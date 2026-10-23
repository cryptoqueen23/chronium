// The public page that the ChroniumMind User-Agent links to must not promise more (or less) than the code does.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_LIMITS, USER_AGENT, USER_AGENT_TOKEN } from '../public/discovery/config.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.resolve(here, '..', 'public', 'crawler.html'), 'utf8');
const text = html.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

test('the User-Agent points at the page, and names the same token the page describes', () => {
  assert.match(USER_AGENT, /\(\+https:\/\/chronium-mind\.truewolfflix777\.workers\.dev\/crawler\.html;/);
  assert.ok(text.includes(USER_AGENT_TOKEN));
});
test('every number on the page matches the code', () => {
  assert.ok(text.includes(`at least ${DEFAULT_LIMITS.minDelayMs / 1000} seconds`));
  assert.ok(text.includes(`more than ${DEFAULT_LIMITS.maxAcceptedCrawlDelayMs / 1000} seconds`));
  assert.ok(text.includes(`about ${DEFAULT_LIMITS.maxPages} pages and ${DEFAULT_LIMITS.maxDocuments} documents`));
  assert.ok(text.includes(`at most ${DEFAULT_LIMITS.maxTotalRequests} requests`));
  assert.ok(text.includes(`${DEFAULT_LIMITS.maxRequestsPerHostPerDay} requests a day`));
  assert.ok(text.includes(`at most ${DEFAULT_LIMITS.maxWebsiteFetches} requests per search`));
  assert.ok(text.includes(USER_AGENT.split(' ')[0]) || text.includes('ChroniumMind/0.1'));
});
test('the page is complete: a contact address, a date, no placeholders, accessible basics', () => {
  assert.match(html, /mailto:marimercruz8@gmail\.com/);
  assert.doesNotMatch(html, /\[[A-Z][^\]]*(?:to be|CONTACT|date)[^\]]*\]/);
  assert.match(html, /<html lang="en">/); assert.match(html, /<title>[^<]+<\/title>/); assert.match(html, /class="skip"/); assert.match(html, /<caption>/); assert.match(html, /<th scope="col">/);
  assert.match(text, /User-agent: ChroniumMind\s+Disallow: \//);
});
