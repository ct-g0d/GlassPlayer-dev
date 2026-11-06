/* nexus-embed.js — Legacy compatibility wrapper for nexus-bridge.js.
   Ensures legacy callers, iframes (?embed=1), and direct imports continue
   working seamlessly without breaking changes. */

(() => {
  'use strict';

  if (typeof window === 'undefined') {
    if (typeof module !== 'undefined' && module.exports) {
      try {
        module.exports = require('./nexus-bridge.js');
      } catch (_) {}
    }
    return;
  }

  // If nexus-bridge.js is already running in the document
  if (window.__nexusBridgeLoaded && window.NexusBridge) {
    window.nexusEmbed = window.NexusBridge;
    return;
  }

  // If nexus-bridge.js has not been injected yet, inject it dynamically
  if (typeof document !== 'undefined') {
    const existingScript = document.querySelector('script[src*="nexus-bridge.js"]');
    if (!existingScript) {
      const script = document.createElement('script');
      script.src = (document.currentScript && document.currentScript.src)
        ? new URL('nexus-bridge.js', document.currentScript.src).href
        : './nexus-bridge.js';
      script.async = false;
      document.head.appendChild(script);
    }
  }

  if (typeof module !== 'undefined' && module.exports) {
    try {
      module.exports = window.NexusBridge || require('./nexus-bridge.js');
    } catch (_) {}
  }
})();
