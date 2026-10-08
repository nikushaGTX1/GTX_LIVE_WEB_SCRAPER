'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { launchBrowserbase } = require('../browserbase');

function harness(failConnect = false) {
  const calls = [];
  let disconnected;
  let closed = 0;
  const context = {};
  const chromium = { connectOverCDP: async url => {
    assert.equal(url, 'wss://example.invalid/test');
    if (failConnect) throw new Error('secret connection URL');
    return { contexts: () => [context], on: (name, fn) => { disconnected = fn; }, close: async () => { closed++; } };
  } };
  const request = async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body), headers: options.headers });
    return { ok: true, json: async () => ({ id: 'session-1', connectUrl: 'wss://example.invalid/test', expiresAt: '2030-01-01T00:00:00Z' }) };
  };
  return { chromium, request, calls, context, disconnect: () => disconnected(), closed: () => closed };
}

test('creates persistent session, tracks disconnect and releases on pause', async () => {
  const h = harness();
  const context = await launchBrowserbase(h.chromium, {
    request: h.request, env: { BROWSERBASE_API_KEY: 'test-key', BROWSERBASE_PROJECT_ID: 'project-1' }, contextId: 'saved-context'
  });
  assert.deepEqual(h.calls[0].body.browserSettings, { solveCaptchas: false, context: { id: 'saved-context', persist: true } });
  assert.equal(h.calls[0].headers['X-BB-API-Key'], 'test-key');
  assert.equal(context._browserbaseExpiresAt, Date.parse('2030-01-01T00:00:00Z'));
  h.disconnect();
  assert.equal(context._browserbaseDisconnected, true);
  await context.close();
  assert.equal(h.closed(), 1);
  assert.equal(h.calls[1].body.status, 'REQUEST_RELEASE');
});

test('failed CDP connection releases the created session and hides connection secrets', async () => {
  const h = harness(true);
  await assert.rejects(launchBrowserbase(h.chromium, { request: h.request, env: {} }), error => {
    assert.doesNotMatch(error.message, /secret/);
    return /Could not connect/.test(error.message);
  });
  assert.equal(h.calls[1].body.status, 'REQUEST_RELEASE');
});

test('API rejection exposes status without printing response credentials', async () => {
  await assert.rejects(launchBrowserbase({}, {
    env: {}, request: async () => ({ ok: false, status: 401, json: async () => { throw new Error('Should not read rejected body'); } })
  }), /HTTP 401/);
});
