const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');

test('accepted and rejected apartment IDs are global permanent duplicates', () => {
  assert.match(source, /const REJECTED_APARTMENTS_PATH = path\.join\(DATA_ROOT, 'rejected-apartments\.json'\)/);
  assert.match(source, /function permanentApartmentKeys\(myHomeData = \{\}, ssData = \{\}\)/);
  assert.match(source, /item\._review_status === 'accepted' \|\| item\._review_status === 'rejected'/);
  assert.match(source, /permanentKeys\.has\(apartmentRegistryKey\('MyHome', card\.id\)\)/);
  assert.match(source, /permanentKeys\.has\(apartmentRegistryKey\('SS\.ge', card\.id\)\)/);
});

test('reject action writes a durable rejection registry entry', () => {
  assert.match(source, /if \(body\.action === 'rejected'\) rememberRejectedApartment/);
  assert.match(source, /fs\.writeFileSync\(REJECTED_APARTMENTS_PATH/);
});

test('district-removed apartment IDs are scraper duplicates but bulk-cleared IDs are forgotten', () => {
  assert.match(source, /function rememberRemovedApartment\(item, source, viewer\)/);
  assert.match(source, /function forgetRemovedApartment\(item, source\)/);
  assert.match(source, /Object\.keys\(removedApartmentRegistry\(\)\)/);
  assert.doesNotMatch(source, /restoreAccidentallyExcludedApartments/);
});
