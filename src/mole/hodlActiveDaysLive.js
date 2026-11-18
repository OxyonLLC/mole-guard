// Live wiring for hodlActiveDays: the existing per-identity records, read as they
// are. Reused, not copied: faucet claims (claimStore), game reward claims
// (rewardHistory, linked accounts aggregated there), the quiz's server-side UTC
// day log (quiz/db.js users[id].web.daily) and hodl check-ins.
import { createRequire } from "node:module";
import { getClaimHistoryForUser } from "../faucet/claimStore.js";
import { listRewardClaims } from "./rewardHistory.js";
import { makeActiveDaysReader } from "./hodlActiveDays.js";
import { listCheckinDays, refreshCheckins } from "./hodlCheckins.js";

const require = createRequire(import.meta.url);

export async function makeLiveActiveDaysReader({ snapshotAtMs = Date.now() } = {}) {
  // Decide from Mongo's current check-ins, not a boot-time cache.
  // A failed refresh is reported on every participant (never hidden): the
  // check-in count could be stale, so hodl-pay must not pay from it.
  const globalErrors = [];
  try { await refreshCheckins(); } catch (error) { globalErrors.push(`checkin_refresh: ${error?.message || "failed"}`); }
  const quizDb = require("../quiz/db.js");
  return makeActiveDaysReader({
    snapshotAtMs,
    globalErrors,
    readFaucetClaims: async (id) => (await getClaimHistoryForUser(id, 200))?.claims || [],
    readGameClaims: async (id) => listRewardClaims(id, 200),
    readQuizDaily: async (id) => quizDb.getUser(id)?.web?.daily || {},
    readCheckinDays: async (id) => listCheckinDays(id),
  });
}
