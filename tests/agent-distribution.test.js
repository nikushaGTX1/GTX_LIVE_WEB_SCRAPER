'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');

test('pending apartments are persistently assigned in round-robin order', () => {
  assert.match(source, /const agents = await getDistributionAgents\(\)/);
  assert.match(source, /Number\(state\.api_assignment_index \|\| 0\) % agents\.length/);
  assert.match(source, /item\.assigned_agent_id = agent\.id/);
  assert.match(source, /state\.api_assignment_index = Number\(state\.api_assignment_index \|\| 0\) \+ 1/);
  assert.match(source, /saveData\(data, dataPath, csvPath\);\s*saveState\(state\)/);
});

test('Website API upload is attributed to the assigned agent', () => {
  assert.match(source, /async function uploadApartmentToWebsite\(item, agentId\)/);
  assert.match(source, /form\.set\('UploadedByUserId', agentId\)/);
  assert.match(source, /uploadApartmentToWebsite\(item, agent\.id\)/);
});

test('agents only see and review their own assigned apartments', () => {
  assert.match(source, /viewer\?\.role === 'agent'/);
  assert.match(source, /String\(item\.assigned_agent_id \|\| ''\) === String\(viewer\.agentId \|\| ''\)/);
  assert.match(source, /This apartment is assigned to another agent/);
  assert.match(source, /<th>Assigned agent<\/th>/);
});
