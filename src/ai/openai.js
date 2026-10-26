// OpenAI adapter (Responses API). OpenAI is the preferred AI provider; Anthropic is legacy and gets no new work.
//
// KEY HANDLING: the key is read only from env.OPENAI_API_KEY, a Cloudflare Worker SECRET that the operator types into
// `wrangler secret put OPENAI_API_KEY` (hidden prompt). It is never in the repository, a variable, a browser, the extension or the
// PWA. It is used only in the Authorization header of the request below. No error from this file contains response text
// from OpenAI (an error body can echo part of a key), only the HTTP status and OpenAI's short machine code.
//
// WHAT IT SENDS: one POST https://api.openai.com/v1/responses, non-streaming, with
//   store: false                  OpenAI keeps no application state for the call (it still keeps abuse-monitoring logs up to 30 days)
//   max_output_tokens: <cap>      the Worker's cap (src/guard.js aiCaps); reasoning tokens count against it, see below
//   reasoning.effort: "none"      OpenAI's GPT-6 Luna and Terra support "none". A reasoning model that is left at its default
//                                 effort ("medium") would spend the whole small cap on hidden reasoning and return nothing,
//                                 which the strict validator would then (correctly) refuse as truncated. Configurable, see below.
//   text.format: json_schema, strict  steers the shape; src/aiResult.js still validates everything
//   safety_identifier: <hash>     a one-way hash of the visitor, so abuse by one visitor cannot get the whole account throttled
// WHAT IT RETURNS: the text, the token counts, the model, and a stop reason in the shared vocabulary src/aiResult.js understands:
//   "end_turn" (status completed), "max_tokens" (status incomplete, reason max_output_tokens), "refusal", or null (anything else).
//
// CONFIGURATION (all optional, plain variables, none secret):
//   OPENAI_MODEL              default "gpt-6-luna" (OpenAI's lowest-cost current model, $0.10 / $0.50 per million tokens).
//                             NOT yet tested live: the staging AI phase must confirm it follows the schema and cites correctly.
//   OPENAI_REASONING_EFFORT   default "none". A model that does not support "none" (GPT-6 Sol, Astra) answers 400 and the call is
//                             refused; do not raise effort without raising the output cap, which needs an approved code change.
//   OPENAI_STRUCTURED         "off" omits the schema (the prompt still asks for JSON, the validator still decides).
import { AIProvider } from './provider.js';

export const OPENAI_DEFAULT_MODEL = 'gpt-6-luna';
const EFFORTS = new Set(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']);
const MODEL_RE = /^[a-z0-9][a-z0-9._-]{1,63}$/;

export function openaiSettings(env) {
  const model = env.OPENAI_MODEL ? String(env.OPENAI_MODEL).trim() : OPENAI_DEFAULT_MODEL;
  if (!MODEL_RE.test(model)) throw new Error('AI analysis is not configured correctly (OPENAI_MODEL is not a model name).');
  const effort = EFFORTS.has(env.OPENAI_REASONING_EFFORT) ? env.OPENAI_REASONING_EFFORT : 'none';
  return { model, effort, structured: env.OPENAI_STRUCTURED !== 'off' };
}

export function buildOpenAIRequest({ system, prompt, maxTokens, schema, safetyId, env }) {
  const { model, effort, structured } = openaiSettings(env);
  const body = { model, instructions: system, input: prompt, max_output_tokens: maxTokens, store: false, reasoning: { effort } };
  if (structured && schema) body.text = { format: { type: 'json_schema', name: schema.name, strict: true, schema: schema.schema } };
  if (safetyId) body.safety_identifier = String(safetyId).slice(0, 64);
  return body;
}

// The Responses API output is a list of items; the answer is in message items as "output_text" parts, a refusal as a "refusal" part.
export function readOpenAIResponse(data) {
  const parts = [];
  let refused = false;
  for (const item of Array.isArray(data?.output) ? data.output : []) {
    if (item?.type !== 'message' || !Array.isArray(item.content)) continue;
    for (const c of item.content) {
      if (c?.type === 'output_text' && typeof c.text === 'string') parts.push(c.text);
      else if (c?.type === 'refusal') refused = true;
    }
  }
  let stopReason = null;
  if (refused) stopReason = 'refusal';
  else if (data?.status === 'completed') stopReason = 'end_turn';
  else if (data?.status === 'incomplete') stopReason = data?.incomplete_details?.reason === 'max_output_tokens' ? 'max_tokens' : data?.incomplete_details?.reason === 'content_filter' ? 'refusal' : null;
  return {
    text: parts.join(''),
    inputTokens: Number(data?.usage?.input_tokens) || 0,
    outputTokens: Number(data?.usage?.output_tokens) || 0,
    model: typeof data?.model === 'string' ? data.model : '',
    stopReason
  };
}

async function complete({ system, prompt, maxTokens, schema, safetyId, env }) {
  const apiKey = env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('AI analysis is not configured yet (no OPENAI_API_KEY secret set).');
  const body = buildOpenAIRequest({ system, prompt, maxTokens, schema, safetyId, env });
  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    // Never pass the response text on: an error body can echo part of a key. Status and OpenAI's short code are enough to diagnose.
    let code = '';
    try { const j = await res.json(); code = String(j?.error?.code || j?.error?.type || '').replace(/[^a-z0-9_.-]/gi, '').slice(0, 60); } catch { /* no body */ }
    throw new Error(`OpenAI HTTP ${res.status}${code ? ` ${code}` : ''}`);
  }
  let data;
  try { data = await res.json(); } catch { throw new Error('OpenAI answered with something that was not JSON'); }
  if (data?.error) throw new Error(`OpenAI reported an error${data.error.code ? ` ${String(data.error.code).replace(/[^a-z0-9_.-]/gi, '').slice(0, 60)}` : ''}`);
  return readOpenAIResponse(data);
}

export const openaiProvider = new AIProvider({ id: 'openai', label: 'OpenAI (Responses API)', complete });
