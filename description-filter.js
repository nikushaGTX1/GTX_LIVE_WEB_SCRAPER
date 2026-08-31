'use strict';

const EXCLUDED_DESCRIPTION_PHRASES = [
  'აგენტებმა არ დამირეკოთ',
  'agentebma ar damirekot',
  'აგენტებმა არ დარეკოთ',
  'agentebma ar darekot',
  'არანაირი შემოთავაზებით',
  'aranairi shemotavazebit',
  'ვარ აგენტი',
  'var agenti',
  'მაკლერებმა არ დარეკოთ',
  'maklerebma ar darekot',
  'არანაირი პირობით',
  'aranairi pirobit',
  'თავი შეიკავეთ',
  'tavi sheikavet',
  'აგენტებთან არ ვთანამშრომლობ',
  'agentebtan ar vtanamshromlob',
  'არ ვთანამშრომობთ სააგენტოებთან',
  'არ ვთანამშრომობ სააგენტოებთან',
  'სააგენტოებთან არ ვთანამშრომობთ',
  'სააგენტოებთან არ ვთანამშრომობ',
  'ar vtanamshromlobt saagentoebtan',
  'ar vtanamshromlob saagentoebtan',
  'არანაირი აგენტები',
  'aranairi agentebi',
  'ვთანამშრომლობ ნახევარზე',
  'vtanamshromlob nakhevarze',
  'vtanamshromlob naxevarze'
];

function normalizedDescription(value) {
  return String(value ?? '')
    .replace(/&#(?:x20|32);|&nbsp;/gi, ' ')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}%]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const NORMALIZED_EXCLUDED_PHRASES = EXCLUDED_DESCRIPTION_PHRASES.map(normalizedDescription);

function hasExcludedDescription(value) {
  const description = normalizedDescription(value);
  if (!description) return false;

  return NORMALIZED_EXCLUDED_PHRASES.some(phrase => description.includes(phrase)) ||
    /(?:^|[^\p{N}])50\s*%(?:$|[^\p{N}])/u.test(description);
}

module.exports = {
  EXCLUDED_DESCRIPTION_PHRASES,
  hasExcludedDescription,
  normalizedDescription
};
