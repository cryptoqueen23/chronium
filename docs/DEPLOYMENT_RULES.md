# Deployment rules (Windows line endings, clean exports, preflight)

Written 2026-10-26 after the staging incident described in `docs/STAGING_AI_PROVIDER_CORRECTION.md` section 5. These are binding for every deployment of Chronium Mind, by anyone, including assistant sessions.

## Why this exists

Git on this computer is configured with `core.autocrlf=true` (Git for Windows' default). Any checkout, reset or `git worktree` therefore rewrites text files with Windows line endings (CRLF), while the repository stores LF. Wrangler hashes the exact bytes of every static file, so a CRLF rewrite silently changes what the website serves: on 2026-10-26 a staging redeploy from an isolated worktree re-uploaded 50 static files and left 56 of 58 served as CRLF. Production was never affected, because production releases were already deployed from `git archive` exports. Python scripts that save files in text mode on Windows also write CRLF; that was caught and fixed the same day.

## The three locks now in place

1. **`.gitattributes`** pins `text=auto eol=lf` (binary files excluded), so every checkout, reset and worktree writes LF whatever the global setting. The repository's stored content did not change (verified: a full renormalization stages nothing).
2. **`scripts/check-deploy-tree.mjs`** refuses to continue if any deployed text file (`public/`, `src/`, `wrangler.jsonc`, `package.json`) contains a carriage return. `npm run deploy` and `npm run deploy:staging` run it **first**, then the config validator, then Wrangler. The stable-extension builder (`scripts/make-personal-extension.mjs`) also refuses a CRLF `extension/` folder.
3. **`scripts/clean-export.mjs <commit> <empty-folder>`** makes a clean export: each file written straight from the bytes Git stores for that commit (no conversion, no untracked file, no `.git`), then re-read and checked against the stored object id, with a record in `EXPORT.json`. It reproduces the existing production package exactly (verified).

## Rules

- **Production and staging releases are deployed only from a clean export** of a named commit or branch (`node scripts/clean-export.mjs release/ai-off .release/ai-off-package`), or from the main folder via `npm run deploy` / `npm run deploy:staging`, which run the guard. **Never from `git worktree add`, a `git checkout` of an old commit, or a zip a person unpacked.**
- **Before** any deploy: confirm the target Worker and environment, run `node scripts/list-worker-bindings.mjs --worker=<name>` (must exit 0 on staging and production before and after), compare the deployed Worker module with the compiled package where one exists, and keep the version id you can roll back to.
- **During**: read the deploy output. **"Found N new or modified static assets" for a release that is not supposed to change files is a stop sign**: roll back or investigate before anything else.
- **After**: wait for propagation (20 to 60 seconds was seen; poll until the new state answers consistently), then run the verifier for that release against the live site, and check the version list.
- **Never** edit `public/`, `src/`, `extension/`, `wrangler.jsonc` or `package.json` with a tool that rewrites line endings. If a script must edit them, open and write the file in binary or with `newline=''`, then run `node scripts/check-deploy-tree.mjs`.
- Secrets stay Secrets and settings stay plain variables (`list-worker-bindings.mjs` checks both). No key is ever read, printed or committed.
