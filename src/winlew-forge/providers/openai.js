const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';

export async function sendOpenAI({ prompt, systemPrompt = '', model = 'gpt-4o-mini', temperature = 0.7, maxTokens = 1200 }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not configured.');
  }

  const messages = [];
  if (systemPrompt && String(systemPrompt).trim()) {
    messages.push({ role: 'system', content: String(systemPrompt) });
  }
  messages.push({ role: 'user', content: String(prompt) });

  const res = await fetch(OPENAI_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature,
      max_tokens: maxTokens,
      messages,
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = data?.error?.message || `OpenAI request failed with status ${res.status}`;
    throw new Error(message);
  }

  return {
    provider: 'openai',
    model: data?.model || model,
    content: data?.choices?.[0]?.message?.content?.trim() || '',
    raw: data,
  };
}
