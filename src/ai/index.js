// Provider registry. Swapping the active AI provider is a config change
// (the AI_PROVIDER var in wrangler.jsonc) plus a new adapter file here -
// never a change to the callers in src/index.js, which only ever see the
// generic AIProvider interface from ./provider.js.
import { anthropicProvider } from './anthropic.js';

const PROVIDERS = {
  anthropic: anthropicProvider
  // openai: openaiProvider, gemini: geminiProvider, local: localModelProvider, etc. - add here.
};

export function getAIProvider(env) {
  const id = env.AI_PROVIDER || 'anthropic';
  const provider = PROVIDERS[id];
  if (!provider) throw new Error(`Unknown AI_PROVIDER "${id}" - configured providers: ${Object.keys(PROVIDERS).join(', ')}`);
  return provider;
}
