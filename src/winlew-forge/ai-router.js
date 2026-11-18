import { sendOpenAI } from './providers/openai.js';
import { sendAnthropic } from './providers/anthropic.js';

const DEFAULTS = {
  openai: 'gpt-4o-mini',
  anthropic: (process.env.CLAUDE_MODEL || 'claude-opus-4-8'),
};

export function normalizeForgeRequest(body = {}) {
  const provider = String(body.provider || 'openai').toLowerCase();
  const prompt = String(body.prompt || '').trim();
  const systemPrompt = String(body.systemPrompt || '').trim();
  const model = String(body.model || DEFAULTS[provider] || DEFAULTS.openai).trim();
  const temperature = Number.isFinite(Number(body.temperature)) ? Number(body.temperature) : 0.7;
  const maxTokens = Number.isFinite(Number(body.maxTokens)) ? Number(body.maxTokens) : 1200;
  const task = String(body.task || 'general').trim();

  if (!prompt) {
    throw new Error('Prompt is required.');
  }

  return {
    provider,
    prompt,
    systemPrompt,
    model,
    temperature,
    maxTokens,
    task,
  };
}

export async function routeForgePrompt(input) {
  switch (input.provider) {
    case 'anthropic':
    case 'claude':
      return sendAnthropic({ ...input, model: input.model || DEFAULTS.anthropic });
    case 'openai':
    case 'gpt':
    default:
      return sendOpenAI({ ...input, model: input.model || DEFAULTS.openai });
  }
}

export function getForgeCatalog() {
  return {
    brains: [
      {
        id: 'openai',
        label: 'OpenAI',
        role: 'Logic, structured outputs, gameplay systems',
        defaultModel: DEFAULTS.openai,
      },
      {
        id: 'anthropic',
        label: 'Anthropic',
        role: 'Creative writing, worldbuilding, design exploration',
        defaultModel: DEFAULTS.anthropic,
      },
    ],
    image: [
      { id: 'leonardo', label: 'Leonardo', status: 'planned' },
      { id: 'midjourney', label: 'Midjourney', status: 'planned' },
      { id: 'stable-diffusion', label: 'Stable Diffusion', status: 'planned' },
    ],
    web3: [
      { id: 'score-hooks', label: 'Score hooks', status: 'planned' },
      { id: 'achievement-rewards', label: 'Achievement rewards', status: 'planned' },
      { id: 'daily-participation', label: 'Daily participation', status: 'planned' },
    ],
  };
}
