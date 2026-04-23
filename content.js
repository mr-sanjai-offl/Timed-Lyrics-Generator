/**
 * Timed Lyrics Generator — Content Script
 * 
 * APPROACH: Instead of manually fetching lyrics, we intercept Spotify's
 * own fetch() calls to the color-lyrics API. When Spotify loads lyrics
 * for a song, we capture the response and process it into LRC format.
 * 
 * This avoids needing to manage auth tokens or track IDs manually.
 */

(() => {
  'use strict';

  let currentTrackId = null;
  let currentTrackMeta = { title: '', artist: '', album: '' };
  let capturedTrackTitle = ''; 
  
  // Multi-track buffer to handle out-of-order pre-fetches
  let lyricsBuffer = {}; // trackId -> { lrc, meta, rawLines, title }
  
  let isProcessing = false;
  let contextValid = true;

  const DEBUG = false;
  function log(...args) {
    if (DEBUG) console.log('[LRC]', ...args);
  }

  /**
   * Check if the extension context is still valid.
   * Returns false after the extension is reloaded/updated.
   */
  function isContextValid() {
    try {
      // This will throw if context is invalidated
      void chrome.runtime.id;
      return true;
    } catch (e) {
      contextValid = false;
      return false;
    }
  }

  /**
   * Safe wrapper for chrome.storage.local.set
   */
  function safeStorageSet(data) {
    if (!isContextValid()) return;
    try {
      chrome.storage.local.set(data);
    } catch (e) {
      log('Storage set failed (context invalid):', e.message);
      contextValid = false;
    }
  }

  /**
   * Safe wrapper for chrome.storage.local.remove
   */
  function safeStorageRemove(keys) {
    if (!isContextValid()) return;
    try {
      chrome.storage.local.remove(keys);
    } catch (e) {
      contextValid = false;
    }
  }


  // NOTE: The fetch interceptor (interceptor.js) is now loaded via
  // manifest.json with "world": "MAIN" — no inline injection needed.
  // It runs at document_start and patches fetch() before Spotify loads.


  // ── Listen for Intercepted Lyrics ─────────────────────────────────

  let lastProcessedTrackId = null;
  let lastProcessedTime = 0;

  function startLyricsListener() {
    window.addEventListener('message', async (event) => {
      if (event.source !== window) return;
      if (event.data?.type !== 'LRC_LYRICS_INTERCEPTED') return;
      if (!contextValid) return;

      const url = event.data.url;
      const apiData = event.data.data;
      
      try {
        const lines = apiData?.lyrics?.lines;
        if (!lines || lines.length === 0) return;

        // 1. Extract track ID from URL
        const urlMatch = url.match(/track\/([a-zA-Z0-9]{22})/);
        const interceptedTrackId = urlMatch ? urlMatch[1] : null;
        
        if (!interceptedTrackId) return;

        log('Captured lyrics for Track ID:', interceptedTrackId);

        // 2. Fetch current Meta from DOM for this specific capture
        // (Note: This might be slightly off if pre-fetching, but we'll try to get it)
        const tempMeta = getTrackMetaFromDOM();
        
        // 3. Build and Store in Buffer
        const lrc = LRCUtils.buildLRC(lines, tempMeta);
        
        lyricsBuffer[interceptedTrackId] = {
          lrc: lrc,
          meta: tempMeta,
          rawLines: lines,
          title: tempMeta.title,
          timestamp: Date.now()
        };

        // Also save to storage for persistence
        safeStorageSet({
          lyrics_buffer: JSON.stringify(lyricsBuffer)
        });

        log('Buffered track:', tempMeta.title || interceptedTrackId);

        // Notify if this matches the currently playing song
        if (interceptedTrackId === getTrackIdFromPage()) {
          showProminentNotification('Lyrics Synchronized', tempMeta.title || 'Current Track');
        }

      } catch (e) {
        log('Error buffering intercepted lyrics:', e);
      }
    });

    log('Lyrics buffer active');

    // Add track change detection
    let lastUrl = window.location.href;
    let lastId = getTrackIdFromPage();

    setInterval(() => {
      const currentUrl = window.location.href;
      const currentId = getTrackIdFromPage();
      const currentMeta = getTrackMetaFromDOM();
      const currentTitle = currentMeta.title;

      if (currentUrl !== lastUrl || currentId !== lastId) {
        // if (DEBUG) log('Track changed to:', currentId);
        lastUrl = currentUrl;
        lastId = currentId;
        
        // If the new track already has lyrics in buffer, notify!
        if (lyricsBuffer[currentId]) {
          log('Instant match found in buffer for track change!');
          showProminentNotification('Lyrics Ready', currentTitle || 'Subscribed Track');
        }
      }
    }, 2000);
  }

  // ── Track Metadata from DOM ───────────────────────────────────────

  function getTrackMetaFromDOM() {
    const meta = { title: '', artist: '', album: '' };

    try {
      // ── Title: Try multiple selector strategies ──
      const titleSelectors = [
        '[data-testid="now-playing-widget"] [data-testid="context-item-link"]',
        '[data-testid="now-playing-widget"] a[data-testid="context-item-link"]',
        '[data-testid="context-item-info-title"]',
        '[data-testid="nowplaying-track-link"]',
        '.now-playing-bar [data-testid="context-item-link"]',
        '[data-testid="track-info-name"] a',
        '[data-testid="track-info-name"]',
        '.now-playing-widget .track-info__name',
        'a[data-testid*="track"]',
        'footer a[href*="/track/"]',
        '.Root__now-playing-bar a[href*="/track/"]',
      ];

      for (const sel of titleSelectors) {
        try {
          const el = document.querySelector(sel);
          if (el && el.textContent.trim()) {
            meta.title = el.textContent.trim();
            break;
          }
        } catch (e) { /* continue */ }
      }

      // ── Artist ──
      const artistSelectors = [
        '[data-testid="now-playing-widget"] [data-testid="context-item-info-artist"]',
        '[data-testid="context-item-info-artist"]',
        '[data-testid="track-info-artists"] a',
        '[data-testid="track-info-artists"]',
        '.now-playing-widget .track-info__artists',
        'footer a[href*="/artist/"]',
        '.Root__now-playing-bar a[href*="/artist/"]',
      ];

      for (const sel of artistSelectors) {
        try {
          const el = document.querySelector(sel);
          if (el && el.textContent.trim()) {
            meta.artist = el.textContent.trim();
            break;
          }
        } catch (e) { /* continue */ }
      }

      // ── Fallback: document title ("Song - Artist | Spotify") ──
      if (!meta.title && document.title) {
        const match = document.title.match(/^(.+?)\s*[-–—]\s*(.+?)\s*\|?\s*Spotify/i);
        if (match) {
          meta.title = meta.title || match[1].trim();
          meta.artist = meta.artist || match[2].trim();
        }
      }

    } catch (e) {
      console.warn('[LRC] Could not extract track meta:', e);
    }

    return meta;
  }

  // ── Manual Fetch (Fallback) ───────────────────────────────────────
  // If the user clicks Generate but we haven't intercepted lyrics yet,
  // we can try to fetch manually using the token from Spotify.

  async function manualFetchLyrics() {
    const trackId = getTrackIdFromPage();
    if (!trackId) throw new Error('Could not identify current track.');

    // Check buffer first
    if (lyricsBuffer[trackId]) {
      return { lrc: lyricsBuffer[trackId].lrc, meta: lyricsBuffer[trackId].meta };
    }
    if (!trackId) {
      throw new Error(
        'No lyrics detected yet.\n\n' +
        'How to use:\n' +
        '1. Play a song on Spotify Web Player\n' +
        '2. Wait for the song to start playing\n' +
        '3. Spotify will automatically fetch lyrics\n' +
        '4. This extension captures them automatically\n\n' +
        'Tip: Try switching to a different song and back.'
      );
    }

    // Try to get token and fetch manually
    const token = await getSpotifyToken();
    if (!token) {
      throw new Error(
        'Could not get access token.\n' +
        'Make sure you are logged into Spotify Web Player.'
      );
    }

    const url = `https://spclient.wg.spotify.com/color-lyrics/v2/track/${trackId}?format=json&market=from_token`;
    
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'App-Platform': 'WebPlayer',
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error('No synced lyrics available for this track.');
      }
      throw new Error(`Lyrics API error: ${response.status}`);
    }

    const data = await response.json();
    const lines = data?.lyrics?.lines;
    
    if (!lines || lines.length === 0) {
      throw new Error('No lyric lines found in API response.');
    }

    currentTrackMeta = getTrackMetaFromDOM();
    const lrc = LRCUtils.buildLRC(lines, currentTrackMeta);
    
    // Store in buffer
    lyricsBuffer[trackId] = {
      lrc: lrc,
      meta: currentTrackMeta,
      rawLines: lines,
      title: currentTrackMeta.title,
      timestamp: Date.now()
    };

    safeStorageSet({ lyrics_buffer: JSON.stringify(lyricsBuffer) });

    return { lrc: lrc, meta: currentTrackMeta };
  }

  function getTrackIdFromPage() {
    // From URL
    const urlMatch = window.location.href.match(/track\/([a-zA-Z0-9]{22})/);
    if (urlMatch) return urlMatch[1];

    // From highlight param
    const highlightMatch = window.location.href.match(/highlight=spotify:track:([a-zA-Z0-9]{22})/);
    if (highlightMatch) return highlightMatch[1];

    // From any track link in the footer/player area
    const links = document.querySelectorAll('a[href*="/track/"]');
    for (const link of links) {
      const rect = link.getBoundingClientRect();
      if (rect.top > window.innerHeight * 0.75) {
        const m = link.href.match(/track\/([a-zA-Z0-9]{22})/);
        if (m) return m[1];
      }
    }

    // From any track link
    if (links.length > 0) {
      const m = links[0].href.match(/track\/([a-zA-Z0-9]{22})/);
      if (m) return m[1];
    }

    // Stored track ID
    return currentTrackId;
  }

  async function getSpotifyToken() {
    try {
      const response = await fetch('https://open.spotify.com/get_access_token?reason=transport&productType=web_player', {
        credentials: 'include'
      });
      if (response.ok) {
        const data = await response.json();
        return data.accessToken || null;
      }
    } catch (e) {
      console.warn('[LRC] Token fetch failed:', e);
    }
    return null;
  }

  // ── UI: Toast Notification ────────────────────────────────────────

  // ── UI: Prominent Notification ────────────────────────────────────

  function showProminentNotification(title, songName) {
    // Only show if not already visible for same song to avoid spam
    const existing = document.getElementById('lrc-notif');
    if (existing && existing.dataset.song === songName) return;
    if (existing) existing.remove();

    const notif = document.createElement('div');
    notif.id = 'lrc-notif';
    notif.className = 'lrc-notif';
    notif.dataset.song = songName;
    notif.innerHTML = `
      <div class="lrc-notif__title">${title}</div>
      <div class="lrc-notif__desc">${songName}</div>
      <div class="lrc-notif__sub">Click to open extension</div>
      <div class="lrc-notif__icon">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
        </svg>
      </div>
    `;

    document.body.appendChild(notif);

    // Fade in
    requestAnimationFrame(() => notif.classList.add('lrc-notif--visible'));

    // Remove on click or timeout
    notif.addEventListener('click', () => {
      const currentTrackId = getTrackIdFromPage();
      if (lyricsBuffer[currentTrackId]) {
        showLyricsModal(currentTrackId);
      }
      notif.classList.remove('lrc-notif--visible');
      setTimeout(() => notif.remove(), 500);
    });

    setTimeout(() => {
      if (notif.parentNode) {
        notif.classList.remove('lrc-notif--visible');
        setTimeout(() => notif.remove(), 500);
      }
    }, 5000);
  }

  function showLyricsModal(trackId) {
    const data = lyricsBuffer[trackId];
    if (!data) return;

    const overlay = document.createElement('div');
    overlay.className = 'lrc-modal-overlay';
    overlay.innerHTML = `
      <div class="lrc-modal">
        <div class="lrc-modal__header">
          <div class="lrc-modal__title">Synced Lyrics Ready</div>
          <div class="lrc-modal__close">✕</div>
        </div>
        <div class="lrc-modal__content">
          <div style="margin-bottom: 15px;">
            <div style="font-weight: 700; font-size: 16px;">${data.meta.title}</div>
            <div style="color: rgba(255,255,255,0.5); font-size: 14px;">${data.meta.artist}</div>
          </div>
          <div class="lrc-modal__lyrics">${data.lrc.split('\n').slice(0, 15).join('\n')}\n...</div>
        </div>
        <div class="lrc-modal__footer">
          <button class="lrc-modal__btn lrc-modal__btn--copy">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
            </svg>
            Copy LRC
          </button>
          <button class="lrc-modal__btn lrc-modal__btn--secondary lrc-modal__btn--download">
            Download .lrc
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('lrc-modal--visible'));

    // Close logic
    const close = () => {
      overlay.classList.remove('lrc-modal--visible');
      setTimeout(() => overlay.remove(), 300);
    };

    overlay.querySelector('.lrc-modal__close').onclick = close;
    overlay.onclick = (e) => { if (e.target === overlay) close(); };

    // Copy logic
    const copyBtn = overlay.querySelector('.lrc-modal__btn--copy');
    copyBtn.onclick = async () => {
      try {
        await navigator.clipboard.writeText(data.lrc);
        copyBtn.innerHTML = `
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
          Copied!
        `;
        copyBtn.style.background = '#1ed760';
        setTimeout(() => {
          copyBtn.innerHTML = `
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
            </svg>
            Copy LRC
          `;
          copyBtn.style.background = '';
        }, 1500);
      } catch (err) {
        log('Copy failed:', err);
      }
    };

    // Download logic
    overlay.querySelector('.lrc-modal__btn--download').onclick = () => {
      chrome.runtime.sendMessage({
        action: 'DOWNLOAD_LRC',
        lrc: data.lrc,
        filename: `${data.meta.artist} - ${data.meta.title}.lrc`
      });
      close();
    };
  }

  function showToast(message) {
    const existing = document.getElementById('lrc-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'lrc-toast';
    toast.className = 'lrc-toast';
    toast.textContent = message;
    document.body.appendChild(toast);

    requestAnimationFrame(() => toast.classList.add('lrc-toast--visible'));

    setTimeout(() => {
      toast.classList.remove('lrc-toast--visible');
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }


  // NOTE: Download button overlay removed at user request.
  // Use extension popup or "Download" inside popup for LRC files.


  // ── Message Handling (Popup Communication) ────────────────────────

    if (isContextValid()) {
    try {
      chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (!isContextValid()) return false;
        
        if (message.action === 'GET_TRACK_INFO') {
          const trackIdFromPage = getTrackIdFromPage();
          const meta = getTrackMetaFromDOM();
          
          // Buffer Lookup
          const bufferedData = lyricsBuffer[trackIdFromPage];
          
          // Secondary validation: ensure titles match (case-insensitive)
          const pageTitle = (meta.title || '').toLowerCase().trim();
          const bufferTitle = (bufferedData?.title || '').toLowerCase().trim();
          
          // Note: If pageTitle is empty, we allow the match based on ID alone
          const hasValidMatch = bufferedData && (pageTitle === bufferTitle || pageTitle === '');

          sendResponse({
            trackId: trackIdFromPage,
            meta: meta,
            hasLyrics: !!hasValidMatch,
            lyricsLineCount: hasValidMatch ? (bufferedData.rawLines?.length || 0) : 0,
            cachedLrc: hasValidMatch ? bufferedData.lrc : null,
            cachedMeta: hasValidMatch ? bufferedData.meta : null
          });
          return true;
        }

        if (message.action === 'GENERATE_LYRICS') {
          (async () => {
            try {
              const trackIdFromPage = getTrackIdFromPage();
              const meta = getTrackMetaFromDOM();
              const pageTitle = (meta.title || '').toLowerCase().trim();
              
              const bufferedData = lyricsBuffer[trackIdFromPage];
              const bufferTitle = (bufferedData?.title || '').toLowerCase().trim();

              if (bufferedData && (pageTitle === bufferTitle || pageTitle === '')) {
                sendResponse({ lrc: bufferedData.lrc, meta: bufferedData.meta });
                return;
              }

              const result = await manualFetchLyrics();
              sendResponse({ lrc: result.lrc, meta: result.meta });
            } catch (e) {
              sendResponse({ error: e.message });
            }
          })();
          return true;
        }

        if (message.action === 'FORCE_REFETCH') {
          lyricsBuffer = {};
          safeStorageRemove(['lyrics_buffer']);
          sendResponse({ ok: true });
          return true;
        }

        if (message.action === 'DEBUG_INFO') {
          const trackIdFromPage = getTrackIdFromPage();
          sendResponse({
            currentTrackId: trackIdFromPage,
            bufferSize: Object.keys(lyricsBuffer).length,
            hasLyricsForCurrent: !!lyricsBuffer[trackIdFromPage],
            url: window.location.href,
            documentTitle: document.title,
            pageTrackId: trackIdFromPage
          });
          return true;
        }

        return false;
      });
    } catch (e) {
      log('Failed to register message listener (context invalid)');
      contextValid = false;
    }
  }

  // ── Initialize ───────────────────────────────────────────────────

  function init() {
    log('Timed Lyrics Generator v1.0 initializing...');
    log('URL:', window.location.href);

    // 1. Interceptor runs via manifest.json (MAIN world, document_start)
    //    — no manual injection needed

    // 2. Start listening for intercepted lyrics data
    startLyricsListener();

    // 4. Check if we already have cached data in storage
    if (isContextValid()) {
      try {
        chrome.storage.local.get(['lyrics_buffer'], (data) => {
          if (chrome.runtime.lastError) return;
          if (data?.lyrics_buffer) {
            try {
                lyricsBuffer = JSON.parse(data.lyrics_buffer);
                log('Loaded buffered lyrics for ' + Object.keys(lyricsBuffer).length + ' tracks');
            } catch(e) {}
          }
        });
      } catch (e) {
        log('Storage read failed (context invalid)');
        contextValid = false;
      }
    }

    log('Initialized successfully. Waiting for Spotify to fetch lyrics...');
  }

  // Handle initialization
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(init, 1000));
  } else {
    setTimeout(init, 500);
  }

})();
