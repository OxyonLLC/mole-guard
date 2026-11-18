// HODL check-ins: one record per verified identity per UTC day, written with the
// SERVER's clock only (a caller cannot choose the day). Idempotent: a second
// check-in on the same UTC day changes nothing. Feeds hodlActiveDays only; it
// is not a reward and creates no reward record.
//
// hodl_checkins.json (Mongo-mirrored managed file) { "<discordUserId>:<YYYY-MM-DD>": { discordUserId, day, atIso, source } }
import { readJson, writeJson, refreshManagedFile } from "./storage.js";
import { utcDayKey } from "./hodlActiveDays.js";

export const CHECKINS = "hodl_checkins.json";
const RETENTION_DAYS = 35; // a snapshot looks back 7 days; keep a margin for audits

export function recordCheckin(discordUserId, { nowMs = Date.now(), source = "discord" } = {}) {
  const id = String(discordUserId || "").trim();
  if (!/^\d{17,20}$/.test(id)) return { ok: false, error: "not_a_discord_identity" };
  const day = utcDayKey(nowMs);
  const key = `${id}:${day}`;
  const all = readJson(CHECKINS, {});
  if (all[key]) return { ok: true, already: true, day };
  const cutoff = utcDayKey(nowMs - RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const kept = Object.fromEntries(Object.entries(all).filter(([, v]) => String(v.day) >= cutoff));
  kept[key] = { discordUserId: id, day, atIso: new Date(nowMs).toISOString(), source: String(source) };
  writeJson(CHECKINS, kept);
  return { ok: true, already: false, day };
}

export function listCheckinDays(discordUserId) {
  const id = String(discordUserId || "");
  return Object.values(readJson(CHECKINS, {})).filter((v) => v.discordUserId === id).map((v) => v.day);
}

export async function refreshCheckins() {
  return refreshManagedFile(CHECKINS);
}
