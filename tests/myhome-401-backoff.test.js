'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');

function run(name, args) {
  const context = { result: null };
  const start = source.indexOf(`function ${name}(`);
  const end = source.indexOf('\nfunction ', start + 1);
  vm.runInNewContext(`${source.slice(start, end)}\nresult = ${name}(${args});`, context);
  return context.result;
}

test('findDehydratedQuery picks the query by its first two key segments', () => {
  const nextData = {
    props: { pageProps: { dehydratedState: { queries: [
      { queryKey: ['cardView'], state: { data: null } },
      { queryKey: ['statements', 'list', { query: {} }], state: { data: { data: { data: [{ id: 1 }] } } } },
      { queryKey: ['statements', 'details', { statementId: '1' }], state: { data: { data: { statement: { id: 1 } } } } }
    ] } } }
  };
  const context = { nextData, result: null };
  const start = source.indexOf('function findDehydratedQuery(');
  const end = source.indexOf('\nasync function collectApiCards(');
  vm.runInNewContext(`${source.slice(start, end)}\nresult = [
    findDehydratedQuery(nextData, 'statements', 'list')?.state?.data?.data?.data,
    findDehydratedQuery(nextData, 'statements', 'details')?.state?.data?.data?.statement,
    findDehydratedQuery(nextData, 'nope', 'nope')
  ];`, context);
  assert.deepEqual(context.result[0], [{ id: 1 }]);
  assert.deepEqual(context.result[1], { id: 1 });
  assert.equal(context.result[2], null);
});

test('findDehydratedQuery and readNextData tolerate a missing or malformed __NEXT_DATA__', () => {
  assert.equal(run('findDehydratedQuery', 'null, "statements", "list"'), null);
  assert.equal(run('findDehydratedQuery', '{}, "statements", "list"'), null);
  assert.equal(run('findDehydratedQuery', '{props:{pageProps:{}}}, "statements", "list"'), null);
});

test('listings are read by rendering MyHome pages, not calling the locked-down API', () => {
  // The API calls (`x-website-key` header, fetch to api-statements.tnet.ge)
  // are gone; collectApiCards/getMyHomeStatement now navigate a page and
  // read the embedded __NEXT_DATA__ that MyHome's own pages still render.
  assert.doesNotMatch(source, /fetch\(.*x-website-key/);
  assert.doesNotMatch(source, /fetch\(`https:\/\/api-statements\.tnet\.ge\/v1\/statements/);
  assert.match(source, /async function collectApiCards\(page, searchUrl, pageCount/);
  assert.match(source, /async function getMyHomeStatement\(page, id\)/);
  assert.match(source, /await page\.goto\(pageUrl\(searchUrl, number\)/);
  assert.match(source, /await page\.goto\(`https:\/\/www\.myhome\.ge\/udzravi-qoneba\/\$\{id\}\/`/);
  assert.match(source, /findDehydratedQuery\(await readNextData\(page\), 'statements', 'list'\)/);
  assert.match(source, /findDehydratedQuery\(await readNextData\(page\), 'statements', 'details'\)/);
});

test('every getMyHomeStatement call site has a page to pass it', () => {
  // The function declaration plus three call sites share the scan's page;
  // the Word-import endpoint passes its own lazily-created page instead.
  assert.equal((source.match(/getMyHomeStatement\(page, /g) || []).length, 4);
  assert.match(source, /getMyHomeStatement\(wordImportPage, apartmentId\)/);
  assert.doesNotMatch(source, /getMyHomeStatement\((?!page,|wordImportPage,)/);
});

test('a sustained scan failure logs once and backs off to a 10-minute recheck, any failure resets it on success', () => {
  assert.match(source, /let scanFailingSince = null/);
  assert.match(source, /if \(!scanFailingSince\) \{\s*\n\s*scanFailingSince = Date\.now\(\);\s*\n\s*console\.error\(`Scan failed: \$\{error\.message\}\. Backing off and won't log this again until it recovers\.`\);/);
  assert.match(source, /scanFailingSince = null;\s*\n\s*\} catch \(error\)/);
  assert.match(source, /const delaySeconds = scanFailingSince \? Math\.max\(watcherRuntime\.interval, 600\) : watcherRuntime\.interval/);
  assert.match(source, /const quiet = myHomePaused \|\| scanFailingSince/);
});
