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
    other: { district: 'Vake', assigned_agent_id: 'agent-2' },
    unlisted: { district: 'Unlisted district', assigned_agent_id: 'agent-2' },
    ready: { district: 'Vake', assigned_agent_id: 'agent-1', _review_status: 'accepted' },
    uploaded: { district: 'Vake', assigned_agent_id: 'agent-1', _api_uploaded: true, _website_api_apartment_id: 123 },
    baseline: { _baseline: true },
    rejected: { _review_status: 'rejected' }
  };
  const ss = { waiting: { district: 'Digomi', assigned_agent_id: 'agent-1' }, ready: { _review_status: 'accepted' } };
  const before = JSON.parse(JSON.stringify({ myhome, ss }));
  const saves = [];
  const writes = [];
  let status, result;
  vm.runInNewContext(`(function () { ${route} })()`, {
    pathname: '/api/apartments', request: { method: 'DELETE' },
    requestUrl: new URL(`http://localhost/api/apartments${query}`),
    viewer: { role, email: 'viewer@test', agentId: 'agent-1' }, clean: value => String(value || '').trim(),
    fs: { writeFileSync: (...args) => writes.push(args) },
    liveMyHomeData: myhome, liveSsData: ss,
    saveData: data => saves.push(data), SS_DATA_PATH: 'ss.json', SS_CSV_PATH: 'ss.csv',
    response: { writeHead: code => { status = code; }, end: body => { result = JSON.parse(body); } }
  });
  return { myhome, ss, before, saves, writes, status, result };
}

test('unscoped management reset clears every agent queue but keeps ready and uploaded records', () => {
  const r = run('?scope=all-pending');
  assert.equal(r.status, 200);
  assert.equal(r.result.removed, 6);
  assert.equal(r.result.preserved, 3);
  assert.equal(r.saves.length, 2);
  assert.equal(r.myhome.waiting, undefined);
  assert.equal(r.myhome.other, undefined);
  assert.equal(r.myhome.unlisted, undefined);
  assert.equal(r.ss.waiting, undefined);
  for (const key of ['ready', 'uploaded']) assert.deepEqual(r.myhome[key], r.before.myhome[key]);
  assert.equal(r.myhome.baseline, undefined);
  assert.equal(r.myhome.rejected, undefined);
  assert.deepEqual(r.ss.ready, r.before.ss.ready);
});

test('clearing one agent pending list leaves every other agent untouched', () => {
  const r = run('?scope=all-pending&agent=agent-1');
  assert.equal(r.status, 200);
  assert.equal(r.result.agentId, 'agent-1');
  assert.equal(r.result.removed, 2);
  assert.equal(r.myhome.waiting, undefined);
  assert.equal(r.ss.waiting, undefined);
  assert.deepEqual(r.myhome.other, r.before.myhome.other);
  assert.deepEqual(r.myhome.unlisted, r.before.myhome.unlisted);
  assert.deepEqual(r.myhome.ready, r.before.myhome.ready);
  assert.deepEqual(r.myhome.uploaded, r.before.myhome.uploaded);
  assert.deepEqual(r.myhome.baseline, r.before.myhome.baseline);
  assert.deepEqual(r.ss.ready, r.before.ss.ready);
});

test('agent bulk clear removes only that agent pending apartments', () => {
  const r = run('?scope=all-pending', 'agent');
  assert.equal(r.status, 200);
  assert.equal(r.result.removed, 2);
  assert.equal(r.myhome.waiting, undefined);
  assert.deepEqual(r.myhome.other, r.before.myhome.other);
  assert.deepEqual(r.myhome.ready, r.before.myhome.ready);
  assert.deepEqual(r.ss.ready, r.before.ss.ready);
});

test('an agent cannot widen the scope with the agent parameter', () => {
  const r = run('?scope=all-pending&agent=agent-2', 'agent');
  assert.equal(r.result.agentId, 'agent-1');
  assert.deepEqual(r.myhome.other, r.before.myhome.other);
});

test('manager bulk clear has global scope and missing scope is rejected', () => {
  const manager = run('?scope=all-pending', 'manager');
  assert.equal(manager.status, 200);
  assert.equal(manager.result.removed, 6);
  for (const [query, role, status] of [['', 'admin', 400], ['', 'agent', 400]]) {
    const r = run(query, role);
    assert.equal(r.status, status);
    assert.deepEqual({ myhome: r.myhome, ss: r.ss }, r.before);
    assert.equal(r.saves.length, 0);
  }
});

test('district deletion stays inside the district and inside the open agent profile', () => {
  const everyone = run('?district=Vake');
  assert.equal(everyone.result.removed, 2);
  assert.deepEqual(everyone.myhome.unlisted, everyone.before.myhome.unlisted);
  assert.deepEqual(everyone.ss, everyone.before.ss);
  assert.deepEqual(everyone.myhome.ready, everyone.before.myhome.ready);

  const profile = run('?district=Vake&agent=agent-1');
  assert.equal(profile.result.removed, 1);
  assert.equal(profile.myhome.waiting, undefined);
  assert.deepEqual(profile.myhome.other, profile.before.myhome.other);
  assert.deepEqual(profile.myhome.ready, profile.before.myhome.ready);
  assert.deepEqual(profile.myhome.uploaded, profile.before.myhome.uploaded);
});

test('no list-clearing path writes an exclusion file or a duplicate registry entry', () => {
  for (const query of ['?scope=all-pending', '?scope=all-pending&agent=agent-1', '?district=Vake']) {
    assert.deepEqual(run(query).writes, [], query);
  }
  assert.doesNotMatch(route, /remember\w*Apartment|forget\w*Apartment|REJECTED_APARTMENTS_PATH/);
  assert.doesNotMatch(source, /removed-apartments\.json/);
});
