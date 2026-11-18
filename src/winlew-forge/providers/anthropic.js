const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

export async function sendAnthropic({ prompt, systemPrompt = '', model = (process.env.CLAUDE_MODEL || 'claude-opus-4-8'), temperature = 0.7, maxTokens = 1200 }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY is not configured.');
  }

  const res = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      temperature,
      system: systemPrompt || undefined,
      messages: [{ role: 'user', content: String(prompt) }],
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = data?.error?.message || `Anthropic request failed with status ${res.status}`;
    throw new Error(message);
  }

  const content = Array.isArray(data?.content)
    ? data.content.filter((part) => part?.type === 'text').map((part) => part?.text || '').join('\n').trim()
    : '';

  return {
    provider: 'anthropic',
    model: data?.model || model,
    content,
    raw: data,
  };
}
