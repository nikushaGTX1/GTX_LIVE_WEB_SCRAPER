'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '..', 'main.js'), 'utf8');

function harness(hosted) {
  let now = 0;
  const status = {};
  const logs = [];
  const sandbox = {
    IS_HOSTED: hosted, process: { env: {}, argv: [] }, watcherStatus: status,
    clean: value => String(value).trim(), console: { log: value => logs.push(value) },
    Date: { now: () => now }, sleep: async ms => { now += ms; }
  };
  vm.createContext(sandbox);
  vm.runInContext(source.slice(source.indexOf('async function waitThroughChallenge('), source.indexOf('async function collectCards(')), sandbox);
  const page = {
    waitForTimeout: async () => {}, title: async () => 'Just a moment...',
    locator: () => ({ innerText: async () => 'Verify you are human' })
  };
  return { sandbox, status, logs, page };
}

test('hosted verification fails immediately with an accessible-browser instruction', async () => {
  const { sandbox, status, page } = harness(true);
  await assert.rejects(sandbox.waitThroughChallenge(page), error => error.code === 'MYHOME_SECURITY_CHECK');
  assert.match(status.message, /WATCHER_CDP_URL/);
  assert.equal(page._watcherChallengePending, true);
});

test('visible verification remains pending after timeout and clears when completed', async () => {
  const { sandbox, page, logs } = harness(false);
  await assert.rejects(sandbox.waitThroughChallenge(page, 4000), /open scraper tab/);
  assert.equal(logs.length, 1);
  assert.equal(page._watcherChallengePending, true);
  page.title = async () => 'MyHome';
  page.locator = () => ({ innerText: async () => 'Apartments' });
  await sandbox.waitThroughChallenge(page);
  assert.equal(page._watcherChallengePending, false);
});

test('retry checks the retained tab before navigating and timeout does not close it', async () => {
  const { sandbox, page } = harness(false);
  Object.assign(sandbox, {
    runScan: async () => { throw new Error('Unexpected navigation'); },
    Date: class extends Date {
      static now = (() => { let n = 0; return () => n += 180001; })();
    }
  });
  vm.runInContext(source.slice(source.indexOf('async function scan('), source.indexOf('async function runScan(')), sandbox);
  page._watcherChallengePending = true;
  page.isClosed = () => false;
  page.close = async () => { throw new Error('Unexpected close'); };
  const context = { _myHomeScanPage: page, newPage: async () => { throw new Error('Unexpected new tab'); } };
  await assert.rejects(sandbox.scan(context, {}, {}, { pages: 1, searches: [] }), /verification is still pending/);
  assert.equal(context._myHomeScanPage, page);
});
