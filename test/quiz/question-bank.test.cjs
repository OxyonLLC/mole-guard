'use strict';

// Uses the EXISTING question bank + its EXISTING validator (src/quiz/questions.js)
// rather than introducing a new/duplicate validation path. This is the same
// pool the Discord bot and the web quiz both draw from (src/mole/web.js
// requires this same file) — proving it's clean here proves it for both.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const questions = require(path.join('..', '..', 'src', 'quiz', 'questions.js'));
const sponsor = require(path.join('..', '..', 'src', 'quiz', 'sponsor.js'));

test('the regular question bank has no malformed/duplicate-answer/missing records', () => {
  const problems = questions.validatePools({ throwOnError: false });
  assert.deepEqual(problems, [], `found ${problems.length} invalid question record(s): ${JSON.stringify(problems.slice(0, 3))}`);
});

test('each difficulty pool is non-empty', () => {
  assert.ok(questions.EASY.length > 0, 'EASY pool must not be empty');
  assert.ok(questions.MEDIUM.length > 0, 'MEDIUM pool must not be empty');
  assert.ok(questions.HARD.length > 0, 'HARD pool must not be empty');
});

test('getAllQuestions returns the concatenation of all three pools', () => {
  const all = questions.getAllQuestions();
  assert.equal(all.length, questions.EASY.length + questions.MEDIUM.length + questions.HARD.length);
});

test('getPool resolves easy/medium/hard and defaults to easy for an unknown level', () => {
  assert.equal(questions.getPool('easy').length, questions.EASY.length);
  assert.equal(questions.getPool('medium').length, questions.MEDIUM.length);
  assert.equal(questions.getPool('hard').length, questions.HARD.length);
  assert.equal(questions.getPool('nonsense').length, questions.EASY.length);
});

test('every question in every pool has exactly 4 string choices and a valid answerIndex', () => {
  for (const [label, pool] of [['easy', questions.EASY], ['medium', questions.MEDIUM], ['hard', questions.HARD]]) {
    pool.forEach((q, i) => {
      assert.ok(Array.isArray(q.choices) && q.choices.length === 4, `${label}[${i}] must have 4 choices`);
      assert.ok(q.choices.every((c) => typeof c === 'string' && c.length > 0), `${label}[${i}] choices must be non-empty strings`);
      assert.ok(Number.isInteger(q.answerIndex) && q.answerIndex >= 0 && q.answerIndex <= 3, `${label}[${i}] answerIndex must reference a real choice`);
      assert.ok(typeof q.q === 'string' && q.q.trim().length > 0, `${label}[${i}] must have non-empty question text`);
    });
  }
});

test('no exact-duplicate question text within a single difficulty pool', () => {
  for (const [label, pool] of [['easy', questions.EASY], ['medium', questions.MEDIUM], ['hard', questions.HARD]]) {
    const seen = new Set();
    const dupes = [];
    for (const q of pool) {
      const key = q.q.trim().toLowerCase();
      if (seen.has(key)) dupes.push(key);
      seen.add(key);
    }
    assert.deepEqual(dupes, [], `${label} pool has duplicate question text: ${JSON.stringify(dupes)}`);
  }
});

test('sponsor pools exist and are shaped like the regular pools', () => {
  assert.ok(sponsor.SPONSOR_POOLS && typeof sponsor.SPONSOR_POOLS === 'object');
  const keys = Object.keys(sponsor.SPONSOR_POOLS);
  assert.ok(keys.length > 0, 'at least one sponsor pool must exist');
  for (const key of keys) {
    const pool = sponsor.SPONSOR_POOLS[key];
    assert.ok(Array.isArray(pool) && pool.length > 0, `sponsor pool "${key}" must be a non-empty array`);
    pool.forEach((q, i) => {
      assert.ok(Array.isArray(q.choices) && q.choices.length === 4, `sponsor:${key}[${i}] must have 4 choices`);
      assert.ok(Number.isInteger(q.answerIndex) && q.answerIndex >= 0 && q.answerIndex <= 3, `sponsor:${key}[${i}] answerIndex must be valid`);
    });
  }
});
