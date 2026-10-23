// Records Recovery: grouping documents into series and recognising a recurring pattern in their dates.
// Conservative by design: a pattern is trusted only when enough documents sit on it AND enough of the expected
// dates inside the held range are held, so a series with two meetings a month, or an irregular one, produces no
// pattern and therefore no "gap". Nothing is ever extrapolated outside the range of held documents.
// Pure module.

const DAY = 86400000;
export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const ORD = ['', 'first', 'second', 'third', 'fourth', 'fifth'];
export const MEETING_TYPES = ['agenda', 'minutes', 'packet'];

const parse = (iso) => { const [y, m, d] = iso.split('-').map(Number); return { y, m, d, t: Date.UTC(y, m - 1, d) }; };
const fromT = (t) => new Date(t).toISOString().slice(0, 10);
const weekday = (iso) => new Date(parse(iso).t).getUTCDay();
const daysIn = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
export const dayDiff = (a, b) => Math.round((parse(a).t - parse(b).t) / DAY);
export const longDate = (iso) => { const p = parse(iso); return `${['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][p.m - 1]} ${p.d}, ${p.y}`; };

function nthWeekdayOfMonth(y, m, wd, ord) {
  const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const day = 1 + ((wd - first + 7) % 7) + (ord - 1) * 7;
  return day <= daysIn(y, m) ? `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}` : null;
}
const mode = (arr) => { const c = new Map(); for (const v of arr) c.set(v, (c.get(v) || 0) + 1); let best = null; for (const [v, n] of c) if (best === null || n > best[1] || (n === best[1] && v < best[0])) best = [v, n]; return best ? best[0] : null; };

// Groups facts into series. Meeting documents (agenda, minutes, packet) of one body form ONE series of meeting
// dates; every other type is its own series. Documents without a usable date or type are left out here.
export function groupSeries(factsList) {
  const map = new Map();
  for (const f of factsList) {
    if (!f.date.iso || f.date.ambiguous || f.type.value === 'unknown') continue;
    const body = f.body.value || '(body not stated)';
    const kind = MEETING_TYPES.includes(f.type.value) ? 'meeting' : f.type.value;
    const key = `${body}|${kind}`;
    if (!map.has(key)) map.set(key, { key, body, kind, members: [] });
    map.get(key).members.push(f);
  }
  return [...map.values()].map((s) => {
    s.members.sort((a, b) => (a.date.iso < b.date.iso ? -1 : a.date.iso > b.date.iso ? 1 : (a.recordId < b.recordId ? -1 : 1)));
    s.dates = [...new Set(s.members.map((m) => m.date.iso))];
    return s;
  }).sort((a, b) => (a.key < b.key ? -1 : 1));
}

function positionsFor(kind, params, lo, hi) {
  const out = [];
  const a = parse(lo); const b = parse(hi);
  if (kind === 'monthly-nth' || kind === 'monthly-day') {
    for (let y = a.y, m = a.m; y < b.y || (y === b.y && m <= b.m); m === 12 ? (y++, m = 1) : m++) {
      const p = kind === 'monthly-nth' ? nthWeekdayOfMonth(y, m, params.wd, params.ord) : (params.dom <= daysIn(y, m) ? `${y}-${String(m).padStart(2, '0')}-${String(params.dom).padStart(2, '0')}` : null);
      if (p) out.push(p);
    }
    return out;
  }
  const step = kind === 'biweekly' ? 14 : 7;
  let t = parse(params.anchor).t;
  while (t - step * DAY >= a.t - 3 * DAY) t -= step * DAY;
  for (; t <= b.t + 3 * DAY; t += step * DAY) out.push(fromT(t));
  return out;
}

/**
 * Looks for a recurring pattern in a list of ISO dates.
 * Returns { found:false, reason } or { found:true, kind, label, positions, holes, onShare, density, used }.
 * `holes` are the expected dates inside the held range that have no document within the tolerance.
 */
export function detectCadence(dates, opt) {
  const uniq = [...new Set(dates)].sort();
  if (uniq.length < opt.cadenceMinDocuments) return { found: false, reason: 'too-few', have: uniq.length, need: opt.cadenceMinDocuments };
  const lo = uniq[0]; const hi = uniq[uniq.length - 1];
  const info = uniq.map((iso) => { const p = parse(iso); return { iso, wd: weekday(iso), dom: p.d, ord: Math.ceil(p.d / 7), t: p.t }; });
  const wdMode = mode(info.map((i) => i.wd));
  const tries = [];
  const nth = mode(info.map((i) => `${i.wd}-${i.ord}`));
  if (nth) { const [wd, ord] = nth.split('-').map(Number); tries.push({ kind: 'monthly-nth', params: { wd, ord }, label: `monthly, on the ${ORD[ord]} ${WEEKDAYS[wd]}` }); }
  const domMode = mode(info.map((i) => i.dom));
  tries.push({ kind: 'monthly-day', params: { dom: domMode }, label: `monthly, on day ${domMode}` });
  const sameWd = info.filter((i) => i.wd === wdMode);
  const parityMode = mode(sameWd.map((i) => Math.floor(i.t / (7 * DAY)) % 2));
  const anchor14 = sameWd.find((i) => Math.floor(i.t / (7 * DAY)) % 2 === parityMode);
  if (anchor14) tries.push({ kind: 'biweekly', params: { anchor: anchor14.iso }, label: `every two weeks, on ${WEEKDAYS[wdMode]}` });
  if (sameWd[0]) tries.push({ kind: 'weekly', params: { anchor: sameWd[0].iso }, label: `weekly, on ${WEEKDAYS[wdMode]}` });

  let lastReason = 'no-pattern';
  for (const tr of tries) {
    const positions = positionsFor(tr.kind, tr.params, lo, hi).filter((p) => p >= fromT(parse(lo).t - opt.dateToleranceDays * DAY) && p <= fromT(parse(hi).t + opt.dateToleranceDays * DAY));
    if (!positions.length) continue;
    // Day numbers in sets, widened by the tolerance, so a large series is not compared pair by pair.
    const tol = opt.dateToleranceDays;
    const expand = (isos) => { const s = new Set(); for (const i of isos) { const n = Math.round(parse(i).t / DAY); for (let k = -tol; k <= tol; k++) s.add(n + k); } return s; };
    const posDays = expand(positions); const heldDays = expand(uniq);
    const near = (iso, daySet) => daySet.has(Math.round(parse(iso).t / DAY));
    const onShare = uniq.filter((d) => near(d, posDays)).length / uniq.length;
    const occupied = positions.filter((p) => near(p, heldDays));
    const density = occupied.length / positions.length;
    if (onShare < opt.cadenceOnLatticeShare) { lastReason = 'dates-do-not-follow-one-pattern'; continue; }
    if (density < opt.cadenceMinDensity) { lastReason = 'too-sparse-for-the-pattern'; continue; }
    const holes = positions.filter((p) => !near(p, heldDays));
    return { found: true, kind: tr.kind, label: tr.label, positions, holes, onShare, density, used: uniq.filter((d) => near(d, posDays)) };
  }
  return { found: false, reason: lastReason };
}
