(function collectHeadMetadata() {
  let lastSentFingerprint = '';
  let sendTimer = null;

  const readMeta = (name, attr = 'name') =>
    document.head.querySelector(`meta[${attr}="${name}"]`)?.content?.trim() || '';

  function collectAndSend(reason = 'unknown') {
    const canonicalUrl = document.head.querySelector('link[rel="canonical"]')?.href || '';
    const iconHref = document.head.querySelector('link[rel~="icon"]')?.href || `${location.origin}/favicon.ico`;

    const payload = {
      rawUrl: location.href,
      canonicalUrl,
      title: document.title || '',
      description: readMeta('description'),
      ogTitle: readMeta('og:title', 'property'),
      ogDescription: readMeta('og:description', 'property'),
      siteName: readMeta('og:site_name', 'property'),
      referrer: document.referrer || '',
      favicon: iconHref
    };

    const fingerprint = `${payload.rawUrl}|${payload.title}|${payload.description}`;
    if (fingerprint === lastSentFingerprint) return;
    lastSentFingerprint = fingerprint;

    // Privacy rule: content script only reads document <head> metadata and explicitly avoids body/forms/screenshots.
    chrome.runtime.sendMessage({ type: 'RECORD_VISIT', payload, reason });
  }

  function scheduleCollect(reason) {
    clearTimeout(sendTimer);
    sendTimer = setTimeout(() => collectAndSend(reason), 300);
  }

  function patchHistoryMethod(method) {
    const original = history[method];
    history[method] = function patchedHistory(...args) {
      const result = original.apply(this, args);
      scheduleCollect(method);
      return result;
    };
  }

  patchHistoryMethod('pushState');
  patchHistoryMethod('replaceState');
  window.addEventListener('popstate', () => scheduleCollect('popstate'));
  window.addEventListener('hashchange', () => scheduleCollect('hashchange'));

  // SPA support: many sites (e.g., Google search) update <title>/<meta> and URL without full page reload.
  const observer = new MutationObserver(() => scheduleCollect('head-mutation'));
  observer.observe(document.head, { subtree: true, childList: true, attributes: true, characterData: true });

  collectAndSend('initial');
})();
