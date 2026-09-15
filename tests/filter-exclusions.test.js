'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const { hasExcludedDescription } = require('../description-filter');
const { belongsToSavedOwner, nonCooperatingOwnerIds } = require('../owner-filter');

function refresh(data, rows = []) {
  const context = {
    result: null,
    data,
    blocked: nonCooperatingOwnerIds(rows),
    hasExcludedDescription,
    belongsToSavedOwner
  };
  const fn = source.slice(source.indexOf('function refreshFilterExclusions('), source.indexOf('function match('));
  vm.runInNewContext(`${fn}\nresult = refreshFilterExclusions(data, blocked);`, context);
  return { excluded: context.result.excluded, restored: context.result.restored };
}

const ownerRow = (ownerId, phone, agreement) => [ownerId, phone, '', '', '', '', '', '', agreement];

test('a listing stays excluded only while it still matches a filter', () => {
  const data = {
    stale: { apartment_id: 'stale', description: 'ჩვეულებრივი ბინა', _baseline: true, _excluded: true },
    matching: { apartment_id: 'matching', description: 'აგენტებმა არ დამირეკოთ' },
    clean: { apartment_id: 'clean', description: 'ქირავდება ბინა' }
  };
  const result = refresh(data);
  assert.deepEqual(result, { excluded: 1, restored: 1 });
  assert.equal(data.stale._excluded, undefined);
  assert.equal(data.stale._baseline, false);
  assert.equal(data.matching._excluded, true);
  assert.equal(data.matching._excluded_reason, 'description');
  assert.equal(data.clean._excluded, undefined);
});

test('a cooperating owner is released while a refusing owner stays filtered', () => {
  const rows = [
    ownerRow('111', '555 111 222', 'ინდივიდი არ არის შეთანხმებული'),
    ownerRow('222', '555 333 444', 'სტანდარტული შეთანხმება')
  ];
  const data = {
    refusing: { owner_id: '111', phone: '+995555111222', description: '' },
    cooperating: { owner_id: '222', phone: '+995555333444', description: '', _baseline: true, _excluded: true, _excluded_reason: 'owner_id' }
  };
  const result = refresh(data, rows);
  assert.deepEqual(result, { excluded: 1, restored: 1 });
  assert.equal(data.refusing._excluded_reason, 'owner_id');
  assert.equal(data.cooperating._excluded, undefined);
  assert.equal(data.cooperating._excluded_reason, undefined);
});

test('reviewed apartments are never touched by the automatic filters', () => {
  const data = {
    ready: { description: 'აგენტებმა არ დამირეკოთ', _review_status: 'accepted', _review_comment: 'keep' },
    dismissed: { description: 'ქირავდება ბინა', _review_status: 'rejected', _excluded: true }
  };
  assert.deepEqual(refresh(data), { excluded: 0, restored: 0 });
  assert.equal(data.ready._excluded, undefined);
  assert.equal(data.ready._review_comment, 'keep');
  assert.equal(data.dismissed._excluded, true);
});
