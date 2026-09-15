'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DESCRIPTION_KEYWORDS_ENABLED, hasExcludedDescription, matchDescriptionKeywords
} = require('../description-filter');

const excludedDescriptions = [
  'აგენტებმა არ დამირეკოთ',
  'Agentebma ar damirekot',
  'აგენტებმა არ დარეკოთ',
  'Agentebma ar darekot',
  'არანაირი შემოთავაზებით',
  'Aranairi Shemotavazebit',
  'ვარ აგენტი',
  'var agenti',
  'მაკლერებმა არ დარეკოთ',
  'Maklerebma ar darekot',
  'არანაირი პირობით',
  'Aranairi Pirobit',
  'თავი შეიკავეთ',
  'Tavi Sheikavet',
  'აგენტებთან არ ვთანამშრომლობ',
  'Agentebtan ar vtanamshromlob',
  'არ ვთანამშრომობთ სააგენტოებთან .',
  'არ ვთანამშრომობ სააგენტოებთან!',
  'სააგენტოებთან არ ვთანამშრომობთ',
  'Ar vtanamshromlobt saagentoebtan',
  'არანაირი აგენტები',
  'Aranairi agentebi',
  'ვთანამშრომლობ მხოლოდ 50%',
  'Vtanamshromlob 50 %',
  'ვთანამშრომლობ ნახევარზე',
  'vtanamshromlob nakhevarze',
  'აგენტებმა&#x20;არ&#32;დამირეკოთ',
  'განაცხადი — აგენტებმა, არ დამირეკოთ!'
];

test('keyword filtering is currently disabled, so every description is imported', () => {
  // Requested 2026-09-15: stop filtering by description keywords so every
  // scraped apartment gets in, regardless of phrasing.
  assert.equal(DESCRIPTION_KEYWORDS_ENABLED, false);
  for (const description of [...excludedDescriptions, 'სააგენტოებთან ვთანამშრომლობ მხოლოდ 50%-ით']) {
    assert.equal(hasExcludedDescription(description), false, description);
  }
});

test('the underlying keyword matcher still recognizes agent and commission phrases', () => {
  // Kept correct and tested so filtering can be re-enabled later by flipping
  // DESCRIPTION_KEYWORDS_ENABLED back to true.
  for (const description of excludedDescriptions) {
    assert.notEqual(matchDescriptionKeywords(description), null, description);
  }
});

test('the underlying matcher does not flag unrelated numbers or ordinary listings', () => {
  assert.equal(matchDescriptionKeywords('ქირავდება 50 მ² ბინა მესაკუთრისგან'), null);
  assert.equal(matchDescriptionKeywords('ფასი 150% არ არის და სააგენტოს საკომისიო არ წერია'), null);
  assert.equal(matchDescriptionKeywords('Owner listing, call any time'), null);
});

test('the underlying matcher treats an ordinary deposit percentage as unrelated', () => {
  assert.equal(matchDescriptionKeywords('წინასწარი გადახდა 50%'), null);
  assert.equal(matchDescriptionKeywords('დეპოზიტი 50 % პირველი თვის გადახდით'), null);
  assert.equal(matchDescriptionKeywords('50% ავანსად, დანარჩენი შეყვანისას'), null);
  assert.equal(matchDescriptionKeywords('Deposit 50% required before move-in'), null);
});

test('the underlying matcher still catches a half-commission offer near "50%"', () => {
  assert.notEqual(matchDescriptionKeywords('სააგენტოებთან ვთანამშრომლობ მხოლოდ 50%-ით'), null);
  assert.notEqual(matchDescriptionKeywords('აგენტს ვურჩევ 50% საკომისიოს'), null);
  assert.notEqual(matchDescriptionKeywords('agent commission only 50% accepted'), null);
});

test('the underlying matcher still lets an owner say they are not an agent', () => {
  assert.equal(matchDescriptionKeywords('მე არ ვარ აგენტი, ბინის მესაკუთრე ვარ'), null);
  assert.equal(matchDescriptionKeywords('ar var agenti, mesakutre var'), null);
  assert.notEqual(matchDescriptionKeywords('არ ვარ აგენტი და აგენტებმა არ დამირეკოთ'), null);
});
