'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const fnSource = source.slice(
  source.indexOf('const KNOWN_DISTRICT_NAMES'),
  source.indexOf('function validateMyHomeUrl(')
);

function districtNameFromApiCard(item, fallback) {
  const context = { result: null, clean: value => String(value ?? '').replace(/\s+/g, ' ').trim(), item, fallback };
  vm.runInNewContext(`${fnSource}\nresult = districtNameFromApiCard(item, fallback);`, context);
  return context.result;
}

test('a multi-neighborhood search tags each listing with its own real area, not the search label', () => {
  const searchLabel = 'Elia';
  assert.equal(districtNameFromApiCard({ urban_name: 'მთაწმინდა' }, searchLabel), 'მთაწმინდა');
  assert.equal(districtNameFromApiCard({ urban_name: 'სოლოლაკი' }, searchLabel), 'სოლოლაკი');
  assert.equal(districtNameFromApiCard({ urban_name: 'ორთაჭალა' }, searchLabel), 'ორთაჭალა');
  assert.equal(districtNameFromApiCard({ urban_name: 'ავლაბარი' }, searchLabel), 'ავლაბარი');
});

test('a known neighborhood maps back to its existing English quick-filter label', () => {
  assert.equal(districtNameFromApiCard({ urban_name: 'საბურთალო' }, 'Custom'), 'Saburtalo');
  assert.equal(districtNameFromApiCard({ urban_name: 'ვაკე' }, 'Custom'), 'Vake');
  assert.equal(districtNameFromApiCard({ urban_name: 'დიდი დიღომი' }, 'Custom'), 'Didi Dighomi');
  assert.equal(districtNameFromApiCard({ urban_name: 'დიღომი' }, 'Custom'), 'Digomi');
});

test('falls back to the search-level label when the API card has no urban_name', () => {
  assert.equal(districtNameFromApiCard({}, 'Elia'), 'Elia');
  assert.equal(districtNameFromApiCard({ urban_name: '' }, 'Elia'), 'Elia');
  assert.equal(districtNameFromApiCard(null, 'Elia'), 'Elia');
});
