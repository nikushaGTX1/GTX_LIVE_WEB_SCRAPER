'use strict';

// Owners rows follow OWNER_HEADERS in main.js. The last column holds the
// agreement note the agent wrote for that owner.
const OWNER_AGREEMENT_COLUMN = 8;

// An owner is only kept away from the scraper when the saved note says they
// refuse to work with us. Every other note - including "standard agreement",
// a condition such as pets, or an empty cell - describes a cooperating owner
// whose listings must keep arriving in All Apartments.
const NON_COOPERATION_PATTERNS = [
  // Georgian: a negation within two words of an agreement/cooperation stem.
  /(?:^| )(?:არ|ვერ)(?: \S+){0,2} \S*(?:შეთანხმ|თანამშრომ|თანხმ)/u,
  // Georgian: an outright refusal.
  /(?:^| )უარ(?:ი|ს|ზე|ით|ყო)/u,
  // Latin transliteration used by part of the team.
  /(?:^| )(?:ar|ver)(?: \S+){0,2} \S*(?:shetankhm|shetanxm|shethankhm|tanamshrom|tankhm|tanxm)/u,
  /(?:^| )uar(?:i|s|ze)(?: |$)/u,
  // English notes.
  /(?:^| )(?:no|not|never)(?: \S+){0,2} (?:agree|agreed|agreement|cooperat|collaborat)/u,
  /(?:^| )(?:refus|declin)(?:e|ed|es|ing)(?: |$)/u
];

function normalizedOwnerId(value) {
  return String(value ?? '').replace(/\s+/g, '').trim();
}

function normalizedOwnerPhone(value) {
  let digits = String(value ?? '').replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('995')) digits = digits.slice(3);
  return digits.length === 9 ? digits : '';
}

function normalizedAgreementNote(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function ownerRefusesCooperation(value) {
  const note = normalizedAgreementNote(value);
  if (!note) return false;
  return NON_COOPERATION_PATTERNS.some(pattern => pattern.test(note));
}

function ownerIdsFromRows(rows = []) {
  return new Set(rows.map(row => {
    const ownerId = normalizedOwnerId(row?.[0]);
    const phone = normalizedOwnerPhone(row?.[1]);
    return ownerId && phone ? `${ownerId}:${phone}` : '';
  }).filter(Boolean));
}

function nonCooperatingOwnerIds(rows = []) {
  return ownerIdsFromRows(rows.filter(row => ownerRefusesCooperation(row?.[OWNER_AGREEMENT_COLUMN])));
}

function belongsToSavedOwner(item, ownerSignatures) {
  const ownerId = normalizedOwnerId(item?.owner_id);
  const phone = normalizedOwnerPhone(item?.phone);
  return Boolean(ownerId && phone && ownerSignatures.has(`${ownerId}:${phone}`));
}

module.exports = {
  OWNER_AGREEMENT_COLUMN,
  belongsToSavedOwner,
  nonCooperatingOwnerIds,
  normalizedOwnerId,
  normalizedOwnerPhone,
  ownerIdsFromRows,
  ownerRefusesCooperation
};
