const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');

test('dashboard API accepts Website API bearer tokens', () => {
  assert.match(source, /async function authenticateBearerViaWebsiteApi\(token\)/);
  assert.match(source, /supplied\.startsWith\('Bearer '\)/);
  assert.match(source, /fetch\(`\$\{WEBSITE_API_URL\}\/api\/Profile\/me`/);
  assert.match(source, /profile\?\.data\?\.user \|\| profile\?\.user/);
  assert.match(source, /identity\/claims\/emailaddress/);
});

test('Owners endpoint atomically upserts and merges platform columns', () => {
  assert.match(source, /pathname === '\/api\/owners\/upsert' && request\.method === 'POST'/);
  assert.match(source, /data\.rows\.findIndex\(row => clean\(row\[0\]\) === incoming\[0\]\)/);
  assert.match(source, /incoming\[columnIndex\] \|\| clean\(data\.rows\[rowIndex\]\[columnIndex\]\)/);
});

test('extension owner uploads feed the authenticated agent and central Administrator databases', () => {
  assert.match(source, /const ADMIN_OWNERS_PATH = path\.join\(DATA_ROOT, 'owners-admin\.json'\)/);
  assert.match(source, /const accountResult = upsertOwnerRow\(viewer, incoming\)/);
  assert.match(source, /const adminViewer = \{ role: 'admin', email: 'owners-inbox' \}/);
  assert.match(source, /sameDatabase \? accountResult : upsertOwnerRow\(adminViewer, incoming\)/);
  assert.match(source, /\^owners-\[a-f0-9\]\{24\}\\\.json\$/i);
  assert.match(source, /rows = mergeOwnerRows\(rows, normalizedOwnersData\(readJsonFile\(legacyPath\)\)\.rows\)/);
});
