// Provider-agnostic AI interface. Every adapter (Anthropic today; OpenAI,
// Gemini, a local model, etc. later) implements the same shape - a single
// `complete()` call that takes a system prompt + user prompt and returns
// text plus token usage. Nothing outside src/ai/ should ever import a
// specific provider's SDK/API shape directly - callers only see AIProvider.
export class AIProvider {
  constructor({ id, label, complete }) {
    this.id = id;
    this.label = label;
    this._complete = complete; // async ({ system, prompt, maxTokens, env }) => { text, inputTokens, outputTokens, model }
  }

  async complete(args) {
    return this._complete(args);
  }
}
