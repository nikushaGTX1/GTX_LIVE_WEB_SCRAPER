'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const { belongsToSavedOwner, nonCooperatingOwnerIds } = require('../owner-filter');

function load(names, extra = {}) {
  const context = {
    clean: value => String(value ?? '').replace(/\s+/g, ' ').trim(),
    hasExcludedDescription: () => false,
    belongsToSavedOwner,
    ...extra
  };
  vm.createContext(context);
  for (const name of names) {
    const start = source.indexOf(`function ${name}(`);
    const end = source.indexOf('\nfunction ', start + 1);
    vm.runInContext(source.slice(start, end === -1 ? undefined : end), context);
  }
  return context;
}

const ownerRow = (id, phone, note = '') => [id, phone, '', '', '', '', '', '', note];

test('an accepted apartment stays listed even when its owner is blocked or it is excluded', () => {
  const { isListedApartment } = load(['isListedApartment']);
  const blocked = nonCooperatingOwnerIds([ownerRow('111', '555 111 222', 'ინდივიდი არ არის შეთანხმებული')]);
  const accepted = { owner_id: '111', phone: '+995555111222', _review_status: 'accepted', _excluded: true, _baseline: true };
  assert.equal(isListedApartment(accepted, blocked), true);
});

test('unreviewed blocked, excluded and rejected apartments stay hidden', () => {
  const { isListedApartment } = load(['isListedApartment']);
  const blocked = nonCooperatingOwnerIds([ownerRow('111', '555 111 222', 'ინდივიდი არ არის შეთანხმებული')]);
  assert.equal(isListedApartment({ owner_id: '111', phone: '555111222' }, blocked), false);
  assert.equal(isListedApartment({ _excluded: true }, blocked), false);
  assert.equal(isListedApartment({ _review_status: 'rejected' }, blocked), false);
  assert.equal(isListedApartment({ owner_id: '9', phone: '555000111' }, blocked), true);
});

test('dashboard and CSV both use the shared listing rule', () => {
  assert.equal((source.match(/isListedApartment\(/g) || []).length, 3);
});

test('review accepts Word-imported apartments, stored with the MyHome data', () => {
  assert.match(source, /\['myhome', 'ss\.ge', 'word'\]\.includes\(requestedSource\)/);
  assert.match(source, /requestedSource === 'myhome' \|\| requestedSource === 'word'/);
});

test('owner upsert matches by owner ID, else phone, else listing ID, so rows without an ID still get added', () => {
  const { ownerRowIndex } = load(['digitsOnly', 'ownerRowIndex']);
  const rows = [ownerRow('111', '555 111 222'), ownerRow('', '599 000 111'), Object.assign(ownerRow('', ''), { 6: '777' })];
  const blank = (over) => Object.assign(ownerRow('', ''), over);
  assert.equal(ownerRowIndex(rows, blank({ 0: '111' })), 0);
  assert.equal(ownerRowIndex(rows, blank({ 0: '222' })), -1);
  assert.equal(ownerRowIndex(rows, blank({ 1: '+995 599-000-111' })), 1);
  assert.equal(ownerRowIndex(rows, blank({ 6: '777' })), 2);
  assert.equal(ownerRowIndex(rows, blank({ 1: '500 500 500' })), -1);
  assert.match(source, /Owner ID, phone or listing ID is required/);
});
