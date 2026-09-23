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
  const start = source.indexOf('function propertyOptionsHtml(');
  const end = source.indexOf('\nfunction ', start + 1);
  const context = {};
  vm.runInNewContext(source.slice(start, end), context);
  const rendered = context.propertyOptionsHtml('Confirmed [Pet friendly] [50% commission] [Indians allowed]');
  assert.match(rendered, /value="Pet friendly" checked/);
  assert.match(rendered, /value="50% commission" checked/);
  assert.match(rendered, /value="Indians allowed" checked/);
  assert.doesNotMatch(rendered, /value="Furnished" checked/);
});

test('Indians allowed is a selectable option everywhere the option list appears', () => {
  assert.match(template, /<option>Indians allowed<\/option>/);
  assert.match(template, /optionLabels = \[.*'Indians allowed'\]/);
  assert.match(source, /'Short-term rental', 'Indians allowed'\]\.map/);
  assert.match(source, /'Short-term rental', 'Indians allowed'\]\.filter/);
  assert.match(source, /\['Indians allowed', 'Indians allowed'\]/);
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
