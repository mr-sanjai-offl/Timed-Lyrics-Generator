/**
 * Timed Lyrics Generator — Background Service Worker
 * Handles downloads, tab communication, and cross-context messaging.
 */

// ── Download Handler ─────────────────────────────────────────────

function downloadFile(content, filename, type = 'text/plain') {
  const blob = new Blob([content], { type: `${type};charset=utf-8` });
  const reader = new FileReader();

  reader.onloadend = () => {
    chrome.downloads.download({
      url: reader.result,
      filename: filename,
      saveAs: true
    });
  };

  reader.readAsDataURL(blob);
}

// ── Message Handler ──────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  if (message.action === 'DOWNLOAD_FILE') {
    const { content, filename, type } = message;
    downloadFile(content, filename || 'lyrics.lrc', type);
    sendResponse({ success: true });
    return true;
  }

  if (message.action === 'GET_ACTIVE_TAB') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        sendResponse({ tab: tabs[0] });
      } else {
        sendResponse({ error: 'No active tab found.' });
      }
    });
    return true;
  }

  if (message.action === 'SEND_TO_CONTENT') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, message.payload, (response) => {
          sendResponse(response);
        });
      } else {
        sendResponse({ error: 'No Spotify tab found.' });
      }
    });
    return true;
  }

  return false;
});

// ── Tab Update Listener ──────────────────────────────────────────

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url && tab.url && tab.url.includes('open.spotify.com/track/')) {
    chrome.tabs.sendMessage(tabId, { action: 'URL_CHANGED', url: changeInfo.url })
      .catch(() => { /* content script may not be loaded yet */ });
  }
});

// ── Installation Handler ─────────────────────────────────────────

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('[LRC] Extension installed successfully.');
  }
});
