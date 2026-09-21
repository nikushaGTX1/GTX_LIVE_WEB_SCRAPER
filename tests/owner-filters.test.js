'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'dashboard.html'), 'utf8').replace(/\r\n/g, '\n');
const source = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');

const numberStart = html.indexOf('const ownerNumber = value =>');
const numberEnd = html.indexOf('const applyOwnerFilters');
const filterCode = html.slice(numberStart, numberEnd);

function run(values, cells, added = '') {
  const context = {
    ownerDistrict: '',
    document: { getElementById: id => (id in values ? { value: values[id] } : null) },
    row: { cells: cells.map((text, index) => ({ textContent: text, dataset: index === 9 ? { added } : {} })) },
    result: null
  };
  vm.runInNewContext(`${filterCode}\nresult = ownerFilterPasses(row);`, context);
  return context.result;
}

const cells = (rooms, area, price, note = '') => ['1', '555', 'ვერა', rooms, area, price, '', '', note, ''];

test('rooms and bedrooms are read from the combined cell', () => {
  const row = cells('3 ოთახი 2 საძ', '90 კვ', '750$');
  assert.equal(run({ 'owner-filter-rooms': '3' }, row), true);
  assert.equal(run({ 'owner-filter-rooms': '2' }, row), false);
  assert.equal(run({ 'owner-filter-rooms': '3' }, cells('5 ოთახი 4 საძ', '', '')), false);
  assert.equal(run({ 'owner-filter-rooms': '5+' }, cells('6 ოთახი 4 საძ', '', '')), true);
  assert.equal(run({ 'owner-filter-bedrooms': '2' }, row), true);
  assert.equal(run({ 'owner-filter-bedrooms': '4+' }, cells('5 ოთახი 4 საძ', '', '')), true);
  assert.equal(run({ 'owner-filter-bedrooms': '1' }, row), false);
  assert.equal(run({ 'owner-filter-bedrooms': '1' }, cells('', '', '')), false);
});

test('area and price ranges accept units and skip rows without a number', () => {
  const row = cells('3 ოთახი 2 საძ', '90 კვ', '750$');
  assert.equal(run({ 'owner-filter-area-min': '80', 'owner-filter-area-max': '100' }, row), true);
  assert.equal(run({ 'owner-filter-area-min': '95' }, row), false);
  assert.equal(run({ 'owner-filter-area-max': '60' }, row), false);
  assert.equal(run({ 'owner-filter-price-min': '700', 'owner-filter-price-max': '800' }, row), true);
  assert.equal(run({ 'owner-filter-price-max': '500' }, row), false);
  assert.equal(run({ 'owner-filter-price-min': '1' }, cells('', '', '')), false);
});

test('currency, note and added-date filters', () => {
  assert.equal(run({ 'owner-filter-currency': '$' }, cells('', '', '750$')), true);
  assert.equal(run({ 'owner-filter-currency': '₾' }, cells('', '', '750$')), false);
  assert.equal(run({ 'owner-filter-currency': '₾' }, cells('', '', '1500 ₾')), true);
  assert.equal(run({ 'owner-filter-comment': 'with' }, cells('', '', '', 'ok')), true);
  assert.equal(run({ 'owner-filter-comment': 'with' }, cells('', '', '')), false);
  assert.equal(run({ 'owner-filter-comment': 'without' }, cells('', '', '')), true);
  const now = new Date().toISOString();
  const old = new Date(Date.now() - 20 * 86400000).toISOString();
  assert.equal(run({ 'owner-filter-added': 'today' }, cells('', '', ''), now), true);
  assert.equal(run({ 'owner-filter-added': 'today' }, cells('', '', ''), old), false);
  assert.equal(run({ 'owner-filter-added': '7' }, cells('', '', ''), old), false);
  assert.equal(run({ 'owner-filter-added': '30' }, cells('', '', ''), old), true);
  assert.equal(run({ 'owner-filter-added': '30' }, cells('', '', ''), ''), false);
  assert.equal(run({}, cells('', '', '')), true);
});

test('owners view renders the filter bar and the date cell carries its raw date', () => {
  for (const id of ['district', 'rooms', 'bedrooms', 'area-min', 'area-max', 'price-min', 'price-max', 'currency', 'added', 'comment']) {
    assert.match(source, new RegExp(`owner-filter-\$\{id\}|'owner-filter-${id.split('-')[0]}'`));
  }
  assert.match(source, /owner-filter-reset/);
  assert.match(source, /data-added=/);
  assert.match(source, /\$\{ownerFiltersHtml\(districts\)\}/);
});
