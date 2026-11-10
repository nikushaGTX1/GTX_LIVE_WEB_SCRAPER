'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const template = fs.readFileSync(path.join(__dirname, '..', 'dashboard.html'), 'utf8');
const source = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');

function comment(note, selected) {
  const context = { editor: { value: note }, container: { querySelectorAll: () => selected.map(value => ({ value })) } };
  const start = template.indexOf('    const optionLabels =');
  const end = template.indexOf('    document.querySelectorAll', start);
  vm.runInNewContext(template.slice(start, end) + '\nresult = reviewCommentWithOptions(container, editor);', context);
  return context.result;
}

test('review options travel in the saved comment without duplication', () => {
  assert.equal(comment('Call tomorrow', ['Pet friendly', '50% commission']), 'Call tomorrow [Pet friendly] [50% commission]');
  assert.equal(comment('Call tomorrow [Pet friendly]', ['Pet friendly']), 'Call tomorrow [Pet friendly]');
  assert.equal(comment('Call tomorrow [Pet friendly]', []), 'Call tomorrow');
  assert.equal(comment('', ['Pet friendly']), '');
});

test('saved options hydrate the review editor', () => {
  const start = source.indexOf('const RENT_PROPERTY_OPTIONS');
  const end = source.indexOf('\nfunction ', source.indexOf('function propertyOptionsHtml('));
  const context = {};
  vm.runInNewContext(source.slice(start, end) + '; this.propertyOptionsHtml = propertyOptionsHtml;', context);
  const rendered = context.propertyOptionsHtml('Confirmed [Pet friendly] [50% commission] [Indians allowed]');
  assert.match(rendered, /value="Pet friendly" checked/);
  assert.match(rendered, /value="50% commission" checked/);
  assert.match(rendered, /value="Indians allowed" checked/);
  assert.doesNotMatch(rendered, /value="Furnished" checked/);
  const sale = context.propertyOptionsHtml('[თეთრი კარკასი]', 'sale');
  assert.match(sale, /value="თეთრი კარკასი" checked/);
  assert.doesNotMatch(sale, /Pet friendly|Indians allowed|Short-term rental/);
});

test('rent and sale each offer their own options everywhere the option list appears', () => {
  assert.match(template, /<option data-deal="rent">Indians allowed<\/option>/);
  assert.match(template, /<option data-deal="sale">თეთრი კარკასი<\/option>/);
  assert.match(template, /optionLabels = \[.*'Indians allowed'.*'თეთრი კარკასი'/);
  assert.match(source, /const RENT_PROPERTY_OPTIONS = \[.*'Indians allowed'\]/);
  assert.match(source, /const SALE_PROPERTY_OPTIONS = \[.*'თეთრი კარკასი'/);
  assert.match(source, /propertyOptionsFor\(dealTypeOf\(item\)\)\.filter/);
  assert.match(source, /propertyOptionsFor\(deal\)\.map\(label => \[label, label\]\)/);
});



test('accepted comments and options reach matching Owners without touching unrelated rows', () => {
  const start = source.indexOf('function applyAcceptedCommentsToOwners(');
  const end = source.indexOf('\nfunction ', start + 1);
  const context = {
    clean: value => String(value ?? '').trim(),
    liveMyHomeData: { a: { apartment_id: '123', _review_status: 'accepted', _review_comment: 'Confirmed [Pet friendly] [50% commission]' } },
    liveSsData: {},
  };
  vm.runInNewContext(source.slice(start, end), context);
  const data = { rows: [['123', '', '', '', '', '', '', '', 'old'], ['999', '', '', '', '', '', '123', '', 'Keep this note']] };
  assert.equal(context.applyAcceptedCommentsToOwners(data), true);
  assert.equal(data.rows[0][8], 'Confirmed [Pet friendly] [50% commission]');
  assert.equal(data.rows[1][8], 'Keep this note');
  assert.equal(context.applyAcceptedCommentsToOwners(data), false);
});

test('Owners property filters compose with existing price filters', () => {
  const start = template.indexOf('    const ownerNumber =');
  const end = template.indexOf('    const applyOwnerFilters', start);
  const values = { 'owner-filter-option': 'Pet friendly', 'owner-filter-price-max': '800' };
  const context = {
    document: { getElementById: id => ({ value: values[id] || '' }) },
    row: { cells: ['123', '', '', '', '', '750$', '', '', 'Confirmed [Pet friendly]'].map(textContent => ({ textContent })) },
  };
  const check = () => {
    const scope = { ...context };
    vm.runInNewContext(template.slice(start, end) + '\nresult = ownerFilterPasses(row);', scope);
    return scope.result;
  };
  assert.equal(check(), true);
  values['owner-filter-price-max'] = '700';
  assert.equal(check(), false);
  values['owner-filter-price-max'] = '';
  values['owner-filter-option'] = '50% commission';
  assert.equal(check(), false);
});

test('the website upload badge shows the latest upload time', () => {
  assert.match(source, /const uploadedAt = \(item\._listing_uploads \|\| \[\]\)\.at\(-1\)\?\.uploadedAt \|\| item\._api_uploaded_at \|\| ''/);
  assert.match(source, /class="upload-time" title="\$\{html\(uploadedAt\)\}"/);
});
