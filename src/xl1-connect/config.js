// Connect XL1 wallet (P2/P3): every switch, read once, all OFF by default.
//
//   XL1_CONNECT_ENABLED=true        turn the connect routes on (otherwise every route answers 404)
//   XL1_CONNECT_AUDIENCE            'allowlist' (default) or 'all'. With 'allowlist', only the
//                                    accounts in XL1_CONNECT_TRIAL_ACCOUNTS see anything; an empty
//                                    list means nobody.
//   XL1_CONNECT_TRIAL_ACCOUNTS      comma-separated WinLEW account ids for the private trial
//   XL1_CONNECT_REF_SECRET          HMAC key for account references (at least 32 characters).
//                                    Required when enabled; without it the routes stay off.
//   XL1_ELIGIBILITY_ROUTES          comma-separated eligibility routes (P3). Empty = today's rule,
//                                    unchanged. Owner policy 2026-11-15: 'x' and 'moderator' may be
//                                    designed; automatic on-chain eligibility stays DISABLED, so
//                                    'onchain' is refused here, not just left unused.
//
// Nothing in this module grants, accrues or changes a reward. P3's eligibility answer is not read by
// the arcade until a later, owner-approved change wires it in.

export const MIN_REF_SECRET = 32
export const ALLOWED_ELIGIBILITY_ROUTES = Object.freeze(['x', 'moderator'])

const list = (raw) => String(raw ?? '').split(',').map((s) => s.trim()).filter(Boolean)

export function getConnectConfig(env = process.env) {
  const secret = String(env.XL1_CONNECT_REF_SECRET ?? '')
  const routes = list(env.XL1_ELIGIBILITY_ROUTES).map((r) => r.toLowerCase())
  const refused = routes.filter((r) => !ALLOWED_ELIGIBILITY_ROUTES.includes(r))
  const requested = String(env.XL1_CONNECT_ENABLED ?? '').trim().toLowerCase() === 'true'
  const problems = []
  if (requested && secret.length < MIN_REF_SECRET) problems.push(`XL1_CONNECT_REF_SECRET must be at least ${MIN_REF_SECRET} characters`)
  if (refused.length) problems.push(`XL1_ELIGIBILITY_ROUTES has unsupported or disabled route(s): ${refused.join(', ')}`)
  return Object.freeze({
    // On only when asked for AND safe to run: a missing secret or a refused route keeps it off.
    enabled: requested && !problems.length,
    audience: String(env.XL1_CONNECT_AUDIENCE ?? 'allowlist').trim().toLowerCase() === 'all' ? 'all' : 'allowlist',
    trialAccounts: Object.freeze(list(env.XL1_CONNECT_TRIAL_ACCOUNTS)),
    secret,
    eligibilityRoutes: Object.freeze(routes.filter((r) => ALLOWED_ELIGIBILITY_ROUTES.includes(r))),
    problems: Object.freeze(problems),
  })
}

/** May this account see the connect feature at all? */
export function inAudience(config, accountId) {
  if (!config.enabled || !accountId) return false
  return config.audience === 'all' || config.trialAccounts.includes(String(accountId))
}
