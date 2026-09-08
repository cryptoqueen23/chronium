// Deterministic command recognition for Ask Sources - keyword/pattern
// matching only, never AI (docs/CANON.md "AI/Agents Are Last Resort"). An
// input that matches nothing here falls through to plain source search
// rather than the router guessing at a mutation. The exported target lists
// also back the "Save Evidence · Add to..." / "Create..." menus so typed
// commands and menu clicks share one intent vocabulary and one dispatcher
// (see runAskSourcesAddTo / handleCreateIntent in app.js).

export const ADD_TO_TARGETS = [
  { id: 'evidence', label: 'Evidence' },
  { id: 'outline', label: 'Research Outline' },
  { id: 'findings', label: 'Findings (as a Claim)' },
  { id: 'report', label: 'Report (as a Claim)' },
  { id: 'timeline', label: 'Timeline' }
];

export const CREATE_TARGETS = [
  { id: 'outline', label: 'Outline' },
  { id: 'bibliography', label: 'Bibliography' },
  { id: 'citations', label: 'Citations' },
  { id: 'evidence-table', label: 'Evidence Table' },
  { id: 'claim-matrix', label: 'Claim/Evidence Matrix' },
  { id: 'quantitative-table', label: 'Quantitative Table' },
  { id: 'source-index', label: 'Source Index' },
  { id: 'timeline', label: 'Timeline' },
  { id: 'findings-summary', label: 'Findings Summary' },
  { id: 'gaps', label: 'Gap List' },
  { id: 'report', label: 'Report' }
];

// Ordered rule table - first match wins. Leads/unresolved are checked
// before the generic "gaps"/"report" create-targets so a real question
// ("what don't we know?") gets an inline answer, not just a tab jump -
// docs/CANON.md Product Principles #11/#12/#15.
const RULES = [
  { test: (q) => /\bwhat (should i|to) (investigate|research|look into|pursue) next\b|\binvestigative leads?\b|\bwhat leads? (do|are there)\b|\bwhat should i (look into|pursue)\b/.test(q), intent: 'leads', target: null },
  { test: (q) => /\bwhat don'?t we know\b|\bwhat'?s unresolved\b|\bwhat is unresolved\b|\bwhat are the gaps\b|\bwhat'?s missing\b|\bwhat is missing\b/.test(q), intent: 'unresolved', target: null },
  { test: (q) => /\bcite\b|\bcitation/.test(q), intent: 'create', target: 'citations' },
  { test: (q) => /\bbibliography\b|\bsource list\b/.test(q), intent: 'create', target: 'bibliography' },
  { test: (q) => /\bclaim.{0,4}evidence matrix\b|\bclaim matrix\b/.test(q), intent: 'create', target: 'claim-matrix' },
  { test: (q) => /\bevidence table\b/.test(q), intent: 'create', target: 'evidence-table' },
  { test: (q) => /\bquantitative table\b/.test(q), intent: 'create', target: 'quantitative-table' },
  { test: (q) => /\bsource index\b/.test(q), intent: 'create', target: 'source-index' },
  { test: (q) => /\bfindings summary\b/.test(q), intent: 'create', target: 'findings-summary' },
  { test: (q) => /\bgaps?\b/.test(q), intent: 'create', target: 'gaps' },
  { test: (q) => /\boutline\b/.test(q), intent: 'create', target: 'outline' },
  { test: (q) => /\btimeline\b/.test(q), intent: 'create', target: 'timeline' },
  { test: (q) => /\breport\b/.test(q), intent: 'create', target: 'report' },
  { test: (q) => /\btable\b/.test(q), intent: 'clarify-table', target: null },
  { test: (q) => /\badd\b.*\bto (the )?outline\b/.test(q), intent: 'add-to', target: 'outline' },
  { test: (q) => /\b(put|include)\b.*\b(in|into) (the )?report\b/.test(q), intent: 'add-to', target: 'report' },
  { test: (q) => /\bremove\b.*\bfrom (the )?report\b/.test(q), intent: 'exclude-from-report', target: null }
];

export function parseAskSourcesCommand(rawQuestion) {
  const q = (rawQuestion || '').trim().toLowerCase();
  if (!q) return { intent: 'search', target: null };
  for (const rule of RULES) {
    if (rule.test(q)) return { intent: rule.intent, target: rule.target || null };
  }
  return { intent: 'search', target: null };
}

// Small, honest "Computed Fact" layer - counts/earliest/latest over an
// already-fetched result set. No AI, no invented numbers.
export function computeDeterministicFact(rawQuestion, results) {
  const q = (rawQuestion || '').toLowerCase();
  const dated = results.map((r) => r.captureDate || r.addedAt || r.savedAt).filter(Boolean).map((d) => new Date(d)).filter((d) => !isNaN(d));
  if (/\bhow many\b|\bcount\b/.test(q)) {
    return `${results.length} matching source${results.length === 1 ? '' : 's'} (computed).`;
  }
  if (/\bearliest\b|\boldest\b|\bfirst\b/.test(q) && dated.length) {
    const min = new Date(Math.min(...dated));
    return `Earliest matching date: ${min.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })} (computed).`;
  }
  if (/\blatest\b|\bnewest\b|\bmost recent\b/.test(q) && dated.length) {
    const max = new Date(Math.max(...dated));
    return `Most recent matching date: ${max.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })} (computed).`;
  }
  return null;
}

// Product Principles #11: every Ask Sources answer must be labeled one of
// five states, never silently blurred into another. This is a pure
// function over what already happened (result counts / AI outcome) - it
// never itself decides what IS true, only how to label what was found.
export const FACT_STATE_LABELS = {
  confirmed: 'Confirmed Fact',
  computed: 'Computed Fact',
  lead: 'Investigative Lead',
  unresolved: 'Unresolved',
  'ai-analysis': 'AI Analysis'
};

// `discoverCount` = results found by Discover Sources (public/discover.js)
// that aren't already in this investigation. Discovery is never
// "Confirmed" on its own, no matter how good the match - search-result
// metadata is discovery, not evidence, until a researcher reviews and
// saves it (explicit product requirement, docs/CANON.md Principle #9).
export function classifyAskAnswer({ passageCount, sourceCount, aiResult, discoverCount = 0 }) {
  if (aiResult && !aiResult.insufficient && !aiResult.parseError) return 'ai-analysis';
  if (aiResult && aiResult.insufficient) return 'unresolved';
  if (passageCount > 0) return 'confirmed'; // in My Sources, with a matched passage
  if (sourceCount > 0) return 'lead'; // in My Sources by topic/metadata, no exact passage confirmed it
  if (discoverCount > 0) return 'lead'; // found externally, not yet reviewed/saved into this investigation
  return 'unresolved'; // nothing matched anywhere - evidence is insufficient, not "no" evidence of absence
}

// Adaptive Research Depth (Product Principles #21): same evidence, same
// provenance, different presentation - detected from phrasing, not a
// second search/answer engine. `isRepresentOnly` flags a pure
// re-presentation request ("now give me the professional version") so the
// caller can re-render the last answer instead of re-querying.
const DEPTH_RULES = [
  { depth: 'professional', test: (q) => /\bprofessional\b|\bformal report\b|\bwith footnotes\b|\bexecutive( summary)?\b/.test(q) },
  { depth: 'explain', test: (q) => /\bexplain( this| it)?( simply| like i'?m a? ?\d+| like a kid)?\b|\beli5\b|\bin (simple|plain) (terms|words|english)\b/.test(q) },
  { depth: 'quick', test: (q) => /\bquick( answer)?\b|\btl;?dr\b|\bshort answer\b|\bbriefly\b/.test(q) },
  { depth: 'research', test: (q) => /\bgive me everything\b|\bshow (all|every) sources?\b|\bfull detail\b|\bcomprehensive\b|\bresearch version\b/.test(q) }
];
const DEPTH_FILLER = /\b(now|give|me|show|the|version|please|i'?d like|can you|could you)\b/g;

export function parseDepthRequest(rawQuestion) {
  const q = (rawQuestion || '').trim().toLowerCase();
  if (!q) return { depth: null, isRepresentOnly: false };
  for (const rule of DEPTH_RULES) {
    if (!rule.test(q)) continue;
    const remaining = q.replace(DEPTH_FILLER, ' ').replace(/[?.,!]/g, ' ').replace(/\s+/g, ' ').trim();
    // If almost nothing is left after stripping filler + the depth phrase
    // itself, this question is ONLY a depth request ("explain it simply"),
    // not a new topic - a rough but deterministic and auditable heuristic.
    const withoutDepthWord = remaining.replace(/professional|formal report|footnotes|executive summary|executive|explain|simply|like i'?m a? ?\d+|like a kid|eli5|simple|plain|terms|words|english|this|it|quick|answer|tl;?dr|short|briefly|everything|all sources|every sources?|full detail|comprehensive|research version/g, '').trim();
    return { depth: rule.depth, isRepresentOnly: withoutDepthWord.length < 6 };
  }
  return { depth: null, isRepresentOnly: false };
}
export const DEPTH_LABELS = { quick: 'Quick', explain: 'Explain', research: 'Research', professional: 'Professional' };

// Strips common question words before handing terms to searchInvestigation's
// literal AND-of-substrings matcher (public/db.js) - "what did the budget
// say about roads" -> "budget say roads", not an unmatchable full sentence.
// Includes depth-cue words (Product Principles #21) so "explain simply
// where did the road money go" searches on the real topic terms, not on
// "explain"/"simply" themselves.
// Pronouns are included deliberately: "it"/"that"/"this" left in as a
// literal search term would substring-match almost every record (a
// bare, contextless depth request like "explain it simply" must fall
// through to "nothing to search" rather than a noisy false-positive
// flood) - see docs/CANON.md Product Principles #17, Never Fake Coverage.
const STOPWORDS = new Set(['what', 'whats', 'how', 'many', 'much', 'when', 'who', 'where', 'did', 'does', 'do', 'the', 'a', 'an', 'of', 'in', 'on', 'for', 'is', 'are', 'was', 'were', 'tell', 'me', 'about', 'show', 'find', 'search', 'please', 'can', 'you',
  'it', 'that', 'this', 'these', 'those', 'there', 'my', 'our', 'your',
  'explain', 'simply', 'quick', 'quickly', 'briefly', 'tldr', 'eli5', 'professional', 'formally', 'formal', 'executive', 'summary', 'comprehensive', 'detail', 'detailed', 'everything', 'now', 'give', 'version',
  // "How many sources mention X" framing words - found live in browser
  // verification: without these, extractSearchTerms literally searched
  // for the AND of "sources mention X" and failed even when X was
  // genuinely present, because no real document contains the word
  // "mention" - the computed-fact question's own framing broke itself.
  'sources', 'source', 'mention', 'mentions', 'mentioned', 'documents', 'document', 'records', 'record', 'files', 'file', 'discuss', 'discusses', 'reference', 'references']);
export function extractSearchTerms(rawQuestion) {
  const words = (rawQuestion || '').toLowerCase().replace(/[?.,!']/g, '').split(/\s+/).filter(Boolean);
  const kept = words.filter((w) => !STOPWORDS.has(w));
  return kept.length ? kept.join(' ') : (rawQuestion || '').trim();
}
