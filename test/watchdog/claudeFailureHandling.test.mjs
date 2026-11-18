// Watchdog's Claude integration — failure handling.
//
// Watchdog calls Claude on every failure-looking bot message. When the
// Anthropic API org ran out of credit, that produced one full stack trace per
// bot failure, indefinitely — the fallback was already correct (heuristics),
// only the noise and the pointless retries were not.
//
// Two guarantees locked here:
//   1. a fatal, human-fixable error (no credit, bad key, no access, bad model)
//      parks automatic calls instead of being retried forever, and carries a
//      summary that says what to actually do;
//   2. a transient error (429, 5xx) does NOT park anything.
//
// Plus: `temperature` is only sent to models that still accept it, so bumping
// CLAUDE_MODEL to a current model can't fail with a 400 that reads like a
// billing problem.
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'sk-ant-test-key';
process.env.CLAUDE_FAILURE_COOLDOWN_MS = '60000';

const {
  describeClaudeError,
  isClaudeAvailable,
  getClaudePause,
  askClaude,
} = await import('../../src/services/claude.js');

/** Shape of a real @anthropic-ai/sdk APIError. */
function apiError(status, type, message) {
  const err = new Error(`${status} ${message}`);
  err.status = status;
  err.error = { type: 'error', error: { type, message } };
  return err;
}

const NO_CREDIT = apiError(
  400,
  'invalid_request_error',
  'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.'
);

test('the empty-credit-balance error is fatal and explains the org-vs-subscription trap', () => {
  const described = describeClaudeError(NO_CREDIT);
  assert.equal(described.code, 'no_credit');
  assert.equal(described.fatal, true, 'retrying an empty balance can never succeed');

  // The whole point of the message: "I have credit" and this error are not a
  // contradiction. It must say where the balance actually lives.
  assert.match(described.summary, /subscription/i);
  assert.match(described.summary, /organi[sz]ation|workspace/i);
  assert.match(described.summary, /Billing/i);
});

test('other human-fixable failures are fatal too', () => {
  assert.equal(describeClaudeError(apiError(401, 'authentication_error', 'invalid x-api-key')).code, 'bad_key');
  assert.equal(describeClaudeError(apiError(403, 'permission_error', 'not allowed')).code, 'no_access');

  const badModel = describeClaudeError(apiError(404, 'not_found_error', 'model: claude-nope'));
  assert.equal(badModel.code, 'bad_model');
  assert.match(badModel.summary, /CLAUDE_MODEL/);

  for (const err of [apiError(401, 'x', 'y'), apiError(403, 'x', 'y'), apiError(404, 'x', 'model: z')]) {
    assert.equal(describeClaudeError(err).fatal, true);
  }
});

test('transient failures are NOT fatal — those should keep retrying', () => {
  for (const [status, type] of [[429, 'rate_limit_error'], [500, 'api_error'], [529, 'overloaded_error']]) {
    const described = describeClaudeError(apiError(status, type, 'try again'));
    assert.equal(described.fatal, false, `${status} must stay retryable`);
  }
});

test('a fatal error parks automatic calls; a forced call still probes', async () => {
  assert.equal(isClaudeAvailable(), true, 'starts available');

  let calls = 0;
  const failing = async () => {
    calls += 1;
    throw NO_CREDIT;
  };

  await assert.rejects(askClaude('hi', { transport: failing }), (err) => err.claudeCode === 'no_credit');
  assert.equal(calls, 1);

  // Parked: the automatic audit path checks this and falls back to heuristics.
  assert.equal(isClaudeAvailable(), false);
  const pause = getClaudePause();
  assert.equal(pause.code, 'no_credit');
  assert.ok(pause.until > Date.now());

  // An automatic call must not reach the network at all while parked.
  await assert.rejects(askClaude('hi', { transport: failing }), (err) => err.claudePaused === true);
  assert.equal(calls, 1, 'parked automatic calls must not hit the API');

  // A user typing !wd forces a probe — that is how recovery gets noticed.
  await assert.rejects(askClaude('hi', { transport: failing, force: true }));
  assert.equal(calls, 2, 'forced calls bypass the pause');

  // ...and a successful probe un-parks it.
  const ok = await askClaude('hi', {
    force: true,
    transport: async () => ({ content: [{ type: 'text', text: 'back online' }] }),
  });
  assert.equal(ok, 'back online');
  assert.equal(isClaudeAvailable(), true, 'success resumes automatic calls');
  assert.equal(getClaudePause(), null);
});

test('temperature is sent only to models that still accept it', async () => {
  const seen = [];
  const transport = async (request) => {
    seen.push(request);
    return { content: [{ type: 'text', text: 'ok' }] };
  };

  // Current default and its contemporaries accept sampling params.
  for (const model of ['claude-sonnet-4-5-20250929', 'claude-sonnet-4-6', 'claude-opus-4-6', 'claude-haiku-4-5']) {
    process.env.CLAUDE_MODEL = model;
    await askClaude('hi', { transport, temperature: 0.4 });
    assert.equal(seen.at(-1).temperature, 0.4, `${model} should still get temperature`);
  }

  // Newer models 400 on temperature. Omitting it is valid on every model, so
  // an unknown/newer id must fail safe by leaving it out.
  for (const model of ['claude-opus-4-8', 'claude-opus-5', 'claude-sonnet-5', 'claude-fable-5', 'claude-something-future']) {
    process.env.CLAUDE_MODEL = model;
    await askClaude('hi', { transport, temperature: 0.4 });
    assert.ok(!('temperature' in seen.at(-1)), `${model} must not be sent temperature`);
  }

  delete process.env.CLAUDE_MODEL;
});
