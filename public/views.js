// Big Picture / Overview / Deep Dive: three presentations of ONE investigation.
// buildModel() derives everything from a single snapshot (the same
// readInvestigationForExport snapshot Ask Chronium and case export use), and
// all three renderers read that one model, so a number or finding shown in one
// level is the same object in the others. Nothing here is stored; nothing is
// computed that is not traceable to a source, and every key statement carries
// a "How do we know?" link into Deep Dive.
//
// Wording rule: "Missing" = nothing was located; "Not reviewed yet" = material
// exists but nobody has looked; "Unresolved" = looked at, evidence insufficient
// or conflicting. These are never merged.
import {
  indexSnapshot, sourceFor, sourceForEvidence, documentDate, voteEvents, identifiersIn, claimLinks, clip, textOf,
  progressCounts, STATES, AMOUNT_RE
} from './askRouter.js';
import { sourceHtml } from './askRender.js';

const esc = (s = '') => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const MONEY_REL = /PAID|PAYMENT|GRANT|FUND|CONTRACT|AWARD|VENDOR|SPONSOR|APPROPRIAT|BOND/i;

export const VIEWS = [
  { id: 'bigpicture', label: 'Big Picture', hint: 'Understand it quickly' },
  { id: 'overview', label: 'Overview', hint: 'See how it connects' },
  { id: 'deepdive', label: 'Deep Dive', hint: 'Examine the evidence' }
];

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------
function limitationsFor(ix, { classification, sources, claim, contradicted }) {
  const out = [];
  if (!sources.length) out.push('No evidence passage is attached, so this cannot be checked against a source.');
  if (classification === 'ALLEGATION') out.push('This is an allegation, not an established fact.');
  if (classification === 'SUPPORTED_INFERENCE') out.push('This is an inference drawn from the evidence; no single record states it directly.');
  if (classification === 'UNRESOLVED_QUESTION') out.push('The evidence is insufficient or conflicting, so this is still an open question.');
  if (classification === 'NO_EVIDENCE_LOCATED') out.push('No evidence was located. That does not prove nothing exists.');
  if (contradicted) out.push('Some evidence in this case contradicts the related claim; both sides are shown in Deep Dive.');
  for (const s of sources) {
    const r = ix.recordById.get(s.recordId);
    if (!s.date) out.push(`"${s.title}" has no readable date.`);
    if (r && r.sourceType === 'bulk-document' && r.storageMode !== 'local-copy') out.push(`Chronium does not keep a copy of "${s.title}". Open it from where you store the original.`);
    if (r && !r.originalUrl && !r.archiveUrl && r.sourceType !== 'bulk-document') out.push(`"${s.title}" has no web address recorded.`);
  }
  return [...new Set(out)];
}

export function buildModel(snapshot) {
  const ix = indexSnapshot(snapshot);
  const snap = ix.snap;
  const claims = snap.claims || [];
  const inv = snap.investigation || {};
  const outline = (snap.outlines || [])[0] || null;

  const claimView = (c) => {
    const links = claimLinks(ix, c);
    const side = (stance) => links.filter((l) => l.stance === stance).map((l) => {
      const ev = ix.evidenceById.get(l.evidenceId);
      return ev ? { ...sourceForEvidence(ix, ev), stance, evidenceId: ev.id } : null;
    }).filter(Boolean);
    return { id: c.id, claimId: c.claimId || '', text: c.text, status: c.status || 'UNVERIFIED', supports: side('supports'), contradicts: side('contradicts'), contextualizes: side('contextualizes') };
  };
  const claimViews = claims.map(claimView);
  const claimById = new Map(claimViews.map((c) => [c.id, c]));

  const findings = (snap.claimFindings || []).map((f) => {
    const claim = claimById.get(f.claimId) || null;
    const sources = (f.evidenceIds || []).map((id) => ix.evidenceById.get(id)).filter(Boolean).map((ev) => ({ ...sourceForEvidence(ix, ev), evidenceId: ev.id }));
    return {
      id: f.id, claimId: f.claimId, claimText: claim?.text || '', claimLabel: claim?.claimId || '',
      conclusion: f.conclusion, classification: f.classification, label: STATES[f.classification] || f.classification,
      sources, notes: f.notes || '', updatedAt: f.updatedAt || '',
      limitations: limitationsFor(ix, { classification: f.classification, sources, claim, contradicted: !!claim?.contradicts.length })
    };
  });
  const rank = { DOCUMENTED_FACT: 0, SUPPORTED_INFERENCE: 1, ALLEGATION: 2, UNRESOLVED_QUESTION: 3, NO_EVIDENCE_LOCATED: 4 };
  findings.sort((a, b) => (rank[a.classification] ?? 9) - (rank[b.classification] ?? 9));

  const discrepancies = claimViews.filter((c) => c.contradicts.length);

  const figures = [];
  for (const ev of snap.evidenceItems || []) {
    const amounts = String(ev.excerptText || '').match(AMOUNT_RE);
    if (!amounts) continue;
    figures.push({ evidenceId: ev.id, amounts: [...new Set(amounts.map((a) => a.replace(/\s+/g, '')))], text: clip(ev.excerptText, 200), source: sourceForEvidence(ix, ev) });
  }
  const calculations = (snap.quantitativeFindings || []).map((q) => ({ id: q.id, statement: q.statement, formula: q.formula || '', method: q.method || '', inputs: q.inputs || null }));

  const votes = voteEvents(ix, '').map((e) => ({ recordId: e.record.id, date: e.date, line: e.line, source: sourceFor(ix, e.record, { excerpt: e.window }) }));

  const dates = ix.records.map((r) => documentDate(r)).filter(Boolean).sort();
  const timeline = [];
  const seen = new Set();
  const push = (e) => { const k = `${e.kind}:${e.recordId}`; if (e.date && !seen.has(k)) { seen.add(k); timeline.push(e); } };
  for (const v of votes) push({ date: v.date, kind: 'vote', label: `Vote recorded: ${v.source.title}`, recordId: v.recordId, target: `vote/${v.recordId}` });
  for (const ev of snap.evidenceItems || []) {
    const r = ix.recordById.get(ev.sourceRecordId);
    if (r) push({ date: documentDate(r), kind: 'evidence', label: `Evidence from: ${r.title || r.originalUrl}`, recordId: r.id, target: `source/${r.id}` });
  }
  timeline.sort((a, b) => a.date.localeCompare(b.date));

  const groupsMap = new Map();
  for (const r of ix.records) for (const id of identifiersIn(textOf(r).slice(0, 8000))) {
    if (!groupsMap.has(id)) groupsMap.set(id, []);
    groupsMap.get(id).push(r);
  }
  const docGroups = [...groupsMap.entries()].filter(([, rs]) => rs.length >= 2).sort((a, b) => b[1].length - a[1].length).slice(0, 10)
    .map(([key, rs]) => ({ key, count: rs.length, docs: rs.slice(0, 6).map((r) => sourceFor(ix, r, { excerpt: '' })) }));

  const relationships = (snap.relationships || []).map((rel) => {
    const a = ix.entityById.get(rel.sourceEntityId), b = ix.entityById.get(rel.targetEntityId);
    const sources = (rel.evidenceIds || []).map((id) => ix.evidenceById.get(id)).filter(Boolean).map((ev) => ({ ...sourceForEvidence(ix, ev), evidenceId: ev.id }));
    return { id: rel.id, from: a?.name || 'Unknown', fromType: a?.type, to: b?.name || 'Unknown', toType: b?.type, type: String(rel.type || '').replace(/_/g, ' ').toLowerCase(), status: String(rel.status || 'UNKNOWN').toLowerCase(), sources, money: MONEY_REL.test(rel.type || '') };
  });

  const p = progressCounts(ix);
  const titleOf = (i) => i.sourceFilename || i.title || ix.recordById.get(i.recordId)?.title || 'Untitled';
  const questions = {
    missing: [
      ...findings.filter((f) => f.classification === 'NO_EVIDENCE_LOCATED').map((f) => ({ text: f.conclusion, target: `finding/${f.id}` })),
      ...p.emptyLanes.map((l) => ({ text: `Outline section "${l.label || l.name || l.id}" has no evidence.`, target: null })),
      ...p.failedDocs.map((i) => ({ text: `"${titleOf(i)}" could not be read, so its contents are not searchable.`, target: null }))
    ],
    notReviewed: [
      ...(p.unreviewedDocs.length ? [{ text: `${p.unreviewedDocs.length} imported document${p.unreviewedDocs.length === 1 ? '' : 's'} not reviewed yet.`, target: null }] : []),
      ...(p.openCands.length ? [{ text: `${p.openCands.length} possible name match${p.openCands.length === 1 ? '' : 'es'} not decided yet${p.ambiguous.length ? ` (${p.ambiguous.length} could be more than one person)` : ''}.`, target: null }] : []),
      ...(p.hits.length ? [{ text: `${p.hits.length} watch-term hit${p.hits.length === 1 ? '' : 's'} not reviewed.`, target: null }] : []),
      ...p.bare.map((c) => ({ text: `Claim ${c.claimId || ''} has no evidence linked yet: ${clip(c.text, 100)}`, target: `claim/${c.id}` }))
    ],
    unresolved: findings.filter((f) => f.classification === 'UNRESOLVED_QUESTION').map((f) => ({ text: f.conclusion, target: `finding/${f.id}` }))
  };

  const coverage = {
    sources: ix.records.length,
    documents: ix.records.filter((r) => r.sourceType === 'bulk-document').length,
    webCaptures: ix.records.filter((r) => r.archiveUrl).length,
    searchable: ix.records.filter((r) => textOf(r).trim()).length,
    unreadable: p.failedDocs.map(titleOf),
    duplicates: p.dupDocs.length,
    imported: p.ing.length
  };

  const sources = ix.records.map((r) => {
    const used = (snap.evidenceItems || []).filter((e) => e.sourceRecordId === r.id).length;
    return { ...sourceFor(ix, r, { excerpt: '' }), type: r.sourceType || (r.archiveUrl ? 'archived web page' : 'saved source'), storageMode: r.storageMode || '', usedAsEvidence: used, mime: r.mime || '' };
  });
  const evidence = (snap.evidenceItems || []).map((ev) => ({
    id: ev.id, text: ev.excerptText, type: ev.excerptType || '', source: sourceForEvidence(ix, ev),
    claims: (snap.claimEvidence || []).filter((l) => l.evidenceId === ev.id).map((l) => ({ claimId: l.claimId, stance: l.stance, label: claimById.get(l.claimId)?.claimId || '' }))
  }));
  const reviewHistory = [...(snap.reviewHistory || [])].sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp))).slice(0, 30);

  const model = {
    investigation: { id: inv.id || null, name: inv.name || 'Investigation', description: inv.description || '' },
    question: outline?.researchQuestion || '',
    counts: { sources: ix.records.length, evidence: evidence.length, claims: claimViews.length, findings: findings.length, relationships: relationships.length, subjects: (snap.entities || []).length, votes: votes.length, contradicted: discrepancies.length },
    findings, claims: claimViews, discrepancies, figures, calculations, votes, dates: { earliest: dates[0] || null, latest: dates[dates.length - 1] || null },
    timeline, docGroups, relationships, questions, coverage, sources, evidence, reviewHistory,
    people: { registered: (snap.entities || []).filter((e) => e.type === 'PERSON').length, undecidedMatches: p.openCands.length, ambiguousMatches: p.ambiguous.length },
    empty: !ix.records.length && !evidence.length && !claimViews.length
  };
  // Hidden lookup for "How do we know?" limits; not part of the model's data.
  Object.defineProperty(model, '_ix', { value: ix, enumerable: false });
  return model;
}

// Where a "How do we know?" link points. Resolves a target string to the
// evidence behind it, or null when it no longer exists.
export function resolveTarget(model, target) {
  if (!target) return null;
  const [kind, ...rest] = String(target).split('/');
  const id = rest.join('/');
  if (kind === 'finding') { const f = model.findings.find((x) => x.id === id); return f ? { kind, title: f.conclusion, state: f.label, claim: f.claimText, sources: f.sources, limitations: f.limitations, note: f.notes } : null; }
  if (kind === 'claim' || kind === 'discrepancy') {
    const c = model.claims.find((x) => x.id === id); if (!c) return null;
    const sources = [...c.supports, ...c.contradicts, ...c.contextualizes];
    return { kind, title: c.text, state: `Claim ${c.claimId}: ${String(c.status).toLowerCase().replace(/_/g, ' ')}`, claim: '', sources, limitations: limitationsFor(model._ix, { classification: '', sources, claim: c, contradicted: c.contradicts.length > 0 }), note: '' };
  }
  if (kind === 'relationship') { const r = model.relationships.find((x) => x.id === id); return r ? { kind, title: `${r.from} — ${r.type} — ${r.to}`, state: `Status: ${r.status}`, claim: '', sources: r.sources, limitations: r.sources.length ? (r.status === 'confirmed' ? [] : [`This connection is marked "${r.status}", not confirmed.`]) : ['No evidence passage is attached to this connection.'], note: '' } : null; }
  if (kind === 'vote') { const v = model.votes.find((x) => x.recordId === id); return v ? { kind, title: `Vote recorded in ${v.source.title}`, state: 'Voting language found in the document', claim: '', sources: [v.source], limitations: ['Chronium found voting wording (motion, seconded, voted). It has not interpreted the outcome: read the passage.', ...(v.date ? [] : ['The document has no readable date.'])], note: '' } : null; }
  if (kind === 'figure') { const f = model.figures.find((x) => x.evidenceId === id); return f ? { kind, title: f.amounts.join(', '), state: 'Amount quoted in saved evidence', claim: '', sources: [f.source], limitations: ['Amounts are quoted, not verified against payment records, and are never added together.'], note: '' } : null; }
  if (kind === 'source') { const s = model.sources.find((x) => x.recordId === id); return s ? { kind, title: s.title, state: s.type, claim: '', sources: [s], limitations: [], note: '' } : null; }
  return null;
}

// ---------------------------------------------------------------------------
// HTML (shared by the website and the extension)
// ---------------------------------------------------------------------------
// Links are real anchors (work with the website's hash router) and carry
// data-goto so the extension can handle them without a router.
export function gotoHref(path) { return `#/workspace/${path}`; }
function how(target, about) {
  return `<a class="btn btn-small how-link" href="${gotoHref('deepdive/' + target)}" data-goto="deepdive/${esc(target)}" aria-label="How do we know? ${esc(clip(about, 90))}">How do we know?</a>`;
}
const tag = (t) => `<span class="ask-tag">${esc(t)}</span>`;
const section = (id, title, body, intro = '') => `<section class="vw-section" aria-labelledby="vw-${id}"><h3 id="vw-${id}">${esc(title)}</h3>${intro ? `<p class="vw-intro">${esc(intro)}</p>` : ''}${body}</section>`;
const empty = (msg) => `<p class="vw-empty">${esc(msg)}</p>`;
const list = (items) => `<ul class="vw-list">${items.join('')}</ul>`;

export function emptyCaseHtml() {
  return `<div class="notice"><p><strong>This case has nothing in it yet.</strong></p><p>Add documents or save sources, and this page will summarize what they show. Nothing is shown here that is not backed by a source.</p></div>`;
}

export function bigPictureHtml(m) {
  if (m.empty) return emptyCaseHtml();
  const about = section('about', 'What this investigation is about',
    `<p><strong>${esc(m.investigation.name)}</strong>${m.investigation.description ? `: ${esc(m.investigation.description)}` : ''}</p>
     ${m.question ? `<p>Question being investigated: ${esc(m.question)}</p>` : empty('No research question has been written yet.')}
     <p class="vw-meta">${m.counts.sources} source${m.counts.sources === 1 ? '' : 's'} · ${m.counts.evidence} saved passage${m.counts.evidence === 1 ? '' : 's'} · ${m.counts.claims} claim${m.counts.claims === 1 ? '' : 's'} · ${m.counts.findings} finding${m.counts.findings === 1 ? '' : 's'}</p>`);

  const key = m.findings.filter((f) => f.classification === 'DOCUMENTED_FACT' || f.classification === 'SUPPORTED_INFERENCE');
  const other = m.findings.filter((f) => !key.includes(f));
  const findingItem = (f) => `<li class="vw-item"><p>${esc(f.conclusion)}</p><p class="vw-meta">${tag(f.label)} ${f.claimLabel ? `About claim ${esc(f.claimLabel)} · ` : ''}${f.sources.length} source${f.sources.length === 1 ? '' : 's'}</p>${how('finding/' + f.id, f.conclusion)}</li>`;
  const findings = section('findings', 'What the records document',
    key.length ? list(key.map(findingItem)) : empty(m.findings.length ? 'No finding has been recorded as a documented fact or supported inference yet.' : 'No findings have been recorded yet. A finding is a conclusion you write down together with its evidence.'),
    'Each statement below is a conclusion someone recorded with evidence attached. Select "How do we know?" to see the source.')
    + (other.length ? section('findings-other', 'Allegations and open findings', list(other.map(findingItem)), 'These are not established facts.') : '');

  const amountItems = m.figures.slice(0, 6).map((f) => `<li class="vw-item"><p><strong>${esc(f.amounts.join(', '))}</strong> in ${esc(f.source.title)}${f.source.date ? ` (${esc(f.source.date)})` : ''}</p><p class="vw-meta">${esc(f.text)}</p>${how('figure/' + f.evidenceId, f.amounts.join(', '))}</li>`);
  const dateItems = [];
  if (m.dates.earliest) dateItems.push(`<li class="vw-item"><p>Documents in this case are dated from <strong>${esc(m.dates.earliest)}</strong> to <strong>${esc(m.dates.latest)}</strong>.</p></li>`);
  for (const v of m.votes.slice(0, 5)) dateItems.push(`<li class="vw-item"><p>${v.date ? `<strong>${esc(v.date)}</strong>: ` : ''}vote wording found in ${esc(v.source.title)}</p>${how('vote/' + v.recordId, v.source.title)}</li>`);
  const figures = section('figures', 'Important figures and dates',
    (amountItems.length || dateItems.length) ? list([...amountItems, ...dateItems]) : empty('No dollar amounts have been saved as evidence, and no dated documents were found.'),
    'Amounts are quoted from saved evidence. They have not been checked against payment records and are not added together.');

  const disc = section('discrepancies', 'Where records disagree',
    m.discrepancies.length ? list(m.discrepancies.map((c) => `<li class="vw-item"><p>${esc(c.text)}</p><p class="vw-meta">${tag('Records disagree')} ${c.supports.length} supporting · ${c.contradicts.length} contradicting</p>${how('discrepancy/' + c.id, c.text)}</li>`)) : empty('No claim has evidence linked as contradicting it. That reflects linked evidence only.'));

  const q = m.questions;
  const qItems = (rows) => rows.slice(0, 6).map((r) => `<li class="vw-item"><p>${esc(r.text)}</p>${r.target ? how(r.target, r.text) : ''}</li>`);
  const open = section('open', 'What is still unanswered',
    `<h4>Missing: nothing was located</h4>${q.missing.length ? list(qItems(q.missing)) : empty('Nothing known to be missing.')}
     <h4>Not reviewed yet: material exists, nobody has looked</h4>${q.notReviewed.length ? list(qItems(q.notReviewed)) : empty('Nothing waiting for review.')}
     <h4>Unresolved: looked at, evidence is not enough</h4>${q.unresolved.length ? list(qItems(q.unresolved)) : empty('No unresolved findings.')}`,
    'These three are different: a missing record is not the same as one nobody has read yet.');

  const c = m.coverage;
  const cov = section('coverage', 'How complete is the search',
    `<p>${c.sources} source${c.sources === 1 ? '' : 's'} in this case; ${c.searchable} with readable text${c.documents ? `, ${c.documents} imported file${c.documents === 1 ? '' : 's'}` : ''}${c.webCaptures ? `, ${c.webCaptures} archived web page${c.webCaptures === 1 ? '' : 's'}` : ''}.</p>
     ${c.unreadable.length ? `<p>${c.unreadable.length} file${c.unreadable.length === 1 ? ' was' : 's were'} skipped or unreadable, so ${c.unreadable.length === 1 ? 'its' : 'their'} contents are not searched: ${esc(c.unreadable.slice(0, 5).join('; '))}.</p>` : ''}
     ${c.duplicates ? `<p>${c.duplicates} duplicate file${c.duplicates === 1 ? '' : 's'} not added again (same content already here).</p>` : ''}
     <p class="vw-meta">Which web archives responded is shown at the time of each search and is not stored in the case. A search that found nothing does not prove a record does not exist.</p>`);
  const people = section('people', 'Names',
    `<p>${m.people.registered} person${m.people.registered === 1 ? '' : 's'} recorded. ${m.people.undecidedMatches ? `${m.people.undecidedMatches} possible name match${m.people.undecidedMatches === 1 ? '' : 'es'} ${m.people.undecidedMatches === 1 ? 'is' : 'are'} unconfirmed${m.people.ambiguousMatches ? `, ${m.people.ambiguousMatches} of which could be more than one person` : ''}.` : ''}</p>
     <p class="vw-meta">A name appearing in a document does not identify a person. Only matches someone confirmed are treated as identified.</p>`);
  return about + findings + figures + disc + open + cov + people;
}

export function overviewHtml(m) {
  if (m.empty) return emptyCaseHtml();
  const byYear = new Map();
  for (const e of m.timeline) { const y = e.date.slice(0, 4); if (!byYear.has(y)) byYear.set(y, []); byYear.get(y).push(e); }
  const timeline = section('timeline', 'Timeline',
    m.timeline.length ? [...byYear.entries()].map(([y, ev]) => `<h4>${esc(y)}</h4>${list(ev.map((e) => `<li class="vw-item"><p><time datetime="${esc(e.date)}">${esc(e.date)}</time> ${tag(e.kind === 'vote' ? 'Vote' : 'Evidence')} ${esc(e.label)}</p>${how(e.target, e.label)}</li>`))}`).join('') : empty('No dated documents are linked to evidence or votes yet.'),
    'In date order, as a list. Only documents with a vote or saved evidence are shown; the date is the one read from the document.');

  const decisions = section('decisions', 'Government decisions and votes',
    m.votes.length ? list(m.votes.slice(0, 15).map((v) => `<li class="vw-item"><p>${v.date ? `<time datetime="${esc(v.date)}">${esc(v.date)}</time>: ` : '<em>Date not readable</em>: '}${esc(v.source.title)}</p><p class="vw-meta">${esc(clip(v.line, 160))}</p>${how('vote/' + v.recordId, v.source.title)}</li>`)) + (m.votes.length > 15 ? `<p class="vw-meta">${m.votes.length - 15} more not shown. Ask Chronium can narrow them by name.</p>` : '') : empty('No document with voting wording (motion, seconded, voted) was found.'),
    'Found by wording. Chronium does not interpret outcomes.');

  const groups = section('docs', 'Documents that mention the same item',
    m.docGroups.length ? list(m.docGroups.map((g) => `<li class="vw-item"><p><strong>${esc(g.key)}</strong> appears in ${g.count} documents</p><p class="vw-meta">${esc(g.docs.map((d) => d.title).join('; '))}${g.count > g.docs.length ? '…' : ''}</p></li>`)) : empty('No ordinance, agreement, or company name appears in two or more documents.'),
    'This groups documents by a shared identifier in their text. It shows they mention the same item, not that one caused another.');

  const relItem = (r) => `<li class="vw-item"><p>${esc(r.from)} — ${esc(r.type)} — ${esc(r.to)}</p><p class="vw-meta">${tag('Status: ' + r.status)} ${r.sources.length} source${r.sources.length === 1 ? '' : 's'}</p>${how('relationship/' + r.id, r.from + ' ' + r.type + ' ' + r.to)}</li>`;
  const plain = m.relationships.filter((r) => !r.money);
  const money = m.relationships.filter((r) => r.money);
  const rel = section('relationships', 'People and organizations',
    plain.length ? list(plain.map(relItem)) : empty('No evidence-backed connection has been recorded.'),
    'Every connection here was recorded with at least one evidence passage. Names that merely appear together are not shown as connections.');
  const flows = section('money', 'Money connections',
    money.length ? list(money.map(relItem)) : empty('No money connection (payment, grant, contract, fund) has been recorded with evidence.'),
    'Only connections recorded with evidence. Amounts quoted in evidence are in Deep Dive.');

  const conflicts = section('conflicts', 'Conflicting claims',
    m.discrepancies.length ? list(m.discrepancies.map((c) => `<li class="vw-item"><p>${esc(c.text)}</p>${c.supports.length ? `<p class="vw-meta">Supported by: ${esc(c.supports.map((s) => s.title).join('; '))}</p>` : ''}<p class="vw-meta">Contradicted by: ${esc(c.contradicts.map((s) => s.title).join('; '))}</p>${how('discrepancy/' + c.id, c.text)}</li>`)) : empty('No claim has contradicting evidence linked.'));

  const q = m.questions;
  const total = q.missing.length + q.notReviewed.length + q.unresolved.length;
  const progress = section('progress', 'Progress',
    `<ul class="vw-list"><li class="vw-item"><p>${m.counts.findings} finding${m.counts.findings === 1 ? '' : 's'} recorded for ${m.counts.claims} claim${m.counts.claims === 1 ? '' : 's'}.</p></li>
     <li class="vw-item"><p>${q.missing.length} missing · ${q.notReviewed.length} not reviewed yet · ${q.unresolved.length} unresolved.</p></li></ul>
     ${total ? '' : '<p class="vw-meta">Nothing is flagged. That does not mean the investigation is complete.</p>'}`);
  return timeline + decisions + groups + rel + flows + conflicts + progress;
}

function targetHtml(t) {
  return `<section id="howWeKnow" class="vw-how" tabindex="-1" aria-labelledby="vw-how-h">
    <h3 id="vw-how-h">How do we know?</h3>
    <p><strong>${esc(t.title)}</strong></p>
    <p class="vw-meta">${tag(t.state)}</p>
    ${t.claim ? `<p class="vw-meta">About the claim: ${esc(t.claim)}</p>` : ''}
    ${t.sources.length ? `<ul class="ask-sources" aria-label="Sources">${t.sources.map(sourceHtml).join('')}</ul>` : empty('No source is attached to this.')}
    ${t.limitations.length ? `<div class="ask-missing"><h4>Limits to keep in mind</h4><ul>${t.limitations.map((l) => `<li>${esc(l)}</li>`).join('')}</ul></div>` : ''}
    ${t.note ? `<p class="vw-meta">Note recorded with it: ${esc(t.note)}</p>` : ''}
  </section>`;
}

export function deepDiveHtml(m, target) {
  if (m.empty) return emptyCaseHtml();
  const t = resolveTarget(m, target);
  const miss = target && !t ? `<div class="notice" role="alert"><p>That item is no longer in this case. It may have been removed or not imported yet.</p></div>` : '';
  const details = (id, title, count, body, open = false) => `<details class="vw-details" id="vw-${id}"${open ? ' open' : ''}><summary>${esc(title)} <span class="vw-count">(${count})</span></summary>${body}</details>`;
  const src = details('sources', 'Source documents', m.sources.length, m.sources.length ? list(m.sources.map((s) => `<li class="vw-item"><p><strong>${esc(s.title)}</strong></p><p class="vw-meta">${esc(s.type)}${s.date ? ' · ' + esc(s.date) : ' · no readable date'}${s.sourceId ? ' · ' + esc(s.sourceId) : ''} · used as evidence ${s.usedAsEvidence} time${s.usedAsEvidence === 1 ? '' : 's'}</p>${s.hash ? `<p class="vw-meta">File fingerprint: ${esc(s.hash)}</p>` : '<p class="vw-meta">No file fingerprint recorded.</p>'}${s.storageMode === 'local-copy' ? '<p class="vw-meta">A copy is kept in this browser.</p>' : ''}${s.url ? `<p class="ask-source-links"><a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">Open original</a>${s.archiveUrl ? ` <a href="${esc(s.archiveUrl)}" target="_blank" rel="noopener noreferrer">Open archived copy</a>` : ''}</p>` : (s.archiveUrl ? `<p class="ask-source-links"><a href="${esc(s.archiveUrl)}" target="_blank" rel="noopener noreferrer">Open archived copy</a></p>` : '')}</li>`)) : empty('No sources.'));
  const ev = details('evidence', 'Evidence passages', m.evidence.length, m.evidence.length ? list(m.evidence.map((e) => `<li class="vw-item"><blockquote class="ask-excerpt">${esc(e.text)}</blockquote><p class="vw-meta">From <strong>${esc(e.source.title)}</strong>${e.source.date ? ' · ' + esc(e.source.date) : ''}${e.source.location ? ' · ' + esc(e.source.location) : ''}</p>${e.claims.length ? `<p class="vw-meta">Linked to: ${esc(e.claims.map((c) => `${c.label || 'claim'} (${c.stance})`).join(', '))}</p>` : '<p class="vw-meta">Not linked to a claim yet.</p>'}</li>`)) : empty('No evidence passages saved.'));
  const cl = details('claims', 'Claims and their evidence', m.claims.length, m.claims.length ? list(m.claims.map((c) => `<li class="vw-item"><p><strong>${esc(c.claimId)}</strong> ${esc(c.text)}</p><p class="vw-meta">${tag(String(c.status).toLowerCase().replace(/_/g, ' '))} ${c.supports.length} supporting · ${c.contradicts.length} contradicting · ${c.contextualizes.length} context</p></li>`)) : empty('No claims.'));
  const contra = details('contradictions', 'Contradictory records', m.discrepancies.length, m.discrepancies.length ? list(m.discrepancies.map((c) => `<li class="vw-item"><p>${esc(c.text)}</p><ul class="ask-sources">${[...c.supports, ...c.contradicts].map(sourceHtml).join('')}</ul></li>`)) : empty('No claim has contradicting evidence linked.'));
  const fin = details('financial', 'Financial amounts, calculations and assumptions', m.figures.length + m.calculations.length,
    `${m.calculations.length ? list(m.calculations.map((q) => `<li class="vw-item"><p><strong>${esc(q.statement)}</strong></p>${q.formula ? `<p class="vw-meta">Formula: ${esc(q.formula)}</p>` : ''}${q.method ? `<p class="vw-meta">Method and assumptions: ${esc(q.method)}</p>` : ''}</li>`)) : empty('No calculations have been recorded.')}
     ${m.figures.length ? `<h4>Amounts quoted in saved evidence</h4>${list(m.figures.map((f) => `<li class="vw-item"><p><strong>${esc(f.amounts.join(', '))}</strong> — ${esc(f.text)}</p><p class="vw-meta">${esc(f.source.title)}${f.source.date ? ' · ' + esc(f.source.date) : ''}</p></li>`))}<p class="vw-meta">Assumption: amounts are copied from the passages and not verified against payment records. They are not added together because one payment can appear in several documents.</p>` : ''}`);
  const rh = details('review', 'Review history and unresolved questions', m.reviewHistory.length + m.questions.unresolved.length + m.questions.missing.length + m.questions.notReviewed.length,
    `${m.reviewHistory.length ? list(m.reviewHistory.map((h) => `<li class="vw-item"><p>${esc(String(h.timestamp || '').slice(0, 19).replace('T', ' '))} · ${esc(h.action || h.type || 'change')}${h.actorName ? ' · ' + esc(h.actorName) : ''}</p>${h.note ? `<p class="vw-meta">${esc(clip(h.note, 160))}</p>` : ''}</li>`)) : empty('No review activity recorded.')}
     ${['missing', 'notReviewed', 'unresolved'].map((k) => m.questions[k].length ? `<h4>${k === 'missing' ? 'Missing' : k === 'notReviewed' ? 'Not reviewed yet' : 'Unresolved'}</h4>${list(m.questions[k].map((r) => `<li class="vw-item"><p>${esc(r.text)}</p></li>`))}` : '').join('')}`);
  return `${miss}${t ? targetHtml(t) : ''}<p class="vw-intro">${t ? 'All the original material for this case:' : 'The original material behind everything in the other two views.'}</p>${src}${ev}${cl}${contra}${fin}${rh}`;
}

export function viewHtml(view, model, target) {
  if (view === 'bigpicture') return bigPictureHtml(model);
  if (view === 'overview') return overviewHtml(model);
  return deepDiveHtml(model, target);
}
