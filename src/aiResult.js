// Strict reading of the model's structured answers. An answer counts as COMPLETE only if all of these hold:
//   1. the provider says the model finished on its own (stop reason "end_turn"), not that it ran out of tokens, refused, or
//      that the reason is unknown;
//   2. the text is exactly one JSON object (an optional matching ``` fence is allowed; anything else around it is not);
//   3. every required field is present with exactly the right type, and every cited id is one that this request supplied.
// Anything else is INCOMPLETE and carries a reason. Incomplete output is never repaired, never partly used, never cached and
// never returned as an analysis: callers return a plain refusal instead. A cut-off answer is not a shorter answer, it is
// no answer, so the person is told that and nothing is saved.

export const INCOMPLETE_CODES = Object.freeze({
  truncated: 'ai-truncated', malformed: 'ai-malformed', unverified: 'ai-unverified', refused: 'ai-refused'
});

// Reads the stop reason. Only an explicit "end_turn" means the model finished.
export function completionState(stopReason) {
  if (stopReason === 'end_turn') return 'finished';
  if (stopReason === 'max_tokens') return 'truncated';
  if (stopReason === 'refusal') return 'refused';
  return 'unverified'; // missing, null, tool_use, pause_turn, model_context_window_exceeded, anything new
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isStr = (v) => typeof v === 'string';
const isNonEmptyStr = (v) => typeof v === 'string' && v.trim().length > 0;
const isStrArray = (v) => Array.isArray(v) && v.every(isStr);

// The text must be one JSON object. A leading ``` fence is accepted only together with its closing fence.
export function parseJsonObject(text) {
  if (!isStr(text)) return null;
  let t = text.trim();
  if (t.startsWith('```')) {
    const m = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(t);
    if (!m) return null; // an opening fence with no closing fence is a cut-off answer
    t = m[1];
  }
  let parsed;
  try { parsed = JSON.parse(t); } catch { return null; }
  return isObj(parsed) ? parsed : null;
}

function idsKnown(ids, allowed) { return !allowed || ids.every((id) => allowed.has(id)); }

// ---- Qualitative analysis ----
export function validateAnalysis(p, allowedIds = null) {
  if (!isObj(p)) return false;
  if (!isNonEmptyStr(p.synthesis)) return false;
  const withIds = (list, textKeys) => Array.isArray(list) && list.every((x) => isObj(x) && textKeys.every((k) => isNonEmptyStr(x[k])) && isStrArray(x.evidenceIds) && idsKnown(x.evidenceIds, allowedIds));
  return withIds(p.themes, ['title', 'description']) && withIds(p.patterns, ['description']) && withIds(p.contradictions, ['description']);
}

// ---- Ask Sources ----
export function validateAskSources(p, allowedIds = null) {
  if (!isObj(p)) return false;
  if (typeof p.insufficient !== 'boolean') return false;
  if (!isStr(p.answer) || !isStr(p.missing) || !isStrArray(p.citedPassageIds)) return false;
  if (!idsKnown(p.citedPassageIds, allowedIds)) return false;
  if (p.insufficient) return isNonEmptyStr(p.missing); // "not enough in the passages" must say what is missing
  return isNonEmptyStr(p.answer) && p.citedPassageIds.length > 0; // an answer must cite what it rests on
}

function interpret(text, stopReason, validate, shape, allowedIds) {
  const state = completionState(stopReason);
  if (state === 'truncated') return { complete: false, reason: 'truncated' };
  if (state === 'refused') return { complete: false, reason: 'refused' };
  const parsed = parseJsonObject(text);
  if (!parsed || !validate(parsed, allowedIds)) return { complete: false, reason: 'malformed' };
  if (state !== 'finished') return { complete: false, reason: 'unverified' }; // well formed, but nobody can say the model finished
  return { complete: true, result: shape(parsed) };
}

export function interpretAnalysis(text, stopReason, allowedIds = null) {
  return interpret(text, stopReason, validateAnalysis, (p) => ({
    themes: p.themes.map((t) => ({ title: t.title, description: t.description, evidenceIds: t.evidenceIds })),
    patterns: p.patterns.map((x) => ({ description: x.description, evidenceIds: x.evidenceIds })),
    contradictions: p.contradictions.map((x) => ({ description: x.description, evidenceIds: x.evidenceIds })),
    synthesis: p.synthesis, complete: true, parseError: false
  }), allowedIds);
}

export function interpretAskSources(text, stopReason, allowedIds = null) {
  return interpret(text, stopReason, validateAskSources, (p) => ({
    answer: p.answer, citedPassageIds: p.citedPassageIds, insufficient: p.insufficient, missing: p.missing, complete: true, parseError: false
  }), allowedIds);
}

// The plain refusal sent instead of an analysis. No model text is included.
export const incompleteBody = (reason) => ({ ok: false, error: INCOMPLETE_CODES[reason] || INCOMPLETE_CODES.malformed, incomplete: reason });
