(function collectHeadMetadata() {
  const readMeta = (name, attr = 'name') =>
    document.head.querySelector(`meta[${attr}="${name}"]`)?.content?.trim() || '';

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

  // Privacy rule: content script only reads document <head> metadata and explicitly avoids body/forms/screenshots.
  chrome.runtime.sendMessage({ type: 'RECORD_VISIT', payload });
})();
