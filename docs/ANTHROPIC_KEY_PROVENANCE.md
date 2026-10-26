# How did `ANTHROPIC_API_KEY` get onto the production Worker? (read-only investigation, 2026-10-26)

Question from Mari: she says she never personally added an Anthropic API key to Cloudflare. This document records only what was **verified**, and what is **unknown**. Method: read-only requests to Cloudflare's account API (GET only, using the existing Wrangler login), the repository's git history, and the assistant's own local notes. **No secret value was read, revealed, exported or tested** (Cloudflare does not return secret values), **no Anthropic request was made**, nothing was changed, and **the AI-off deployment is paused** (prepared, not deployed). Mari has said she will leave both the Anthropic and OpenAI keys in place for now; nothing was deleted or rotated.

## 1. Verified: the binding

| Fact | Evidence |
|---|---|
| The production Worker `chronium-mind` has a binding named `ANTHROPIC_API_KEY`, of type **`secret_text`** (a Secret, not a visible variable) | Cloudflare's "list secrets" and settings endpoints, 2026-10-26 |
| It is the **only** secret on that Worker | same |
| It has been present, unchanged in type, in every version since it first appeared | version details, section 2 |

## 2. Verified: when it was added, and what Cloudflare records about how

The Worker was created **2026-08-28 18:43:48 UTC**. Its complete retained history is **15 versions and 15 deployments** (all of them; the default listing shows only the newest 10, so the full list was read).

| Version | Time (UTC) | Triggered by | Has the secret? |
|---|---|---|---|
| 1 | 08-28 18:44:12 | upload | no |
| 2 to 12 | 08-28 18:51 to 20:07 | version upload | no |
| 13 (`e1823ee4`) | 08-28 20:55:06 | version upload (adds the `AI_PROVIDER` variable) | no |
| **14 (`799e564e`)** | **08-28 21:18:47** (**16:18:47 US Central**) | **`secret`** | **yes: first appearance** |
| 15 (`60045ea5`) | 10-23 22:54:14 | version upload (the page-only release) | yes (unchanged) |

- **Exactly one event in the Worker's entire history changed a secret**: version 14 / deployment `21f30487`, "triggered by secret", about 23 minutes after the `AI_PROVIDER` variable was deployed. No secret change before or since.
- Every version and deployment, including that one, carries **`source = wrangler`** and **`author = marimercruz8@gmail.com`**.

## 3. What that does and does not establish about who

**Establishes:** the secret was set through the **Wrangler command line** (not the dashboard) while authenticated as the Cloudflare user `marimercruz8@gmail.com` (a login session or an API token belonging to that user).

**Does not establish, and Cloudflare does not say in anything I can read:**
- *which person* ran it, or which computer, network address or terminal;
- whether it was typed by hand or run by a tool. Any program that uses the Wrangler login on that computer (an assistant session, a script) is recorded **under the same email**, so the record cannot tell Mari's own typing from an assistant's command;
- which Anthropic key was stored (the value is unreadable by design).

The account **audit log**, which usually records the actor, the address and the kind of credential for such an event, answered **403 (not permitted)** to the Wrangler login, so I could not read it. **Mari can**: Cloudflare dashboard, account home, **Audit Log**; look at **28 August 2026, about 21:18 UTC (16:18 Central)** for a Workers secret entry and read its actor, IP address and authentication method. Whether the log still holds that date is not verified.

## 4. Verified: what the repository and the assistant's notes say

| Evidence | What it says |
|---|---|
| Repository code at the deployed commit `d80ef66` (2026-08-28 16:00 Central) | The code and its comments tell *the operator* to run `wrangler secret put ANTHROPIC_API_KEY`; no key value exists anywhere in the repository or its history (all 77 commits on every branch were searched, text conversion off so no file was skipped: the only key-shaped strings are three obvious fakes inside test files added in October, and no `.env` or `.dev.vars` file was ever committed) |
| The assistant's own handoff note for that day (written **2026-08-28 16:02 Central**, about 16 minutes **before** the secret appears) | "OPEN: no API key configured yet. Mari is adding it herself (never pasted into chat, never in repo/client code) — she needs to run, from the chronium repo locally: `wrangler secret put ANTHROPIC_API_KEY` and paste her Anthropic API key when prompted." It also records that, until then, the analysis feature failed cleanly (checked by `curl` and in a browser) |
| Repository commit `3d9f381` (2026-08-29 18:32 Central, git author name `cryptoqueen23`) | A later session wrote that `wrangler secret list` "shows `ANTHROPIC_API_KEY` already set on the deployed Worker", and that **it used the production secret for real**: it ran `wrangler dev --remote` (real Cloudflare secrets) and called `/api/analyze/qualitative` with synthetic evidence, got "a real 200 from Anthropic" with the Haiku model, then drove the page's "Run AI analysis" button with a browser test. It says the user had asked it to confirm the feature works |
| Local assistant session transcripts from 28 and 29 August | **Not available**: the only transcripts on this computer are from October (3 files). Wrangler's own command logs on this computer start on 2026-10-22. So the actual command that set the secret is **not recorded anywhere I can read** |

So the only written account of *intent* is that **Mari was asked to set it herself**; there is **no record that she did**, and **no record that an assistant did**. There is a record that an assistant session **used** the already-present secret for real Anthropic calls the next day. The git author name on commits is just the account's identity on that computer, shared by any assistant session working there; it is not evidence of who ran a particular command.

## 5. The "six historical calls": what they do and do not establish

Source of the number: `GET /api/ai/usage` on the live site returns the Worker's own counter, stored in its KV namespace under `ai-usage:anthropic`: **calls 6, errors 2, input tokens 1,376, output tokens 1,295, last updated 2026-08-29 22:09:37 UTC** (17:09 Central).

How the deployed code writes it (read from the deployed source, which is byte-identical to the repository's production package):
- After the model call **returns**, it adds `calls +1` and the input and output token counts **that the provider reported in its answer**.
- If the call **throws** for any reason (including "no key is set", a rejected key, or a network failure), it adds `calls +1` and `errors +1` with zero tokens.
- The write is read-modify-write, "best effort" (a failure is silently ignored), so two simultaneous calls can be undercounted.

What this **establishes**, if the counter is accurate: on six occasions the Worker attempted a model call; on four of them it received an answer carrying token counts (about 344 input and 324 output tokens per call on average, i.e. small synthetic requests), and on two it failed. Token counts of that kind come from the provider's response, so at least some answers came back from a working endpoint. The last recorded attempt (17:09 Central, 29 August) falls inside the window the 29 August note describes (after the 16:12 push, before the 18:32 note). The two recorded errors are *consistent with* the two pre-key tests the 28 August note describes, and the four successes with the 29 August verification, but that is a fit, not a proof.

What it **does not establish**:
- **It is not Anthropic's record.** The counter is the application's own bookkeeping; only the Anthropic Console shows what Anthropic received and billed for that key.
- **It does not show who or what made the calls**, or from where. A `wrangler dev --remote` session writes to the same production KV, so developer testing and real visitors look identical.
- **It cannot show use that bypassed it**: calls made with the same key from anywhere else (another project, a local program, anyone who obtained the key) would not touch this counter.
- It can be edited by anyone with write access to that KV namespace.
- Taken at face value the recorded tokens would cost well under one cent (at the pricing used for this model: about $1 per million input tokens and $5 per million output tokens: roughly $0.008). That figure is an estimate from the counter, not a bill.

## 6. What remains unknown (and who can find out)

| Unknown | Who/where it can be answered |
|---|---|
| Who ran `wrangler secret put` on 2026-08-28 at 16:18 Central, and from which computer | **Cloudflare Audit Log** (Mari, dashboard); not readable through the Wrangler login |
| Whose Anthropic key it is, when that key was created, by whom, and its **last-used date** | **Anthropic Console, API keys page** (Mari). Compare "created" and "last used" with 28 to 29 August |
| What Anthropic actually received and billed for that key, and whether anything happened that the counter did not record | **Anthropic Console usage and billing** for 28 August to now |
| Whether the same key is used by other projects | Mari (and the Console's usage by key or workspace) |
| Whether anyone other than Mari has access to her Cloudflare login or API tokens | Cloudflare dashboard: profile, **API Tokens**, and account **Members**; and the Audit Log's authentication-method column |

Nothing verified so far points to misuse: the counter is small and falls inside documented testing. But **nothing verified rules it out either**, because the counter is not an independent record. The Anthropic Console is the check that settles it. Mari has said she will review spending controls in her Anthropic account; the "created", "last used" and per-day usage columns for 28 to 29 August (and since) are the two things to look at.

## 7. Status of other work

- The production AI shutdown (`release/ai-off`, verified locally) stays **prepared and undeployed**, paused until this question is resolved, as requested.
- The Anthropic secret and key are **untouched**. The OpenAI key on the staging Worker is also untouched; note it is stored as a plain-text variable (see `docs/PRODUCTION_AI_SHUTDOWN_REVIEW.md` section 12), which stays readable in the dashboard and by the account API until it is re-added as a Secret.
