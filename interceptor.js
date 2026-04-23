/**
 * Timed Lyrics Generator — Fetch Interceptor
 * 
 * This script runs in the MAIN world (Spotify's page context)
 * via manifest.json "world": "MAIN" declaration.
 * 
 * It patches window.fetch() and XMLHttpRequest to intercept
 * Spotify's lyrics API responses.
 */

(function() {
  'use strict';

  function isValidLyricsData(data) {
    return data && data.lyrics && Array.isArray(data.lyrics.lines);
  }

  // Patch window.fetch
  const originalFetch = window.fetch;
  window.fetch = async function(...args) {
    const response = await originalFetch.apply(this, args);

    try {
      const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';

      // Detect Spotify's lyrics API call
      if (url.includes('color-lyrics') || url.includes('lyrics/v2')) {
        const clone = response.clone();
        clone.json().then(data => {
          // Only send if it actually contains lyrics lines
          if (isValidLyricsData(data)) {
            window.postMessage({
              type: 'LRC_LYRICS_INTERCEPTED',
              url: url,
              data: data
            }, '*');
          }
        }).catch(() => {});
      }
    } catch(e) {
      // Silent fail — never break Spotify
    }

    return response;
  };

  // Patch XMLHttpRequest
  const originalXHROpen = XMLHttpRequest.prototype.open;
  const originalXHRSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    this._lrcUrl = url;
    return originalXHROpen.call(this, method, url, ...rest);
  };

  XMLHttpRequest.prototype.send = function(...args) {
    if (this._lrcUrl && (this._lrcUrl.includes('color-lyrics') || this._lrcUrl.includes('lyrics/v2'))) {
      this.addEventListener('load', function() {
        try {
          const data = JSON.parse(this.responseText);
          if (isValidLyricsData(data)) {
            window.postMessage({
              type: 'LRC_LYRICS_INTERCEPTED',
              url: this._lrcUrl,
              data: data
            }, '*');
          }
        } catch(e) {}
      });
    }
    return originalXHRSend.apply(this, args);
  };

  console.log('[LRC] Interceptor active. Monitoring lyrics traffic...');
})();
