// Deep Discovery: what happened to a request or a target, in words that never
// overstate. The central rule: a failed connection is NEVER evidence that a
// document does not exist. "Not located in the sources searched" is only ever
// the answer when every consulted source gave a definite "no".
// Pure module.

export const OUTCOME = Object.freeze({
  FOUND: 'found',
  HISTORICAL_COPY_FOUND: 'historical-copy-found',
  PARTIAL: 'partially-retrieved',
  NOT_LOCATED: 'not-located',
  SOURCE_UNAVAILABLE: 'source-unavailable',
  ACCESS_RESTRICTED: 'access-restricted',
  SEARCH_INCOMPLETE: 'search-incomplete'
});

export const OUTCOME_LABEL = Object.freeze({
  [OUTCOME.FOUND]: 'Found',
  [OUTCOME.HISTORICAL_COPY_FOUND]: 'Historical copy found',
  [OUTCOME.PARTIAL]: 'Partially retrieved',
  [OUTCOME.NOT_LOCATED]: 'Not located in the sources searched',
  [OUTCOME.SOURCE_UNAVAILABLE]: 'Source unavailable',
  [OUTCOME.ACCESS_RESTRICTED]: 'Access restricted',
  [OUTCOME.SEARCH_INCOMPLETE]: 'Search incomplete'
});

export const OUTCOME_MEANING = Object.freeze({
  [OUTCOME.FOUND]: 'The document was retrieved in full from its original address.',
  [OUTCOME.HISTORICAL_COPY_FOUND]: 'The original is not available, but an archived copy exists. The capture date is recorded.',
  [OUTCOME.PARTIAL]: 'Only part of the document could be retrieved (cut off by a size limit or an interrupted transfer). What was retrieved is marked as partial.',
  [OUTCOME.NOT_LOCATED]: 'Every source that was searched answered that it has no such document. This does not mean the record does not exist: only that these sources do not show it.',
  [OUTCOME.SOURCE_UNAVAILABLE]: 'The source did not answer or reported an error. Nothing can be concluded about whether the document exists.',
  [OUTCOME.ACCESS_RESTRICTED]: 'The source does not allow automated access to this item (robots.txt, a login, or a block). Nothing was retrieved and nothing can be concluded about the document.',
  [OUTCOME.SEARCH_INCOMPLETE]: 'The search stopped before it finished (a limit was reached, it was cancelled, or some sources could not be checked). Results so far are partial.'
});

// One request -> one outcome.
// input: { status, error, robotsBlocked, redirectBlocked, truncated, bytes, expectedBytes, cancelled, capped }
export function classifyAttempt({ status = null, error = null, robotsBlocked = false, redirectBlocked = false, truncated = false, bytes = null, expectedBytes = null, cancelled = false, capped = false } = {}) {
  if (cancelled) return { outcome: OUTCOME.SEARCH_INCOMPLETE, reason: 'cancelled' };
  if (capped) return { outcome: OUTCOME.SEARCH_INCOMPLETE, reason: 'limit-reached' };
  if (robotsBlocked) return { outcome: OUTCOME.ACCESS_RESTRICTED, reason: 'robots' };
  if (redirectBlocked) return { outcome: OUTCOME.ACCESS_RESTRICTED, reason: 'redirect-blocked' };
  if (error) return { outcome: OUTCOME.SOURCE_UNAVAILABLE, reason: error.code || 'network-error' };
  if (status === null) return { outcome: OUTCOME.SOURCE_UNAVAILABLE, reason: 'no-response' };
  if (status === 401 || status === 403 || status === 451) return { outcome: OUTCOME.ACCESS_RESTRICTED, reason: `http-${status}` };
  if (status === 404 || status === 410) return { outcome: OUTCOME.NOT_LOCATED, reason: `http-${status}` };
  if (status === 206) return { outcome: OUTCOME.PARTIAL, reason: 'partial-content' };
  if (status >= 200 && status < 300) {
    if (truncated) return { outcome: OUTCOME.PARTIAL, reason: 'size-limit' };
    if (expectedBytes !== null && bytes !== null && bytes < expectedBytes) return { outcome: OUTCOME.PARTIAL, reason: 'short-transfer' };
    return { outcome: OUTCOME.FOUND, reason: `http-${status}` };
  }
  if (status === 429) return { outcome: OUTCOME.SOURCE_UNAVAILABLE, reason: 'rate-limited' };
  if (status >= 500) return { outcome: OUTCOME.SOURCE_UNAVAILABLE, reason: `http-${status}` };
  return { outcome: OUTCOME.SOURCE_UNAVAILABLE, reason: `unexpected-http-${status}` };
}

// Several sources consulted for one target -> one honest outcome.
// attempts: [{ source, outcome, archive?: boolean }]
export function combineAttempts(attempts) {
  const list = attempts || [];
  if (!list.length) return { outcome: OUTCOME.SEARCH_INCOMPLETE, reason: 'no source was consulted', unavailable: [], restricted: [] };
  const by = (o, archive) => list.filter((a) => a.outcome === o && (archive === undefined || !!a.archive === archive));
  const unavailable = list.filter((a) => a.outcome === OUTCOME.SOURCE_UNAVAILABLE).map((a) => a.source);
  const restricted = list.filter((a) => a.outcome === OUTCOME.ACCESS_RESTRICTED).map((a) => a.source);
  const pack = (outcome, reason) => ({ outcome, reason, unavailable, restricted });
  if (by(OUTCOME.FOUND, false).length) return pack(OUTCOME.FOUND, 'retrieved from the original address');
  if (by(OUTCOME.PARTIAL, false).length) return pack(OUTCOME.PARTIAL, 'only part of the original was retrieved');
  if (by(OUTCOME.FOUND, true).length || by(OUTCOME.HISTORICAL_COPY_FOUND).length) return pack(OUTCOME.HISTORICAL_COPY_FOUND, 'archived copy found');
  if (by(OUTCOME.PARTIAL, true).length) return pack(OUTCOME.PARTIAL, 'only part of an archived copy was retrieved');
  if (list.some((a) => a.outcome === OUTCOME.SEARCH_INCOMPLETE)) return pack(OUTCOME.SEARCH_INCOMPLETE, 'the search stopped before finishing');
  if (restricted.length && !list.some((a) => a.outcome === OUTCOME.NOT_LOCATED)) return pack(OUTCOME.ACCESS_RESTRICTED, 'access to the source is restricted');
  if (unavailable.length === list.length) return pack(OUTCOME.SOURCE_UNAVAILABLE, 'no source answered');
  if (unavailable.length || restricted.length) return pack(OUTCOME.SEARCH_INCOMPLETE, 'some sources answered "not found" but others could not be checked');
  return pack(OUTCOME.NOT_LOCATED, 'every consulted source answered that it has no such document');
}

export function describeOutcome(outcome, reason = '') {
  const label = OUTCOME_LABEL[outcome] || outcome;
  return reason ? `${label} (${reason})` : label;
}
