#!/usr/bin/env node
// Read-only audit of every Worker's bindings in the Cloudflare account, by NAME and TYPE. It exists so a credential can be checked for
// without ever being displayed:
//   * a binding of type "secret_text" is a SECRET (its value cannot be read back, by anyone);
//   * a binding of type "plain_text" is a VARIABLE: its value is visible in the dashboard and is returned by the account API to any
//     tool using your login. A credential must never be one. Any plain_text binding whose name looks like a credential, or whose value
//     looks like an API key, is shown only as [REDACTED, n characters] and flagged.
// It also flags the opposite mistake: an ordinary SETTING (AI_PROVIDER, ENVIRONMENT, AI_ENABLED, FEATURE_*, RATE_LIMIT_BINDING, the model
// names ...) stored as a Secret. A secret's value cannot be read back, so the setting cannot be verified, and it can clash with the same
// name in the repository's configuration at the next deploy.
// Usage: node scripts/list-worker-bindings.mjs [--worker=<name>]   (existing Wrangler login, GET requests only; the token is never printed)
// Exit code 1 if anything is flagged, so it can be used as a check before a deploy.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const candidates = [path.join(os.homedir(), '.wrangler', 'config', 'default.toml'), path.join(process.env.APPDATA || '', 'xdg.config', '.wrangler', 'config', 'default.toml')];
const cfg = candidates.find((f) => fs.existsSync(f));
const token = cfg && /oauth_token\s*=\s*"([^"]+)"/.exec(fs.readFileSync(cfg, 'utf8'))?.[1];
if (!token) { console.error('No Wrangler login found. Run: npx wrangler login'); process.exit(2); }
const api = async (p) => (await (await fetch(`https://api.cloudflare.com/client/v4${p}`, { headers: { authorization: `Bearer ${token}` } })).json());
const only = (process.argv.find((a) => a.startsWith('--worker=')) || '').slice('--worker='.length) || null;

const NAME_LOOKS_LIKE_CREDENTIAL = /(^|_)(KEY|SECRET|TOKEN|PASSWORD|PASSWD|CREDENTIALS?|AUTH|APIKEY)(_|$)|OPENAI|ANTHROPIC|CHATGPT|GPT/i;
const VALUE_LOOKS_LIKE_KEY = /(^|[^A-Za-z0-9-])(sk-[A-Za-z0-9_-]{16,}|ghp_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{12,})/;
const suspicious = (name, value) => NAME_LOOKS_LIKE_CREDENTIAL.test(name) || (typeof value === 'string' && VALUE_LOOKS_LIKE_KEY.test(value));
// Names that are settings, not credentials: they must be plain variables (a name that is itself a key, like OPENAI_API_KEY, is not here).
const SETTING_NAME = /^(AI_PROVIDER|AI_DEFAULT_PROVIDER|AI_ENABLED|ENVIRONMENT|RATE_LIMIT_BINDING|FEATURE_[A-Z_]+|AI_[A-Z_]*(CEILING|PER_VISITOR_PER_DAY)|AI_(MAX|DAILY_TOKEN)_[A-Z_]+|LIMIT_[A-Z_]+|OPENAI_(MODEL|REASONING_EFFORT|STRUCTURED)|ANTHROPIC_MODEL)$/;

const accounts = (await api('/accounts')).result || [];
let warnings = 0;
for (const acct of accounts) {
  const scripts = (await api(`/accounts/${acct.id}/workers/scripts`)).result || [];
  for (const { id: name } of scripts) {
    if (only && name !== only) continue;
    const b = (await api(`/accounts/${acct.id}/workers/scripts/${encodeURIComponent(name)}/settings`)).result?.bindings || [];
    console.log(`\n${name}: ${b.length} bindings`);
    for (const x of b) {
      const credentialAsVariable = x.type === 'plain_text' && suspicious(x.name, x.text);
      const settingAsSecret = x.type === 'secret_text' && SETTING_NAME.test(x.name);
      if (credentialAsVariable || settingAsSecret) warnings++;
      const shown = x.type === 'plain_text' ? (credentialAsVariable ? `[REDACTED, ${String(x.text ?? '').length} characters]` : JSON.stringify(x.text)) : x.type === 'kv_namespace' ? `${String(x.namespace_id).slice(0, 8)}...` : '';
      const note = credentialAsVariable ? '   <-- WARNING: a credential-like value stored as a plain variable. Make it a SECRET.'
        : settingAsSecret ? '   <-- WARNING: a SETTING stored as a Secret (its value cannot be verified). It should be a plain variable.' : '';
      console.log(`   ${x.type.padEnd(14)} ${x.name.padEnd(30)} ${shown}${note}`);
    }
  }
}
console.log(warnings ? `\n${warnings} warning(s): see above.` : '\nNo credential stored as a plain variable, and no setting stored as a Secret.');
process.exit(warnings ? 1 : 0);
