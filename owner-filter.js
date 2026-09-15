'use strict';

function normalizedOwnerId(value) {
  return String(value ?? '').replace(/\s+/g, '').trim();
}

function normalizedOwnerPhone(value) {
  let digits = String(value ?? '').replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('995')) digits = digits.slice(3);
  return digits.length === 9 ? digits : '';
}

function ownerIdsFromRows(rows = []) {
  return new Set(rows.map(row => {
    const ownerId = normalizedOwnerId(row?.[0]);
    const phone = normalizedOwnerPhone(row?.[1]);
    return ownerId && phone ? `${ownerId}:${phone}` : '';
  }).filter(Boolean));
}

function belongsToSavedOwner(item, ownerSignatures) {
  const ownerId = normalizedOwnerId(item?.owner_id);
  const phone = normalizedOwnerPhone(item?.phone);
  return Boolean(ownerId && phone && ownerSignatures.has(`${ownerId}:${phone}`));
}

module.exports = { belongsToSavedOwner, normalizedOwnerId, normalizedOwnerPhone, ownerIdsFromRows };
