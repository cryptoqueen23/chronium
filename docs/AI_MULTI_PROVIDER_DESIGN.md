# Design: Claude and ChatGPT as two optional, independent AI providers

**Status: DESIGN FOR APPROVAL. Nothing in this document is built, deployed or switched on.** Written 2026-10-26 after Mari's decision (same day): **keep both keys** (`ANTHROPIC_API_KEY` on production, `OPENAI_API_KEY` on staging), support **both** providers eventually with a **provider selection option**, each **optional** with its **own security controls, usage limits and cost protections**. This supersedes the earlier "OpenAI only, no new Anthropic work" direction in `docs/AI_OPENAI_PLAN.md`; its adapter, caps, validation and key-handling rules still apply to both.

Standing rules, unchanged: AI stays **off** until Mari approves activation and costs in writing; keeping a key is **not** authorization to use it; no paid call, key creation, rotation, deletion or overwrite without explicit permission; keys are **Worker secrets only** (never a plain variable, the extension, the PWA, the repository or browser storage); local research features never depend on AI.

## 0. Today's state (verified 2026-10-26)

| Item | State |
|---|---|
| Production `chronium-mind` | `ANTHROPIC_API_KEY` is a **Secret** (`secret_text`), preserved. Live code is the August build (unguarded AI route; shutdown patch prepared, **not deployed**, paused) |
| Staging `chronium-mind-staging` | `OPENAI_API_KEY` exists but is a **plain-text variable** (`plain_text`, value never shown), **not a Secret**; staging's secrets list is empty. Staging AI switch is `off`; the deployed staging code predates the OpenAI adapter and does not read the key |
| Repository (main) | Anthropic and OpenAI adapters, strict validation, caps, ceilings, token ceiling, latch, all with AI off by default |

## 1. Problem found in today's code: the controls are shared, not independent

Verified by reading `src/guard.js` and `src/index.js`. With one provider this is fine. With two it is not:

| Control | Today | Why it breaks independence |
|---|---|---|
| On/off switch | one `AI_ENABLED` | cannot enable one provider and keep the other off |
| Provider choice | one server variable `AI_PROVIDER` | no per-request choice |
| Per-visitor and global call ceilings | one set (`AI_PER_VISITOR_PER_DAY`, `AI_DAILY_CEILING`) | calls to either provider draw from one pool; no separate budget for the costlier provider |
| Daily token ceiling | one counter (`ai-tokens-day`) | tokens from either provider mix; the ceiling default assumes one provider's per-call worst case |
| Spend/credit latch | one flag (`ai-provider-latch`) | if OpenAI reports its spend limit reached, **Anthropic is shut for the day too** (and the reverse) |
| **Answer cache** | key = hash of prompt only | **does not include provider or model**: a cached Claude answer could be returned to a request that chose ChatGPT (or the reverse), without calling it and mislabelled |
| Usage counters | already one record per provider (`ai-usage:<id>`) | fine |
| Secrets | separate names | fine; each adapter reads only its own |

## 2. Design

### 2.1 Each provider has its own full control set (every one required before that provider can run)

For provider `P` in {`OPENAI`, `ANTHROPIC`}:

| Control | Variable (plain, not secret) | Rule |
|---|---|---|
| Provider switch | `AI_P_ENABLED` | exactly `"on"`, otherwise absent as if it did not exist (404). Also needs the master switch |
| Per-visitor calls per day | `AI_P_PER_VISITOR_PER_DAY` | whole number, required |
| Global calls per day | `AI_P_DAILY_CEILING` | whole number, required |
| Daily token ceiling | `AI_P_DAILY_TOKEN_CEILING` | default = global calls x that provider's per-call worst-case tokens; can only be lowered |
| Per-call output / evidence / body caps | `AI_P_MAX_OUTPUT_TOKENS`, `AI_P_MAX_INPUT_CHARS`, `AI_P_MAX_BODY_BYTES` | lower-only; defaults 600 / 8,000 / 256 KB for both |
| Model | `OPENAI_MODEL`, `ANTHROPIC_MODEL` | named in config, checked against a name pattern; never from the page |
| Secret | `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` | **type Secret only**; a provider is not "enabled" while its key is missing; the adapter reads only its own key |
| Spend/credit **latch** | per provider, per UTC day | OpenAI's `project_spend_limit_exceeded` (and the other listed codes) stops **OpenAI** only; the equivalent Anthropic billing errors stop **Anthropic** only |
| Usage counters, token counters, burst limiter | per provider | independent counts and independent refusal |
| **Provider-side hard limit** | OpenAI: Project settings, Limits, Spend, "Enforce a hard limit". Anthropic: a monthly spend limit on the workspace that owns the key | **required before activation**, set and seen by Mari. Neither is exact (OpenAI documents enforcement lag; Anthropic's exact behaviour is not verified), so the server-side limits above are the first line |

**Master switch and umbrella ceilings.** `AI_ENABLED` stays as the master kill switch (off means both are off). The existing `AI_DAILY_CEILING` and token ceiling become the **umbrella across both providers**, so two providers can never together exceed one overall budget; both a provider's own limit and the umbrella must allow a call.

### 2.2 Provider selection

- The page may send `provider: "openai" | "anthropic"` with an AI request. The **server decides**: the choice is valid only if that provider is fully enabled (switch on, key present, its ceilings set). Anything else is answered exactly like a route that does not exist (404), revealing nothing about the other provider.
- If the page sends nothing, the server uses `AI_DEFAULT_PROVIDER` (a plain variable) if that provider is enabled, else refuses.
- The public `/api/features` answer gains booleans only (`aiProviders: { openai: true|false, anthropic: true|false }`); no key, model or limit values. The screen shows a chooser **only when two providers are enabled**, labelled in plain words ("Claude (Anthropic)", "ChatGPT (OpenAI)") with a one-line note of **who receives the evidence text**. Each analysis is an explicit click (as now), so nothing is sent without a decision.
- The choice is a per-person preference remembered in the browser (not sensitive). It never overrides the server.
- **No automatic fail-over.** If one provider is down, limited or refused, the other is **not** tried silently: a surprise charge on a provider the person did not choose is not acceptable. The message says what happened and offers the other provider as an explicit choice.
- Every result carries its **provider and model** and is shown and saved with them ("Analysis by ChatGPT, gpt-6-luna"). The page's completeness gate (`complete: true`) applies to both.

### 2.3 The cache fix (needed before two providers can coexist)

The answer-cache key must include the **provider id, the model name and the schema/prompt version** (and the effective caps), so an answer is only ever served to a request for that same provider and model. The cache stays version-prefixed (`v3`) so older entries are never read.

### 2.4 Extension, PWA and local features

The Chrome extension and the stable personal copy have no AI code and no keys, and gain none. If AI is ever offered there, it would go through the Worker like the website, with the same server-side rules. The PWA would reuse the website's AI screen unchanged. Nothing about search, cases, evidence, export, backup or reports depends on either provider.

## 3. Tests required (all offline, with each provider replaced by a stub; no key, no spend)

1. **Independence matrix:** for each provider alone, both on, both off, one on with the other's key missing or malformed: only the enabled provider answers; the other is 404.
2. **Exhaustion independence:** exhaust provider A's per-visitor, global and token ceilings and trip its latch: provider B still answers; the umbrella still applies to the total.
3. **Cache separation:** the same prompt asked of A then B reaches B (never A's cached answer); keys differ by model and version.
4. **Selection safety:** unknown, disabled, mixed-case, injected and oversized `provider` values are refused identically; the page cannot select a provider the server has not enabled; no fail-over ever occurs.
5. **Key isolation:** the OpenAI adapter never reads `ANTHROPIC_API_KEY` and the reverse; neither key name nor value reaches a response, a log line or an error; the existing static scans (no key shapes in the repository, the extension or the website files) cover both names.
6. **Validation parity:** the strict completeness, shape and citation rules, the output caps and the truncation handling pass identically for both providers' stop reasons.
7. **Config checks:** the deploy validator rejects a provider switched on without its ceilings, a key name used as a plain variable, and any per-provider variable that is not a whole number.

## 4. Costs (worst case per call at the default caps: about 3,000 input and 600 output tokens)

| Provider and model | Price per million tokens (input / output; vendor pricing pages, 2026-10-26) | Per call | At 50 calls a day |
|---|---|---|---|
| OpenAI `gpt-6-luna` | $0.10 / $0.50 | about $0.0006 | about $0.03 a day |
| Anthropic `claude-haiku-4-5` (what the code uses) | $1 / $5 | about $0.006 | about $0.30 a day |
| Anthropic `claude-haiku-5-5` (listed on Anthropic's pricing page, not used by the code, structured-output behaviour **not verified**) | $0.10 / $0.50 | about $0.0006 | about $0.03 a day |

Caveat: on both providers the vendor-side hard limit lags and our counters are per-data-centre, so plan for a small multiple; the provider-side hard limit and the umbrella ceilings are the firm limits. Each provider's cost is tracked separately in its own usage record.

## 5. Phasing (every step needs Mari's approval; nothing starts until the extension is tested)

0. **Now:** nothing built. Mari tests the stable personal extension; then PWA planning (subject to her approval).
1. Fix the key storage: convert the staging OpenAI variable to a **Secret** (Mari's step). Keep both keys.
2. Implement section 2 locally with both providers stubbed (AI off), the cache fix first, plus the section 3 tests; review.
3. Production hygiene, separately approved: the prepared AI-off patch (paused until the question of who added the Anthropic key is resolved).
4. Staging AI measurement, one provider at a time (about 10 calls each, hard limit set first, provider's own cap verified), then a combined-ceiling test with stubs only.
5. Production activation, provider by provider, each with its own approval.

## 6. Decisions needed from Mari (none assumed)

1. Default provider when the person has not chosen: ChatGPT, Claude, or none (force a choice each time).
2. Which Worker holds which key: one Worker with both secrets (simplest for the chooser), or one provider per Worker (stronger isolation).
3. Umbrella ceilings: whether the overall daily limit is the sum of the two providers' limits or lower.
4. Whether Anthropic should stay on `claude-haiku-4-5` ($1 / $5) or be measured on a cheaper model first.
5. Whether to show cost or provider information to the person in the chooser.
6. Confirm the chooser appears only when both providers are enabled.
