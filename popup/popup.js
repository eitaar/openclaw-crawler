const el = {
  todayCount: document.getElementById('todayCount'),
  blockSiteBtn: document.getElementById('blockSiteBtn'),
  previewBtn: document.getElementById('previewBtn'),
  previewPanel: document.getElementById('previewPanel'),
  previewList: document.getElementById('previewList'),
  refreshPreviewBtn: document.getElementById('refreshPreviewBtn'),
  sendBtn: document.getElementById('sendBtn'),
  webhookUrl: document.getElementById('webhookUrl'),
  bearerToken: document.getElementById('bearerToken'),
  promptTemplate: document.getElementById('promptTemplate'),
  entryTemplate: document.getElementById('entryTemplate'),
  allowlist: document.getElementById('allowlist'),
  denylist: document.getElementById('denylist'),
  saveSettingsBtn: document.getElementById('saveSettingsBtn'),
  historyList: document.getElementById('historyList'),
  status: document.getElementById('status')
};

init().catch((err) => setStatus(`Init error: ${err.message}`));

async function init() {
  await Promise.all([loadCount(), loadSettings(), loadHistory()]);

  el.blockSiteBtn.addEventListener('click', blockCurrentSite);
  el.previewBtn.addEventListener('click', async () => {
    el.previewPanel.hidden = false;
    await loadPreview();
  });
  el.refreshPreviewBtn.addEventListener('click', loadPreview);
  el.sendBtn.addEventListener('click', sendToday);
  el.saveSettingsBtn.addEventListener('click', saveSettings);
}

async function loadCount() {
  const res = await sendMessage({ type: 'GET_TODAY_COUNT' });
  el.todayCount.textContent = String(res.count || 0);
}

async function blockCurrentSite() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url) {
    setStatus('No active tab URL to block.');
    return;
  }

  const res = await sendMessage({ type: 'BLOCK_CURRENT_URL', url: tab.url });
  if (res.ok) {
    setStatus(`Added to denylist: ${res.added}`);
    await loadSettings();
  } else {
    setStatus(`Failed to block site: ${res.error}`);
  }
}

async function loadPreview() {
  const res = await sendMessage({ type: 'GET_PREVIEW' });
  const items = res.items || [];
  el.previewList.innerHTML = '';

  if (!items.length) {
    el.previewList.innerHTML = '<li>No entries recorded today.</li>';
    return;
  }

  items.forEach((item) => {
    const li = document.createElement('li');
    li.innerHTML = `
      <strong>${escapeHtml(item.title || '(untitled)')}</strong>
      <div class="mono">${escapeHtml(item.url)}</div>
      <div>${escapeHtml(item.description || '')}</div>
      <div>${escapeHtml(item.visitedAt)}</div>
      <button data-id="${item.id}">Delete</button>
      <button data-action="edit">Edit</button>
    `;
    li.querySelector('[data-id]').addEventListener('click', async () => {
      await sendMessage({ type: 'DELETE_VISIT', id: item.id });
      await Promise.all([loadPreview(), loadCount()]);
    });
    li.querySelector('[data-action="edit"]').addEventListener('click', async () => {
      await editEntry(item);
    });
    el.previewList.appendChild(li);
  });
}

async function sendToday() {
  const ok = confirm('Send today\'s batch to OpenClaw now?');
  if (!ok) return;

  const res = await sendMessage({ type: 'SEND_TODAY_BATCH' });
  if (res.ok) {
    setStatus(`Batch sent: ${res.batchId}`);
  } else {
    setStatus(`Send failed: ${res.error}`);
  }

  await Promise.all([loadHistory(), loadCount()]);
}

async function loadSettings() {
  const res = await sendMessage({ type: 'GET_SETTINGS' });
  const s = res.settings || {};
  el.webhookUrl.value = s.webhookUrl || '';
  el.bearerToken.value = s.bearerToken || '';
  el.allowlist.value = (s.allowlist || []).join('\n');
  el.denylist.value = (s.denylist || []).join('\n');
  el.promptTemplate.value = s.promptTemplate || '';
  el.entryTemplate.value = s.entryTemplate || '';
}

async function saveSettings() {
  const payload = {
    webhookUrl: el.webhookUrl.value.trim(),
    bearerToken: el.bearerToken.value,
    promptTemplate: el.promptTemplate.value,
    entryTemplate: el.entryTemplate.value,
    allowlist: parseRules(el.allowlist.value),
    denylist: parseRules(el.denylist.value)
  };

  // Privacy rule: credentials are only saved in chrome.storage.local (not source code / not remote sync).
  const res = await sendMessage({ type: 'SAVE_SETTINGS', settings: payload });
  setStatus(res.ok ? 'Settings saved.' : `Failed to save settings: ${res.error}`);
}

async function loadHistory() {
  const res = await sendMessage({ type: 'GET_BATCH_HISTORY' });
  const items = res.items || [];

  el.historyList.innerHTML = '';
  if (!items.length) {
    el.historyList.innerHTML = '<li>No batches yet.</li>';
    return;
  }

  items.forEach((batch) => {
    const li = document.createElement('li');
    li.innerHTML = `
      <div>
        <strong>${escapeHtml(batch.batchId)}</strong>
        <span class="badge ${escapeHtml(batch.status)}">${escapeHtml(batch.status)}</span>
      </div>
      <div>Day: ${escapeHtml(batch.day || '')}</div>
      <div>Items: ${escapeHtml(String(batch.itemCount || 0))}</div>
      <div>Last attempt: ${escapeHtml(batch.lastAttemptAt || '-')}</div>
      <button>Resend</button>
    `;
    li.querySelector('button').addEventListener('click', async () => {
      const resend = await sendMessage({ type: 'RESEND_BATCH', batchId: batch.batchId });
      setStatus(resend.ok ? `Resent ${batch.batchId}` : `Resend failed: ${resend.error}`);
      await loadHistory();
    });
    el.historyList.appendChild(li);
  });
}

function parseRules(value) {
  return String(value || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function setStatus(message) {
  el.status.textContent = message;
}

function sendMessage(msg) {
  return chrome.runtime.sendMessage(msg);
}

async function editEntry(item) {
  const title = prompt('Edit title', item.title || '');
  if (title === null) return;
  const url = prompt('Edit URL', item.url || '');
  if (url === null) return;
  const description = prompt('Edit description', item.description || '');
  if (description === null) return;

  const res = await sendMessage({
    type: 'UPDATE_VISIT',
    id: item.id,
    changes: { title, url, description }
  });

  setStatus(res.ok ? 'Entry updated.' : `Failed to update entry: ${res.error}`);
  if (res.ok) {
    await loadPreview();
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
