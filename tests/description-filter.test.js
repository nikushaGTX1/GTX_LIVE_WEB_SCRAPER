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

test('an ordinary deposit or prepayment percentage does not exclude the listing', () => {
  // These are routine Tbilisi rental terms with no agent or commission
  // context nearby, and must keep importing normally.
  assert.equal(hasExcludedDescription('წინასწარი გადახდა 50%'), false);
  assert.equal(hasExcludedDescription('დეპოზიტი 50 % პირველი თვის გადახდით'), false);
  assert.equal(hasExcludedDescription('50% ავანსად, დანარჩენი შეყვანისას'), false);
  assert.equal(hasExcludedDescription('Deposit 50% required before move-in'), false);
});

test('a half-commission offer near "50%" still excludes the listing', () => {
  assert.equal(hasExcludedDescription('სააგენტოებთან ვთანამშრომლობ მხოლოდ 50%-ით'), true);
  assert.equal(hasExcludedDescription('აგენტს ვურჩევ 50% საკომისიოს'), true);
  assert.equal(hasExcludedDescription('agent commission only 50% accepted'), true);
});

test('an owner saying they are not an agent still cooperates with us', () => {
  assert.equal(hasExcludedDescription('მე არ ვარ აგენტი, ბინის მესაკუთრე ვარ'), false);
  assert.equal(hasExcludedDescription('ar var agenti, mesakutre var'), false);
  // The negation only clears that one claim; another refusal still excludes.
  assert.equal(hasExcludedDescription('არ ვარ აგენტი და აგენტებმა არ დამირეკოთ'), true);
});
