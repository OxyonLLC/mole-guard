function cloneTags(tags = []) {
  return Array.from(new Set((Array.isArray(tags) ? tags : []).filter(Boolean)));
}

function rotateChoices(question, targetIndex) {
  const choices = Array.isArray(question.choices) ? [...question.choices] : [];
  const current = Number(question.answerIndex);
  if (choices.length !== 4 || !Number.isInteger(current) || current < 0 || current > 3) {
    return { ...question };
  }
  const delta = ((targetIndex - current) % 4 + 4) % 4;
  const rotated = new Array(4);
  for (let i = 0; i < 4; i += 1) {
    rotated[(i + delta) % 4] = choices[i];
  }
  return { ...question, choices: rotated, answerIndex: targetIndex };
}

function rebalancePool(pool, { startOffset = 0 } = {}) {
  if (!Array.isArray(pool)) return [];
  return pool.map((question, idx) => rotateChoices(question, (idx + startOffset) % 4));
}

function packRawPool(rawPool, { sponsor = null, difficulty = null, startOffset = 0 } = {}) {
  if (!Array.isArray(rawPool)) return [];
  return rawPool.map((item, idx) => {
    const targetIndex = (idx + startOffset) % 4;
    const distractors = Array.isArray(item.distractors) ? [...item.distractors] : [];
    const choices = [];
    let wrongIdx = 0;
    for (let i = 0; i < 4; i += 1) {
      if (i === targetIndex) {
        choices.push(item.correct);
      } else {
        choices.push(distractors[wrongIdx]);
        wrongIdx += 1;
      }
    }
    return {
      q: item.q,
      choices,
      answerIndex: targetIndex,
      tags: cloneTags([...(item.tags || []), sponsor].filter(Boolean)),
      difficulty: item.difficulty || difficulty || undefined,
      sponsor: sponsor || item.sponsor || undefined,
    };
  });
}

function validatePool(pool, {
  label = 'pool',
  throwOnError = false,
  requireTags = false,
  requireDifficulty = false,
} = {}) {
  const problems = [];
  for (const [idx, q] of (pool || []).entries()) {
    const okQ = typeof q?.q === 'string' && q.q.trim().length > 0;
    const okChoices = Array.isArray(q?.choices) && q.choices.length === 4 && q.choices.every((c) => typeof c === 'string' && c.trim().length > 0);
    const okIndex = Number.isInteger(q?.answerIndex) && q.answerIndex >= 0 && q.answerIndex <= 3;
    const okTags = !requireTags || (Array.isArray(q?.tags) && q.tags.length > 0);
    const okDifficulty = !requireDifficulty || ['easy', 'medium', 'hard'].includes(String(q?.difficulty || '').toLowerCase());
    if (!okQ || !okChoices || !okIndex || !okTags || !okDifficulty) {
      problems.push({ label, idx, q });
    }
  }
  if (problems.length) {
    const summary = `Question validation failed for ${label} with ${problems.length} problem(s).`;
    if (throwOnError) {
      const detail = problems.slice(0, 5).map((p) => `${p.label}#${p.idx}`).join(', ');
      throw new Error(`${summary} ${detail}`);
    }
    console.warn(`⚠️ ${summary}`);
  }
  return problems;
}

function answerDistribution(pool) {
  const counts = [0, 0, 0, 0];
  for (const q of pool || []) {
    if (Number.isInteger(q?.answerIndex) && q.answerIndex >= 0 && q.answerIndex <= 3) {
      counts[q.answerIndex] += 1;
    }
  }
  return { A: counts[0], B: counts[1], C: counts[2], D: counts[3] };
}

module.exports = {
  cloneTags,
  rotateChoices,
  rebalancePool,
  packRawPool,
  validatePool,
  answerDistribution,
};
