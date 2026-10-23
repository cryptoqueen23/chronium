// Synthetic case snapshots for Records Recovery tests. Everything here is invented ("Larkspur Falls" is a made-up
// city); no real record is used. Two builders:
//   completeSnapshot()    a council that met on the second Tuesday of every month of 2024: every agenda has its minutes,
//                         budgets for FY2022 to FY2024, five ordinances that are cited and held. EXPECTED GAPS: none.
//   incompleteSnapshot()  the same, minus: minutes for March 12, June 11 and September 10; everything for May 14;
//                         the FY2023 budget; and two ordinances (2024-21, 2024-22) that the minutes cite but are not held.
//                         EXPECTED GAPS: exactly 7 (3 pairs, 1 date, 1 year, 2 citations).
export const MEETING_DATES = ['2024-01-09', '2024-02-13', '2024-03-12', '2024-04-09', '2024-05-14', '2024-06-11', '2024-07-09', '2024-08-13', '2024-09-10', '2024-10-08', '2024-11-12', '2024-12-10'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const longDate = (iso) => { const [y, m, d] = iso.split('-').map(Number); return `${MONTHS[m - 1]} ${d}, ${y}`; };

let n = 0;
export function rec(over) {
  n += 1;
  const id = over.id || `rec-${String(n).padStart(4, '0')}`;
  return {
    id, sourceType: 'bulk-document', origin: 'deep-discovery', title: over.title, originalUrl: over.url, filePath: over.url, mime: 'application/pdf',
    extractedText: over.text ?? '', extractionNote: over.text ? null : 'No text', fileHash: over.hash || `hash-${id}`, fileSize: 1000,
    discovery: { originalUrl: over.url, finalUrl: over.url, retrievedAt: over.retrievedAt || '2026-10-23T12:00:00Z', sha256: over.hash || `hash-${id}`, linkText: over.title, partial: false, alsoFoundAt: [] },
    ...(over.extra || {})
  };
}
const agendaText = (d, extra = '') => `CITY OF LARKSPUR FALLS\nCITY COUNCIL AGENDA\nRegular Meeting\n${longDate(d)}\n1. Call to order\n2. Approval of the minutes of the previous meeting\n${extra}`;
const minutesText = (d, extra = '') => `CITY OF LARKSPUR FALLS\nMINUTES OF THE REGULAR MEETING OF THE CITY COUNCIL\n${longDate(d)}\nThe council met and took action. ${extra}`;

export function completeRecords({ skipMinutes = [], skipDates = [], skipBudgetYears = [], citeUnheld = false } = {}) {
  const out = [];
  const ords = ['2024-01', '2024-02', '2024-03', '2024-04', '2024-05'];
  MEETING_DATES.forEach((d, i) => {
    if (skipDates.includes(d)) return;
    out.push(rec({ title: `Agenda ${d}`, url: `https://records.example.gov/agendas/agenda-${d}.pdf`, text: agendaText(d) }));
    if (!skipMinutes.includes(d)) {
      let extra = '';
      if (i < ords.length) extra = `Ordinance No. ${ords[i]} was adopted on second reading.`;
      if (citeUnheld && d === '2024-10-08') extra = 'Ordinance No. 2024-21 was read in full.';
      if (citeUnheld && d === '2024-11-12') extra = 'Ordinance No. 2024-22 was adopted.';
      out.push(rec({ title: `Minutes ${d}`, url: `https://records.example.gov/minutes/minutes-${d}.pdf`, text: minutesText(d, extra) }));
    }
  });
  for (const o of ords) out.push(rec({ title: `Ordinance ${o}`, url: `https://records.example.gov/ordinances/ord-${o}.pdf`, text: `ORDINANCE NO. ${o}\nAN ORDINANCE OF THE CITY OF LARKSPUR FALLS, TEXAS.` }));
  for (const y of [2022, 2023, 2024]) {
    if (skipBudgetYears.includes(y)) continue;
    out.push(rec({ title: `Annual Budget FY${y}`, url: `https://records.example.gov/budgets/budget-fy${y}.pdf`, text: `CITY COUNCIL\nANNUAL BUDGET FY${y}\nAdopted by the council.` }));
  }
  return out;
}

const base = (records, extra = {}) => ({ investigation: { id: 'inv-fixture', name: 'Fixture' }, records, investigationRecords: [], discoveryRuns: [], discoveryLedger: [], recoveryReviews: [], recoveryRequests: [], recoverySettings: [], ...extra });
export const completeSnapshot = (extra) => base(completeRecords(), extra);
export const incompleteSnapshot = (extra) => base(completeRecords({ skipMinutes: ['2024-03-12', '2024-06-11', '2024-09-10'], skipDates: ['2024-05-14'], skipBudgetYears: [2023], citeUnheld: true }), extra);
