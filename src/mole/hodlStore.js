// HODL Rewards — epoch and snapshot persistence.
//
// Thin on purpose. The rules live in hodlEpochs.js and the batch shape in
// hodlBatch.js; this only reads and writes them, through mole's managed
// JSON+Mongo layer so the serving machine and the workers see one truth.
//
// TWO THINGS ARE APPEND-ONLY, AND THAT IS THE POINT.
//
// A closed epoch's parameters are never edited: spec §7 requires historical
// epochs to stay viewable, and a reward program whose past terms can be quietly
// rewritten cannot be audited by anyone. Governance sets the NEXT epoch; it
// never revises a finished one.
//
// A paid snapshot is never rewritten either. It is the record of what was
// actually sent, and it has to still be true years later when the parameters
// that produced it are long gone.

import { readJson, writeJson, refreshManagedFile } from "./storage.js";
import { validateEpoch, EPOCH_STATUS, DEFAULT_EPOCH_PARAMS } from "./hodlEpochs.js";

const EPOCHS = "hodl_epochs.json";
const SNAPSHOTS = "hodl_snapshots.json";

const snapshotKey = (epochId, weekIndex) => `${epochId}:${weekIndex}`;

export function listEpochs() {
  return Object.values(readJson(EPOCHS, {}));
}

export function getEpoch(id) {
  return readJson(EPOCHS, {})[String(id)] || null;
}

/** The one epoch currently paying out. More than one active epoch is a bug, so
 *  this returns the first and the caller should never need to disambiguate.
 *
 *  An epoch whose end has passed is NOT current, whatever its stored status
 *  says. Without this, an epoch nobody closed stays "active" forever: the
 *  status API reports a live program in week 13 of a finished one, and
 *  activateEpoch() refuses every new epoch ("close it first"). That is how a
 *  stale 2-day `e1` blocked weekly HODL from 2026-08-22 on. */
export function getActiveEpoch({ nowMs = Date.now() } = {}) {
  return listEpochs().find((e) => e.status === EPOCH_STATUS.ACTIVE
    && !(Number.isFinite(Number(e.endMs)) && Number(e.endMs) <= nowMs)) || null;
}

/**
 * Create a DRAFT epoch. Draft is the only state you can author freely — it pays
 * nobody, so an admin can iterate on parameters without consequence.
 */
export function createEpoch({ id, startMs, endMs, ...params } = {}) {
  const epochs = readJson(EPOCHS, {});
  if (!id) return { ok: false, error: "an epoch needs an id" };
  if (epochs[id]) return { ok: false, error: `epoch ${id} already exists` };

  const epoch = {
    id: String(id),
    startMs: Number(startMs),
    endMs: Number(endMs),
    ...DEFAULT_EPOCH_PARAMS,
    ...params,
    status: EPOCH_STATUS.DRAFT,
    createdAtIso: new Date().toISOString(),
  };

  // Validated at creation as well as activation. Catching a bad number while it
  // is still a draft is cheaper than catching it on a Tuesday morning.
  const valid = validateEpoch(epoch);
  if (!valid.ok) return { ok: false, error: valid.errors.join("; "), errors: valid.errors };

  epochs[epoch.id] = epoch;
  writeJson(EPOCHS, epochs);
  return { ok: true, epoch };
}

/**
 * Make a draft live.
 *
 * Re-validates rather than trusting what was stored — a draft may have been
 * written by an older build, edited by hand, or restored from a backup, and
 * this is the last gate before it can move tokens.
 */
export function activateEpoch(id) {
  const epochs = readJson(EPOCHS, {});
  const epoch = epochs[String(id)];
  if (!epoch) return { ok: false, error: `no epoch ${id}` };
  if (epoch.status === EPOCH_STATUS.ACTIVE) return { ok: true, epoch, alreadyActive: true };
  if (epoch.status === EPOCH_STATUS.CLOSED) return { ok: false, error: "a closed epoch cannot be reactivated" };

  const valid = validateEpoch(epoch);
  if (!valid.ok) return { ok: false, error: valid.errors.join("; "), errors: valid.errors };

  const active = getActiveEpoch();
  if (active && active.id !== epoch.id) {
    // Two live epochs would mean two weekly pools drawing on one reserve, with
    // nothing deciding which applies. Close the old one deliberately first.
    return { ok: false, error: `epoch ${active.id} is still active — close it first` };
  }

  epoch.status = EPOCH_STATUS.ACTIVE;
  epoch.activatedAtIso = new Date().toISOString();
  epochs[epoch.id] = epoch;
  writeJson(EPOCHS, epochs);
  return { ok: true, epoch };
}

export function closeEpoch(id) {
  const epochs = readJson(EPOCHS, {});
  const epoch = epochs[String(id)];
  if (!epoch) return { ok: false, error: `no epoch ${id}` };
  if (epoch.status === EPOCH_STATUS.CLOSED) return { ok: true, epoch, alreadyClosed: true };

  epoch.status = EPOCH_STATUS.CLOSED;
  epoch.closedAtIso = new Date().toISOString();
  epochs[epoch.id] = epoch;
  writeJson(EPOCHS, epochs);
  return { ok: true, epoch };
}

export function listSnapshots(epochId = null) {
  const all = Object.values(readJson(SNAPSHOTS, {}));
  return epochId ? all.filter((s) => s.epochId === epochId) : all;
}

export function getSnapshot(epochId, weekIndex) {
  return readJson(SNAPSHOTS, {})[snapshotKey(epochId, weekIndex)] || null;
}

/**
 * Store a week's snapshot.
 *
 * Refuses to overwrite one that has already been paid, or is mid-flight. That
 * is the guard against the worst available mistake: re-running a Tuesday,
 * replacing the record of what was sent, and paying everybody again with no
 * evidence left that it happened.
 */
export function saveSnapshot(snapshot) {
  if (!snapshot?.epochId || snapshot.weekIndex == null) {
    return { ok: false, error: "a snapshot needs an epochId and a weekIndex" };
  }
  const all = readJson(SNAPSHOTS, {});
  const key = snapshotKey(snapshot.epochId, snapshot.weekIndex);
  const existing = all[key];

  if (existing && existing.status !== "pending") {
    return { ok: false, error: `snapshot ${key} is already ${existing.status} and cannot be replaced`, existing };
  }

  all[key] = { ...snapshot, savedAtIso: new Date().toISOString() };
  writeJson(SNAPSHOTS, all);
  return { ok: true, snapshot: all[key] };
}

/** Attach batch progress to a stored snapshot. The batch is the record of what
 *  was actually sent, so it lives with the snapshot that authorised it. */
export function updateSnapshotBatch(epochId, weekIndex, batch, status) {
  const all = readJson(SNAPSHOTS, {});
  const key = snapshotKey(epochId, weekIndex);
  if (!all[key]) return { ok: false, error: `no snapshot ${key}` };

  all[key] = {
    ...all[key],
    batch,
    status: status || all[key].status,
    updatedAtIso: new Date().toISOString(),
  };
  writeJson(SNAPSHOTS, all);
  return { ok: true, snapshot: all[key] };
}

/** Pull both files from the authoritative store. A worker deciding a payout
 *  must not run on a cache populated when it booted. */
export async function refreshHodlStore() {
  const results = await Promise.all([
    refreshManagedFile(EPOCHS).catch(() => false),
    refreshManagedFile(SNAPSHOTS).catch(() => false),
  ]);
  return results.every(Boolean);
}

export const __testing = { EPOCHS, SNAPSHOTS, snapshotKey };
