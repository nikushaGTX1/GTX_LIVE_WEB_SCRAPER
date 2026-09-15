'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { belongsToSavedOwner, ownerIdsFromRows } = require('../owner-filter');

test('matches only when owner ID and normalized phone match the same Owners row', () => {
  const ownerIds = ownerIdsFromRows([
    ['9829952', '555 111 222'],
    [' 12 34 ', '555 333 444']
  ]);

  assert.equal(belongsToSavedOwner({ owner_id: 9829952, phone: '+995 555-111-222' }, ownerIds), true);
  assert.equal(belongsToSavedOwner({ owner_id: '1234', phone: '555333444' }, ownerIds), true);
  assert.equal(belongsToSavedOwner({ owner_id: 9829952, phone: '555333444' }, ownerIds), false);
  assert.equal(belongsToSavedOwner({ owner_id: '5555', phone: '555111222' }, ownerIds), false);
});

test('does not match when owner ID or full phone is missing', () => {
  const ownerIds = ownerIdsFromRows([['9829952', '555 111 222']]);
  assert.equal(belongsToSavedOwner({}, ownerIds), false);
  assert.equal(belongsToSavedOwner({ owner_id: '', phone: '555111222' }, ownerIds), false);
  assert.equal(belongsToSavedOwner({ owner_id: '9829952', phone: '555111***' }, ownerIds), false);
});
