#!/usr/bin/env node
// Refuses to let an unsafe configuration be deployed. Checks wrangler.jsonc, and (with --dry-run) the variables that
// wrangler itself reports it would deploy, so a `--var` typed on a command line is caught too.
//
//   node scripts/validate-production-config.mjs [--env=staging] [--dry-run] [--allow-on=FEATURE_VIEW_CAPTURE,...]
//
// Rules (docs/STAGE0_SECURITY.md):
//  - ENVIRONMENT is set ("production" at the top level, "staging" in the staging block).
//  - No test-only variable appears anywhere.
//  - Every guarded feature switch is present and is "off" unless named in --allow-on (a deliberate, recorded choice).
//  - Paid AI may be "on" only with both cost ceilings set to whole numbers.
//  - Staging has its own Worker name, its own KV namespace (not a placeholder, not production's), and no production id.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { FEATURE_VARS, TEST_ONLY_VARS } from '../src/guard.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function parseJsonc(text) {
  let out = ''; let inStr = false; let esc = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]; const n = text[i + 1];
    if (inStr) { out += c; if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') { inStr = true; out += c; continue; }
    if (c === '/' && n === '/') { while (i < text.length && text[i] !== '\n') i++; out += '\n'; continue; }
    if (c === '/' && n === '*') { i += 2; while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++; i++; continue; }
    out += c;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}

const isWhole = (v) => /^[1-9]\d*$/.test(String(v));

/** Returns a list of problems (empty = safe). `vars` may be supplied separately (for example from a dry run). */
export function validateConfig(config, { env = null, vars = null, allowOn = [] } = {}) {
  const problems = [];
  const block = env ? config.env?.[env] : config;
  if (!block) return [`there is no "${env}" environment in the configuration`];
  const v = vars || { ...(env ? {} : {}), ...(block.vars || {}) };
  const expectEnvironment = env ? 'staging' : 'production';
  if (v.ENVIRONMENT !== expectEnvironment) problems.push(`ENVIRONMENT must be "${expectEnvironment}" (found ${JSON.stringify(v.ENVIRONMENT)})`);
  for (const name of Object.keys(v)) if (TEST_ONLY_VARS.includes(name)) problems.push(`test-only variable ${name} must not be deployed`);
  for (const [feature, name] of Object.entries(FEATURE_VARS)) {
    const value = v[name];
    if (value === undefined) { problems.push(`${name} is not set (every switch must be written down; "off" is the safe value)`); continue; }
    if (value !== 'on' && value !== 'off') problems.push(`${name} must be exactly "on" or "off" (found ${JSON.stringify(value)})`);
    if (value === 'on' && !allowOn.includes(name)) problems.push(`${name} is "on" but was not named with --allow-on; turning a feature on must be a deliberate, recorded choice`);
    void feature;
  }
  if (v.FEATURE_VIEW_CAPTURE === 'on') problems.push('FEATURE_VIEW_CAPTURE cannot be deployed "on" anywhere public: archived pages must first be served from their own separate origin (docs/STAGE1_STAGING_PROPOSAL.md section 7); --allow-on does not override this');
  if (v.AI_ENABLED === 'on' || v.FEATURE_ASK_SOURCES === 'on') {
    if (!isWhole(v.AI_PER_VISITOR_PER_DAY) || !isWhole(v.AI_DAILY_CEILING)) problems.push('paid AI cannot be on without AI_PER_VISITOR_PER_DAY and AI_DAILY_CEILING set to whole numbers');
    if (v.FEATURE_ASK_SOURCES === 'on' && v.AI_ENABLED !== 'on') problems.push('FEATURE_ASK_SOURCES needs AI_ENABLED to be on as well');
  }
  for (const name of Object.keys(v)) if (/^LIMIT_/.test(name) && !isWhole(v[name])) problems.push(`${name} must be a whole number`);
  if (!block.name && !env) problems.push('the Worker has no name');
  if (!config.compatibility_date) problems.push('compatibility_date is missing');
  if (!(config.assets?.run_worker_first || []).includes('/api/*')) problems.push('assets.run_worker_first must include "/api/*" so the Worker sees every API request');
  // Rate Limiting binding: staging must require it and declare every binding it needs; production must not use it yet.
  const rl = block.ratelimits || [];
  if (env) {
    if (v.RATE_LIMIT_BINDING !== 'required') problems.push('staging must set RATE_LIMIT_BINDING to "required" so the burst limiter fails closed');
    for (const name of ['RL_FETCH', 'RL_VIEWCAPTURE', 'RL_AI']) {
      const b = rl.find((x) => x.name === name);
      if (!b) { problems.push(`staging has no ratelimits binding named ${name}`); continue; }
      if (!isWhole(b.namespace_id)) problems.push(`${name}: namespace_id must be a positive whole number written as a string`);
      if (![10, 60].includes(b.simple?.period)) problems.push(`${name}: period must be 10 or 60`);
      if (!Number.isInteger(b.simple?.limit) || b.simple.limit < 1) problems.push(`${name}: limit must be a positive whole number`);
    }
    const ids = rl.map((x) => x.namespace_id); if (new Set(ids).size !== ids.length) problems.push('ratelimits namespace_id values must be unique');
    if (ids.some((id) => (config.ratelimits || []).some((x) => x.namespace_id === id))) problems.push('staging reuses a production ratelimits namespace_id');
  } else {
    if (rl.length || v.RATE_LIMIT_BINDING !== undefined) problems.push('production must not use the Rate Limiting binding yet (it is staging-only until measured)');
  }
  if (env) {
    const prodName = config.name; const prodKv = (config.kv_namespaces || []).map((k) => k.id);
    if (!block.name || block.name === prodName) problems.push('staging must be a separate Worker with its own name');
    const kv = block.kv_namespaces || [];
    if (!kv.length) problems.push('staging has no KV namespace of its own');
    for (const k of kv) {
      if (/REPLACE|PLACEHOLDER/i.test(k.id || '')) problems.push(`staging KV namespace id is still a placeholder (${k.id}); create it with "wrangler kv namespace create CONNECTOR_HEALTH --env staging"`);
      if (prodKv.includes(k.id)) problems.push('staging uses the PRODUCTION KV namespace; it must have its own');
    }
  }
  return problems;
}

// Variables wrangler says it would deploy: "env.NAME ("value")  Environment Variable" lines of a dry run.
export function varsFromDryRun(text) {
  const vars = {};
  for (const m of String(text).matchAll(/env\.([A-Za-z0-9_]+)\s+\("([^"]*)"\)\s+Environment Variable/g)) vars[m[1]] = m[2];
  return vars;
}

function cli() {
  const args = process.argv.slice(2);
  const get = (n) => { const a = args.find((x) => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : null; };
  const env = get('env'); const allowOn = (get('allow-on') || '').split(',').filter(Boolean);
  const config = parseJsonc(fs.readFileSync(path.join(root, 'wrangler.jsonc'), 'utf8'));
  let problems = validateConfig(config, { env, allowOn });
  if (args.includes('--dry-run')) {
    let out = '';
    try { out = execFileSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['wrangler', 'deploy', '--dry-run', ...(env ? ['--env', env] : [])], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32' }); }
    catch (e) { out = `${e.stdout || ''}${e.stderr || ''}`; }
    const vars = varsFromDryRun(out);
    if (!Object.keys(vars).length) problems.push('the dry run reported no variables, so the deployed configuration could not be checked');
    else problems = [...problems, ...validateConfig(config, { env, vars, allowOn }).map((p) => `(dry run) ${p}`)];
  }
  if (problems.length) { console.error(`UNSAFE CONFIGURATION: not deploying.\n- ${problems.join('\n- ')}`); process.exit(1); }
  console.log(`Configuration is safe to deploy (${env || 'production'}${allowOn.length ? `, deliberately on: ${allowOn.join(', ')}` : ', every guarded feature off'}).`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) cli();
