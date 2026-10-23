// Deep Discovery: what kind of public record a link probably is, from the
// words in its link text, file name and the page it was found on. Rules only
// (no AI): the first match wins, "other" is the honest default, and the result
// is a hint shown to the person, never a claim about the document's contents.
// Pure module.

export const RULES = [
  ['minutes', /\bminutes?\b/],
  ['packet', /\b(agenda\s*)?(packet|attachments?|backup|exhibits?)\b/],
  ['agenda', /\bagendas?\b/],
  ['check-register', /\b(check\s*register|checks?\s*issued|disbursements?|expenditure\s*report|warrant\s*register|payment\s*register|vendor\s*payments?)\b/],
  ['audit', /\b(audit|acfr|cafr|annual\s*comprehensive\s*financial|financial\s*report|financial\s*statements?)\b/],
  ['budget', /\b(budget|appropriations?|tax\s*rate|proposed\s*rate)\b/],
  ['contract', /\b(contracts?|agreements?|interlocal|memorandum\s*of\s*understanding|\bmou\b|bid\s*tabulation|purchase\s*order)\b/],
  ['ordinance', /\bordinances?\b/],
  ['resolution', /\bresolutions?\b/]
];

export const CLASS_LABEL = Object.freeze({
  agenda: 'Agenda', minutes: 'Minutes', packet: 'Agenda packet or attachment', budget: 'Budget', audit: 'Audit or financial report',
  'check-register': 'Check register or expenditure report', contract: 'Contract or agreement', ordinance: 'Ordinance', resolution: 'Resolution', other: 'Other document'
});

export function classifyDocument({ url = '', text = '', parentText = '' } = {}) {
  let name = '';
  try { name = decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop() || ''); } catch { name = String(url); }
  const hay = `${text} ${name.replace(/[_\-.+]+/g, ' ')}`.toLowerCase();
  for (const [cls, re] of RULES) if (re.test(hay)) return { class: cls, label: CLASS_LABEL[cls], basis: 'link text or file name' };
  const ctx = String(parentText).toLowerCase();
  for (const [cls, re] of RULES) if (re.test(ctx)) return { class: cls, label: CLASS_LABEL[cls], basis: 'the page it was linked from' };
  return { class: 'other', label: CLASS_LABEL.other, basis: 'no matching words' };
}
