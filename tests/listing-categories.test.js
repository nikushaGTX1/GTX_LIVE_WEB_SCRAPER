'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const helpers = source.slice(source.indexOf('const PROPERTY_TYPES = ['), source.indexOf('function myHomeUrl('));
const { propertyTypeOf, dealTypeOf } = new Function('clean', `${helpers}; return { propertyTypeOf, dealTypeOf };`)(
  value => String(value ?? '').trim()
);

test('property type comes from an explicit value, then the URL or Georgian title', () => {
  assert.equal(propertyTypeOf({ property_type: 'land', title: 'ქირავდება ბინა' }), 'land');
  assert.equal(propertyTypeOf({ url: 'https://www.myhome.ge/udzravi-qoneba/qiravdeba-agaraki-123/' }), 'country');
  assert.equal(propertyTypeOf({ title: 'ქირავდება კომერციული ფართი' }), 'commercial');
  assert.equal(propertyTypeOf({ title: 'ქირავდება კერძო სახლი ვაკეში' }), 'house');
  assert.equal(propertyTypeOf({ url: 'https://home.ss.ge/ka/udzravi-qoneba/qiravdeba-bina-saburtaloze-1' }), 'apartment');
  assert.equal(propertyTypeOf({ property_type: 'castle' }), 'apartment');
  assert.equal(propertyTypeOf({}), 'apartment');
});

test('deal type is sale only when stated, otherwise rent', () => {
  assert.equal(dealTypeOf({ deal_type: 'sale' }), 'sale');
  assert.equal(dealTypeOf({ url: 'https://www.myhome.ge/udzravi-qoneba/iyideba-bina-123/' }), 'sale');
  assert.equal(dealTypeOf({ title: 'იყიდება 2 ოთახიანი ბინა' }), 'sale');
  assert.equal(dealTypeOf({ title: 'ქირავდება ბინა' }), 'rent');
  assert.equal(dealTypeOf({ deal_type: 'swap' }), 'rent');
  assert.equal(dealTypeOf({}), 'rent');
});

test('apartment and owner IDs open their listings and the table never scrolls sideways', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  const template = fs.readFileSync(path.join(__dirname, '..', 'dashboard.html'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '..', 'dashboard.css'), 'utf8');
  assert.match(source, /class="apartment-id-link" href="\$\{html\(item\.url\)\}"/);
  assert.match(source, /class="owner-id-link"/);
  assert.match(template, /classList\.toggle\('as-cards', resultsTable\.scrollWidth > wrap\.clientWidth \+ 2\)/);
  assert.match(css, /\.results \{ overflow-x: hidden; \}/);
});
