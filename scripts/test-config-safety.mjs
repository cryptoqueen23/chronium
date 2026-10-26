// Production configuration safety (Stage 0 / B7): unsafe configurations are rejected before deployment, and the
// repository's own configuration is safe as committed.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseJsonc, validateConfig, varsFromDryRun } from './validate-production-config.mjs';
import { TEST_ONLY_VARS, FEATURE_VARS } from '../src/guard.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const real = parseJsonc(fs.readFileSync(path.join(root, 'wrangler.jsonc'), 'utf8'));
const clone = (o) => JSON.parse(JSON.stringify(o));

test('the committed production configuration is safe, with every guarded feature off', () => {
  assert.deepEqual(validateConfig(real), []);
  for (const name of Object.values(FEATURE_VARS)) assert.equal(real.vars[name], 'off', name);
  assert.equal(real.vars.ENVIRONMENT, 'production');
});
test('every test-only variable is rejected, each one by itself', () => {
  for (const name of TEST_ONLY_VARS) {
    const c = clone(real); c.vars[name] = 'on';
    assert.ok(validateConfig(c).some((p) => p.includes(name)), name);
  }
});
test('a missing or wrong ENVIRONMENT, a missing switch, or a switch with a loose value is rejected', () => {
  let c = clone(real); delete c.vars.ENVIRONMENT; assert.ok(validateConfig(c).some((p) => /ENVIRONMENT/.test(p)));
  c = clone(real); c.vars.ENVIRONMENT = 'development'; assert.ok(validateConfig(c).some((p) => /ENVIRONMENT/.test(p)));
  for (const name of Object.values(FEATURE_VARS)) { c = clone(real); delete c.vars[name]; assert.ok(validateConfig(c).some((p) => p.includes(name)), `missing ${name}`); }
  for (const bad of ['ON', 'true', '1', 'enabled', '']) { c = clone(real); c.vars.FEATURE_DISCOVERY_FETCH = bad; assert.ok(validateConfig(c).some((p) => /exactly "on" or "off"/.test(p)), bad); }
});
test('turning a feature on needs a deliberate flag, and AI needs both ceilings', () => {
  let c = clone(real); c.vars.FEATURE_DISCOVERY_FETCH = 'on';
  assert.ok(validateConfig(c).some((p) => /not named with --allow-on/.test(p)));
  assert.deepEqual(validateConfig(c, { allowOn: ['FEATURE_DISCOVERY_FETCH'] }), []);
  // The capture viewer is different: no flag can turn it on in any deployed configuration (separate origin first).
  c = clone(real); c.vars.FEATURE_VIEW_CAPTURE = 'on';
  assert.ok(validateConfig(c, { allowOn: ['FEATURE_VIEW_CAPTURE'] }).some((p) => /separate origin/.test(p)), 'production');
  c = clone(real); c.env.staging.kv_namespaces[0].id = 'aaaabbbbccccddddeeeeffff00001111'; c.env.staging.vars.FEATURE_VIEW_CAPTURE = 'on';
  assert.ok(validateConfig(c, { env: 'staging', allowOn: ['FEATURE_VIEW_CAPTURE'] }).some((p) => /separate origin/.test(p)), 'staging');
  c = clone(real); c.vars.AI_ENABLED = 'on';
  assert.ok(validateConfig(c, { allowOn: ['AI_ENABLED'] }).some((p) => /cost|AI_DAILY_CEILING/.test(p)), 'AI on without ceilings');
  c.vars.AI_PER_VISITOR_PER_DAY = '10'; c.vars.AI_DAILY_CEILING = '200';
  assert.deepEqual(validateConfig(c, { allowOn: ['AI_ENABLED'] }), []);
  c.vars.AI_DAILY_CEILING = 'lots'; assert.ok(validateConfig(c, { allowOn: ['AI_ENABLED'] }).length);
  c = clone(real); c.vars.FEATURE_ASK_SOURCES = 'on'; c.vars.AI_PER_VISITOR_PER_DAY = '1'; c.vars.AI_DAILY_CEILING = '1';
  assert.ok(validateConfig(c, { allowOn: ['FEATURE_ASK_SOURCES'] }).some((p) => /needs AI_ENABLED/.test(p)));
  c = clone(real); c.vars.LIMIT_FETCH_PER_IP_PER_MIN = 'abc'; assert.ok(validateConfig(c).some((p) => /LIMIT_FETCH_PER_IP_PER_MIN/.test(p)));
  for (const name of ['AI_MAX_OUTPUT_TOKENS', 'AI_MAX_INPUT_CHARS', 'AI_MAX_BODY_BYTES']) { c = clone(real); c.vars[name] = 'lots'; assert.ok(validateConfig(c).some((p) => p.includes(name)), name); c.vars[name] = '300'; assert.deepEqual(validateConfig(c), [], name); }
});
test('variables reported by a dry run are checked too (a --var typed on the command line is caught)', () => {
  const dry = `Your Worker has access to the following bindings:\nBinding  Resource\nenv.CONNECTOR_HEALTH (4ed1...)   KV Namespace\nenv.AI_PROVIDER ("anthropic")   Environment Variable\nenv.ENVIRONMENT ("production")   Environment Variable\nenv.TEST_MODE ("on")   Environment Variable\nenv.DISCOVERY_ALLOW_PRIVATE ("127.0.0.1:8790")   Environment Variable\nenv.FEATURE_DISCOVERY_FETCH ("off")   Environment Variable\n`;
  const vars = varsFromDryRun(dry);
  assert.equal(vars.TEST_MODE, 'on'); assert.equal(vars.ENVIRONMENT, 'production');
  const problems = validateConfig(real, { vars });
  assert.ok(problems.some((p) => /TEST_MODE/.test(p)) && problems.some((p) => /DISCOVERY_ALLOW_PRIVATE/.test(p)));
});
test('staging is isolated: its own Worker name, its own storage, never production\'s, and no placeholder left', () => {
  const stagingAsCommitted = validateConfig(real, { env: 'staging' });
  assert.ok(stagingAsCommitted.some((p) => /placeholder/.test(p)), 'the committed staging block cannot be deployed until its namespace exists');
  let c = clone(real); c.env.staging.kv_namespaces[0].id = 'aaaabbbbccccddddeeeeffff00001111';
  assert.deepEqual(validateConfig(c, { env: 'staging' }), []);
  c.env.staging.name = 'chronium-mind'; assert.ok(validateConfig(c, { env: 'staging' }).some((p) => /separate Worker/.test(p)));
  c = clone(real); c.env.staging.kv_namespaces[0].id = real.kv_namespaces[0].id; assert.ok(validateConfig(c, { env: 'staging' }).some((p) => /PRODUCTION KV/.test(p)));
  c = clone(real); c.env.staging.kv_namespaces[0].id = 'aaaabbbbccccddddeeeeffff00001111'; c.env.staging.vars.ENVIRONMENT = 'production'; assert.ok(validateConfig(c, { env: 'staging' }).some((p) => /ENVIRONMENT/.test(p)));
  assert.equal(real.env.staging.vars.AI_ENABLED, 'off', 'staging starts with paid AI off and holds no production AI credential (secrets belong to a Worker, and staging is a different Worker)');
  assert.ok(validateConfig({ ...real, env: {} }, { env: 'staging' })[0].includes('no "staging"'));
});
test('the committed files contain no secrets and no real credentials', () => {
  const files = ['wrangler.jsonc', 'src/guard.js', 'src/discoveryProxy.js', 'src/viewCapture.js', 'src/index.js'];
  for (const f of files) assert.doesNotMatch(fs.readFileSync(path.join(root, f), 'utf8'), /sk-ant-[A-Za-z0-9_-]{10,}|ANTHROPIC_API_KEY\s*[:=]\s*["'][^"']{8,}/, f);
});
test('the deploy scripts run the validator first', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.match(pkg.scripts.deploy, /validate-production-config\.mjs/); assert.ok(pkg.scripts.deploy.indexOf('validate-production-config') < pkg.scripts.deploy.indexOf('wrangler deploy'));
  assert.match(pkg.scripts['deploy:staging'], /--env=staging/); assert.match(pkg.scripts['deploy:staging'], /wrangler deploy --env staging/);
});

test('staging requires the burst limiter, with every binding declared, and production must not use it yet', () => {
  const ok = (c) => { c.env.staging.kv_namespaces[0].id = 'aaaabbbbccccddddeeeeffff00001111'; return c; };
  assert.deepEqual(validateConfig(ok(clone(real)), { env: 'staging' }), []);
  assert.equal(real.env.staging.vars.RATE_LIMIT_BINDING, 'required');
  let c = ok(clone(real)); c.env.staging.vars.RATE_LIMIT_BINDING = 'on'; assert.ok(validateConfig(c, { env: 'staging' }).some((p) => /RATE_LIMIT_BINDING/.test(p)));
  for (const name of ['RL_FETCH', 'RL_VIEWCAPTURE', 'RL_AI']) { c = ok(clone(real)); c.env.staging.ratelimits = c.env.staging.ratelimits.filter((b) => b.name !== name); assert.ok(validateConfig(c, { env: 'staging' }).some((p) => p.includes(name)), name); }
  c = ok(clone(real)); c.env.staging.ratelimits[0].simple.period = 30; assert.ok(validateConfig(c, { env: 'staging' }).some((p) => /period must be 10 or 60/.test(p)));
  c = ok(clone(real)); c.env.staging.ratelimits[1].namespace_id = c.env.staging.ratelimits[0].namespace_id; assert.ok(validateConfig(c, { env: 'staging' }).some((p) => /unique/.test(p)));
  c = clone(real); c.ratelimits = [{ name: 'RL_FETCH', namespace_id: '1', simple: { limit: 5, period: 60 } }]; assert.ok(validateConfig(c).some((p) => /production must not use/.test(p)));
  c = clone(real); c.vars.RATE_LIMIT_BINDING = 'required'; assert.ok(validateConfig(c).some((p) => /production must not use/.test(p)));
});
