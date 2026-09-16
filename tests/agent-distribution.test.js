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

test('automatic round-robin agent assignment has been removed', () => {
  // Requested 2026-09-16: apartments must never be auto-assigned to agents;
  // a manager assigns them by hand via the reassign dropdown instead.
  assert.doesNotMatch(source, /function getDistributionAgents\(/);
  assert.doesNotMatch(source, /function assignPendingApartments\(/);
  assert.doesNotMatch(source, /function hydrateAssignedAgentNames\(/);
  assert.doesNotMatch(source, /assigned in round-robin order/);
  assert.doesNotMatch(source, /Round-robin assignment enabled/);
  // api_assignment_index still appears once, inside the pre-existing
  // intentionally-unreachable legacy publishing block (never executed) -
  // confirm it's not live anywhere reachable code calls into.
  assert.doesNotMatch(source, /await assignPendingApartments\(/);
  assert.doesNotMatch(source, /await getDistributionAgents\(\)/);
  assert.doesNotMatch(source, /await hydrateAssignedAgentNames\(/);
});

test('only real agent accounts are eligible for manual reassignment, not admins or managers', () => {
  assert.match(source, /function isAssignableApiAgent\(agent\)/);
  assert.match(source, /if \(role\) return \/\(\^\|\[ _-\]\)agent/);
  assert.match(source, /\.filter\(agent => agent\.id && isAssignableApiAgent\(agent\)\)/);
  assert.doesNotMatch(source, /slice\(0, distributionCount\)/);
  assert.doesNotMatch(source, /AGENT_DISTRIBUTION_COUNT/);
});

test('the standalone Website API upload helper still attributes uploads to a given agent', () => {
  // The round-robin distribution loop that used to call this was removed;
  // the helper itself is kept for possible future per-agent publishing.
  assert.match(source, /async function uploadApartmentToWebsite\(item, agentId\)/);
  assert.match(source, /form\.set\('UploadedByUserId', agentId\)/);
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
