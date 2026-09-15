'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  belongsToSavedOwner, nonCooperatingOwnerIds, ownerIdsFromRows, ownerRefusesCooperation
} = require('../owner-filter');

// [ownerId, phone, district, rooms, area, price, myHomeId, ssId, agreement]
const ownerRow = (ownerId, phone, agreement) => [ownerId, phone, '', '', '', '', '', '', agreement];

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

test('an agreement note is read as cooperation unless it records a refusal', () => {
  for (const note of [
    'ინდივიდი არ არის შეთანხმებული',
    'სააგენტოებთან არ ვთანამშრომლობს',
    'ვერ შევთანხმდით',
    'უარი თქვა',
    'ar aris shetankhmebuli',
    'uari',
    'not agreed',
    'owner refused'
  ]) {
    assert.equal(ownerRefusesCooperation(note), true, note);
  }

  for (const note of [
    '',
    'სტანდარტული შეთანხმება',
    'მოკლედ სტანდარტული შეთანხმება',
    'შეთანხმება ცხოველებზე',
    'რუსები და ცხოველები შეთანხმდება',
    'დავუკავშირდეთ შეთანხმებისთვის',
    'ბინა არ არის თავისუფალი მარტამდე',
    'standard agreement'
  ]) {
    assert.equal(ownerRefusesCooperation(note), false, note);
  }
});

test('only owners recorded as refusing keep the scraper away from their listings', () => {
  const blocked = nonCooperatingOwnerIds([
    ownerRow('111', '555 111 222', 'ინდივიდი არ არის შეთანხმებული'),
    ownerRow('222', '555 333 444', 'სტანდარტული შეთანხმება'),
    ownerRow('333', '555 555 666', '')
  ]);

  assert.equal(belongsToSavedOwner({ owner_id: '111', phone: '555111222' }, blocked), true);
  assert.equal(belongsToSavedOwner({ owner_id: '222', phone: '555333444' }, blocked), false);
  assert.equal(belongsToSavedOwner({ owner_id: '333', phone: '555555666' }, blocked), false);
  assert.equal(blocked.size, 1);
  assert.equal(ownerIdsFromRows([
    ownerRow('111', '555 111 222', 'ინდივიდი არ არის შეთანხმებული'),
    ownerRow('222', '555 333 444', 'სტანდარტული შეთანხმება')
  ]).size, 2);
});
