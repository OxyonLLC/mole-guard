// Sign in / sync with X (Twitter) — OAuth 2.0 with PKCE.
//
// WHY THIS EXISTS. "not everyone has discord and not every one has X" — so
// either one, on its own, proves a person and unlocks payouts. Discord stays
// the community's home; it stopped being the only door.
//
// DORMANT UNTIL CONFIGURED. This project has TWITTER_BEARER_TOKEN, which is
// app-only auth for reading tweets and cannot log a user in. User login needs an
// X developer app with OAuth 2.0 enabled: X_CLIENT_ID and X_CLIENT_SECRET.
// Until both are set, isXOAuthConfigured() is false, every route reports X as
// unavailable, and the UI shows "coming soon" instead of a button that cannot
// work. Nothing here runs or breaks in the meantime.
//
// PKCE IS NOT OPTIONAL ON X, unlike Discord. Every authorize request must carry
// a code_challenge and the token exchange the matching code_verifier. The
// verifier is generated per attempt and stored SERVER-SIDE against the state —
// the browser never sees it, which is the entire point: an intercepted
// authorization code is useless without it.

import crypto from "crypto";

export const X_AUTHORIZE_URL = "https://x.com/i/oauth2/authorize";
export const X_TOKEN_URL = "https://api.x.com/2/oauth2/token";
export const X_ME_URL = "https://api.x.com/2/users/me";

/** Minimal scopes. `users.read` is what identifies the account; `tweet.read` is
 *  required alongside it by X for users.read to be granted. `offline.access` is
 *  deliberately NOT requested — it returns a refresh token, and this flow reads
 *  an id once and never acts on anyone's behalf again. Asking for durable
 *  access we would never use is both a worse consent screen and a credential to
 *  look after for no reason. */
export const X_SCOPES = ["users.read", "tweet.read"];

export function getXOAuthConfig(env = process.env) {
  const clientId = String(env.X_CLIENT_ID || "").trim();
  const clientSecret = String(env.X_CLIENT_SECRET || "").trim();
  // Falls back to the site's own callback path so the only thing that must be
  // registered with X is predictable; override when the backend is reached on a
  // different host (as it is today, through the ngrok tunnel).
  const redirectUri = String(env.X_REDIRECT_URI || "").trim();
  return { clientId, clientSecret, redirectUri };
}

export function isXOAuthConfigured(env = process.env) {
  const { clientId, clientSecret, redirectUri } = getXOAuthConfig(env);
  return Boolean(clientId && clientSecret && redirectUri);
}

/** base64url of random bytes — the PKCE verifier. 32 bytes is 43 characters,
 *  inside X's 43-128 range. */
export function createPkcePair() {
  const verifier = crypto.randomBytes(32).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function buildXAuthorizeUrl({ state, challenge, env = process.env }) {
  const { clientId, redirectUri } = getXOAuthConfig(env);
  if (!clientId || !redirectUri) throw new Error("x_oauth_not_configured");
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: X_SCOPES.join(" "),
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  return `${X_AUTHORIZE_URL}?${params.toString()}`;
}

/**
 * Exchange the code for a token.
 *
 * X requires HTTP Basic auth with client_id:client_secret for a confidential
 * client, AND the client_id repeated in the body. Sending only one of the two is
 * the usual reason this returns 401 with an unhelpful message.
 */
export async function exchangeXCode({ code, verifier, env = process.env, fetchImpl = fetch }) {
  const { clientId, clientSecret, redirectUri } = getXOAuthConfig(env);
  if (!clientId || !clientSecret || !redirectUri) throw new Error("x_oauth_not_configured");

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    code_verifier: verifier,
  });

  const res = await fetchImpl(X_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
    },
    body,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`x_token_exchange_failed:${res.status}:${text.slice(0, 200)}`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("x_token_exchange_bad_json");
  }
}

/** The authenticated user's own id and handle. The ID is what gets synced — a
 *  handle can be changed or taken over by someone else, and this store is meant
 *  to say "one person, one account" for as long as the account exists. */
export async function fetchXUser({ accessToken, fetchImpl = fetch }) {
  const res = await fetchImpl(X_ME_URL, { headers: { Authorization: `Bearer ${accessToken}` } });
  const text = await res.text();
  if (!res.ok) throw new Error(`x_me_failed:${res.status}:${text.slice(0, 200)}`);
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("x_me_bad_json");
  }
  const id = parsed?.data?.id;
  if (!id) throw new Error("x_me_no_id");
  return { id: String(id), username: parsed?.data?.username || null };
}
