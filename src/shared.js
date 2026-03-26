export const TRACKING_PARAM_PREFIXES = ['utm_'];
export const TRACKING_PARAM_KEYS = new Set([
  'fbclid',
  'gclid',
  'igshid',
  'mc_cid',
  'mc_eid',
  'msclkid',
  'ref',
  'ref_src',
  'spm',
  'trk',
  'yclid'
]);

export const SENSITIVE_QUERY_KEYS = ['token', 'password', 'secret', 'auth', 'code'];

export function isoWithTimezone(date = new Date()) {
  const tzOffset = -date.getTimezoneOffset();
  const sign = tzOffset >= 0 ? '+' : '-';
  const abs = Math.abs(tzOffset);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 19);
  return `${local}${sign}${hh}:${mm}`;
}

export function dayKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

export function normalizeUrl(input) {
  const url = new URL(input);
  const kept = new URL(url.origin + url.pathname);

  // Privacy rule: remove fragment to avoid recording in-page anchors that can include sensitive identifiers.
  kept.hash = '';

  for (const [k, v] of url.searchParams.entries()) {
    const lower = k.toLowerCase();
    const tracking = TRACKING_PARAM_PREFIXES.some((prefix) => lower.startsWith(prefix)) || TRACKING_PARAM_KEYS.has(lower);
    if (!tracking) {
      kept.searchParams.append(k, v);
    }
  }

  if (kept.pathname.endsWith('/') && kept.pathname !== '/') {
    kept.pathname = kept.pathname.slice(0, -1);
  }

  return kept.toString();
}

export function hasSensitiveQuery(input) {
  let parsed;
  try {
    parsed = new URL(input);
  } catch {
    return true;
  }

  return [...parsed.searchParams.keys()].some((k) => {
    const lower = k.toLowerCase();
    return SENSITIVE_QUERY_KEYS.some((needle) => lower.includes(needle));
  });
}

export function safeHostname(input) {
  try {
    return new URL(input).hostname.toLowerCase();
  } catch {
    return '';
  }
}
