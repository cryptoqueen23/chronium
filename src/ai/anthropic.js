// Anthropic adapter - the first AIProvider implementation, not a special
// case. Reads env.ANTHROPIC_API_KEY (a Cloudflare secret the operator sets
// via `wrangler secret put ANTHROPIC_API_KEY` - never in the repo, never
// sent to the client). Swap providers via the AI_PROVIDER var in
// wrangler.jsonc + src/ai/index.js's registry, not by editing callers.
import { AIProvider } from './provider.js';

const ANTHROPIC_MODEL = 'claude-haiku-4-5-20251001'; // cheapest capable model - matches CANON.md's cost principle

async function complete({ system, prompt, maxTokens, env }) {
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('AI analysis is not configured yet (no ANTHROPIC_API_KEY secret set).');

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: maxTokens || 1024,
      system,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  if (!res.ok) {
    const bodyText = await res.text().catch(() => '');
    throw new Error(`Anthropic HTTP ${res.status}: ${bodyText.slice(0, 300)}`);
  }

  const data = await res.json();
  const text = (data.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
  return {
    text,
    inputTokens: data.usage?.input_tokens || 0,
    outputTokens: data.usage?.output_tokens || 0,
    model: data.model || ANTHROPIC_MODEL
  };
}

export const anthropicProvider = new AIProvider({ id: 'anthropic', label: 'Anthropic Claude (Haiku)', complete });
