'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');

function run(status) {
  const context = {};
  const start = source.indexOf('function myHomeFeedError(');
  const end = source.indexOf('\nasync function collectApiCards(');
  vm.runInNewContext(`${source.slice(start, end)}\nresult = myHomeFeedError(${status});`, context);
  return context.result;
}

test('a 401 is tagged so the watcher loop can recognize MyHome revoked the key', () => {
  const error = run(401);
  assert.equal(error.myHomeUnauthorized, true);
  assert.match(error.message, /returned HTTP 401/);
});

test('other HTTP failures are left untagged so they keep retrying normally', () => {
  for (const status of [500, 502, 503, 429]) {
    const error = run(status);
    assert.equal(error.myHomeUnauthorized, undefined, String(status));
  }
});

test('the detail feed reuses the same tagged error, with its own label', () => {
  assert.match(source, /throw myHomeFeedError\(response\.status, 'MyHome detail feed'\)/);
});

test('list and detail feed 401s both flow through the one error constructor', () => {
  assert.equal((source.match(/throw myHomeFeedError\(/g) || []).length, 2);
});

test('the watcher loop logs a sustained 401 once and backs off instead of hammering every tick', () => {
  assert.match(source, /let myHomeUnauthorizedSince = null/);
  assert.match(source, /if \(error\.myHomeUnauthorized\) \{/);
  assert.match(source, /if \(!myHomeUnauthorizedSince\) \{/);
  assert.match(source, /won't log this again until it recovers/);
  assert.match(source, /const delaySeconds = myHomeUnauthorizedSince \? Math\.max\(watcherRuntime\.interval, 600\) : watcherRuntime\.interval/);
  assert.match(source, /await sleep\(delaySeconds \* 1000\)/);
  // A real scan success (not just "no error") clears the backoff so normal
  // outages recover on the very next good tick.
  assert.match(source, /myHomeUnauthorizedSince = null;\s*\n\s*\} catch \(error\)/);
});

test('a non-401 failure still resets the backoff and logs every tick as before', () => {
  assert.match(source, /} else \{\s*\n\s*watcherStatus\.message = 'The last scraper check failed\.';\s*\n\s*myHomeUnauthorizedSince = null;\s*\n\s*console\.error\(`Scan failed: \$\{error\.message\}`\);/);
});
