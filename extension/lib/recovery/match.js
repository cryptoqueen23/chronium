// Records Recovery: matching an expectation (or a request item) to documents the case holds.
//
// Tiers (docs/RECORDS_RECOVERY_PLAN.md, section 5 as amended in section 14):
//   exact      same file (hash) or same original address                        -> may close a gap
//   series     same type, body and date, EACH read from the document's own text  -> may close a gap
//   reference  the document is the numbered item a citation names               -> never closes a gap; requires review
//   candidate  some facts agree, or the facts rest only on names/links          -> never closes a gap; requires review
//   none
// A person's confirmation (a stored decision) can close what the rules cannot; that is applied by the model, not here.
// Pure module.

export const TIER_LABEL = Object.freeze({
  exact: 'Same file or same address',
  series: 'Same record type, body and date, each read from the document\'s own text',
  reference: 'Carries the number the citation names (requires review)',
  candidate: 'Some details agree (requires review)',
  none: 'Nothing held fits'
});
export const CLOSING_TIERS = new Set(['exact', 'series']);

const eqBody = (want, have) => !want || want === have;

/**
 * expectation: { type?, body?, date?, hash?, address?, citationKey? }
 * facts: list from extractFacts. Returns { tier, matches: [{ facts, tier, why }], closes }.
 * Several documents can match; the strongest tier decides, and every match is returned with its reason.
 */
export function matchExpectation(expectation, factsList) {
  const out = [];
  for (const f of factsList) {
    if (expectation.hash && f.hash && f.hash === expectation.hash) { out.push({ facts: f, tier: 'exact', why: 'same file (identical SHA-256)' }); continue; }
    if (expectation.address && (f.address === expectation.address || f.alsoFoundAt.includes(expectation.address))) { out.push({ facts: f, tier: 'exact', why: 'same original address' }); continue; }
    if (expectation.citationKey) {
      if (f.ownNumbers.includes(expectation.citationKey)) out.push({ facts: f, tier: 'reference', why: `the document's own number is ${expectation.citationKey.split(':')[1]}` });
      continue;
    }
    if (!expectation.type) continue;
    const typeOk = f.type.value === expectation.type;
    const bodyOk = eqBody(expectation.body, f.body.value);
    const dateOk = !!expectation.date && f.date.iso === expectation.date && !f.date.ambiguous;
    if (typeOk && bodyOk && dateOk) {
      const textBased = f.type.basis === 'document text' && f.date.basis === 'document text' && (!expectation.body || f.body.basis === 'document text') && !f.date.conflict;
      if (textBased) out.push({ facts: f, tier: 'series', why: `same ${f.type.value}${expectation.body ? `, body (${f.body.value})` : ''} and date, each read from the document's own text` });
      else out.push({ facts: f, tier: 'candidate', why: f.date.conflict ? 'same type and date, but the date is stated differently in different places' : 'same type, body and date, but at least one detail comes from a file name or link, not from the document\'s text' });
      continue;
    }
    // A different record type never matches (an agenda is not the minutes of the same meeting), and neither does a
    // different named body (council minutes never satisfy a planning commission expectation).
    if (!typeOk) continue;
    if (expectation.body && f.body.value && f.body.value !== expectation.body) continue;
    if (dateOk) out.push({ facts: f, tier: 'candidate', why: 'same type and date; the body differs or is not stated' });
    else if (expectation.date && f.date.iso && !f.date.ambiguous && bodyOk && f.body.value !== null) {
      const gap = Math.abs(Date.parse(f.date.iso) - Date.parse(expectation.date)) / 86400000;
      if (gap <= 3) out.push({ facts: f, tier: 'candidate', why: `same type and body; dated ${gap} day${gap === 1 ? '' : 's'} from the expected date` });
    }
  }
  const rank = { exact: 3, series: 2, reference: 1, candidate: 1 };
  out.sort((a, b) => (rank[b.tier] - rank[a.tier]) || (a.facts.recordId < b.facts.recordId ? -1 : 1));
  const tier = out.length ? (out.some((m) => m.tier === 'exact') ? 'exact' : out.some((m) => m.tier === 'series') ? 'series' : out.some((m) => m.tier === 'reference') ? 'reference' : 'candidate') : 'none';
  return { tier, matches: out, closes: CLOSING_TIERS.has(tier) };
}
