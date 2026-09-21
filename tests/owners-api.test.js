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

test('Owners endpoint merges later platform IDs into the same owner row', () => {
  assert.match(source, /pathname === '\/api\/owners\/upsert' && request\.method === 'POST'/);
  assert.match(source, /if \(incoming\[0\]\) return clean\(row\[0\]\) === incoming\[0\]/);
  assert.match(source, /seenOwnerIds\.has\(ownerId\)/);
  assert.match(source, /incoming\[columnIndex\] \|\| clean\(data\.rows\[rowIndex\]\[columnIndex\]\)/);
});

test('extension owner uploads feed the authenticated agent and central Administrator databases', () => {
  assert.match(source, /const ADMIN_OWNERS_PATH = path\.join\(DATA_ROOT, 'owners-admin\.json'\)/);
  assert.match(source, /const accountResult = upsertOwnerRow\(viewer, incoming\)/);
  assert.match(source, /const adminViewer = \{ role: 'admin', email: 'owners-inbox' \}/);
  assert.match(source, /sameDatabase \? accountResult : upsertOwnerRow\(adminViewer, incoming\)/);
  assert.match(source, /\^owners-\[a-f0-9\]\{24\}\\\.json\$/i);
  assert.match(source, /data\.rows = mergeOwnerRows\(data\.rows, normalizedOwnersData\(readJsonFile\(agentPath\)\)\.rows\)/);
});

test('owner aggregation preserves id-less rows and refines broad districts without deleting saved data', () => {
  assert.match(source, /const rowKeys = new Set\(/);
  assert.match(source, /if \(!ownerId\) \{[\s\S]*if \(!rowKeys\.has\(rowKey\)\)[\s\S]*merged\.push\(incoming\)/);
  assert.match(source, /BROAD_OWNER_DISTRICTS\.has\(existingDistrict\) && !BROAD_OWNER_DISTRICTS\.has\(incomingDistrict\)/);
  assert.match(source, /merged\[existingIndex\]\[2\] = incomingDistrict/);
  assert.doesNotMatch(source, /function mergeOwnerRows[\s\S]*?merged\.splice/);
});

test('owner rows use a saved apartment neighbourhood instead of a combined administrative area', () => {
  assert.match(source, /function applySpecificDistrictsToOwners\(data\)/);
  assert.match(source, /myHomeDistricts\.get\(clean\(row\[0\]\)\)/);
  assert.match(source, /ssDistricts\.get\(clean\(row\[0\]\)\)/);
  assert.match(source, /myHomeDistricts\.get\(clean\(row\[6\]\)\)/);
  assert.match(source, /ssDistricts\.get\(clean\(row\[7\]\)\)/);
  assert.match(source, /if \(currentDistrict && !BROAD_OWNER_DISTRICTS\.has\(currentDistrict\)\) continue/);
  assert.match(source, /row\[2\] = specificDistrict/);
  assert.match(source, /applySpecificDistrictsToOwners\(data\)/);
});

test('managers share the complete owner database and team profiles link to each agent owners', () => {
  assert.match(source, /\['admin', 'manager'\]\.includes\(viewer\?\.role\)\) return ADMIN_OWNERS_PATH/);
  assert.match(source, /view=owners&agent=\$\{encodeURIComponent\(agent\.id\)\}/);
  assert.match(source, /buildOwnersContent\(viewer, selectedOwner \|\| viewer\)/);
  assert.match(source, /function ownersDataForSubject\(viewer, subject\)/);
  assert.match(source, /String\(item\.assigned_agent_id \|\| ''\) === agentId/);
  assert.match(source, /central\.rows\.filter\(row => assignedListingIds\.has\(clean\(row\[0\]\)\)\)/);
  assert.match(source, /\['admin', 'manager'\]\.includes\(viewer\?\.role\)/);
  assert.match(source, /data\.rows = mergeOwnerRows\(data\.rows, normalizedOwnersData\(readJsonFile\(agentPath\)\)\.rows\)/);
  assert.match(source, /function removeOwnersFromEveryDatabase\(ownerId = ''\)/);
});

test('removed queue apartments are deleted from the live queue', () => {
  assert.match(source, /delete source\.data\[itemKey\]/);
});

test('accepted apartment comments synchronize to matching owner listing IDs', () => {
  assert.match(source, /acceptedComments\.get\(clean\(row\[0\]\)\)/);
  assert.doesNotMatch(source, /acceptedComments\.get\(clean\(row\[(?:6|7)\]\)\)/);
  assert.match(source, /row\[8\] = comment/);
});
