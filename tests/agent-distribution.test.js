'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');

test('management includes new API agents outside the automatic distribution pool', () => {
  const vm = require('node:vm');
  const context = vm.createContext({
    websiteApiAgents: [{ id: 'old', name: 'Old agent' }],
    websiteDirectoryAgents: [{ id: 'old', name: 'Old agent' }, { id: 'new', name: 'New agent' }],
    dashboardUploadAgents: [{ id: 'historical', name: 'Former agent' }],
    dashboardAccounts: () => [],
    clean: value => String(value || '').trim(),
    agentDisplayName: agent => agent.name,
    agentEmail: agent => agent.email || ''
  });
  vm.runInContext(source.slice(source.indexOf('function managementAgents('), source.indexOf('function buildTeamContent(')), context);
  const agents = vm.runInContext('managementAgents()', context);
  assert.equal(agents.find(agent => agent.id === 'new').assignable, true);
  assert.equal(agents.find(agent => agent.id === 'historical').assignable, false);
  context.websiteDirectoryAgents = [{ id: 'old', name: 'Old agent' }];
  assert.equal(vm.runInContext('managementAgents()', context).some(agent => agent.id === 'new'), false);
});

test('inactive and uploader accounts are omitted from assignment dropdowns', () => {
  assert.doesNotMatch(source, /inactiveCurrent|\(inactive\)<\/option>/);
  assert.match(source, /return assignableAgents\.map\(agent => `<option/);
});

test('pending apartments are persistently assigned in round-robin order', () => {
  assert.match(source, /const agents = await getDistributionAgents\(\)/);
  assert.match(source, /Number\(state\.api_assignment_index \|\| 0\) % agents\.length/);
  assert.match(source, /item\.assigned_agent_id = agent\.id/);
  assert.match(source, /state\.api_assignment_index = Number\(state\.api_assignment_index \|\| 0\) \+ 1/);
  assert.match(source, /saveData\(data, dataPath, csvPath\);\s*saveState\(state\)/);
});

test('assignment refreshes active API agents and reassigns inactive pending queues', () => {
  const distributionStart = source.indexOf('async function getDistributionAgents');
  const distributionEnd = source.indexOf('async function hydrateAssignedAgentNames');
  assert.doesNotMatch(source.slice(distributionStart, distributionEnd), /if \(websiteApiAgents\.length\) return websiteApiAgents/);
  assert.match(source, /const activeAgentIds = new Set\(agents\.map\(agent => String\(agent\.id\)\)\)/);
  assert.match(source, /activeAgentIds\.has\(assignedId\) \|\| !stillPending/);
  assert.match(source, /delete item\.assigned_agent_id/);
  assert.match(source, /item\._reassigned_from_inactive_at = item\._assigned_at/);
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

test('comment updates are handled inside the apartment review handler', () => {
  const reviewStart = source.indexOf('async function reviewApartment');
  const serverStart = source.indexOf('function startWebServer');
  const reviewSource = source.slice(reviewStart, serverStart);
  assert.match(reviewSource, /body\.action === 'update-comment'/);
  assert.doesNotMatch(source.slice(serverStart), /body\.action === 'update-comment'/);
});

test('profile transfer is restricted to explicitly selected apartments', () => {
  assert.match(source, /if \(!apartments\.length\) throw new Error\('Select at least one apartment'\)/);
  assert.match(source, /selectedKeys\.has\(`\$\{source\}:\$\{item\.apartment_id\}`\)/);
  assert.match(source, /transfer\(myHomeData, 'MyHome'\)/);
  assert.match(source, /transfer\(ssData, 'SS\.ge'\)/);
  assert.match(source, /\['accepted', 'rejected'\]\.includes\(item\._review_status\)/);
  assert.match(source, /waitingForReview \? `<input class="transfer-apartment-checkbox"/);
});
