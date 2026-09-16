'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const fnSource = source.slice(
  source.indexOf('async function updateWatcherConfig('),
  source.indexOf('async function reviewApartment(')
);

async function run(body, watcherRuntime) {
  let status, result;
  const context = {
    watcherRuntime,
    watcherStatus: { state: 'idle', message: '' },
    clean: value => String(value ?? '').trim(),
    validateMyHomeUrl: value => value,
    districtNameFromUrl: () => 'Other',
    searchKey: (url, pages) => `${url}|pages=${pages}`,
    saveWatcherConfig: () => {},
    publicWatcherConfig: () => ({ searches: watcherRuntime.searches }),
    request: { },
    readRequestJson: async () => body,
    response: { writeHead: code => { status = code; }, end: text => { result = JSON.parse(text); } }
  };
  vm.createContext(context);
  await vm.runInContext(`(${fnSource})(request, response)`, context);
  // vm-context objects fail assert.deepEqual's prototype check even when
  // their content matches, so hand back plain JSON-round-tripped data.
  return { status, result, watcherRuntime: JSON.parse(JSON.stringify(watcherRuntime)) };
}

test('sending a new search link replaces any previously configured search', async () => {
  const watcherRuntime = { enabled: true, pages: 5, interval: 3, searches: [{ district: 'Vera', url: 'https://www.myhome.ge/vera' }] };
  const { status, watcherRuntime: after } = await run({ url: 'https://www.myhome.ge/avlabari', district: 'Avlabari' }, watcherRuntime);
  assert.equal(status, 200);
  assert.deepEqual(after.searches, [{ district: 'Avlabari', url: 'https://www.myhome.ge/avlabari' }]);
});

test('a fresh link replaces even a search list that was accumulated before this fix', async () => {
  const watcherRuntime = {
    enabled: true, pages: 5, interval: 3,
    searches: [
      { district: 'Vera', url: 'https://www.myhome.ge/vera' },
      { district: 'Avlabari', url: 'https://www.myhome.ge/avlabari' },
      { district: 'Elia', url: 'https://www.myhome.ge/elia' }
    ]
  };
  const { watcherRuntime: after } = await run({ url: 'https://www.myhome.ge/saburtalo', district: 'Saburtalo' }, watcherRuntime);
  assert.equal(after.searches.length, 1);
  assert.equal(after.searches[0].district, 'Saburtalo');
});

test('removing the only active search clears the list and pauses the watcher', async () => {
  const watcherRuntime = { enabled: true, pages: 5, interval: 3, searches: [{ district: 'Vera', url: 'https://www.myhome.ge/vera' }] };
  const { watcherRuntime: after } = await run({ removeUrl: 'https://www.myhome.ge/vera' }, watcherRuntime);
  assert.deepEqual(after.searches, []);
  assert.equal(after.enabled, false);
});
