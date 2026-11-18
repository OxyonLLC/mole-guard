const fs = require('fs');
const path = require('path');
const { quizDataDir, ensureQuizDataDir, readManagedQuizJson, writeManagedQuizJson } = require('./storage');

let cache = null;

function ensureFile() {
  ensureQuizDataDir();
  if (!fs.existsSync(path.join(quizDataDir(), 'recent_questions.json'))) {
    writeManagedQuizJson('recent_questions.json', { channels: {} });
  }
}

function load() {
  if (cache) return cache;
  ensureFile();
  try {
    const raw = readManagedQuizJson('recent_questions.json', { channels: {} });
    cache = raw && typeof raw === 'object' && raw.channels && typeof raw.channels === 'object'
      ? raw
      : { channels: {} };
  } catch {
    cache = { channels: {} };
  }
  return cache;
}

function save() {
  ensureFile();
  writeManagedQuizJson('recent_questions.json', load());
}

function getRecentQuestionKeys(channelId) {
  const state = load();
  const row = state.channels[String(channelId)] || {};
  return Array.isArray(row.history) ? row.history : [];
}

function rememberQuestion(channelId, key, max = 12) {
  const state = load();
  const id = String(channelId);
  const row = state.channels[id] || { history: [], updatedAt: 0 };
  const next = [...(Array.isArray(row.history) ? row.history : []), String(key)].slice(-Math.max(1, Number(max) || 12));
  state.channels[id] = {
    history: next,
    updatedAt: Date.now(),
  };
  save();
  return next;
}

function getSummary(channelId) {
  const history = getRecentQuestionKeys(channelId);
  return {
    count: history.length,
    latest: history[history.length - 1] || null,
  };
}

module.exports = {
  getRecentQuestionKeys,
  rememberQuestion,
  getSummary,
};
