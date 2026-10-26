# AI plan: OpenAI is the provider (Anthropic is retired for new work)

Decision from Mari, 2026-10-26: **OpenAI is the preferred AI provider.** No new Anthropic integrations are planned. All AI stays **OFF** until Mari approves activation and its costs. Facts below were read from OpenAI's own documentation on 2026-10-26 unless marked **secondary** (news or blog coverage) or **UNVERIFIED**.

Nothing here was deployed. No API key was created, requested, rotated or seen. No credit was bought. Production was not changed.

## 1. Where the API key goes (answer to "where do I put it")

**Nowhere yet, and never in chat.** When AI is approved, there is exactly one safe place: a **secret on the Cloudflare Worker**.

Never in: the Chrome extension, the website or PWA files, GitHub (the repository is **public**), a variable in `wrangler.jsonc`, browser storage, an email or a chat. A test (`scripts/test-openai-provider.mjs`) fails if the key name, an OpenAI address or a key-shaped string ever appears in `extension/`, `public/` or any committed file.

At activation (after your approval), in this order:
1. In the OpenAI dashboard, make a **separate project** for staging (for example "chronium-staging"). Create the API key **inside that project**; if the dashboard offers it, restrict the key to the Responses API only. Then set an **enforced hard spending limit**, not just a budget notification. OpenAI's spend-limits guide gives the path: **Project settings, Limits, Spend, Edit spend limit, enter the Monthly spend limit (proposed $5), turn on "Enforce a hard limit", Save.** A spend *alert* only notifies ("Spend alerts do not enforce a cap"); only the hard limit makes requests fail, with HTTP 429 and the code `project_spend_limit_exceeded`. Add an alert as well (for example $2.50) as an early warning. **Nothing is switched on until the toggle has been seen set.** OpenAI also warns that "enforcement is not instantaneous, so recorded spend can slightly exceed the configured amount", which is why section 5b adds limits of our own that do not depend on OpenAI's.
2. In a terminal in the project folder, run `npx wrangler secret put OPENAI_API_KEY --env staging`. Wrangler asks for the value in a **hidden prompt**: paste, press Enter. Nothing is shown or stored in your shell history. I never see it.
3. Switch AI on for staging only with the two cost ceilings (a separate approval), run the measured test (section 9), then **delete the secret** (`npx wrangler secret delete OPENAI_API_KEY --env staging`) unless you want staging AI left on.
4. Production gets its own project, its own key and its own limit, later, in a separate approval.

If a key has already been pasted anywhere (a chat, a note, a file in the project), **delete that copy and revoke the key** in the OpenAI dashboard (Security settings lists every key), and make a new one. OpenAI's own advice: revoke a possibly exposed key promptly.

## 2. Short answer to "Sign in with ChatGPT"

It exists, but **it does not fit Chronium's shape today**, and it is a limited trial for hosted apps.

| Question | Finding |
|---|---|
| Is there an official way for an app to use a person's ChatGPT plan allowance with no API key? | **Yes.** "ChatGPT plan usage" is an optional part of **Sign in with ChatGPT**, documented at developers.openai.com/siwc. Announced at DevDay 2026-09-29 (secondary), built on an identity-only beta from July (secondary) |
| Who may use it? | **Open-source and locally hosted apps**: self-serve (dynamic registration). **Commercial or remotely hosted apps**: not self-serve; "currently available to selected commercial partners through a limited trial"; everyone else completes an **interest form** (waitlist) |
| Which users? | Developer quickstart: eligible **Plus and Pro** users. OpenAI's help centre (found by search; the page itself returned 403 to me) is reported to say commercial plan usage needs **Go, Plus or Pro**. No source says Business or Enterprise are eligible; the API can answer `403 subscription_sharing_user_not_eligible` for a user, workspace or policy |
| How does it work? | OpenID Connect with PKCE in the **system browser**; the redirect is an HTTP **loopback** address on the user's own machine (`http://127.0.0.1:<port>/auth/callback`, not `localhost`); a **public client** (no secret, no API key); scopes `openid profile email` plus `offline_access resource.invoke chatgpt.tokens.use.direct` on resource `https://api.openai.com/v1`; access token 1 hour; **rotating refresh token, 30 days**; calls go to `POST https://api.openai.com/v1/responses` with `store: false` and `stream: true` |
| What it covers | **Eligible Responses API requests** with a model the account can use (listed by `GET /v1/models`). **No** ChatGPT conversations or account context. No image generation, file search, Code Interpreter, computer use or hosted MCP |
| Cost | $0 to the developer. It spends the **user's allowance**; the user sets a **weekly cap per app**, which is not reserved capacity (other ChatGPT use can exhaust the plan first). When it runs out the request fails; OpenAI "does not silently switch the request to another billing path" |
| Token storage | The documentation describes **files with owner-only permissions** (`0600`), never committed or logged, and replacing access token, expiry and rotating refresh token together after a refresh |

### Why it does not fit Chronium today

1. **The Chrome extension** (your priority): browser extensions are **not addressed** anywhere in the documentation. The only redirect allowed is a loopback address, which needs a small program listening on your computer. An extension cannot do that alone; it would need a helper installed outside Chrome (a "native messaging" program). That is a new piece of software to build, install and keep safe, and refresh tokens (valid 30 days, rotating) would have to be stored somewhere protected; browser storage is exactly what you ruled out.
2. **The website/PWA on Cloudflare** is a **remotely hosted** app. That is the commercial category: interest form, limited trial, no guarantee.
3. **It needs accounts.** Plan usage works per user with refresh tokens, so a hosted Chronium would have to hold a sign-in and a protected token for every user. That conflicts with the current rules (local-first, no accounts, no paid infrastructure).
4. **The repository is public but has no licence file**, so it is not open-source in the legal sense; the self-serve category says "open-source". Adding a licence would be a business decision for you, not a technical fix.

### What is possible later (not started)

- **Personal use only, locally:** a small helper on your own computer that signs in once and calls OpenAI with your plan, with the extension asking the helper. Real work (a helper, token protection, an installer) for one user; only worth it if API costs are an issue, which the numbers below say they are not.
- **Public use:** submit the **interest form** (https://openai.com/form/sign-in-with-chatgpt-interest/) and wait. That is an outward-facing step and is **yours to take**; I have not submitted anything.
- The code is ready for it in one respect: AI providers are adapters behind one interface (`src/ai/provider.js`), so a plan-usage adapter could be added later without touching the strict validation, caps or ceilings.

## 3. Comparison

| | **Sign in with ChatGPT (plan usage)** | **OpenAI API with a key on the Worker** |
|---|---|---|
| Who pays | The user's ChatGPT plan allowance (weekly cap they set) | You, per use, from the project's balance |
| Needs an API key | No | Yes (a Worker secret) |
| Eligibility | Users on Plus/Pro (maybe Go); not Free; Business/Enterprise unconfirmed | Anyone, including people with no ChatGPT plan |
| App eligibility | Open-source/local: self-serve. Hosted/commercial: invitation (limited trial) | Any app; you own the account and its terms |
| Fits the Chrome extension | Not without a separate local helper; extensions not addressed | Yes, through the Worker (the extension never holds a key) |
| Fits the PWA/website | Hosted app: invitation only; needs per-user accounts and token storage | Yes |
| Implementation work | Large: OAuth/PKCE, loopback helper, protected token storage, host IDs, refresh, revocation, streaming, usage-limit errors | **Done locally**: adapter, schemas, validation, tests (321 pass). Needs the secret and staging measurement |
| Controls | User's weekly cap (not ours), OpenAI's availability rules | Our ceilings (per visitor, global per day), 600/8,000 caps, **OpenAI project hard limit** |
| Predictability | Can stop at any time for a user (plan exhausted, cap, ineligible) | Predictable; stops only at your limit |
| Privacy | `store:false`; plan usage does not expose conversations | `store:false`; no training by default; abuse logs up to 30 days unless approved for zero retention |
| Cost to you | $0 | See section 4 (cents per day at the proposed ceilings) |
| Risk to keep out of Chronium | Per-user refresh tokens | One secret on the Worker |

**Recommendation:** use the **API path** now (it is built and tested locally), keep sign-in as a documented later option, and decide on the interest form separately.

## 4. Models and costs (OpenAI pricing page, standard tier, per million tokens, 2026-10-26)

| Model | Input | Output | Notes |
|---|---|---|---|
| **gpt-6-luna** (proposed default) | $0.10 | $0.50 | "Our most efficient model for focused, high-volume tasks"; reasoning effort `none` supported |
| gpt-6.1-terra | $1.00 | $5.00 | has its own page on OpenAI's models site and is on the pricing page (2026-10-26): Responses API, structured outputs and `none` supported, default effort `medium`. **Not assumed to be available to your account**: only a call to `GET /v1/models` with your key can show which models you may use, and that waits for approval. Only a candidate if Luna fails |
| gpt-6.1-sol | $2.00 | $10.00 | does **not** support `none`; would need a higher output cap |
| gpt-6-astra | $10.00 | $50.00 | flagship; not for this job |
| gpt-5-nano | $0.05 | $0.40 | older; secondary sources say its dated snapshot is scheduled to shut down 2026-12-11 (**UNVERIFIED**); not chosen |

**Worst case per call at our caps** (8,000 evidence characters plus prompt, about 3,000 input tokens; 600 output tokens):

| Model | Per call | At staging ceilings (10 per day) | At first production ceilings (50 per day) |
|---|---|---|---|
| gpt-6-luna | about $0.0006 | $0.006 per day | $0.03 per day (about $0.90 per 30 days) |
| gpt-6.1-terra | about $0.006 | $0.06 per day | $0.30 per day (about $9 per 30 days) |

The counters are loose across data centres (plan for about 3×), so the firm ceiling is the **OpenAI project hard spend limit**. The earlier plan (Anthropic Haiku 4.5, about $0.006 per call) is withdrawn; Luna is roughly ten times cheaper for the same caps.

## 5. API design (built locally, AI off)

- **Adapter:** `src/ai/openai.js`, registered as the default provider (`AI_PROVIDER` is `openai`). One non-streaming `POST https://api.openai.com/v1/responses`.
- **Request:** `store: false`; `max_output_tokens` = the Worker's cap (600); `reasoning.effort: "none"`; `text.format` = strict JSON Schema (`src/ai/schemas.js`, matched to the validators); `instructions` = system prompt, `input` = the evidence; `safety_identifier` = a one-way SHA-256 of the visitor (never the address) so one visitor's abuse cannot get the whole account throttled; no tools, no stored conversation.
- **Why reasoning effort `none`:** OpenAI's reasoning models count hidden reasoning tokens against `max_output_tokens`, and the Luna default is `medium`. With a 600-token cap that could leave **nothing** for the answer ("incomplete" before any text). `none` avoids that; if a model that does not accept `none` is chosen, OpenAI answers 400 and the call is refused, never silently widened. Do not raise effort without raising the cap, which needs an approved code change and measured evidence.
- **Reading the answer:** `completed` is the only finished state; `incomplete / max_output_tokens` is truncated (even with partial text, even with no text); a `refusal` part or `content_filter` is a refusal; anything else is unknown. These feed the same strict validator as before (`src/aiResult.js`): exact JSON, exact fields, every citation must be an id this request sent, nothing repaired, nothing cached unless complete, the page refuses anything not marked complete.
- **Errors never carry OpenAI's text** (an error body can echo part of a key): only the HTTP status and OpenAI's short code reach logs; users see a generic refusal.
- **Unchanged protections:** the AI switch and both cost ceilings (the route is 404 without them), caller check, 600 output tokens, 8,000 evidence characters, 256 KB body, per-visitor and global daily ceilings, burst limiter, local-first features untouched. **Nothing in Search, Compare, My Research, Reports, export, backup or the personal extension depends on AI.**
- **Configuration (plain variables, none secret):** `OPENAI_MODEL` (default `gpt-6-luna`), `OPENAI_REASONING_EFFORT` (default `none`), `OPENAI_STRUCTURED` (`off` omits the schema; validation still decides).
- **Tests:** `scripts/test-openai-provider.mjs` (14), plus `scripts/test-ai-limits.mjs` (9, section 5b): request shape, every response state, error-text hygiene, the key only in the Authorization header, registry default, end to end through the real Worker with OpenAI stubbed (capped, unstored, hashed visitor; truncated, reasoning-exhausted, refused, unfinished, empty, wrong-JSON and bad-citation answers all refused), and static scans proving no key or OpenAI address in `extension/` or `public/` and no key-shaped string committed.

### Compatibility checked against OpenAI's current documentation (2026-10-26)

| Question | Finding | Source |
|---|---|---|
| Does `gpt-6-luna` exist, and under what name? | Yes: model id `gpt-6-luna`, a single snapshot that is also the default. "Our most efficient model for focused, high-volume tasks." Text and image input, text output; 1,050,000-token context, 128,000 maximum output; knowledge cutoff 2026-05-18; no deprecation notice | its model page |
| Responses API | **Supported** (also Chat Completions and Batch) | its model page |
| Strict structured outputs | **Supported** (listed with streaming, function calling, file search, image input, web search, prompt caching) | its model page |
| Reasoning settings | `reasoning.effort` accepts `none`, `low`, `medium` (**the default**), `high`, `xhigh`, `max`. So the default would spend the cap on hidden reasoning, and **our explicit `none` is required**, as built | its model page and the reasoning guide |
| Reasoning tokens versus the cap | They count against `max_output_tokens`; if they use it all the response is `incomplete` with `incomplete_details.reason` `max_output_tokens`, possibly with no visible text | reasoning guide |
| Request fields used | `model`, `instructions`, `input` (a string is accepted), `max_output_tokens`, `store`, `reasoning`, `text.format` (`type: json_schema`, `name`, `strict: true`, `schema`), `safety_identifier` | text, structured-outputs, data-controls and safety guides |
| Response fields used | `output` (an array; text is in message items' `output_text` parts, a refusal in a `refusal` part), `status` (`incomplete` with a reason when cut off), `usage.input_tokens` / `output_tokens` | text, structured-outputs and reasoning guides |
| Schema rules | Root must be an object; every property `required`; `additionalProperties: false`; at most 10 levels and 5,000 properties; no `allOf`, `not`, `if/then/else`. Our two schemas satisfy all of it, and a test asserts it | structured-outputs guide |
| Limits for a new account | Build tier (after $5 of credit purchases): 5,000 requests and 2,000,000 tokens per minute for this model; far above anything planned | its model page, rate-limits guide |
| `gpt-6.1-terra` | Documented on its own page; availability to your account unknown until `GET /v1/models` is called with a key | its model page |

**Still UNVERIFIED (cannot be settled without a key and an approved staging run):** that strict `json_schema` and `reasoning.effort: none` work *together* on `gpt-6-luna` (each is documented as supported; the combination is not stated); that its answers follow the schema, cite correctly and rarely hit the 600-token cap; that your account can use the model and has credit; the real behaviour of the hard limit's `429`. The measurement plan is in section 9.

## 5b. Independent server-side limits (built locally; they do not rely on OpenAI's own limits)

OpenAI's hard spend limit is a real ceiling but, by its own documentation, enforcement lags, so spend can slightly overshoot. Our Worker therefore enforces its own limits **before any call is made**, and every one fails closed if its storage is unavailable:

| Limit | Enforced where | Default | Can be |
|---|---|---|---|
| AI switch and both call ceilings (otherwise the route answers 404) | Worker | off | lowered or turned on only deliberately |
| Per visitor per day (requests) | Worker | set by `AI_PER_VISITOR_PER_DAY` | required |
| Global per day (requests) | Worker | set by `AI_DAILY_CEILING` | required |
| Burst per minute per visitor, and the Rate Limiting binding on staging | Worker | 6 per minute | lowered |
| Per-call output tokens | Worker (sent to OpenAI as `max_output_tokens`) | 600 | lowered only |
| Per-call evidence text | Worker | 8,000 characters | lowered only |
| Request body | Worker | 256 KB | lowered only |
| **Daily token ceiling (new)** | Worker, counted from the token usage OpenAI reports for every call (including calls that were cut off or refused) | global calls per day x 4,000 tokens | lowered only (`AI_DAILY_TOKEN_CEILING`) |
| **Provider latch (new)** | Worker: when OpenAI answers `project_spend_limit_exceeded`, `organization_spend_limit_exceeded`, `insufficient_quota`, `credit_balance_exhausted` or `organization_usage_limit_exceeded`, no further call is made to OpenAI for the rest of the UTC day | automatic | n/a |
| Hard spend limit | OpenAI (project) | you set it | by you |

Honest limits of our own counters: they live in Cloudflare's per-data-centre cache and are not atomic, so a burst across data centres can overshoot by a small multiple; that is why the OpenAI hard limit and the call ceilings are *both* required before activation. Tests: `scripts/test-ai-limits.mjs` (9): the token ceiling stops the next call before it reaches the provider; cut-off, refused and malformed calls still count; the ceiling is per UTC day; each spend/credit code latches and ordinary rate limits and server errors do not; refused requests use no visitor allowance; broken storage fails closed.

## 5c. Activation checklist (nothing is switched on until every line is ticked and Mari approves in writing)

1. OpenAI project created for staging; **hard spend limit enforced** (Project settings, Limits, Spend, "Enforce a hard limit" on), alert set, key created in that project and restricted if offered.
2. `OPENAI_API_KEY` set by Mari as a staging Worker secret (hidden prompt). No other copy exists.
3. Staging redeployed with `AI_PROVIDER=openai`, `AI_ENABLED=on`, the three ceilings set (proposed 3 per visitor, 10 calls and the derived 40,000 tokens per day), caps unchanged.
4. Ten measured calls (section 9) with the limit and usage page watched; report; then the secret is deleted or AI is switched off again.
5. Production later, with its own project, key, limit and approval.

## 6. The production Anthropic integration, and how to switch it off without touching anyone's saved cases

What is live (verified read-only; the deployed script was downloaded and read): Worker version `60045ea5`, the August code. `POST /api/analyze/qualitative` is **unguarded** (no caller check, no per-visitor or daily limit), uses **claude-haiku-4-5**, `max_tokens` 1,200, 12,000 input characters, and a secret `ANTHROPIC_API_KEY` is bound. `GET /api/ai/usage` is public (6 calls ever). The live front end is **IndexedDB version 4 with no upgrade guard**, and contains a "Run AI analysis" button.

**The constraint:** any deploy from `main` ships a new front end (database version 12). Visitors with saved cases would hit the one-way upgrade. So production AI must be switched off **without deploying `main`**.

| Option | What changes | Database upgrade? | Approval needed |
|---|---|---|---|
| **A. Cap the Anthropic workspace** that owns the key (console: a low monthly limit, an alert) | Nothing in Cloudflare | **No** | yours, in the Anthropic console |
| **B. Delete the `ANTHROPIC_API_KEY` secret** (`wrangler secret delete ANTHROPIC_API_KEY`, production) | The route stays but cannot spend; the button shows "AI analysis is temporarily unavailable" | **No** (no file changes) | yes (it modifies production) |
| **C-lite. Deploy the prepared Worker-only "AI off" release** (below) | The two AI routes answer 404 unless `AI_ENABLED` is `on` | **No** (front-end files byte-identical, proven) | yes (a production deploy) |
| D. Deploy `main` (Stage 0 release) | Everything, including the front end | **Yes** (guarded, with a backup prompt) | a full release approval |

**C-lite is prepared and tested locally; nothing was deployed. The final read-only review (evidence, route-by-route comparison, why the database cannot be upgraded, exact deploy and rollback commands) is `docs/PRODUCTION_AI_SHUTDOWN_REVIEW.md`.**
- Branch `release/ai-off` (commit `1575301`, on top of the exact production release commit `244a9d3`), exported LF-exact to `.release/ai-off-package`. It differs from the production package in **one file, five lines in `src/index.js`**; `public/` and `wrangler.jsonc` are identical.
- Verifier: `scripts/verify-ai-off-release.mjs`. Against **production now** (`--expect=before`): all **16 static files byte-identical**, the front end still opens the database at version 4, no `boot.js`/`upgrade.js`, other routes unchanged, `/api/ai/usage` 200, `/api/analyze/qualitative` 405. Against the package running locally (`--expect=after`): the same 16 files identical, both AI routes **404**. Turning the switch on locally (`AI_ENABLED:on`) restores the route (answering "add at least 2 evidence items" without any model call). Read-only GETs only; no POST is ever sent to production.
- Approval-time steps (not run): `cd .release\ai-off-package`, `npx wrangler deploy` (expect no new assets uploaded), then the verifier with `--expect=after` against production; rollback `npx wrangler rollback 60045ea5-992c-499e-8290-a8ef08572667`.
- Side effects to accept: the live "Run AI analysis" button will show the plain text `not-available` instead of an analysis (the old page shows the server's error code); `/api/ai/usage` stops answering. The Anthropic secret stays bound but unused until you choose B.
- **Suggested order for your decision:** A now (no deploy), then C-lite (stops the open route), then B (removes the secret). All three avoid the database upgrade.

## 7. What is not part of this change

- The staging Worker still has `AI_PROVIDER` set to `anthropic` in its deployed variables; AI is off there and no key is bound. Redeploying staging with `openai` needs your approval.
- No OpenAI secret, project, key or credit exists. No interest form was submitted.
- The Chrome extension and the stable personal copy have no AI code and no key; they are unchanged by this work.

## 8. Decisions needed from Mari

1. Approve the **API path** with OpenAI as the default, `gpt-6-luna` as the first model to measure.
2. For production exposure: which of A, B, C-lite (any combination) and when. None is done.
3. Whether to take the **interest form** step for Sign in with ChatGPT (outward-facing, yours), and whether a legal open-source licence for the repository is wanted.
4. When to run the **staging AI phase** (section 9): create the OpenAI project with a $5 hard limit, set the staging secret yourself, approve the ceilings (proposed 3 per visitor and 10 global per day on staging).

## 9. Staging AI measurement plan (not started; needs your approval)

Ten calls at most, all through the real staging Worker with the real adapter: five analysis calls and five ask-sources calls on small made-up evidence (no real research, no real people). Record for each: HTTP result, stop reason, whether strict JSON validation passed, whether every citation was a sent id, input and output tokens, reasoning tokens (expected 0), latency, and cost from the OpenAI usage page. Success: every answer complete and valid, no truncation, cost at or below $0.001 per call on Luna. If Luna fails (schema rejected, bad citations), try Terra with the same ten calls before deciding; the output cap is raised only if measured calls hit it, and only by an approved edit. Afterwards: delete the secret, confirm AI is off, report.
