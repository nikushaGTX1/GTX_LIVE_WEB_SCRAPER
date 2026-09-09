'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { belongsToSavedOwner, ownerIdsFromRows } = require('../owner-filter');

test('matches a scraped owner ID against the first Owners column', () => {
  const ownerIds = ownerIdsFromRows([
    ['9829952', '555 111 222'],
    [' 12 34 ', '555 333 444']
  ]);

  assert.equal(belongsToSavedOwner({ owner_id: 9829952 }, ownerIds), true);
  assert.equal(belongsToSavedOwner({ owner_id: '1234' }, ownerIds), true);
  assert.equal(belongsToSavedOwner({ owner_id: '5555' }, ownerIds), false);
});

test('does not match missing owner IDs', () => {
  const ownerIds = ownerIdsFromRows([['9829952']]);
  assert.equal(belongsToSavedOwner({}, ownerIds), false);
  assert.equal(belongsToSavedOwner({ owner_id: '' }, ownerIds), false);
});
