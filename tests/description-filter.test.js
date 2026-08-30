'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { hasExcludedDescription } = require('../description-filter');

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
  'არანაირი აგენტები',
  'Aranairi agentebi',
  'ვთანამშრომლობ მხოლოდ 50%',
  'Vtanamshromlob 50 %',
  'ვთანამშრომლობ ნახევარზე',
  'vtanamshromlob nakhevarze',
  'აგენტებმა&#x20;არ&#32;დამირეკოთ',
  'განაცხადი — აგენტებმა, არ დამირეკოთ!'
];

test('rejects descriptions containing agent and commission exclusion phrases', () => {
  for (const description of excludedDescriptions) {
    assert.equal(hasExcludedDescription(description), true, description);
  }
});

test('does not reject unrelated numbers or ordinary owner descriptions', () => {
  assert.equal(hasExcludedDescription('ქირავდება 50 მ² ბინა მესაკუთრისგან'), false);
  assert.equal(hasExcludedDescription('ფასი 150% არ არის და სააგენტოს საკომისიო არ წერია'), false);
  assert.equal(hasExcludedDescription('Owner listing, call any time'), false);
});
