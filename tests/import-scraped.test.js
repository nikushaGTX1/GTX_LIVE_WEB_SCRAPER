'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const route = source.slice(
  source.indexOf("    if (pathname === '/api/apartments/import-scraped'"),
  source.indexOf("    if (pathname === '/api/owners' && request.method === 'GET')")
);

function run(rows, { role = 'admin', district, existingData = {}, rejectedIds = [], ownerRows = [] } = {}) {
  const data = existingData;
  const saves = [];
  let assigned = 0;
  let status, result;
  const context = {
    pathname: '/api/apartments/import-scraped', request: { method: 'POST' },
    viewer: { role, name: 'Tester', email: 't@x.com' },
    readRequestJson: async () => ({ rows, district }),
    liveMyHomeData: data, liveSsData: {},
    loadData: () => data, loadSsData: () => ({}),
    permanentApartmentKeys: (myHomeData) => new Set(rejectedIds.map(id => `MyHome:${id}`)),
    apartmentRegistryKey: (source, id) => `${source}:${id}`,
    blockedOwnerIds: () => new Set(ownerRows),
    belongsToSavedOwner: (item, blocked) => blocked.has(`${item.owner_id}:${item.phone}`),
    excludedDescriptionMatch: description => /no agents/i.test(description || '') ? { type: 'phrase' } : null,
    districtNameFromApiCard: (row, fallback) => row.urban_name || fallback,
    myHomeApartment: (row, id, phone, firstSeen, district) => ({
      apartment_id: id, owner_id: String(row.user_id || ''), phone: phone || '', district,
      title: row.dynamic_title || '', description: row.comment || ''
    }),
    assignPendingApartments: async () => { assigned += 1; return 0; },
    loadState: () => ({}),
    saveData: d => saves.push(JSON.parse(JSON.stringify(d))),
    clean: value => String(value ?? '').trim(),
    response: { writeHead: code => { status = code; }, end: body => { result = JSON.parse(body); } }
  };
  vm.runInNewContext(`(async function () { ${route} })()`, context);
  return new Promise(resolve => setImmediate(() => resolve({ data, saves, assigned, status, result })));
}

test('admin/manager only', async () => {
  for (const role of ['agent', 'unauthorized']) {
    const r = await run([{ id: '1' }], { role });
    assert.equal(r.status, 403);
  }
  for (const role of ['admin', 'manager']) {
    const r = await run([{ id: '1' }], { role });
    assert.equal(r.status, 200);
  }
});

test('imports valid rows and skips invalid ids', async () => {
  const r = await run([{ id: '123', dynamic_title: 'Nice flat' }, { id: 'not-a-number' }, {}], { district: 'Vake' });
  assert.equal(r.status, 200);
  assert.equal(r.result.imported, 1);
  assert.equal(r.result.invalid, 2);
  assert.equal(r.data['123'].district, 'Vake');
  assert.equal(r.data['123']._imported_via, 'extension');
  assert.equal(r.assigned, 1);
});

test('permanently dismissed ids are skipped, not re-saved', async () => {
  const r = await run([{ id: '555' }], { rejectedIds: ['555'] });
  assert.equal(r.result.permanentlyDismissed, 1);
  assert.equal(r.result.imported, 0);
  assert.equal(r.data['555'], undefined);
});

test('duplicates (already fully known) are skipped', async () => {
  const r = await run([{ id: '9' }], { existingData: { 9: { title: 'Already here' } } });
  assert.equal(r.result.duplicates, 1);
  assert.equal(r.data['9'].title, 'Already here');
});

test('owner and description filters mark excluded instead of listing', async () => {
  const r = await run([
    { id: '1', user_id: '50', comment: 'fine' },
    { id: '2', comment: 'no agents please' }
  ], { ownerRows: ['50:'] });
  assert.equal(r.result.filteredOwner, 1);
  assert.equal(r.result.filteredDescription, 1);
  assert.equal(r.data['1']._excluded_reason, 'owner_id');
  assert.equal(r.data['2']._excluded_reason, 'description');
});

test('an empty batch is rejected', async () => {
  const r = await run([]);
  assert.equal(r.status, 400);
  assert.match(r.result.error, /No scraped listings/);
});
