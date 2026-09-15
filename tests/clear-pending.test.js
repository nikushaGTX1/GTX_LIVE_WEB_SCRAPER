const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const route = source.slice(source.indexOf("    if (pathname === '/api/apartments' && request.method === 'DELETE')"), source.indexOf("    if (pathname === '/api/apartments/import-word'"));

function run(query, role = 'admin') {
  const myhome = {
    waiting: { district: 'Vake', assigned_agent_id: 'agent-1' },
    other: { district: 'Unlisted district', assigned_agent_id: 'agent-2' },
    ready: { district: 'Vake', _review_status: 'accepted' },
    uploaded: { district: 'Vake', _review_status: 'accepted', _website_api_apartment_id: 123 },
    baseline: { _baseline: true },
    rejected: { _review_status: 'rejected' }
  };
  const ss = { waiting: { district: 'Digomi' }, ready: { _review_status: 'accepted' } };
  const before = JSON.parse(JSON.stringify({ myhome, ss }));
  const saves = [];
  let status, result;
  vm.runInNewContext(`(function () { ${route} })()`, {
    pathname: '/api/apartments', request: { method: 'DELETE' },
    requestUrl: new URL(`http://localhost/api/apartments${query}`),
    viewer: { role, email: 'viewer@test', agentId: 'agent-1' }, clean: value => String(value || '').trim(),
    rememberRemovedApartment: () => {},
    forgetRemovedApartment: () => {}, fs: { writeFileSync: () => {} }, REMOVED_APARTMENTS_PATH: 'removed.json',
    liveMyHomeData: myhome, liveSsData: ss,
    saveData: data => saves.push(data), SS_DATA_PATH: 'ss.json', SS_CSV_PATH: 'ss.csv',
    response: { writeHead: code => { status = code; }, end: body => { result = JSON.parse(body); } }
  });
  return { myhome, ss, before, saves, status, result };
}

test('bulk reset removes scrape history across sources and districts, preserving ready records', () => {
  const r = run('?scope=all-pending');
  assert.equal(r.status, 200);
  assert.equal(r.result.removed, 5);
  assert.equal(r.saves.length, 2);
  assert.equal(r.myhome.waiting, undefined);
  assert.equal(r.myhome.other, undefined);
  assert.equal(r.ss.waiting, undefined);
  for (const key of ['ready', 'uploaded']) assert.deepEqual(r.myhome[key], r.before.myhome[key]);
  assert.equal(r.myhome.baseline, undefined);
  assert.equal(r.myhome.rejected, undefined);
  assert.deepEqual(r.ss.ready, r.before.ss.ready);
});

test('agent bulk clear removes only that agent pending apartments', () => {
  const r = run('?scope=all-pending', 'agent');
  assert.equal(r.status, 200);
  assert.equal(r.result.removed, 1);
  assert.equal(r.myhome.waiting, undefined);
  assert.deepEqual(r.myhome.other, r.before.myhome.other);
  assert.deepEqual(r.ss, r.before.ss);
});

test('manager bulk clear has global scope and missing scope is rejected', () => {
  const manager = run('?scope=all-pending', 'manager');
  assert.equal(manager.status, 200);
  assert.equal(manager.result.removed, 5);
  for (const [query, role, status] of [['', 'admin', 400], ['', 'agent', 400]]) {
    const r = run(query, role);
    assert.equal(r.status, status);
    assert.deepEqual({ myhome: r.myhome, ss: r.ss }, r.before);
    assert.equal(r.saves.length, 0);
  }
});

test('district deletion remains limited to the requested district', () => {
  const r = run('?district=Vake');
  assert.equal(r.result.removed, 1);
  assert.deepEqual(r.myhome.other, r.before.myhome.other);
  assert.deepEqual(r.ss, r.before.ss);
  assert.deepEqual(r.myhome.ready, r.before.myhome.ready);
});

test('bulk pending clear is not saved as a duplicate, while district removal is', () => {
  assert.match(route, /if \(allPending\) forgetRemovedApartment\(item, source\.name\)/);
  assert.match(route, /else rememberRemovedApartment\(item, source\.name, viewer\)/);
  assert.match(source, /const REMOVED_APARTMENTS_PATH = path\.join\(DATA_ROOT, 'removed-apartments\.json'\)/);
});
