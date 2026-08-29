# Current Chronium-related project state — August 2026

## Chronium Mind
General reusable historical-web intelligence aggregator with a full
Investigation Workspace (Research → Evidence → Findings → Report) built
on top. Federates Arquivo.pt, Wayback, Common Crawl, and a Memento
aggregator, with reliability work (fallback cascades, Coverage Verdict,
in-app Archive Viewer) and the core search-to-evidence-to-report loop
both shipped as of 2026-08-28. See `docs/CLAUDE_HANDOFF.md` for the
current state in detail and `docs/ROADMAP.md` for what's next.

## Copperas Cove archive / investigation corpus
Real-world proof dataset built from city records and Wayback history
(~3,200 categorized records with archive-version metadata,
`data/copperas-cove/normalized.json`). This is Chronium's first
local/project adapter and its primary stress test for the Investigation
Workspace — real multi-page government PDFs, real bid/contract
documents, real budget figures.

## Current investigative use cases driving product design

- city budgets and financial reports
- public works and infrastructure history
- water / wastewater records
- road funding and tax history
- contracts and bids
- council/legal records
- payroll/benefits records
- deleted or changed government pages/documents
- timeline construction
- document/version comparison

These use cases should shape generic capabilities, not become hard-coded city features.

## Relationship to other apps
Chronium should remain independently useful. It may later plug into the broader Phoenix ecosystem for identity/payment, but that is not required for the current MVP and should not block development.
