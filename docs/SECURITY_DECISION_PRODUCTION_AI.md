# Security decision needed: the live production site can spend on paid AI without limits

**Status: DOCUMENTED, NOT CHANGED. This needs a separate decision from Mari.** Written 2026-10-26. Nothing was deployed; the production secret was not touched; no AI request was ever sent by this check.

## What is true today (verified)

| Fact | How it was verified |
|---|---|
| The production Worker `chronium-mind` has a secret named `ANTHROPIC_API_KEY` bound to it | Read-only read of the Worker's bindings through the Cloudflare API (secret value not readable) |
| The live code predates the Stage 0 protections | `GET /api/features` (a Stage 0 route) returns **404** on the live site; the live version is `60045ea5` (2026-10-23), a page-only release on the August code |
| The live code has an **unguarded** paid-AI route | `GET /api/analyze/qualitative` on the live site answers **405 Method Not Allowed** (the route exists and only allows POST). In the August source (`git show d80ef66:src/index.js`) that route has no caller check, no per-visitor limit and no daily ceiling |
| The live site publishes usage counters | `GET /api/ai/usage` answers 200 with `{"provider":"anthropic","calls":6,"inputTokens":1376,"outputTokens":1295,"errors":2,"lastUpdated":"2026-08-29T22:09:37Z"}` |
| So far use looks tiny | Those counters show 6 calls in total, all in August, about $0.01 of model cost. (They are best-effort counters and not proof; the Anthropic console is the record.) |

## What an attacker or a bug could do

Anyone on the internet can send `POST /api/analyze/qualitative` with two invented evidence items and receive a model answer paid for by your Anthropic account. The August code limits each call (about 3,000 input tokens, 1,200 output tokens, roughly **$0.009 per call** on Claude Haiku 4.5 at $1 / $5 per million tokens) and caches identical requests for 30 minutes in each data centre, but it does not limit how many different requests one person sends. Cloudflare's Free plan caps the Worker at 100,000 requests per day; if every one of those were an AI call the ceiling would be about **$900 per day** (an upper bound, not a prediction: it also needs a bot that sends varied bodies). Anthropic's own monthly spend limit, if you have set one on the workspace holding this key, is the real ceiling; **I cannot see it.**

## Options (a decision, not a recommendation to act now)

| Option | Effect | Cost / risk |
|---|---|---|
| A. Set a low monthly spend limit (for example $10) on the Anthropic workspace that owns this key, and a spend alert | Caps the worst case in money, immediately, with no code change | Done by you in the Anthropic console; AI would stop when the cap is reached |
| B. Rotate or delete the `ANTHROPIC_API_KEY` secret on the production Worker | The route then fails at once (an error, no spend). The live August site has a "Run AI analysis" button in the case workspace (an evidence-analysis feature); it would stop working and show an error until a key is set again | One Wrangler command by you or with your say-so; reversible by setting a new key. **Not done without your approval** |
| C. Release the Stage 0 website build (AI switch off, ceilings required, caller checks, 600/8,000 caps, truncation safety) | Fixes the cause: the route answers 404 until AI is deliberately enabled with ceilings | A production deploy, which also puts the one-way database upgrade in front of every visitor with saved cases (the backup prompt exists and is tested; a real-profile test at release is still required) |
| D. Do nothing | Exposure continues; observed use is six calls | Unbounded in principle, bounded in practice by A if you have set it |

Options can be combined. A is the cheapest and fastest protection and does not depend on any release. B stops the route outright. C is the real fix.

## What I did not do

No request to any AI route; no change to the production Worker, its variables or its secret; no deployment; no Anthropic console access. The key value was never read.

## Information that would help the decision

- Does the Anthropic workspace for this key have a spend limit, and what is this month's usage there?
- Whether the key is used by anything else (another project) before it is rotated.
- Whether you want AI features at all in the first public release (the current plan keeps them off).

## Update 2026-10-26: a prepared way to do option C without any database upgrade

A Worker-only "AI off" release is prepared and verified locally (branch `release/ai-off`, package `.release/ai-off-package`, verifier `scripts/verify-ai-off-release.mjs`): it changes five lines in the Worker, leaves all 16 static files byte-identical to production (proved against the live site), and so cannot upgrade anyone's saved cases. Nothing was deployed. Details, the approval-time steps, the rollback target and the suggested order (cap the Anthropic workspace, then deploy this, then delete the secret) are in `docs/AI_OPENAI_PLAN.md`, section 6. The provider going forward is OpenAI, not Anthropic.

**Final read-only review and recommendation (2026-10-26): `docs/PRODUCTION_AI_SHUTDOWN_REVIEW.md`.** Key result: the deployed Worker script is byte-identical to the production package, the patch adds two compiled lines, 16 of 16 static files stay identical, and the database cannot be upgraded by it.
