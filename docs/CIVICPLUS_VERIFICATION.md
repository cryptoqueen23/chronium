# CivicPlus / Copperas Cove: access verification (Deep Discovery Phase 0)

Verified 2026-10-23. Purpose: decide whether an automated CivicPlus adapter may be written and run. **Result: NOT cleared. Automation for this host stays `unverified` (blocked) until a documented decision changes it.** This is a record of what was read, not legal advice.

## What was checked, and what it says

| Item | Finding |
|---|---|
| City `robots.txt` (`https://www.copperascovetx.gov/robots.txt`) | `User-agent: *` group (the one that applies to us) includes **`Crawl-delay: 10`**. For `*` it disallows `/Search`, `/map`, `/RSS.aspx`, `/CurrentEvents*`, error pages, iCalendar and debug modules, `/admin`, `/support`, `/OJA`, `/activedit` and `/PublicLogin.aspx`. A separate group naming AI crawlers (for example `ClaudeBot`, `GPTBot`) repeats those rules and adds extra "expensive endpoint" blocks for `/calendar.aspx`, `/rssfeed.aspx`, `/bids.aspx`, `/faq.aspx` and `/civicalerts.aspx`; **those extra blocks do not apply to the `*` group** (shown by the parser test against the saved file). `/AgendaCenter/...` and `/DocumentCenter/...` are **not** disallowed for anyone. A `Sitemap: /sitemap.xml` line is present (relative form). Saved as a test fixture: `scripts/fixtures/discovery/copperascovetx.robots.txt`. |
| City Copyright Notices page (`/copyright`) | "All content (c) 2006-2026 Copperas Cove, TX and its representatives. All rights reserved." No licence for reuse, no statement about automated access either way. |
| City Privacy Policy (`/site/privacy`) | Describes data the site collects about visitors. No statement about automated access. |
| City Accessibility page | Not relevant to access rules; not read in detail. |
| **CivicPlus Terms of Use** (`https://www.civicplus.com/terms-of-use`, "updated on September 1, 2022"; read through a page-summarising tool, so the quotes below are the tool's extracts and should be re-read by a person) | Section 7 (Prohibited Use) forbids to "Use or launch any automated system, including without limitation, 'robots,' 'spiders,' or 'offline readers,'" that accesses "the Site or any Solution in a manner that sends more request messages to the CivicPlus servers in a given period of time than a human can reasonably produce in the same period by using a conventional on-line web browser"; also to "Access the Site or Solutions by any means other than through the interface that is provided by CivicPlus" and to "Mirror or frame the Site, Solutions or any part". Section 13 sets liquidated damages of $0.25 per page request "after that first 1,000" requests in 24 hours. "Site" is defined as "the CivicPlus proprietary websites"; "Solution(s)" is not defined in the extracts we saw. "You" is "a user of the Site or Solution". |
| `civicplus.com` itself | Returned HTTP 403 to a non-browser User-Agent. **No attempt was made to get around this.** |
| robots.txt of `civicplus.com` | Allows everything (`Disallow:` empty). |

## The endpoints the public pages themselves use

- `/AgendaCenter` loads its meeting lists with a `POST` to **`/AgendaCenter/UpdateCategoryList`** with form fields `year` and `catID` (seen in the page's own JavaScript). The static HTML of the page contains no agenda file links.
- `/DocumentCenter` shows one static `View` link; folder contents load by script. Individual files use `/DocumentCenter/View/<id>/<name>`.
- The sitemap (253 URLs) lists only the two landing pages, not the documents.
- Correction to an earlier draft of this note: `/RSSFeed.aspx` and `/calendar.aspx` are **not** disallowed for the `*` group (only for the named AI-crawler group). A feed or calendar export could therefore be a cleaner listing source, but whether automated use of it is acceptable is the same open terms question. No feed was fetched.

## Assessment

1. **robots.txt permits** requests to the agenda and document paths, subject to the 10-second crawl delay.
2. **Terms are not clearly either way.** The CivicPlus terms prohibit automated systems that exceed human request rates and access by non-provided interfaces. A crawler at one request per 10 seconds is below human rate and the listing call is part of the interface CivicPlus's own page uses, but whether these terms govern a city-hosted site visitor, and how a court would read them, is uncertain. The city's own pages grant no permission and assert copyright over site content.
3. Per the project rule, **"publicly reachable" is not treated as authorised for bulk collection.** The adapter is therefore **not written**, and the host is registered as `unverified` (the engine refuses automated requests to it).

## Compliant alternatives available now

- **User-directed capture:** the person opens the agenda or document page in their own browser and chooses "save to case". One page at a time, at human pace, from their own session (Phase 1 extension feature, uses the page the user is already viewing).
- **User-supplied URLs:** the person pastes links to specific files; one-off retrieval with the same robots/delay rules (needs the host acknowledged, see below).
- **Ask the source:** a short written request to the City of Copperas Cove records/IT contact (and/or CivicPlus) asking whether polite automated retrieval of public agendas and documents is acceptable, or whether a bulk export exists. A reply, or a decision by Mari to accept the residual risk, is recorded in `scripts`-adjacent registry data (`public/discovery/connector.js` host policy) with date and text.
- **Official exports and APIs:** none was found for these modules; do not assume one exists.
- **A formal Texas Public Information Act request** remains the fallback for records that are not otherwise obtainable.

## Safeguards that apply even if the host is later cleared

- Honour `Crawl-delay` (10 s) and never run parallel workers against the host.
- A per-host daily request ceiling of 500 per browser (a ceiling, not an intended request count; staying below the 1,000-pages-a-day figure in the CivicPlus terms is not assumed to establish compliance), counted across runs.
- Runs are user-started, capped, and logged in the coverage ledger.

## Remaining work for the CivicPlus adapter

Blocked on a recorded permission or risk decision. After that: verify the exact request/response shape of `UpdateCategoryList` and the DocumentCenter folder listing with a handful of paced requests, write the adapter against saved fixtures (not live crawling), and add it to the registry with `automation: 'allowed'` and the date and basis of the decision.

## Limits of this verification

- Quotes of the CivicPlus terms came from a summarising fetch tool; a person should read the page.
- Only the Copperas Cove site and `civicplus.com` were examined. Other CivicPlus cities may have different robots files and notices.
- Earlier, before Phase 0 was approved, about eleven light GET requests were made to `www.copperascovetx.gov` within roughly a minute while learning what the site was. That was faster than its published 10-second delay. Requests since then were spaced by at least 10 seconds. No large crawl has been run.

## Phase 1 re-verification (2026-10-23, later the same day)

Purpose: before any CivicPlus adapter is enabled for `copperascovetx.gov`, check the applicable access rules again, this time reading the CivicPlus Terms of Use directly rather than relying on the Phase 0 summary.

| Item | Finding |
|---|---|
| CivicPlus Terms of Use, fetched again through the page-reading tool (still an extract, not a human reading) | Same text as the Phase 0 note. **"Site"** is defined as "the CivicPlus proprietary websites" (Section 3). **"Solution(s)"** is defined only as the engagement tools described in Section 2. **"You"** is "a user of the Site or Solution of CivicPlus" (Section 1). Section 7 (Prohibited Use) forbids automated systems ("robots," "spiders," "offline readers") that access "the Site or any Solution" at a rate above what a person could produce with a conventional browser, and forbids access "by any means other than through the interface that is provided by CivicPlus". Section 13 sets liquidated damages of $0.25 per page request after the first 1,000 in 24 hours. |
| Does the document say whether it governs a city's CivicPlus-hosted site or that site's visitors? | **It does not say either way.** It never names government customer sites. Section 1 says a separately agreed set of terms prevails if there is a conflict, and Section 3 mentions "the master services agreement, statement of work, and/or these TOS", which suggests city contracts may carry their own terms. The city's contract with CivicPlus is not public here. |
| City site (`/copyright`, `/site/privacy`, from Phase 0) | Copyright is asserted over site content; no licence for reuse; no statement about automated access in either direction. |
| `robots.txt` | Unchanged since Phase 0: group `*` allows `/AgendaCenter/` and `/DocumentCenter/`, with `Crawl-delay: 10`. |
| Anything new that grants permission | **Nothing.** No written permission has been received, no export or API was found, and no statement says automated access to the city's agenda and document areas is acceptable. |

**Decision recorded: access rules NOT verified as permitting automation. `copperascovetx.gov` and `civicplus.com` stay `unverified` in the host policy registry, and the engine and the Worker both refuse to contact them.** This is tested: the engine makes zero requests to the host even with an acknowledgment (`scripts/test-discovery-phase1.mjs`, "CivicPlus-hosted Copperas Cove stays blocked"), and the Worker answers HTTP 403 `policy-refused` (same file, "proxy: refuses ..."). The browser test also confirms the Find Records screen explains the refusal in words and makes no request.

### What exists now for CivicPlus

The reusable **adapter interface** (`CivicPlusAdapter` in `public/discovery/connector.js`): it recognises the address shapes seen on the public pages (`/AgendaCenter/ViewFile/...`, `/DocumentCenter/View/<id>/...`, the two centre landing pages), ranks document links first when a capped run has to choose, and offers a `listingCalls()` hook that returns nothing. The engine uses a connector's listing calls **only for hosts whose registry entry is explicitly `allowed`** (an acknowledgment is not enough; tested). The list endpoint (`/AgendaCenter/UpdateCategoryList`) answers a script POST whose response was never captured, so **no list parser exists**; guessing one would be writing against an unverified shape.

### Ways to proceed (for Mari to choose; none has been done)

1. **Ask in writing** (suggested text below). A reply that grants permission, or a refusal, is recorded in the registry entry with its date and text.
2. **Accept a recorded residual risk** and set the entry to `allowed` with the date and basis. The terms' $0.25-per-request clause applies after 1,000 pages in 24 hours; this tool's ceiling is 500 requests per host per day.
3. **User-directed capture only.** The person opens an agenda or document in their own browser and saves that one page to the case (the existing "Add URL" and file import already do this). No automation.
4. **A Texas Public Information Act request** for records that cannot be obtained otherwise.

Suggested short request (not sent):

> To the City Clerk / IT Department, City of Copperas Cove, and to CivicPlus: Chronium Mind is a free research tool that helps people find public meeting records. With a person's permission it can read a city's public agenda and document pages one request at a time, waiting at least 10 seconds between requests (the Crawl-delay in your robots.txt), identifying itself as "ChroniumMind" with a contact address, and never faster than one request every 10 seconds. May it do this for www.copperascovetx.gov (the /AgendaCenter and /DocumentCenter areas)? If you would prefer another method, such as a bulk export or a feed, please tell us. We will follow your answer and keep it on record.

**Update 2026-10-23 (later):** the written request is drafted in `docs/CIVICPLUS_PERMISSION_REQUEST_DRAFT.md` (not sent). Mari confirmed the block stays; only individually selected, user-directed capture is permitted meanwhile, and it needs no code change because Chronium makes no request to the host in that path.
