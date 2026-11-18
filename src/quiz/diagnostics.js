const { EASY, MEDIUM, HARD, getPool, validatePools } = require('./questions');
const { SPONSOR_POOLS } = require('./sponsor');

function answerSpread(pool) {
  const spread = [0, 0, 0, 0];
  for (const q of pool) {
    if (Number.isInteger(q.answerIndex) && q.answerIndex >= 0 && q.answerIndex <= 3) {
      spread[q.answerIndex] += 1;
    }
  }
  return { A: spread[0], B: spread[1], C: spread[2], D: spread[3] };
}

function answerBalanceStats(spread) {
  const values = Object.values(spread);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const missing = Object.entries(spread).filter(([, count]) => count === 0).map(([key]) => key);
  return { min, max, range: max - min, missing };
}

function malformedEntries(pool) {
  return pool
    .map((q, idx) => ({ q, idx }))
    .filter(({ q }) => !(typeof q?.q === 'string' && Array.isArray(q?.choices) && q.choices.length === 4 && Number.isInteger(q.answerIndex) && q.answerIndex >= 0 && q.answerIndex <= 3));
}

function duplicateTexts(pool) {
  const seen = new Map();
  const dupes = [];
  for (const q of pool) {
    const key = String(q?.q || '').trim().toLowerCase();
    if (!key) continue;
    const count = (seen.get(key) || 0) + 1;
    seen.set(key, count);
    if (count === 2) dupes.push(q.q);
  }
  return dupes;
}

function topTags(pool, limit = 8) {
  const counts = new Map();
  for (const q of pool) {
    for (const tag of Array.isArray(q?.tags) ? q.tags : []) {
      counts.set(tag, (counts.get(tag) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit);
}

function summarizePool(label, pool) {
  const answers = answerSpread(pool);
  return {
    label,
    count: pool.length,
    malformed: malformedEntries(pool),
    duplicates: duplicateTexts(pool),
    answers,
    balance: answerBalanceStats(answers),
    tags: topTags(pool),
  };
}

function logPool(prefix, summary) {
  console.log(`[quiz-diagnostics] ${prefix} count=${summary.count} malformed=${summary.malformed.length} duplicates=${summary.duplicates.length} answers=${JSON.stringify(summary.answers)} balanceRange=${summary.balance.range}`);
  if (summary.balance.missing.length) {
    console.warn(`[quiz-diagnostics] ${prefix} missing-answer-slots=${summary.balance.missing.join(',')}`);
  }
  if (summary.tags.length) {
    console.log(`[quiz-diagnostics] ${prefix} top-tags=${summary.tags.map(([tag, count]) => `${tag}:${count}`).join(', ')}`);
  }
  for (const item of summary.malformed) {
    console.warn(`[quiz-diagnostics] ${prefix} malformed #${item.idx}:`, {
      q: item.q?.q,
      choices: item.q?.choices,
      answerIndex: item.q?.answerIndex,
    });
  }
  for (const dupe of summary.duplicates.slice(0, 5)) {
    console.warn(`[quiz-diagnostics] ${prefix} duplicate text: ${dupe}`);
  }
}

function parseBool(raw, fallback = false) {
  if (raw == null || raw === '') return fallback;
  const v = String(raw).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(v)) return true;
  if (['0', 'false', 'no', 'off'].includes(v)) return false;
  return fallback;
}

function runQuizDiagnostics() {
  const general = {
    easy: summarizePool('general.easy', getPool('easy')),
    medium: summarizePool('general.medium', getPool('medium')),
    hard: summarizePool('general.hard', getPool('hard')),
  };
  const sponsor = Object.fromEntries(
    Object.entries(SPONSOR_POOLS).map(([key, pool]) => [key, summarizePool(`sponsor.${key}`, pool)])
  );

  const questionProblems = validatePools({ throwOnError: false });
  const sponsorProblems = Object.values(sponsor).flatMap((summary) => summary.malformed);
  const totalGeneral = Object.values(general).reduce((sum, item) => sum + item.count, 0);
  const totalSponsor = Object.values(sponsor).reduce((sum, item) => sum + item.count, 0);

  console.log(`[quiz-diagnostics] general totals easy=${general.easy.count} medium=${general.medium.count} hard=${general.hard.count} total=${totalGeneral}`);
  console.log(`[quiz-diagnostics] sponsor totals ${Object.entries(sponsor).map(([key, item]) => `${key}=${item.count}`).join(' ')} total=${totalSponsor}`);

  for (const [key, summary] of Object.entries(general)) logPool(key, summary);
  for (const [key, summary] of Object.entries(sponsor)) logPool(key, summary);

  const strict = parseBool(process.env.QUIZ_STRICT_VALIDATION, false);
  const totalProblems = questionProblems.length + sponsorProblems.length;
  if (strict && totalProblems > 0) {
    throw new Error(`quiz_diagnostics_failed:${totalProblems}`);
  }

  if (totalProblems === 0) {
    console.log('[quiz-diagnostics] status=healthy');
  } else {
    console.warn(`[quiz-diagnostics] status=warning totalProblems=${totalProblems} strict=${strict}`);
  }

  return {
    general,
    sponsor,
    totalGeneral,
    totalSponsor,
    totalProblems,
    strict,
  };
}

module.exports = { runQuizDiagnostics };
