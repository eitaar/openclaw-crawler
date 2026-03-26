import { hasSensitiveQuery, safeHostname } from './shared.js';

export const DEFAULT_DENY_RULES = [
  'localhost',
  '127.0.0.1',
  'chrome://',
  'file://',
  'paypal.com',
  'stripe.com',
  'chase.com',
  'bankofamerica.com',
  'wellsfargo.com',
  'capitalone.com',
  'lastpass.com',
  '1password.com',
  'bitwarden.com'
];

const SENSITIVE_PATH_PARTS = ['/oauth', '/auth', '/login', '/signin'];

function asRules(entries) {
  return (entries || []).map((x) => String(x || '').trim().toLowerCase()).filter(Boolean);
}

function matchesRule(url, rule) {
  if (rule.includes('://')) {
    return url.toLowerCase().startsWith(rule);
  }

  const host = safeHostname(url);
  return host === rule || host.endsWith(`.${rule}`);
}

export function shouldRecord(url, allowRules = [], denyRules = []) {
  const lowered = String(url || '').toLowerCase();

  if (!lowered.startsWith('http://') && !lowered.startsWith('https://')) {
    // Privacy rule: non-web protocols are excluded to avoid local or browser-internal surfaces.
    return false;
  }

  if (hasSensitiveQuery(url)) {
    // Privacy rule: URLs containing token/password-like query keys are never captured.
    return false;
  }

  if (SENSITIVE_PATH_PARTS.some((part) => lowered.includes(part))) {
    // Privacy rule: authentication and OAuth endpoints can expose user identity/session state.
    return false;
  }

  const allDeny = [...DEFAULT_DENY_RULES, ...asRules(denyRules)];
  if (allDeny.some((rule) => matchesRule(url, rule))) {
    // Privacy rule: denylist has explicit precedence over all other inclusion logic.
    return false;
  }

  const cleanAllow = asRules(allowRules);
  if (cleanAllow.length === 0) {
    return true;
  }

  return cleanAllow.some((rule) => matchesRule(url, rule));
}
