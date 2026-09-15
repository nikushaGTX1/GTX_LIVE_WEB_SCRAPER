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

// "არ ვარ აგენტი" ("I am not an agent") is an owner telling us they are the
// owner, so it must not be read as the excluded "ვარ აგენტი" claim. Drop the
// negated form before the phrase scan runs.
const NEGATED_AGENT_CLAIM_RE = /(^| )(?:არ|ar) (?:ვარ აგენტი|var agenti)(?= |$)/gu;

// A bare "50%" only means "I'll split commission in half with an agent" when
// it sits near actual commission/cooperation wording. Tbilisi rental ads
// routinely quote a "50% deposit" or "50% upfront" with no agent involved at
// all, so a plain number match would wrongly exclude ordinary owner listings.
const COMMISSION_CONTEXT_STEMS = [
  'თანამშრომ', 'შეთანხმ', 'თანხმ', 'საკომისიო', 'კომისია', 'აგენტ', 'მაკლერ',
  'tanamshrom', 'shetankhm', 'shetankhm', 'tankhm', 'tanxm', 'komisi', 'agent', 'makler'
];

function hasCommissionHalfMention(description) {
  const tokens = description.split(' ').filter(Boolean);
  for (let index = 0; index < tokens.length; index += 1) {
    let matchedLength = 0;
    if (tokens[index] === '50%') matchedLength = 1;
    else if (tokens[index] === '50' && tokens[index + 1] === '%') matchedLength = 2;
    if (!matchedLength) continue;
    const windowText = tokens.slice(Math.max(0, index - 4), index + matchedLength + 4).join(' ');
    if (COMMISSION_CONTEXT_STEMS.some(stem => windowText.includes(stem))) return true;
  }
  return false;
}

function hasExcludedDescription(value) {
  const description = normalizedDescription(value).replace(NEGATED_AGENT_CLAIM_RE, '$1');
  if (!description) return false;

  return NORMALIZED_EXCLUDED_PHRASES.some(phrase => description.includes(phrase)) ||
    hasCommissionHalfMention(description);
}

module.exports = {
  EXCLUDED_DESCRIPTION_PHRASES,
  hasExcludedDescription,
  normalizedDescription
};
