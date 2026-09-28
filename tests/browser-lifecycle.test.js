'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const start = source.indexOf('async function ensureBrowserContext(');
const end = source.indexOf('function saveData(', start);
const lifecycleSource = source.slice(start, end);

function makeContext({ IS_HOSTED = true, launchDelayMs = 0 } = {}) {
  const launches = [];
  const closes = [];
  const context = {
    IS_HOSTED,
    pathToFileURL: value => ({ href: value }),
    DASHBOARD_PATH: '/tmp/live-results.html',
    browserContext: null,
    browserContextPromise: null,
    launchBrowserContext: async () => {
      const id = launches.length + 1;
      launches.push(id);
      if (launchDelayMs) await new Promise(resolve => setTimeout(resolve, launchDelayMs));
      let closed = false;
      return {
        id,
        pages: () => [],
        newPage: async () => ({ goto: async () => {} }),
        close: async () => { closed = true; closes.push(id); },
        get closed() { return closed; }
      };
    },
    console: { log: () => {}, error: () => {} }
  };
  vm.createContext(context);
  vm.runInContext(lifecycleSource, context);
  return { context, launches, closes };
}

test('resuming launches exactly one browser, even when awaited concurrently', async () => {
  const { context, launches } = makeContext({ launchDelayMs: 10 });
  const [a, b, c] = await Promise.all([
    vm.runInContext('ensureBrowserContext({})', context),
    vm.runInContext('ensureBrowserContext({})', context),
    vm.runInContext('ensureBrowserContext({})', context)
  ]);
  assert.equal(launches.length, 1);
  assert.equal(a.id, b.id);
  assert.equal(b.id, c.id);
});

test('pausing closes the browser; the next resume launches a fresh one, never two at once', async () => {
  const { context, launches, closes } = makeContext();
  const first = await vm.runInContext('ensureBrowserContext({})', context);
  assert.equal(launches.length, 1);

  await vm.runInContext('releaseBrowserContext()', context);
  assert.deepEqual(closes, [first.id]);
  assert.equal(first.closed, true);
  assert.equal(vm.runInContext('browserContext', context), null);

  const second = await vm.runInContext('ensureBrowserContext({})', context);
  assert.equal(launches.length, 2);
  assert.notEqual(second.id, first.id);
});

test('releasing while paused with nothing running is a safe no-op', async () => {
  const { context, launches, closes } = makeContext();
  await vm.runInContext('releaseBrowserContext()', context);
  assert.equal(launches.length, 0);
  assert.equal(closes.length, 0);
});

test('repeated pause/resume toggles never leave two browsers open at once', async () => {
  const { context, launches, closes } = makeContext();
  for (let i = 0; i < 5; i += 1) {
    await vm.runInContext('ensureBrowserContext({})', context);
    await vm.runInContext('releaseBrowserContext()', context);
  }
  assert.equal(launches.length, 5);
  assert.equal(closes.length, 5);
  assert.equal(vm.runInContext('browserContext', context), null);
});

test('the watcher loop releases the browser instead of scanning while paused', () => {
  assert.match(source, /const browserNeeded = watcherRuntime\.enabled \|\| SS_SCRAPER_ENABLED/);
  assert.match(source, /if \(!browserNeeded\) \{[\s\S]{0,200}await releaseBrowserContext\(\);/);
  assert.match(source, /const context = await ensureBrowserContext\(options\);/);
  assert.match(source, /await releaseBrowserContext\(\);\s*\n\s*await new Promise\(resolve => server\.close\(resolve\)\);/);
});
