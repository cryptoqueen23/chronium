// Provider registry. Swapping the active AI provider is a config change
// (the AI_PROVIDER var in wrangler.jsonc) plus a new adapter file here -
// never a change to the callers in src/index.js, which only ever see the
// generic AIProvider interface from ./provider.js.
import { openaiProvider } from './openai.js';
import { anthropicProvider } from './anthropic.js';

// OpenAI is the preferred provider and the default. Anthropic stays registered only so the existing code path can be switched
// off or compared; it gets no new work (decision of 2026-10-26).
const PROVIDERS = {
  openai: openaiProvider,
  anthropic: anthropicProvider
  // gemini: geminiProvider, local: localModelProvider, etc. - add here.
};

export function getAIProvider(env) {
  const id = env.AI_PROVIDER || 'openai';
  const provider = PROVIDERS[id];
  if (!provider) throw new Error(`Unknown AI_PROVIDER "${id}" - configured providers: ${Object.keys(PROVIDERS).join(', ')}`);
  return provider;
}
