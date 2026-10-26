// JSON Schemas for the two structured answers. They describe exactly what src/aiResult.js accepts, so a provider that supports
// strict structured output (OpenAI Responses API: text.format json_schema, strict) is steered to the right shape. They do NOT
// replace the validator: aiResult.js still checks every field, every citation and the stop reason, whatever the provider promises.
// Strict mode needs every property listed in `required` and `additionalProperties: false`.
const idList = { type: 'array', items: { type: 'string' } };
const cited = (extra) => ({ type: 'object', additionalProperties: false, required: [...Object.keys(extra), 'evidenceIds'], properties: { ...extra, evidenceIds: idList } });

export const ANALYSIS_SCHEMA = Object.freeze({
  name: 'chronium_analysis',
  schema: {
    type: 'object', additionalProperties: false,
    required: ['themes', 'patterns', 'contradictions', 'synthesis'],
    properties: {
      themes: { type: 'array', items: cited({ title: { type: 'string' }, description: { type: 'string' } }) },
      patterns: { type: 'array', items: cited({ description: { type: 'string' } }) },
      contradictions: { type: 'array', items: cited({ description: { type: 'string' } }) },
      synthesis: { type: 'string' }
    }
  }
});

export const ASK_SOURCES_SCHEMA = Object.freeze({
  name: 'chronium_ask_sources',
  schema: {
    type: 'object', additionalProperties: false,
    required: ['answer', 'citedPassageIds', 'insufficient', 'missing'],
    properties: { answer: { type: 'string' }, citedPassageIds: idList, insufficient: { type: 'boolean' }, missing: { type: 'string' } }
  }
});
