# Deep Discovery source registry and host policy

A source is never contacted automatically unless a **host policy** says it may be. The engine consults the registry before any request, including `robots.txt`. Code: `public/discovery/connector.js` (`defaultHostPolicies()`, `HostPolicyRegistry.decide()`).

## Policy values

| Value | Meaning | Engine behaviour |
|---|---|---|
| `allowed` | Terms checked, automated retrieval verified permitted; date and basis recorded | Runs (still subject to robots.txt, Crawl-delay, caps) |
| `link-only` | Show the address, never fetch it automatically | No request; ledger records `access-restricted`, reason `policy-link-only` |
| `forbidden` | Terms or access controls prohibit automation | No request; reason `policy-forbidden` |
| `unverified` | Terms not (yet) verified | No request; reason `policy-unverified`. Acknowledging the site does **not** override an `unverified` registry entry |
| *(no entry)* | An ordinary site nobody has reviewed | Runs only if the user acknowledged that host for this run ("I have read this site's terms"); the acknowledgment is written to the ledger |

An entry changes only by a documented decision (who, when, on what basis), recorded in the entry's `decidedAt` and `note` and in the linked doc.

## Entries shipped in Phase 0

| Host | Connector | Policy | Basis |
|---|---|---|---|
| `copperascovetx.gov` | `civicplus` (placeholder, no retrieval logic) | `unverified` | `docs/CIVICPLUS_VERIFICATION.md`: robots.txt allows the paths with `Crawl-delay: 10`; CivicPlus terms restrict automated systems and the city asserts copyright; no permission found |
| `civicplus.com` | `civicplus` | `unverified` | Returned HTTP 403 to a non-browser agent; not circumvented |
| `emma.msrb.org` | `emma` | `link-only` | Terms and permitted retrieval methods not verified |

## Adding a source

1. Read the site's terms, copyright and robots.txt; record the text and date.
2. Decide the policy value; if `allowed`, write down the basis (written permission, an explicit open licence or API terms, or Mari's recorded risk acceptance).
3. Add the entry and a row to `docs/COST_DRIVERS.md`.
4. Write the connector against saved fixtures; test with the local test site, never a live crawl.

## Connector interface (`Connector`)

`id`, `label`, `kind`, `matches(url)`, `seeds(input)`, `scopeOptions(seeds)`, `expandPage({url, depth, links})`. A connector never performs a request: the engine owns every request, so a connector cannot bypass robots, delays, caps, or the ledger.

## Phase 1 notes (2026-10-23)

- No registry entry was added or changed. `copperascovetx.gov` and `civicplus.com` remain `unverified` after the re-verification recorded in `docs/CIVICPLUS_VERIFICATION.md`.
- The **Worker enforces the same registry** (`src/discoveryProxy.js`): a blocked host gets HTTP 403 `policy-refused` from `/api/fetch` even if a caller bypasses the engine.
- A connector's `listingCalls()` is used only for hosts whose entry is explicitly `allowed`.
- **Live-source validation log** (a validation is not a registry decision: `www.archives.gov` was searched once, on a person-acknowledged basis, and has no registry entry):

| Host | When | Requests | Basis | Result |
|---|---|---|---|---|
| `www.archives.gov` | 2026-10-23 20:47 to 20:49 UTC | 8 (robots.txt, 3 pages, 1 redirect, 1 document redirect, 1 PDF) | Federal agency; site notice says Federal materials are generally public domain; no automated-access prohibition found; `Crawl-delay: 10` honored | Found: Records Management Glossary of Terms (PDF, 473,745 bytes). See `docs/DEEP_DISCOVERY_PHASE1.md` |
| `www.gao.gov` | 2026-10-23 | robots.txt only | `Crawl-delay: 420` is more than this tool waits | Not searched |
| `www.cbo.gov` | 2026-10-23 | robots.txt only | Answered 403 with a bot challenge | Not searched; not circumvented |
| `comptroller.texas.gov`, `www.govinfo.gov`, `www.federalregister.gov` | 2026-10-23 | robots.txt only | Chosen candidates; terms for automation not read | Not searched |
