const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');

function permanentKeys(registry, myHomeData, ssData) {
  const context = {
    result: null,
    readJsonFile: () => registry,
    REJECTED_APARTMENTS_PATH: 'rejected-apartments.json',
    clean: value => String(value ?? '').trim(),
    myHomeData,
    ssData
  };
  const helpers = source.slice(source.indexOf('function apartmentRegistryKey('), source.indexOf('function runOneTimeScrapeHistoryReset('));
  vm.runInNewContext(`${helpers}\nresult = permanentApartmentKeys(myHomeData, ssData);`, context);
  return context.result;
}

test('only the × button writes the persistent exclusion registry', () => {
  assert.match(source, /const REJECTED_APARTMENTS_PATH = path\.join\(DATA_ROOT, 'rejected-apartments\.json'\)/);
  assert.match(source, /if \(body\.action === 'rejected'\) rememberRejectedApartment/);
  assert.match(source, /fs\.writeFileSync\(REJECTED_APARTMENTS_PATH/);
  // The registry is keyed by the listing's stable source ID, never by title,
  // address or price.
  assert.match(source, /function apartmentRegistryKey\(source, apartmentId\) \{\n\s+return `\$\{source === 'SS\.ge' \? 'SS\.ge' : 'MyHome'\}:\$\{clean\(apartmentId\)\}`/);
  assert.equal(source.match(/fs\.writeFileSync\(REJECTED_APARTMENTS_PATH/g).length, 1);
});

test('removing an apartment from a list never persists it as a duplicate', () => {
  assert.doesNotMatch(source, /removed-apartments\.json|rememberRemovedApartment|forgetRemovedApartment|removedApartmentRegistry/);
  assert.doesNotMatch(source, /restoreAccidentallyExcludedApartments/);
});

test('dismissed IDs stay blocked for both sources while unreviewed IDs do not', () => {
  const keys = permanentKeys(
    { 'MyHome:111': { apartmentId: '111' }, 'SS.ge:222': { apartmentId: '222' } },
    { 333: { apartment_id: '333', _review_status: 'accepted' }, 444: { apartment_id: '444' } },
    { 555: { apartment_id: '555', _review_status: 'rejected' } }
  );
  assert.equal(keys.has('MyHome:111'), true);
  assert.equal(keys.has('SS.ge:222'), true);
  assert.equal(keys.has('MyHome:333'), true);
  assert.equal(keys.has('SS.ge:555'), true);
  assert.equal(keys.has('MyHome:444'), false);
});

test('both scrapers consult the exclusion keys before importing a listing', () => {
  assert.match(source, /permanentKeys\.has\(apartmentRegistryKey\('MyHome', card\.id\)\)/);
  assert.match(source, /permanentKeys\.has\(apartmentRegistryKey\('SS\.ge', card\.id\)\)/);
});

test('startup performs one versioned scrape-history reset without deleting ready apartments', () => {
  assert.match(source, /function runOneTimeScrapeHistoryReset\(data, ssData, state\)/);
  assert.match(source, /if \(item\._review_status === 'accepted'\) continue/);
  assert.match(source, /state\.scrape_history_reset_version = resetVersion/);
  assert.match(source, /Owners and Ready For Upload were preserved/);
});
