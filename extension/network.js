// Network rules for Deep Discovery in the side panel (Chromium declarativeNetRequest).
//
// 1. Private targets are blocked for requests that come from this extension: the browser cannot tell the engine
//    where a redirect leads before following it, so a public site that redirects to 127.0.0.1, 192.168.x.x or a
//    cloud metadata address would otherwise be requested. Rules apply to this extension's own requests only
//    (initiatorDomains = this extension), never to ordinary browsing. The local development server of Chronium
//    itself (http://127.0.0.1:8787) stays reachable.
// 2. When the person grants access to a site, a rule sets a descriptive User-Agent for this extension's requests
//    to that site, so the site's operator can see who is asking (name, purpose, how to read the rules).
//    Closes the "User-Agent" risk noted in docs/DEEP_DISCOVERY_PLAN.md section 8.
import { USER_AGENT } from './lib/discovery/config.js';

// Several small patterns, not one large one: a single regular expression for all private ranges exceeds the
// browser's 2 KB limit for a rule. Chrome canonicalises numeric hosts (for example 2130706433) to dotted form
// before rules are applied, so the dotted patterns also cover those spellings.
const PORT_END = '(:[0-9]+)?(/|$)';
const PRIVATE_PATTERNS = [
  `^https?://(localhost|[^/:]*\\.(localhost|local|internal|localdomain|lan|intranet|corp|private|arpa))${PORT_END}`,
  `^https?://(127|10|0)\\.[0-9]+\\.[0-9]+\\.[0-9]+${PORT_END}`,
  `^https?://(192\\.168|169\\.254)\\.[0-9]+\\.[0-9]+${PORT_END}`,
  `^https?://172\\.(1[6-9]|2[0-9]|3[01])\\.[0-9]+\\.[0-9]+${PORT_END}`,
  `^https?://(100\\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])|198\\.1[89]|2(2[4-9]|[3-5][0-9]))\\.[0-9]+\\.[0-9]+${PORT_END}`,
  `^https?://\\[`
];
const BLOCK_BASE = 9001; const ALLOW_DEV_ID = 9050; const UA_BASE = 9100;

export async function installPrivateTargetBlock() {
  const extId = chrome.runtime.id;
  const ids = PRIVATE_PATTERNS.map((_, i) => BLOCK_BASE + i);
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [...ids, ALLOW_DEV_ID],
    addRules: [
      ...PRIVATE_PATTERNS.map((re, i) => ({ id: ids[i], priority: 1, action: { type: 'block' }, condition: { regexFilter: re, isUrlFilterCaseSensitive: false, resourceTypes: ['xmlhttprequest'], initiatorDomains: [extId] } })),
      { id: ALLOW_DEV_ID, priority: 2, action: { type: 'allow' }, condition: { regexFilter: '^http://127\\.0\\.0\\.1:8787/', resourceTypes: ['xmlhttprequest'], initiatorDomains: [extId] } }
    ]
  });
}

let nextUa = UA_BASE;
const uaRuleByHost = new Map();
export async function setIdentifyingUserAgent(host) {
  if (uaRuleByHost.has(host)) return uaRuleByHost.get(host);
  const id = nextUa++;
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [id],
    addRules: [{ id, priority: 3, action: { type: 'modifyHeaders', requestHeaders: [{ header: 'User-Agent', operation: 'set', value: USER_AGENT }] }, condition: { requestDomains: [host], initiatorDomains: [chrome.runtime.id], resourceTypes: ['xmlhttprequest'] } }]
  });
  uaRuleByHost.set(host, id);
  return id;
}

// Asks for permission to read one site (shown by the browser as a prompt), then installs the identifying header.
// Must be called straight from a click handler. Resolves true when access is granted.
export async function requestSiteAccess(origin) {
  const pattern = `${origin}/*`;
  let ok = false;
  try { ok = await chrome.permissions.contains({ origins: [pattern] }); } catch { ok = false; }
  if (!ok) { try { ok = await chrome.permissions.request({ origins: [pattern] }); } catch { ok = false; } }
  if (!ok) return false;
  // Each rule set is installed on its own, so one failing does not stop the other. If a rule cannot be installed
  // the engine still validates every final address, and the person's own permission list still limits where
  // this extension can read; the failure is logged for diagnosis.
  try { await installPrivateTargetBlock(); } catch (e) { console.warn('Chronium: private-address network rules were not installed:', e && e.message); }
  try { await setIdentifyingUserAgent(new URL(origin).hostname); } catch (e) { console.warn('Chronium: the identifying User-Agent rule was not installed:', e && e.message); }
  return true;
}
