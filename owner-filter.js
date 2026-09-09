'use strict';

function normalizedOwnerId(value) {
  return String(value ?? '').replace(/\s+/g, '').trim();
}

function ownerIdsFromRows(rows = []) {
  return new Set(rows.map(row => normalizedOwnerId(row?.[0])).filter(Boolean));
}

function belongsToSavedOwner(item, ownerIds) {
  const ownerId = normalizedOwnerId(item?.owner_id);
  return Boolean(ownerId && ownerIds.has(ownerId));
}

module.exports = { belongsToSavedOwner, normalizedOwnerId, ownerIdsFromRows };
