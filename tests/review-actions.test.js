'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const dashboard = fs.readFileSync(path.join(__dirname, '..', 'dashboard.html'), 'utf8');
const server = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');

test('the checkmark opens a required comment before acceptance', () => {
  const acceptStart = dashboard.indexOf("if (event.target.closest('.accept-button'))");
  const acceptEnd = dashboard.indexOf("if (event.target.closest('.cancel-comment'))", acceptStart);
  const handler = dashboard.slice(acceptStart, acceptEnd);
  assert.match(handler, /commentRow\.hidden = false/);
  assert.doesNotMatch(handler, /saveReview\(row, 'accepted'\)/);
  assert.match(dashboard, /Please add a comment before moving this apartment to Ready For Upload/);
  assert.match(dashboard, /await saveReview\(row, 'accepted', comment\)/);
});

test('review requests identify the listing source', () => {
  assert.match(dashboard, /source: row\.dataset\.apartmentSource/);
  assert.match(server, /requestedSource === 'ss\.ge'/);
  assert.match(server, /requestedSource === 'myhome'/);
});

test('ready for upload is sorted by the latest approval time', () => {
  assert.match(server, /if \(view === 'accepted'\) \{\s*combined\.sort\(\(a, b\) => String\(b\._reviewed_at \|\| ''\)\.localeCompare\(String\(a\._reviewed_at \|\| ''\)\)\);/);
  assert.match(server, /const displayedAt = view === 'accepted' \? item\._reviewed_at : item\.first_seen/);
  assert.match(server, /view === 'accepted' \? 'Approved' : 'Received'/);
});

test('ready apartment copy buttons group links by approval date', () => {
  assert.match(server, /calendarDateKey\(item\._reviewed_at\) === targetDate/);
  assert.doesNotMatch(server, /calendarDateKey\(item\.first_seen\) === targetDate/);
  assert.match(dashboard, /Copy ready apartment links by approval date/);
});
