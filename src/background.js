import { addVisit, deleteVisit, getAllBatches, getBatch, getVisitsByDay, upsertBatch } from './idb.js';
import { shouldRecord } from './rules.js';
import { dayKey, isoWithTimezone, normalizeUrl, safeHostname } from './shared.js';

const SETTINGS_KEY = 'settings';
const CONSENT_KEY = 'sendConsent';
const LAST_AUTO_DAY_KEY = 'lastAutoSendDay';

const DEFAULT_SETTINGS = {
  webhookUrl: '',
  bearerToken: '',
  allowlist: [],
  denylist: []
};

chrome.runtime.onInstalled.addListener(async () => {
  const settings = await readSettings();
  if (!settings) {
    await chrome.storage.local.set({ [SETTINGS_KEY]: DEFAULT_SETTINGS });
  }
  await chrome.alarms.create('daily-send-check', { periodInMinutes: 15 });
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== 'daily-send-check') return;

  const consent = await readConsent();
  if (!consent) return;

  const now = new Date();
  if (now.getHours() < 23) return;

  const today = dayKey(now);
  const { [LAST_AUTO_DAY_KEY]: lastAutoSendDay } = await chrome.storage.local.get(LAST_AUTO_DAY_KEY);
  if (lastAutoSendDay === today) return;

  await sendDayBatch(today);
  await chrome.storage.local.set({ [LAST_AUTO_DAY_KEY]: today });
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    if (msg?.type === 'RECORD_VISIT') {
      await handleVisit(msg.payload);
      sendResponse({ ok: true });
      return;
    }

    if (msg?.type === 'GET_TODAY_COUNT') {
      const rows = await getVisitsByDay(dayKey());
      sendResponse({ count: rows.length });
      return;
    }

    if (msg?.type === 'GET_PREVIEW') {
      const rows = await getVisitsByDay(dayKey());
      sendResponse({ items: rows });
      return;
    }

    if (msg?.type === 'DELETE_VISIT') {
      await deleteVisit(msg.id);
      sendResponse({ ok: true });
      return;
    }

    if (msg?.type === 'SEND_TODAY_BATCH') {
      const result = await sendDayBatch(dayKey());
      if (result?.ok) {
        await chrome.storage.local.set({ [CONSENT_KEY]: true });
      }
      sendResponse(result);
      return;
    }

    if (msg?.type === 'GET_SETTINGS') {
      sendResponse({ settings: await readSettings() });
      return;
    }

    if (msg?.type === 'SAVE_SETTINGS') {
      const merged = { ...DEFAULT_SETTINGS, ...(msg.settings || {}) };
      await chrome.storage.local.set({ [SETTINGS_KEY]: merged });
      sendResponse({ ok: true });
      return;
    }

    if (msg?.type === 'BLOCK_CURRENT_URL') {
      const settings = await readSettings();
      const parsed = new URL(msg.url);
      const newRule = parsed.hostname;
      const deny = new Set([...(settings.denylist || []), newRule]);
      await chrome.storage.local.set({
        [SETTINGS_KEY]: { ...settings, denylist: [...deny] }
      });
      sendResponse({ ok: true, added: newRule });
      return;
    }

    if (msg?.type === 'GET_BATCH_HISTORY') {
      sendResponse({ items: await getAllBatches() });
      return;
    }

    if (msg?.type === 'RESEND_BATCH') {
      const result = await resendBatch(msg.batchId);
      sendResponse(result);
      return;
    }

    sendResponse({ ok: false, error: 'Unknown message type' });
  })().catch((err) => {
    sendResponse({ ok: false, error: err?.message || String(err) });
  });

  return true;
});

async function handleVisit(payload) {
  const settings = await readSettings();
  const normalizedUrl = normalizeUrl(payload.rawUrl);

  if (!shouldRecord(normalizedUrl, settings.allowlist, settings.denylist)) {
    return;
  }

  const row = {
    url: normalizedUrl,
    canonicalUrl: payload.canonicalUrl || normalizedUrl,
    title: payload.title || '',
    description: payload.description || '',
    ogTitle: payload.ogTitle || '',
    ogDescription: payload.ogDescription || '',
    siteName: payload.siteName || '',
    hostname: safeHostname(normalizedUrl),
    visitedAt: isoWithTimezone(),
    referrer: payload.referrer || '',
    favicon: payload.favicon || `${new URL(normalizedUrl).origin}/favicon.ico`,
    day: dayKey()
  };

  // Privacy rule: only predefined metadata fields are persisted; arbitrary page/body text is intentionally excluded.
  await addVisit(row);
}

async function sendDayBatch(day) {
  const rows = await getVisitsByDay(day);
  const batchId = `browser-${day}`;
  const settings = await readSettings();

  if (!settings.webhookUrl || !settings.bearerToken) {
    return { ok: false, error: 'Missing webhook URL or bearer token in settings.' };
  }

  const payload = {
    day,
    source: 'chrome-extension',
    batchId,
    sentAt: isoWithTimezone(),
    itemCount: rows.length,
    items: rows.map(({ day: _day, id, ...item }) => item)
  };

  const pendingBatch = {
    batchId,
    day,
    status: 'pending',
    itemCount: rows.length,
    lastAttemptAt: isoWithTimezone(),
    payload,
    attempts: 1
  };
  await upsertBatch(pendingBatch);

  try {
    const request = buildWebhookRequest(settings.webhookUrl, settings.bearerToken, payload);
    const res = await fetch(settings.webhookUrl, request);
    const responseText = await res.text();

    const next = {
      ...pendingBatch,
      status: res.ok ? 'sent' : 'failed',
      responseCode: res.status,
      lastAttemptAt: isoWithTimezone(),
      lastResponse: responseText.slice(0, 4000)
    };
    await upsertBatch(next);

    if (!res.ok) {
      return { ok: false, error: `Webhook failed with status ${res.status}: ${responseText || 'no body'}` };
    }

    return { ok: true, batchId };
  } catch (error) {
    await upsertBatch({
      ...pendingBatch,
      status: 'failed',
      lastAttemptAt: isoWithTimezone(),
      lastError: error?.message || String(error)
    });
    return { ok: false, error: error?.message || String(error) };
  }
}

async function resendBatch(batchId) {
  const settings = await readSettings();
  const batch = await getBatch(batchId);
  if (!batch) return { ok: false, error: 'Batch not found' };

  const attempts = Number(batch.attempts || 1) + 1;

  try {
    const request = buildWebhookRequest(settings.webhookUrl, settings.bearerToken, batch.payload);
    const res = await fetch(settings.webhookUrl, request);
    const responseText = await res.text();

    await upsertBatch({
      ...batch,
      attempts,
      status: res.ok ? 'sent' : 'failed',
      responseCode: res.status,
      lastAttemptAt: isoWithTimezone(),
      lastResponse: responseText.slice(0, 4000)
    });

    return res.ok
      ? { ok: true }
      : { ok: false, error: `Webhook failed with status ${res.status}: ${responseText || 'no body'}` };
  } catch (error) {
    await upsertBatch({
      ...batch,
      attempts,
      status: 'failed',
      lastAttemptAt: isoWithTimezone(),
      lastError: error?.message || String(error)
    });

    return { ok: false, error: error?.message || String(error) };
  }
}

async function readSettings() {
  const res = await chrome.storage.local.get(SETTINGS_KEY);
  return { ...DEFAULT_SETTINGS, ...(res[SETTINGS_KEY] || {}) };
}

async function readConsent() {
  const res = await chrome.storage.local.get(CONSENT_KEY);
  return Boolean(res[CONSENT_KEY]);
}

function buildWebhookRequest(webhookUrl, bearerToken, payload) {
  const parsed = new URL(webhookUrl);
  const pathname = parsed.pathname.toLowerCase();

  let body = payload;
  if (pathname.endsWith('/hooks/agent')) {
    // OpenClaw /hooks/agent requires `message` as a string; raw arbitrary payload returns HTTP 400.
    body = {
      message: buildHookMessage(payload),
      name: 'Browser Log Collector',
      wakeMode: 'now',
      deliver: false
    };
  } else if (pathname.endsWith('/hooks/wake')) {
    // OpenClaw /hooks/wake requires `text`; this keeps compatibility for users pointing to wake endpoints.
    body = {
      text: buildHookMessage(payload),
      mode: 'now'
    };
  }

  return {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${bearerToken}`
    },
    body: JSON.stringify(body)
  };
}

function buildHookMessage(payload) {
  const preview = (payload.items || [])
    .slice(0, 25)
    .map((item, i) => `${i + 1}. ${item.title || '(untitled)'} — ${item.url}`)
    .join('\n');

  return [
    `Daily browser log for ${payload.day}.`,
    `batchId=${payload.batchId}`,
    `itemCount=${payload.itemCount}`,
    '',
    'Entries:',
    preview || '(no entries)',
    '',
    'JSON payload:',
    JSON.stringify(payload)
  ].join('\n');
}
