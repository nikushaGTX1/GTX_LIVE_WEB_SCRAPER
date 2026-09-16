'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const dashboard = fs.readFileSync(path.join(__dirname, '..', 'dashboard.html'), 'utf8');
const server = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');

test('the checkmark immediately persists acceptance', () => {
  const acceptStart = dashboard.indexOf("if (event.target.closest('.accept-button'))");
  const acceptEnd = dashboard.indexOf("if (event.target.closest('.cancel-comment'))", acceptStart);
  const handler = dashboard.slice(acceptStart, acceptEnd);
  assert.match(handler, /await saveReview\(row, 'accepted'\)/);
  assert.doesNotMatch(handler, /commentRow\.hidden = false/);
});

test('review requests identify the listing source', () => {
  assert.match(dashboard, /source: row\.dataset\.apartmentSource/);
  assert.match(server, /requestedSource === 'ss\.ge'/);
  assert.match(server, /requestedSource === 'myhome'/);
});
