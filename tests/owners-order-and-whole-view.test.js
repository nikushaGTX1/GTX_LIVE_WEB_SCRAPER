'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');

function sortOwnersNewestFirst(rows) {
  const context = { clean: value => String(value ?? '').trim(), OWNER_ADDED_COLUMN: 9, result: null, rows };
  const start = source.indexOf('function sortOwnersNewestFirst(');
  const end = source.indexOf('\nfunction ', start + 1);
  vm.runInNewContext(`${source.slice(start, end)}\nresult = sortOwnersNewestFirst(rows).map(row => row[0]);`, context);
  return Array.from(context.result);
}

const row = (id, added) => [id, '', '', '', '', '', '', '', '', added];

test('owners are ordered newest to oldest; undated rows keep their order after dated ones', () => {
  const order = sortOwnersNewestFirst([
    row('old-undated-1', ''),
    row('mid', '2026-09-10T10:00:00.000Z'),
    row('old-undated-2', ''),
    row('new', '2026-09-20T10:00:00.000Z'),
    row('same-time-b', '2026-09-10T10:00:00.000Z')
  ]);
  assert.deepEqual(order, ['new', 'mid', 'same-time-b', 'old-undated-1', 'old-undated-2']);
});

test('owners get a date added column filled on create, add-row and import', () => {
  assert.match(source, /'დამატების თარიღი'\];/);
  assert.match(source, /incoming\[OWNER_ADDED_COLUMN\] = incoming\[OWNER_ADDED_COLUMN\] \|\| new Date\(\)\.toISOString\(\)/);
  assert.match(source, /index === OWNER_ADDED_COLUMN \? new Date\(\)\.toISOString\(\)/);
  assert.match(source, /columnIndex === OWNER_ADDED_COLUMN && !cell \? importedAt : cell/);
  assert.match(source, /data\.rows = sortOwnersNewestFirst\(data\.rows\)/);
});

test('the date column is read-only in the table', () => {
  assert.match(source, /readOnly \|\| columnIndex === OWNER_ADDED_COLUMN \? '' : ' contenteditable="true"'/);
});

test('every account can open the whole owner database read-only', () => {
  assert.match(source, /const WHOLE_OWNERS_VIEWER = \{ role: 'admin', email: 'owners-inbox' \}/);
  assert.match(source, /const readOnly = whole \|\| ownersPathFor\(subject\) !== ownersPathFor\(viewer\)/);
  assert.match(source, /whole \? ownersData\(WHOLE_OWNERS_VIEWER\)/);
  assert.match(source, /clean\(requestUrl\.searchParams\.get\('scope'\)\)/);
  // No role check gates scope=all: the route only restricts the team view.
  assert.doesNotMatch(source, /scope'\)[^\n]*role/);
  const html = fs.readFileSync(path.join(__dirname, '..', 'dashboard.html'), 'utf8');
  assert.match(html, /See whole owner database/);
  assert.match(html, /\/\?view=owners&scope=all/);
});
