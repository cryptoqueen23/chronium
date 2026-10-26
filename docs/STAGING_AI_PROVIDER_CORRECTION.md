# Staging: `AI_PROVIDER` was converted into a Secret by accident (record and correction plan)

**Status: DOCUMENTED, NOT CORRECTED.** Mari asked for the problem to be recorded and for a safe plan to be prepared; **nothing has been changed**. The plan below is **for approval** and is to be carried out **before the next staging deployment**. Written 2026-10-26. Throughout: neither API key is to be read, changed, deleted or used without Mari's explicit approval; AI stays off; production is untouched.

## 1. What happened (verified from Cloudflare's version records; types and times only, no values)

The staging Worker is `chronium-mind-staging`. Its versions, oldest first:

| Version | Time (UTC) | How | `AI_PROVIDER` | `OPENAI_API_KEY` |
|---|---|---|---|---|
| 1 to 3 | 2026-10-26 18:58 to 18:59 | Wrangler deploys from the repository | plain variable (`anthropic`, from the configuration at the time) | absent |
| 4 | 19:59:29 | dashboard edit by Mari | plain variable | added as a **plain-text variable** |
| 5 | 20:31:13 | dashboard edit by Mari | plain variable | **converted to a Secret** (the intended fix) |
| 6 | 20:32:02 | dashboard edit by Mari | **converted to a Secret** (49 seconds after version 5) | Secret |

In Mari's words, converting `AI_PROVIDER` was **accidental**: the intended change was only to turn `OPENAI_API_KEY` into a Secret. Cloudflare records the author and the source (`dash`, the dashboard) but not why; the "accident" rests on Mari's statement.

## 2. Current state and effect

Verified by `node scripts/list-worker-bindings.mjs --worker=chronium-mind-staging` (which now flags this case):

- `OPENAI_API_KEY`: **Secret**, correct. Untouched by this correction.
- `AI_PROVIDER`: **Secret**, wrong kind for a setting. The audit prints: *"a SETTING stored as a Secret (its value cannot be verified). It should be a plain variable."*
- `AI_ENABLED`, every `FEATURE_*` switch and `RATE_LIMIT_BINDING`: plain variables, unchanged; **every AI and proxy feature is off**. Production is unchanged (`60045ea5`).

**Effect today: none.** Staging AI is off, the code now deployed there does not call any provider, and nothing can spend money.

**What is unknown:** the secret's **current value**. Before the conversion it read `anthropic`; the dashboard probably carried the value over, so it most likely still says `anthropic` while the intended provider is now OpenAI. That cannot be confirmed because Cloudflare never returns a secret's value (and reading it is not wanted). So **AI must not be enabled on staging until this is corrected**: the Worker could pick the wrong provider.

**Why to correct it before the next staging deploy:**
1. **Unverified clash.** The repository's configuration declares `AI_PROVIDER` as a normal variable (`"openai"`). What Cloudflare does when a deploy supplies a plain variable named like an existing secret is **not documented anywhere I can read and was not tested**: it may refuse the deploy as a duplicate name, or silently replace one with the other. The plan removes the doubt by deleting the wrong secret first.
2. **Unverifiable setting.** A setting nobody can read cannot be checked, which defeats the point of the audit and of the validator.

## 3. The correction plan (to run only on Mari's explicit approval, before the next staging deploy)

**Goal:** `AI_PROVIDER` back to a normal **Text variable** with the value `openai`, **without** touching `OPENAI_API_KEY`.

**Pre-flight (read-only, nothing changes).** Run `node scripts/list-worker-bindings.mjs --worker=chronium-mind-staging`. Expect exactly one warning (`AI_PROVIDER` as a Secret), `OPENAI_API_KEY` as `secret_text`, every switch `off`, exit code 1. If it shows anything else, stop and report.

**Step 1: delete ONLY the secret named `AI_PROVIDER`.** Either way, the name is the only thing selected:
- *Dashboard:* open `chronium-mind-staging`, Settings, **Variables and Secrets**. In the row named `AI_PROVIDER` (type Secret) choose delete; **do not touch the row named `OPENAI_API_KEY`**; then **Deploy**.
- *Command line:* `npx wrangler secret delete AI_PROVIDER --env staging`. Per Cloudflare's documentation this creates a new version and deploys it immediately; it names the one secret to remove.

**Step 2: verify before going on (read-only).** `node scripts/list-worker-bindings.mjs --worker=chronium-mind-staging`: `AI_PROVIDER` is **gone** (no longer a Secret), `OPENAI_API_KEY` is **still `secret_text`**, `AI_ENABLED` is still `"off"`, every `FEATURE_*` is still `"off"`. (Deleting one secret by name does not alter another binding. The key's *value* cannot be read to prove it unchanged, so its integrity is proven only by the approved staging AI phase.) Wait up to a minute for the change to reach every location (staging showed 20 to 60 seconds before), then `node scripts/smoke-staging.mjs --base=https://chronium-mind-staging.truewolfflix777.workers.dev` (10 requests, every guarded route must answer 404).

**Step 3: restore `AI_PROVIDER` as a normal variable.** Preferred, because it keeps the repository as the single source of truth: the **next staging deployment**, run exactly as before (`node scripts/validate-production-config.mjs --env=staging --dry-run`, then `npm run deploy:staging`). The configuration sets `AI_PROVIDER` to `"openai"` as a plain variable. **Secrets are kept by a normal Wrangler deploy**: verified in this Worker family, where the production Worker's version 15 (a Wrangler deploy on 2026-10-23) still carries `ANTHROPIC_API_KEY` as a Secret. That deploy also ships the newer code (the OpenAI adapter, limits, validation) with **AI still off**; it needs its own approval. Alternative if a deploy is not wanted yet: in the dashboard add a variable named `AI_PROVIDER`, type **Text**, value `openai`, then Deploy.

**Step 4: verify after (read-only).** The audit exits 0 with *"No credential stored as a plain variable, and no setting stored as a Secret"*; `AI_PROVIDER` shows as `"openai"`; `OPENAI_API_KEY` is `secret_text`; every switch is `off`; the smoke test passes; production still `60045ea5`.

**If something goes wrong.** Staging is disposable and holds no cases. If `OPENAI_API_KEY` were removed by mistake, Mari re-adds it as a **Secret** (typed into the dashboard's Secret field or `wrangler secret put OPENAI_API_KEY --env staging`; never pasted into chat); if she no longer has the key she creates a new one in the OpenAI project that has the enforced hard limit.

**What this plan does not do:** read, change or use either key; enable AI; touch production, the Anthropic secret, the extension or the shutdown patch; make a paid call.

## 4. Preventing a repeat

- Run `node scripts/list-worker-bindings.mjs --worker=chronium-mind-staging` before **every** staging deployment; proceed only on exit code 0. It checks both mistakes: a credential left as a readable variable, and a setting turned into a Secret.
- In the dashboard's **Variables and Secrets** screen, convert **only** the row named `OPENAI_API_KEY` (and `ANTHROPIC_API_KEY` on production). Every other row is a setting and stays a Text variable.
- A setting that is a Secret is also invisible to the deploy validator; the audit above is the check.

## 5. Applied (2026-10-26, 20:42 to 20:44 UTC) on Mari's approval

| Step | Result |
|---|---|
| Pre-flight | Worker `chronium-mind-staging`; every switch `off` (also by the live public feature answer); `OPENAI_API_KEY` a Secret; start version `0133467d-776d-466c-a768-f820fb015f49`; the audit showed exactly the one expected warning |
| Rebuild check | The Worker code running on staging was rebuilt from its original commit (`659b91b`) in an isolated copy and is **byte-identical** to the deployed code (6,111,933 bytes, SHA-256 `ab42e2c89449def1`), so the fix needed no new code |
| Step 1: `wrangler secret delete AI_PROVIDER --env staging` | Deleted exactly that secret. New version `9c9c8338-22bd-4aa4-80f8-b9518b946a81` (20:42:56, source "Secret Change"): `AI_PROVIDER` absent, `OPENAI_API_KEY` still a Secret, 13 other bindings unchanged |
| Step 3: redeploy the identical code with `AI_PROVIDER` as a normal variable `openai` | New version **`709b15cb-7918-4e22-9753-e76935474ca1`** (20:43:39, Wrangler). Bindings: `AI_PROVIDER` plain `"openai"`, `OPENAI_API_KEY` still `secret_text`, `AI_ENABLED` and every `FEATURE_*` `"off"`, `RATE_LIMIT_BINDING` `"required"`, the three rate-limit bindings, KV and assets as before |
| Step 4: verification | Audit exits 0 ("No credential stored as a plain variable, and no setting stored as a Secret"); deployed Worker code **still byte-identical** (`ab42e2c89449def1`); public feature answer all `false`; smoke test 15 of 15 (10 requests); production untouched (`60045ea5`, later the AI-off release) |
| `OPENAI_API_KEY` | Not read, changed, rotated, deleted or used. Its value cannot be read; its integrity is proven only by the approved staging AI phase |

### One unexpected change (reported, not fixed)

The redeploy reported "**Found 50 new or modified static assets**". Cause (verified): the isolated Windows checkout wrote the text files with CRLF line endings, so **56 of the 58 static files on staging are now the CRLF versions of the same content** (the 2 images are unchanged). The pages work and the smoke test passes, but the files are not byte-identical to the committed LF originals as intended. Staging holds no cases and no one uses it. **Left as it is, as instructed.** Optional cleanup, on request: one more staging deploy from an LF-exact `git archive` export (the method used for the production releases), with `AI_PROVIDER` `"openai"`; it would restore the original bytes and touch nothing else. Lesson: deploy from clean exports, never from a Windows checkout. **Prevention now in place (2026-10-26):** `.gitattributes` pins LF; `scripts/check-deploy-tree.mjs` blocks a deploy of a tree with CRLF and runs first in `npm run deploy` and `npm run deploy:staging`; `scripts/clean-export.mjs` makes verified exports. Details and the standing rules: `docs/DEPLOYMENT_RULES.md`.
