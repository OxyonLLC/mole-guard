import Anthropic from "@anthropic-ai/sdk";
import dotenv from "dotenv";

dotenv.config();

let anthropic = null;

function getAnthropicClient() {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("Missing ANTHROPIC_API_KEY in .env");
  }

  if (!anthropic) {
    anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
  }

  return anthropic;
}

export function isClaudeConfigured() {
  return Boolean(String(process.env.ANTHROPIC_API_KEY || "").trim());
}

const DEFAULT_MODEL = "claude-sonnet-4-5-20250929";

export function getClaudeModel() {
  return process.env.CLAUDE_MODEL || DEFAULT_MODEL;
}

// Models that still accept temperature/top_p/top_k. Newer models (Opus 4.7+,
// Opus 5, Sonnet 5, Fable 5) reject them with a 400, so anything not listed
// here is sent without sampling params — omitting them is valid everywhere,
// which keeps a CLAUDE_MODEL bump from failing in a way that reads like a
// billing or key problem.
const SAMPLING_MODELS =
  /(claude-3|sonnet-4(-[05-6])?(-\d|$)|haiku-3|haiku-4-5|opus-4-[0156])/;

function modelAcceptsSampling(model) {
  return SAMPLING_MODELS.test(String(model || ""));
}

/**
 * Why the API said no, in one line a moderator can act on.
 *
 * `fatal` marks a state that will keep failing until a human changes something
 * (billing, key, permissions) — retrying just burns log space. Everything else
 * is transient and worth trying again.
 */
export function describeClaudeError(error) {
  const status = error?.status ?? null;
  const type = error?.error?.error?.type || error?.error?.type || error?.type || null;
  const apiMessage = String(error?.error?.error?.message || error?.message || "").trim();

  if (status === 400 && /credit balance is too low/i.test(apiMessage)) {
    return {
      fatal: true,
      code: "no_credit",
      summary:
        "Anthropic API credit balance is empty. This is the API organisation's " +
        "own balance — a Claude Pro/Max subscription does not fund it, and " +
        "credits bought under a different organisation or workspace do not " +
        "apply to this key. Top up (or switch ANTHROPIC_API_KEY) at " +
        "console.anthropic.com -> Plans & Billing.",
    };
  }
  if (status === 401) {
    return { fatal: true, code: "bad_key", summary: "ANTHROPIC_API_KEY was rejected — it is invalid, revoked, or mistyped." };
  }
  if (status === 403) {
    return { fatal: true, code: "no_access", summary: `ANTHROPIC_API_KEY lacks access${apiMessage ? ` — ${apiMessage}` : "."}` };
  }
  if (status === 404 && /model/i.test(apiMessage)) {
    return { fatal: true, code: "bad_model", summary: `CLAUDE_MODEL "${getClaudeModel()}" is not a valid model id.` };
  }
  if (status === 429) {
    return { fatal: false, code: "rate_limited", summary: "Rate limited by the Anthropic API." };
  }
  if (status && status >= 500) {
    return { fatal: false, code: "api_error", summary: `Anthropic API error (${status}).` };
  }
  return {
    fatal: false,
    code: type || "unknown_error",
    summary: apiMessage || "Claude request failed.",
  };
}

/**
 * Circuit breaker.
 *
 * Watchdog calls Claude on every failure-looking bot message, so an empty
 * credit balance produced one full stack trace per bot failure, forever. The
 * fallback was already correct (heuristics), only the logging was not — so a
 * fatal error now parks automatic calls for a cooldown and logs once, and the
 * heuristic path carries on untouched.
 */
const COOLDOWN_MS = Math.max(60_000, Number(process.env.CLAUDE_FAILURE_COOLDOWN_MS) || 30 * 60_000);
let paused = null;

function pauseClaude(reason) {
  const first = !paused || paused.code !== reason.code;
  paused = { ...reason, until: Date.now() + COOLDOWN_MS };
  if (first) {
    console.error(
      `[CLAUDE] ${reason.summary} Automatic Claude calls are paused for ` +
        `${Math.round(COOLDOWN_MS / 60_000)} min; watchdog falls back to its ` +
        `built-in heuristics. Run \`!wd-test\` in Discord to retry immediately.`
    );
  }
}

function clearPause() {
  if (paused) {
    console.log("[CLAUDE] Claude is answering again — resuming automatic calls.");
    paused = null;
  }
}

/** Current pause state, or null when Claude is usable. */
export function getClaudePause() {
  if (paused && Date.now() >= paused.until) paused = null;
  return paused;
}

/** Configured AND not parked by a fatal error. Gate automatic calls on this. */
export function isClaudeAvailable() {
  return isClaudeConfigured() && !getClaudePause();
}

export async function askClaude(promptOrContent, options = {}) {
  const content = options.content ?? promptOrContent;
  const messages = options.messages || [
    {
      role: "user",
      content,
    },
  ];

  // `force` is for user-invoked commands: someone typing !wd is explicitly
  // asking us to try, and that attempt doubles as the probe that un-pauses
  // things once billing is sorted out.
  const pause = getClaudePause();
  if (pause && !options.force) {
    const error = new Error(pause.summary);
    error.claudePaused = true;
    error.claudeCode = pause.code;
    throw error;
  }

  const model = getClaudeModel();
  const request = {
    model,
    max_tokens: options.max_tokens || 500,
    system:
      options.system ||
      "You are Mole-Guard AI. Assist with WinLEW, GeoAgora, and bot logic.",
    messages,
  };
  const temperature = options.temperature ?? 0.4;
  if (modelAcceptsSampling(model)) request.temperature = temperature;

  // `transport` exists so the failure-handling tests can replay real API
  // errors without a key or a network call; production never passes it.
  const send = options.transport || ((body) => getAnthropicClient().messages.create(body));

  let res;
  try {
    res = await send(request);
  } catch (error) {
    const described = describeClaudeError(error);
    error.claudeCode = described.code;
    error.claudeSummary = described.summary;
    if (described.fatal) pauseClaude(described);
    throw error;
  }

  clearPause();

  return res.content
    .map((c) => (c.type === "text" ? c.text : ""))
    .join("\n")
    .trim();
}
