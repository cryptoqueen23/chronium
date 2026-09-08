#!/usr/bin/env node
/**
 * Builds a synthetic municipal-records corpus for the Chronium Mind
 * INVESTIGATOR ACCEPTANCE TEST (see docs/INVESTIGATOR_ACCEPTANCE_TEST.md).
 * This is an EVALUATION fixture, not application code — pattern-matches
 * scripts/build-corpus.mjs's role (a generator producing fixtures under
 * data/), but this one hand-authors ~35 "signal" documents that encode a
 * money trail, person/org/government-body chains, deliberate identity
 * ambiguity, and deliberate factual contradictions, then layers them into
 * ~190 templated "background noise" municipal records so the signal has
 * to be found inside realistic clutter — never handed to the investigator
 * pre-sorted.
 *
 * Fictional municipality: Larkspur Falls, TX. Not Copperas Cove — kept
 * clearly separate from the project's real proof corpus per instruction.
 *
 * Output: data/acceptance-test-corpus/documents/*.txt|*.csv|*.pdf|*.docx|*.xlsx
 * plus data/acceptance-test-corpus/manifest.json (the human-readable
 * "answer key" — what's encoded where — so the acceptance test itself is
 * auditable/reproducible without re-reading every generated file).
 *
 * Node 18+, no dependencies.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(HERE, '..', 'data', 'acceptance-test-corpus', 'documents');
const MANIFEST_PATH = path.join(HERE, '..', 'data', 'acceptance-test-corpus', 'manifest.json');

// ---------------------------------------------------------------------------
// Deterministic PRNG (mulberry32) so re-running this generator produces byte-
// identical background noise — reproducible/auditable per the acceptance
// test's own requirement, no dependency needed for something this simple.
// ---------------------------------------------------------------------------
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20260908);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const int = (min, max) => min + Math.floor(rand() * (max - min + 1));
const money = (min, max) => (Math.round((min + rand() * (max - min)) * 100) / 100).toFixed(2);

function pad(n, len = 2) { return String(n).padStart(len, '0'); }
function dateStr(y, m, d) { return `${y}-${pad(m)}-${pad(d)}`; }
function longDate(y, m, d) {
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return `${months[m - 1]} ${d}, ${y}`;
}

const files = []; // { name, content: string | Uint8Array }
function addFile(name, content) { files.push({ name, content }); }

// ===========================================================================
// SIGNAL CAST — the people, orgs, and government body the acceptance test
// reasons over. Kept in one place so every signal document below stays
// internally consistent (same spelling, same roles, same dates).
// ===========================================================================
const MUNI = 'Larkspur Falls, TX';
const COUNCIL = 'Larkspur Falls City Council';
const EDC = 'Larkspur Falls Economic Development Corporation';
const EDC_ACRONYM = 'LFEDC';
const FUND = 'Riverwalk Redevelopment Fund';
const ORDINANCE = 'Ordinance No. 2024-31';
const CONTRACTOR_CO = 'Holt Construction LLC';
const GRANT_PROPERTY = '214 Main St';
const GRANT_AGREEMENT_ID = 'RRF-2024-07';
const INVOICE_ID = 'HC-2024-0091';
const CHECK_NO = '10432';

// LFEDC board (voting): Chair Linda Whitfield, Raymond Payne, Teresa Alvarez,
// Daniel Ochoa, Wayne Ruiz. Staff (non-voting): Executive Director Sheena
// Tanner. Ex officio, non-voting: Mayor Diane Castellano.
// City Council (voting, 5 seats + Mayor presiding, does not vote on routine
// ratifications): Mayor Diane Castellano, James Ko, Renee Blackwood, Hector
// Salinas, Anita Whitfield, Doug Marsh.
//
// THE IDENTITY COLLISION (the project's namesake test, replicated here):
// Raymond Payne (LFEDC board member, alias "Ray Payne") vs. Marc Payne
// (unrelated person — City of Larkspur Falls Code Compliance Officer). Same
// surname, no relation, appear in completely different document families.
// Bare "Payne" appears across enough documents — including at least two
// that are genuinely undecidable from text alone — that a real investigator
// must do real disambiguation work, not just theoretically could.

// ===========================================================================
// SIGNAL DOCUMENTS
// ===========================================================================

// --- Chain 1: Raymond Payne -> LFEDC -> City Council (appointment) --------
addFile('council-resolution-2023-14-lfedc-board-appointment.txt', `CITY OF LARKSPUR FALLS
City Council Resolution No. 2023-14

A RESOLUTION OF THE LARKSPUR FALLS CITY COUNCIL APPOINTING A MEMBER TO THE
BOARD OF DIRECTORS OF THE LARKSPUR FALLS ECONOMIC DEVELOPMENT CORPORATION

Adopted: ${longDate(2023, 9, 12)}

WHEREAS, a vacancy exists on the Board of Directors of the Larkspur Falls
Economic Development Corporation (LFEDC); and

WHEREAS, the City Council has reviewed the qualifications of the nominee;

NOW, THEREFORE, BE IT RESOLVED by the City Council of the City of Larkspur
Falls, Texas:

Section 1. Raymond Payne is hereby appointed to the Board of Directors of
the Larkspur Falls Economic Development Corporation for a term expiring
December 31, 2026.

Section 2. This resolution shall take effect immediately upon adoption.

PASSED AND APPROVED this 12th day of September, 2023.

Diane Castellano, Mayor
Attest: City Secretary's Office`);

addFile('lfedc-board-roster-2024.txt', `LARKSPUR FALLS ECONOMIC DEVELOPMENT CORPORATION
Board of Directors — Current Roster (as of January 2024)

Chair: Linda Whitfield (term exp. 2025)
Board Member: Raymond Payne (term exp. 2026, appointed by City Council
  Resolution No. 2023-14)
Board Member: Teresa Alvarez (term exp. 2025)
Board Member: Daniel Ochoa (term exp. 2027)
Board Member: Wayne Ruiz (term exp. 2026)

Executive Director (staff, non-voting): Sheena Tanner
Ex Officio Liaison (non-voting, per LFEDC Bylaws Art. IV Sec. 2): Mayor
  Diane Castellano, City of Larkspur Falls

The Board meets on the second Tuesday of each month at 6:00 PM, LFEDC
Conference Room, 100 Depot St, Larkspur Falls, TX.`);

// --- Chain 4: Diane Castellano -> Mayor -> Council presides -> LFEDC liaison
addFile('council-minutes-2024-01-09-regular.txt', `CITY OF LARKSPUR FALLS
City Council — Regular Meeting Minutes
${longDate(2024, 1, 9)}, 7:00 PM, Council Chambers, 200 Municipal Way

Mayor Diane Castellano presiding. Present: Councilmembers James Ko, Renee
Blackwood, Hector Salinas, Anita Whitfield, Doug Marsh. City Secretary
recording.

1. Call to Order / Invocation / Pledge
2. Consent Agenda — approved 5-0 (minutes of Dec. 12, 2023; monthly
   financial report; renewal of the animal control services contract)
3. Proclamation — "Small Business Week"
4. Mayor's Report: Mayor Castellano noted her continuing role as the
   Council's ex officio, non-voting liaison to the Larkspur Falls Economic
   Development Corporation (LFEDC) board, and stated the LFEDC's quarterly
   report would be presented at the next regular meeting.
5. Public Comment: none.
6. Adjournment 7:52 PM.`);

// --- Chain 3: Sheena Tanner -> LFEDC -> reports to Council -----------------
addFile('lfedc-quarterly-report-to-council-2024-02-13.txt', `CITY OF LARKSPUR FALLS
City Council — Regular Meeting Minutes (excerpt)
${longDate(2024, 2, 13)}

Item 5 — LFEDC Quarterly Report
Sheena Tanner, Executive Director of the Larkspur Falls Economic
Development Corporation, presented the LFEDC's quarterly report to
Council. Tanner reported the LFEDC board is reviewing a facade
improvement grant application from a downtown property owner and
indicated a recommendation would come before the board in March. No
Council action was requested at this time. Council received the report.`);

// --- Chain 2: Victor Holt -> Holt Construction LLC -> LFEDC (contractor) --
addFile('holt-construction-llc-vendor-registration-2024.txt', `CITY OF LARKSPUR FALLS
Vendor / Contractor Registration Record

Business name: Holt Construction LLC
Principal: Victor Holt (Owner/Operator)
Address: 77 Foundry Rd, Larkspur Falls, TX
Registered trades: General contracting, exterior renovation, masonry
Vendor ID: VEN-04417
Registered: ${dateStr(2021, 6, 2)}
Status: Active
Notes: Eligible bidder for LFEDC-administered facade/streetscape grant
programs per LFEDC Purchasing Policy Sec. 3.1.`);

// ===========================================================================
// THE MONEY TRAIL — 7 documents, deliberately spread out, deliberately not
// co-located: EDC -> authorization -> meeting/vote -> amount -> payment ->
// supporting evidence. Two of these documents ALSO carry deliberate
// contradictions (vote outcome, meeting date); a third contradiction (the
// paid amount vs. the invoiced amount) lives between M5 and M6 below.
// ===========================================================================

// M1 — the actual authorization + vote (ground truth: 4-1, Alvarez opposed,
// March 12 meeting).
addFile('lfedc-board-minutes-2024-03-12.txt', `LARKSPUR FALLS ECONOMIC DEVELOPMENT CORPORATION
Board of Directors — Regular Meeting Minutes
${longDate(2024, 3, 12)}, 6:00 PM, LFEDC Conference Room, 100 Depot St

Present: Chair Linda Whitfield, Board Members Raymond Payne, Teresa
Alvarez, Daniel Ochoa, Wayne Ruiz. Staff: Executive Director Sheena
Tanner. Ex officio: Mayor Diane Castellano (non-voting).

1. Call to Order
2. Approval of Prior Minutes — approved 5-0
3. Financial Report — received

4. Riverwalk Facade Improvement Grant — Holt Construction LLC
   Executive Director Tanner presented a staff recommendation to award a
   facade improvement grant to Holt Construction LLC for the property at
   214 Main St, in an amount not to exceed $185,000.00, payable from the
   Riverwalk Redevelopment Fund established under Ordinance No. 2024-31.
   Board Member Raymond Payne moved to approve the grant as recommended.
   Board Member Ochoa seconded.

   Discussion: Board Member Alvarez expressed concern about the proposed
   completion timeline and stated she could not support the motion as
   written.

   Vote: Motion carried 4-1. Ayes: Payne, Ochoa, Ruiz, Whitfield. Nays:
   Alvarez.

5. Other Business — none
6. Adjournment 7:15 PM

Minutes recorded by LFEDC staff; approved by the Board at its next
regular meeting.`);

// M2 — Council agenda referencing the ratification.
addFile('council-agenda-2024-03-26.txt', `CITY OF LARKSPUR FALLS
City Council — Regular Meeting Agenda
${longDate(2024, 3, 26)}, 7:00 PM, Council Chambers, 200 Municipal Way

1. Call to Order / Invocation / Pledge
2. Consent Agenda
3. Public Comment
...
7. Ratification of LFEDC-Authorized Riverwalk Facade Improvement Grant to
   Holt Construction LLC, not to exceed $185,000.00, per LFEDC Board
   action of March 12, 2024, funded from the Riverwalk Redevelopment Fund
   (Ordinance No. 2024-31 authority). Recommended action: Ratify.
8. Executive Session (personnel)
9. Adjournment`);

// M3 — Council minutes, ratifies 5-0 (consistent with M1, no contradiction here).
addFile('council-minutes-2024-03-26-regular.txt', `CITY OF LARKSPUR FALLS
City Council — Regular Meeting Minutes
${longDate(2024, 3, 26)}, 7:00 PM, Council Chambers, 200 Municipal Way

Mayor Diane Castellano presiding (did not vote). Present: Councilmembers
James Ko, Renee Blackwood, Hector Salinas, Anita Whitfield, Doug Marsh.

Item 7 — Ratification of LFEDC-Authorized Riverwalk Facade Improvement
Grant to Holt Construction LLC. City Manager summarized the LFEDC Board's
March 12, 2024 action approving a grant not to exceed $185,000.00 from
the Riverwalk Redevelopment Fund. Councilmember Ko moved to ratify;
Councilmember Blackwood seconded. Vote: 5-0, ratified.

Adjournment 8:40 PM.`);

// M7 — the grant agreement (supporting evidence for the authorization).
addFile('lfedc-grant-agreement-rrf-2024-07.txt', `LARKSPUR FALLS ECONOMIC DEVELOPMENT CORPORATION
Facade Improvement Grant Agreement No. RRF-2024-07

Parties: Larkspur Falls Economic Development Corporation ("LFEDC") and
Holt Construction LLC ("Contractor").

Date: ${longDate(2024, 3, 20)}

1. Scope: Facade improvement work at 214 Main St, Larkspur Falls, TX, per
   the specifications attached as Exhibit A.
2. Grant amount: Not to exceed $185,000.00, payable from the Riverwalk
   Redevelopment Fund (Ordinance No. 2024-31), contingent on submission
   of a final invoice and photographic documentation of completed work.
3. Authority: LFEDC Board action of March 12, 2024; City Council
   ratification of March 26, 2024.

Signed:
Sheena Tanner, Executive Director, LFEDC
Victor Holt, Owner, Holt Construction LLC`);

// M5 — the invoice (CONTRADICTION B, half 1: invoiced $178,500).
addFile('holt-construction-invoice-hc-2024-0091.txt', `HOLT CONSTRUCTION LLC
77 Foundry Rd, Larkspur Falls, TX
Invoice

Invoice No: HC-2024-0091
Date: ${longDate(2024, 6, 3)}
Bill To: Larkspur Falls Economic Development Corporation, 100 Depot St

Description: Facade improvement work completed at 214 Main St per Grant
Agreement RRF-2024-07 — masonry repair, storefront window replacement,
awning installation, exterior painting.

Amount due: $178,500.00

Reference: LFEDC Grant Agreement RRF-2024-07
Terms: Net 30`);

// M6 — the payment record (CONTRADICTION B, half 2: $185,000 paid, not the
// $178,500 invoiced — a real, unexplained $6,500 gap between the two
// documents, deliberately never resolved anywhere else in the corpus).
addFile('city-check-register-2024-06.csv', `check_no,issue_date,payee,amount,fund,reference
10418,2024-06-07,"Larkspur Falls Office Supply",412.88,General Fund,PO-22190
10422,2024-06-07,"Delgado Landscaping",2100.00,Parks Fund,PO-22201
10426,2024-06-10,"Larkspur Falls Gazette",640.00,General Fund,Legal Notice
${CHECK_NO},2024-06-14,"Holt Construction LLC",185000.00,Riverwalk Redevelopment Fund,LFEDC Grant Agreement RRF-2024-07
10440,2024-06-14,"Aramark Uniform Services",318.25,General Fund,PO-22208
10448,2024-06-21,"Larkspur Falls Water Authority",9820.44,Utility Fund,Monthly billing`);

// M4 — CONTRADICTION A (vote outcome): a later LFEDC press release
// incorrectly claims the board vote was unanimous, contradicting M1's
// documented 4-1 vote.
addFile('lfedc-annual-report-2024-press-release.txt', `LARKSPUR FALLS ECONOMIC DEVELOPMENT CORPORATION
FOR IMMEDIATE RELEASE — ${longDate(2024, 9, 3)}

LFEDC 2024 Annual Report Highlights Riverwalk Progress

The Larkspur Falls Economic Development Corporation released its 2024
annual report today, highlighting several downtown investment projects.
Among the year's milestones: the Board unanimously approved a $185,000
grant to Holt Construction LLC in March 2024 to fund facade improvements
at 214 Main St as part of the ongoing Riverwalk redevelopment effort.

"This project is exactly the kind of investment the Riverwalk
Redevelopment Fund was created for," said Board Chair Linda Whitfield.

For more information, contact the LFEDC office at 100 Depot St.`);

// M8 — CONTRADICTION C (meeting date): a news brief misdates the board
// vote to an April meeting that, per M1/roster, never happened this way.
addFile('larkspur-falls-gazette-2024-04-09-edc-grant-brief.txt', `THE LARKSPUR FALLS GAZETTE
Local Business Brief — ${longDate(2024, 4, 9)}

EDC Approves Riverwalk Facade Grant

At its April meeting, the Larkspur Falls Economic Development Corporation
board approved a $185,000 grant to Holt Construction LLC for facade
improvements on Main Street, part of the city's Riverwalk redevelopment
push. The project is expected to be completed by late summer.

The Gazette will continue following the Riverwalk redevelopment as new
phases are announced.`);

// M9 — a mistaken-identity-fuel document: a letter to the editor that
// misattributes a City Council vote to "Councilman Payne," who does not
// exist — Raymond Payne sits on the LFEDC board, not Council, and no
// "Payne" appears on the Council roster below. Deliberately wrong, useful
// for testing "did Raymond Payne serve on City Council?"
addFile('gazette-letter-to-editor-2024-02-20.txt', `THE LARKSPUR FALLS GAZETTE
Letters to the Editor — ${longDate(2024, 2, 20)}

To the Editor:

I was disappointed to see Councilman Payne vote against the downtown
parking study last month. Our city council needs to think more about
small businesses and less about optics.

— A concerned resident, name withheld`);

addFile('council-roster-2024.txt', `CITY OF LARKSPUR FALLS
City Council — Current Roster (2024)

Mayor: Diane Castellano
Place 1: James Ko
Place 2: Renee Blackwood
Place 3: Hector Salinas
Place 4: Anita Whitfield
Place 5: Doug Marsh

The Mayor presides over Council meetings and votes only to break a tie.
Council meets on the 2nd and 4th Tuesday of each month, 7:00 PM, Council
Chambers, 200 Municipal Way.`);

// ===========================================================================
// IDENTITY AMBIGUITY — the Marc Payne / Raymond Payne ("Ray Payne") pattern,
// spread across enough documents that disambiguation is real work. Marc
// Payne is the City's Code Compliance Officer and has NOTHING to do with
// the LFEDC or the Riverwalk grant.
// ===========================================================================
addFile('code-compliance-personnel-note-2019.txt', `CITY OF LARKSPUR FALLS
Code Compliance Division — Staffing Note

Marc Payne joined the Code Compliance Division as Code Compliance Officer
in March 2019. Payne is assigned to the west-side patrol area (Elm Ln,
Cedar Ln, Foundry Rd corridor) and handles routine property-maintenance
and junked-vehicle enforcement.`);

addFile('code-compliance-notice-2024-05-14.txt', `CITY OF LARKSPUR FALLS
Code Compliance Division — Notice of Violation

Date: ${longDate(2024, 5, 14)}
Property: 88 Elm Ln, Larkspur Falls, TX
Violation: Overgrown vegetation, Municipal Code Sec. 14-22

Inspecting officer: Payne

Officer Payne inspected the property and issued a Notice of Violation.
Property owner has 15 days to comply before a citation is issued.`);

addFile('code-compliance-memo-2024-06-02.txt', `CITY OF LARKSPUR FALLS
Code Compliance Division — Internal Memo

Date: ${longDate(2024, 6, 2)}
From: Division Supervisor
To: File

Payne recommended a citation be issued to the property owner at 45 Cedar
Ln for an unregistered/junked vehicle violation, second notice. Case
forwarded to Municipal Court.`);

addFile('lfedc-board-agenda-2023-11-14.txt', `LARKSPUR FALLS ECONOMIC DEVELOPMENT CORPORATION
Board of Directors — Meeting Agenda
${longDate(2023, 11, 14)}, 6:00 PM

1. Call to Order
2. Approval of Minutes
3. Financial Report
4. Old Business — Payne to report on Riverwalk facade grant program
   development status
5. New Business
6. Adjournment`);

addFile('lfedc-board-minutes-2024-05-14-excerpt.txt', `LARKSPUR FALLS ECONOMIC DEVELOPMENT CORPORATION
Board of Directors — Regular Meeting Minutes (excerpt)
${longDate(2024, 5, 14)}

3. Treasurer's Report — Motion by Payne to accept the treasurer's report
   as presented. Seconded by Ruiz. Approved 5-0.`);

addFile('council-meeting-signin-2024-03-26.txt', `CITY OF LARKSPUR FALLS
City Council Meeting — Public Sign-In Sheet
${longDate(2024, 3, 26)}

Name          | Address              | Agenda item
--------------|----------------------|-------------
G. Ferris     | 12 Willow St         | 3 (Consent)
Payne         | (not listed)         | 7 (LFEDC grant ratification)
M. Escobar    | 900 Ridge Rd         | 3 (Consent)`);

addFile('citizen-complaint-email-2024-07-19.txt', `From: resident@example.invalid
To: cityhall@larkspurfallstx.gov.invalid
Date: ${longDate(2024, 7, 19)}
Subject: Fence permit question

Hi, I stopped by City Hall last week about my fence permit and spoke to
Payne at the front counter. He said the permit was still being reviewed.
Can someone follow up? Thanks.`);

addFile('lfedc-newsletter-2024-summer.txt', `LARKSPUR FALLS ECONOMIC DEVELOPMENT CORPORATION
Board & Community Newsletter — Summer 2024

Board Member Spotlight: Special thanks to Ray Payne for his continued
service on the LFEDC board and his work supporting the Riverwalk
redevelopment effort this year.

Also in this issue: downtown facade grant program update, upcoming board
vacancies, and the fall speaker series schedule.`);

addFile('lfedc-board-signin-2024-03-12.txt', `LARKSPUR FALLS ECONOMIC DEVELOPMENT CORPORATION
Board of Directors Meeting — Sign-In Sheet
${longDate(2024, 3, 12)}

Linda Whitfield
Ray Payne
Teresa Alvarez
Daniel Ochoa
Wayne Ruiz
Sheena Tanner (staff)`);

addFile('code-compliance-annual-summary-2023.txt', `CITY OF LARKSPUR FALLS
Code Compliance Division — 2023 Annual Summary (excerpt)

Officer Marc Payne closed 142 cases in calendar year 2023, the second-
highest caseload in the division. Primary violation categories: overgrown
vegetation (61), junked vehicles (44), unpermitted signage (37).`);

// ===========================================================================
// WATCHLIST-FRIENDLY additional occurrences — a couple of extra background-
// ish documents that repeat the watchlist terms (LFEDC, Riverwalk
// Redevelopment Fund, Ordinance No. 2024-31) in ordinary municipal contexts
// unrelated to the money trail itself, so a watchlist match search returns
// more than just the money-trail documents already listed above.
// ===========================================================================
addFile('ordinance-2024-31-full-text.txt', `CITY OF LARKSPUR FALLS
Ordinance No. 2024-31

AN ORDINANCE OF THE CITY OF LARKSPUR FALLS ESTABLISHING THE RIVERWALK
REDEVELOPMENT FUND AND DEDICATING A PORTION OF THE LOCAL HOTEL OCCUPANCY
TAX TO SUPPORT DOWNTOWN AND RIVERFRONT REDEVELOPMENT GRANTS ADMINISTERED
BY THE LARKSPUR FALLS ECONOMIC DEVELOPMENT CORPORATION

Adopted: ${longDate(2024, 1, 23)}

Section 1. There is hereby established the Riverwalk Redevelopment Fund
as a special revenue fund of the City.

Section 2. Twenty percent (20%) of the City's Local Hotel Occupancy Tax
collections shall be dedicated annually to the Riverwalk Redevelopment
Fund, subject to appropriation.

Section 3. The Larkspur Falls Economic Development Corporation (LFEDC) is
authorized to administer grants from the Riverwalk Redevelopment Fund
consistent with its bylaws and applicable state law, subject to City
Council ratification of individual grant awards exceeding $50,000.

Section 4. This ordinance takes effect immediately upon adoption.

PASSED AND APPROVED this 23rd day of January, 2024.`);

addFile('council-budget-workshop-2024-01-16.txt', `CITY OF LARKSPUR FALLS
City Council — Budget Workshop Minutes (excerpt)
${longDate(2024, 1, 16)}

Finance Director presented projected FY2024 Hotel Occupancy Tax
collections and the proposed allocation to the newly-created Riverwalk
Redevelopment Fund under the pending Ordinance No. 2024-31. Council asked
clarifying questions about LFEDC's grant approval process; no action
taken at the workshop.`);

// ===========================================================================
// CORRUPTED / UNREADABLE FILES — exercises Phase 4 failure-recovery
// (COMPLETED_WITH_ERRORS) and the adapters' extraction-failure path.
// ===========================================================================
function randomBytes(n) {
  const b = new Uint8Array(n);
  for (let i = 0; i < n; i++) b[i] = Math.floor(rand() * 256);
  return b;
}
// Not a real PDF — pdf.js's getDocument() should reject this.
addFile('corrupted-scan-riverwalk-appraisal.pdf', randomBytes(4096));
// Truncated PDF: a real header, then garbage — still expected to fail parsing.
addFile('corrupted-truncated-inspection-report.pdf', (() => {
  const header = new TextEncoder().encode('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n1 0 obj\n');
  const garbage = randomBytes(512);
  const out = new Uint8Array(header.length + garbage.length);
  out.set(header, 0); out.set(garbage, header.length);
  return out;
})());
// Not a real XLSX (which is actually a zip container) — SheetJS should fail.
addFile('corrupted-budget-detail.xlsx', randomBytes(2048));
// Not a real DOCX (also a zip container) — mammoth should fail.
addFile('corrupted-grant-application-draft.docx', randomBytes(2048));
// Zero-byte file — an edge case distinct from garbage-bytes corruption.
addFile('corrupted-empty-file.txt', new Uint8Array(0));

// ===========================================================================
// BACKGROUND NOISE — ~190 templated municipal records unrelated to the
// signal above (different people, vendors, ordinance numbers, dates), so
// the signal documents have to be found inside realistic clutter rather
// than handed to the investigator pre-sorted.
// ===========================================================================
const NOISE_FIRST = ['James', 'Patricia', 'Robert', 'Linda', 'Michael', 'Barbara', 'William', 'Susan', 'David', 'Karen', 'Richard', 'Nancy', 'Joseph', 'Betty', 'Thomas', 'Sandra', 'Charles', 'Donna', 'Mark', 'Carol', 'Paul', 'Ruth', 'Steven', 'Sharon', 'Kenneth', 'Michelle', 'Andrew', 'Laura', 'Joshua', 'Kimberly'];
const NOISE_LAST = ['Nguyen', 'Garcia', 'Miller', 'Davis', 'Rodriguez', 'Martinez', 'Hernandez', 'Lopez', 'Gonzalez', 'Wilson', 'Anderson', 'Thomas', 'Taylor', 'Moore', 'Jackson', 'Martin', 'Lee', 'Perez', 'Thompson', 'White', 'Harris', 'Sanchez', 'Clark', 'Ramirez', 'Lewis', 'Robinson', 'Walker', 'Young', 'Allen', 'King'];
const NOISE_VENDORS = ['Prairie Wind Landscaping', 'Larkspur Falls Office Supply', 'Delgado Landscaping', 'Aramark Uniform Services', 'Cornerstone HVAC Service', 'Falls Print & Copy', 'Redbud Electric Co.', 'TexFleet Maintenance', 'Larkspur Falls Water Authority', 'Summit Roofing Solutions', 'Blackwell Paving', 'Northgate Janitorial', 'Pioneer Fence Co.', 'Loma Verde Nursery', 'Falls County Waste Services'];
const NOISE_DEPTS = ['Public Works', 'Parks and Recreation', 'Police Department', 'Fire Department', 'Municipal Court', 'Library', 'Utilities', 'Finance', 'Planning and Zoning', 'Animal Control'];
const NOISE_FUNDS = ['General Fund', 'Parks Fund', 'Utility Fund', 'Street Maintenance Fund', 'Capital Improvement Fund'];
const NOISE_STREETS = ['Willow St', 'Ridge Rd', 'Sycamore Ave', 'Founders Ln', 'Prairie View Dr', 'Depot St', 'Hillcrest Ave', 'Meadowbrook Ln', 'Overlook Dr', 'Chestnut St'];
const NOISE_ORD_TOPICS = ['regulating sidewalk vendor permits', 'amending the animal control leash requirements', 'establishing a residential parking permit zone on Hillcrest Ave', 'updating the noise ordinance enforcement hours', 'adopting the updated International Fire Code', 'creating a historic preservation overlay district', 'amending stormwater drainage fee schedules', 'establishing a short-term rental registration requirement'];
const NOISE_PROJECTS = ['the Willow St sidewalk repair project', 'the Splash Pad renovation at Founders Park', 'the annual street resurfacing program', 'the animal shelter HVAC replacement', 'the library roof repair', 'the traffic signal upgrade at Ridge Rd and Meadowbrook Ln', 'the wastewater treatment plant pump replacement', 'the downtown holiday lighting program'];

function noiseName() { return `${pick(NOISE_FIRST)} ${pick(NOISE_LAST)}`; }

let noiseCounter = 0;
function nextId(prefix) { noiseCounter++; return `${prefix}-${String(noiseCounter).padStart(4, '0')}`; }

// --- 50 unrelated Council minutes, spread across 2022-2025 ---
for (let i = 0; i < 50; i++) {
  const y = 2022 + Math.floor(i / 18);
  const m = 1 + (i % 12);
  const d = 6 + (i % 3) * 7;
  const members = [pick(NOISE_FIRST) + ' ' + pick(NOISE_LAST), pick(NOISE_FIRST) + ' ' + pick(NOISE_LAST)];
  addFile(`council-minutes-${dateStr(y, m, d)}-${nextId('noise')}.txt`, `CITY OF LARKSPUR FALLS
City Council — Regular Meeting Minutes
${longDate(y, m, d)}, 7:00 PM, Council Chambers, 200 Municipal Way

Mayor Diane Castellano presiding. Present: Councilmembers James Ko, Renee
Blackwood, Hector Salinas, Anita Whitfield, Doug Marsh.

1. Call to Order / Invocation / Pledge
2. Consent Agenda — approved 5-0
3. Public Comment: ${noiseName()} spoke regarding ${pick(NOISE_PROJECTS)}.
4. Presentation: ${pick(NOISE_DEPTS)} Director gave an update on
   ${pick(NOISE_PROJECTS)}, budgeted at $${money(4000, 220000)} from the
   ${pick(NOISE_FUNDS)}.
5. Approval of contract with ${pick(NOISE_VENDORS)} for ${pick(NOISE_PROJECTS)},
   not to exceed $${money(1500, 95000)} — approved 5-0.
6. Adjournment ${int(7, 9)}:${pad(int(0, 59))} PM.`);
}

// --- 40 unrelated Council agendas ---
for (let i = 0; i < 40; i++) {
  const y = 2022 + Math.floor(i / 15);
  const m = 1 + (i % 12);
  const d = 6 + (i % 3) * 7;
  addFile(`council-agenda-${dateStr(y, m, d)}-${nextId('noise')}.txt`, `CITY OF LARKSPUR FALLS
City Council — Regular Meeting Agenda
${longDate(y, m, d)}, 7:00 PM, Council Chambers, 200 Municipal Way

1. Call to Order / Invocation / Pledge
2. Consent Agenda
3. Public Comment
4. Presentation: ${pick(NOISE_DEPTS)} Department Update
5. Discussion and possible action: contract with ${pick(NOISE_VENDORS)} for
   ${pick(NOISE_PROJECTS)}, not to exceed $${money(1500, 95000)}
6. Discussion and possible action: ${pick(NOISE_ORD_TOPICS)}
7. Executive Session (personnel/real estate)
8. Adjournment`);
}

// --- 30 unrelated LFEDC board minutes (routine business, other grantees) ---
const OTHER_GRANTEES = ['Mesa Verde Bakery', 'Falls Family Dentistry', 'Riverside Hardware', 'The Bindery Bookshop', 'Corner Cafe', 'Larkspur Falls Fitness', 'Prairie Rose Florist', 'Foundry Row Studio'];
for (let i = 0; i < 30; i++) {
  const y = 2022 + Math.floor(i / 12);
  const m = 1 + (i % 12);
  addFile(`lfedc-board-minutes-${dateStr(y, m, 14)}-${nextId('noise')}.txt`, `LARKSPUR FALLS ECONOMIC DEVELOPMENT CORPORATION
Board of Directors — Regular Meeting Minutes
${longDate(y, m, 14)}, 6:00 PM, LFEDC Conference Room, 100 Depot St

Present: Chair Linda Whitfield, Board Members Teresa Alvarez, Daniel
Ochoa, Wayne Ruiz. Staff: Executive Director Sheena Tanner.

1. Call to Order
2. Approval of Prior Minutes — approved
3. Financial Report — received
4. Small business facade mini-grant application — ${pick(OTHER_GRANTEES)} —
   approved in the amount of $${money(2000, 15000)}, 5-0.
5. Marketing committee update
6. Adjournment`);
}

// --- 30 budget line-item CSVs, one per department/quarter ---
for (let i = 0; i < 30; i++) {
  const dept = pick(NOISE_DEPTS);
  const y = 2022 + (i % 3);
  const q = 1 + (i % 4);
  const rows = [];
  const lineCount = int(6, 14);
  for (let r = 0; r < lineCount; r++) {
    rows.push(`${nextId('LN')},${dept.replace(/,/g, '')},${pick(['Salaries', 'Supplies', 'Equipment', 'Contract Services', 'Utilities', 'Training', 'Fuel', 'Maintenance'])},${money(200, 48000)},${pick(NOISE_FUNDS)}`);
  }
  addFile(`budget-detail-${dept.toLowerCase().replace(/[^a-z]+/g, '-')}-${y}-q${q}-${nextId('noise')}.csv`, `line_id,department,category,amount,fund\n${rows.join('\n')}`);
}

// --- 20 unrelated vendor invoices ---
for (let i = 0; i < 20; i++) {
  const vendor = pick(NOISE_VENDORS);
  const y = 2022 + (i % 3);
  const m = 1 + (i % 12);
  const d = int(2, 27);
  addFile(`invoice-${vendor.toLowerCase().replace(/[^a-z]+/g, '-')}-${dateStr(y, m, d)}-${nextId('noise')}.txt`, `${vendor.toUpperCase()}
Invoice

Invoice No: ${nextId('INV')}
Date: ${longDate(y, m, d)}
Bill To: City of Larkspur Falls, ${pick(NOISE_DEPTS)}

Description: ${pick(['Routine maintenance service', 'Supply order per PO', 'Quarterly contract service', 'Equipment repair', 'Materials delivery'])}
Amount due: $${money(150, 12000)}
Terms: Net 30`);
}

// --- 10 unrelated ordinances ---
const usedOrdNums = new Set(['2024-31']);
for (let i = 0; i < 10; i++) {
  let num;
  do { num = `${2021 + int(0, 4)}-${int(1, 45)}`; } while (usedOrdNums.has(num));
  usedOrdNums.add(num);
  const y = 2021 + int(0, 4);
  addFile(`ordinance-${num}-${nextId('noise')}.txt`, `CITY OF LARKSPUR FALLS
Ordinance No. ${num}

AN ORDINANCE OF THE CITY OF LARKSPUR FALLS ${pick(NOISE_ORD_TOPICS).toUpperCase()}

Adopted: ${longDate(y, int(1, 12), int(1, 28))}

Section 1. [Purpose and findings.]
Section 2. [Substantive provisions.]
Section 3. This ordinance takes effect immediately upon adoption.

PASSED AND APPROVED.`);
}

// --- 10 unrelated press releases ---
const PRESS_TOPICS = ['a new farmers market on Depot St', 'the summer reading program at the Library', 'road closures for the annual Founders Day parade', 'a citywide recycling program expansion', 'the reopening of the Founders Park splash pad', 'a new online permitting portal', 'the fall leaf collection schedule', 'a public input meeting on the Parks Master Plan', 'expanded hours at the Municipal Court', 'a new small business grant program information session'];
for (let i = 0; i < 10; i++) {
  const y = 2022 + (i % 3);
  const m = 1 + (i % 12);
  const d = int(2, 27);
  addFile(`press-release-${dateStr(y, m, d)}-${nextId('noise')}.txt`, `CITY OF LARKSPUR FALLS
FOR IMMEDIATE RELEASE — ${longDate(y, m, d)}

City Announces ${pick(PRESS_TOPICS)}

The City of Larkspur Falls today announced details regarding ${pick(PRESS_TOPICS)}. Residents can find more information at the City's website or by
contacting the ${pick(NOISE_DEPTS)} department.

For more information, contact the City Communications Office.`);
}

// ===========================================================================
// Write everything out.
// ===========================================================================
await fs.mkdir(OUT_DIR, { recursive: true });
for (const f of files) {
  const target = path.join(OUT_DIR, f.name);
  if (typeof f.content === 'string') {
    await fs.writeFile(target, f.content, 'utf8');
  } else {
    await fs.writeFile(target, f.content);
  }
}

const signalCount = files.length - 195; // approx; recomputed precisely below via manifest
const manifest = {
  generatedAt: new Date().toISOString(),
  municipality: MUNI,
  totalDocuments: files.length,
  answerKey: {
    moneyTrail: {
      organization: EDC,
      fund: FUND,
      ordinance: ORDINANCE,
      contractor: CONTRACTOR_CO,
      grantAgreement: GRANT_AGREEMENT_ID,
      invoice: INVOICE_ID,
      checkNumber: CHECK_NO,
      chain: [
        { step: 'Authorization + vote', file: 'lfedc-board-minutes-2024-03-12.txt', fact: 'Board authorizes grant not to exceed $185,000.00 to Holt Construction LLC. Vote 4-1 (Alvarez opposed).' },
        { step: 'Council agenda (ratification notice)', file: 'council-agenda-2024-03-26.txt' },
        { step: 'Council ratification', file: 'council-minutes-2024-03-26-regular.txt', fact: 'Council ratifies 5-0.' },
        { step: 'Grant agreement (supporting evidence)', file: 'lfedc-grant-agreement-rrf-2024-07.txt' },
        { step: 'Invoice', file: 'holt-construction-invoice-hc-2024-0091.txt', fact: 'Invoiced amount: $178,500.00' },
        { step: 'Payment', file: 'city-check-register-2024-06.csv', fact: 'Paid amount: $185,000.00 (check #10432) — does NOT match the invoiced $178,500.00; unexplained $6,500 gap, never resolved elsewhere in the corpus.' }
      ]
    },
    contradictions: [
      { id: 'A-vote-outcome', files: ['lfedc-board-minutes-2024-03-12.txt', 'lfedc-annual-report-2024-press-release.txt'], description: 'Board minutes record a 4-1 vote (Alvarez opposed). The LFEDC\'s own later press release claims the vote was unanimous.' },
      { id: 'B-amount-mismatch', files: ['holt-construction-invoice-hc-2024-0091.txt', 'city-check-register-2024-06.csv'], description: 'Invoice: $178,500.00. Amount actually paid per the check register: $185,000.00. No document in the corpus explains the $6,500 difference.' },
      { id: 'C-meeting-date', files: ['lfedc-board-minutes-2024-03-12.txt', 'larkspur-falls-gazette-2024-04-09-edc-grant-brief.txt'], description: 'Board minutes show the vote happened March 12, 2024. A Gazette brief says the vote happened "at its April meeting."' }
    ],
    personOrgGovChains: [
      { person: 'Raymond Payne', org: EDC, govBody: COUNCIL, files: ['council-resolution-2023-14-lfedc-board-appointment.txt', 'lfedc-board-roster-2024.txt', 'lfedc-board-minutes-2024-03-12.txt'] },
      { person: 'Victor Holt', org: CONTRACTOR_CO, govBody: EDC, files: ['holt-construction-llc-vendor-registration-2024.txt', 'lfedc-grant-agreement-rrf-2024-07.txt', 'holt-construction-invoice-hc-2024-0091.txt'] },
      { person: 'Sheena Tanner', org: EDC, govBody: COUNCIL, files: ['lfedc-quarterly-report-to-council-2024-02-13.txt', 'lfedc-board-minutes-2024-03-12.txt'] },
      { person: 'Diane Castellano', org: EDC, govBody: COUNCIL, files: ['council-minutes-2024-01-09-regular.txt', 'lfedc-board-roster-2024.txt', 'council-minutes-2024-03-26-regular.txt'] }
    ],
    identityAmbiguity: {
      pattern: 'Marc Payne (unrelated Code Compliance Officer) vs. Raymond Payne (LFEDC board member, alias "Ray Payne")',
      fullNameDocs: ['code-compliance-personnel-note-2019.txt', 'code-compliance-annual-summary-2023.txt', 'council-resolution-2023-14-lfedc-board-appointment.txt', 'lfedc-board-minutes-2024-03-12.txt'],
      aliasDocs: ['lfedc-newsletter-2024-summer.txt', 'lfedc-board-signin-2024-03-12.txt'],
      bareSurnameDocs_shouldTriggerAmbiguous: ['code-compliance-notice-2024-05-14.txt', 'code-compliance-memo-2024-06-02.txt', 'lfedc-board-agenda-2023-11-14.txt', 'lfedc-board-minutes-2024-05-14-excerpt.txt', 'council-meeting-signin-2024-03-26.txt', 'citizen-complaint-email-2024-07-19.txt'],
      genuinelyUndecidableFromTextAlone: ['council-meeting-signin-2024-03-26.txt', 'citizen-complaint-email-2024-07-19.txt'],
      mistakenIdentityFuel: { file: 'gazette-letter-to-editor-2024-02-20.txt', note: 'Falsely implies a "Councilman Payne" exists. No Payne is on the Council roster (council-roster-2024.txt) — Raymond Payne is LFEDC-only.' }
    },
    watchlistSuggestedTerms: [EDC_ACRONYM, FUND, ORDINANCE, 'Holt Construction'],
    corruptedFiles: [
      'corrupted-scan-riverwalk-appraisal.pdf',
      'corrupted-truncated-inspection-report.pdf',
      'corrupted-budget-detail.xlsx',
      'corrupted-grant-application-draft.docx',
      'corrupted-empty-file.txt'
    ]
  }
};
await fs.writeFile(MANIFEST_PATH, JSON.stringify(manifest, null, 2));

console.log(`Wrote ${files.length} documents to ${path.relative(process.cwd(), OUT_DIR)}`);
console.log(`Wrote manifest to ${path.relative(process.cwd(), MANIFEST_PATH)}`);
