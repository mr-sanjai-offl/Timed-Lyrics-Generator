/**
 * Timed Lyrics Generator — Popup Script
 */

(() => {
  'use strict';

  // ── DOM Elements ─────────────────────────────────────────────────
  const trackTitle = document.getElementById('trackTitle');
  const trackArtist = document.getElementById('trackArtist');
  const statusDot = document.getElementById('statusDot');
  const generateBtn = document.getElementById('generateBtn');
  const aiCorrectBtn = document.getElementById('aiCorrectBtn');
  const copyBtn = document.getElementById('copyBtn');
  const downloadBtn = document.getElementById('downloadBtn');
  const lyricsOutput = document.getElementById('lyricsOutput');
  const statusBar = document.getElementById('statusBar');
  const settingsBtn = document.getElementById('settingsBtn');
  const settingsPanel = document.getElementById('settingsPanel');
  const apiKeyInput = document.getElementById('apiKeyInput');
  const modelIdInput = document.getElementById('modelIdInput');
  const aiLabel = document.getElementById('aiLabel');
  const formatChips = document.querySelectorAll('.format-chip');

  let currentFormat = 'lrc';
  let currentLRC = '';
  let currentMeta = {};
  let isAiWorking = false;

  // ── UI States ────────────────────────────────────────────────────
  function setStatus(text, type = '') {
    statusBar.textContent = text;
    statusBar.className = 'status-bar' + (type ? ` ${type}` : '');
  }

  function setLoading(loading) {
    generateBtn.disabled = loading;
    generateBtn.innerHTML = loading ? '<div class="spinner"></div> Generating...' : 'Generate Sync Lyrics';
  }

  function setAiLoading(loading) {
    isAiWorking = loading;
    aiCorrectBtn.disabled = loading;
    aiCorrectBtn.innerHTML = loading ? 
        '<div class="spinner"></div> AI Processing...' : 
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm0 18a8 8 0 1 1 8-8 8 8 0 0 1-8 8z"/><path d="M12 6v6l4 2"/></svg> AI Fix Spelling & Context';
  }

  // ── Communication ────────────────────────────────────────────────
  async function sendToContentScript(payload) {
    return new Promise((resolve, reject) => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (!tabs[0] || !tabs[0].url.includes('open.spotify.com')) {
          reject(new Error('Please open Spotify Web Player and play a song.'));
          return;
        }
        chrome.tabs.sendMessage(tabs[0].id, payload, (response) => {
          if (chrome.runtime.lastError) {
             reject(new Error('Connection failed. Refresh the Spotify tab.'));
             return;
          }
          resolve(response);
        });
      });
    });
  }

  // ── AI Logic ─────────────────────────────────────────────────────
  async function correctWithAI() {
    if (isAiWorking) return;
    const lrc = lyricsOutput.value;
    if (!lrc) {
        setStatus('Generate lyrics first!', 'error');
        return;
    }

    const { openrouter_api_key, openrouter_model_id } = await chrome.storage.local.get(['openrouter_api_key', 'openrouter_model_id']);
    if (!openrouter_api_key) {
        settingsPanel.style.display = 'block';
        setStatus('Please enter your OpenRouter API Key', 'error');
        return;
    }

    const modelId = openrouter_model_id || 'openrouter/auto';

    try {
        setAiLoading(true);
        setStatus('AI is correcting text...', 'working');

        const prompt = `You are a lyrics correction expert. 
        TASK: Fix spelling, grammar, and word joining in the provided LRC lyrics.
        IMPORTANT: DO NOT TRANSLATE. If lyrics are in Tanglish (Latin script), KEEP them in Latin script. If they are in Tamil script, KEEP them in Tamil script.
        
        RULES:
        1. NO TRANSLATION: Do not convert English/Tanglish to Tamil or vice-versa.
        2. TAMIL: Fix spelling and apply proper word joining (sandhi).
        3. ENGLISH: Fix grammar/capitalization. Keep stylistic casing if intentional.
        4. TANGLISH: Mixed format should be natural Latin script (phonetic). Convert "'u" to "-u" (e.g., God'u -> God-u).
        5. PRESERVE ALL LRC TIMESTAMPS [mm:ss.xxx].
        6. Return ONLY the corrected LRC content. No chat or instructions.

        INPUT LYRICS:
        ${lrc}`;

        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${openrouter_api_key}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': 'https://github.com/timed-lyrics-generator',
                'X-Title': 'Timed Lyrics Generator'
            },
            body: JSON.stringify({
                model: modelId,
                messages: [{ role: 'user', content: prompt }]
            })
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`API Error (${response.status}): ${errText.substring(0, 50)}`);
        }

        const data = await response.json();
        if (data.error) {
            console.error('OpenRouter Error:', data.error);
            throw new Error(data.error.message || 'Provider returned error');
        }
        
        const correctedLrc = data.choices[0].message.content.trim();
        if (correctedLrc.includes('[')) {
            lyricsOutput.value = correctedLrc;
            currentLRC = correctedLrc;
            setStatus('✓ AI Correction applied!', 'success');
        } else {
            throw new Error('AI returned invalid format');
        }

    } catch (e) {
        setStatus('AI Error: ' + e.message, 'error');
        // console.error(e);
    } finally {
        setAiLoading(false);
    }
  }

  // ── Track Info ───────────────────────────────────────────────────
  async function loadTrackInfo() {
    try {
      const response = await sendToContentScript({ action: 'GET_TRACK_INFO' });
      const apiData = await chrome.storage.local.get('openrouter_api_key');
      
      if (apiData.openrouter_api_key) {
          aiLabel.classList.remove('hidden');
          aiCorrectBtn.style.display = 'flex';
      }

      if (response && (response.hasLyrics || response.meta)) {
          const meta = response.cachedMeta || response.meta || {};
          trackTitle.textContent = meta.title || 'Unknown Track';
          trackArtist.textContent = meta.artist || 'Unknown Artist';
          currentMeta = meta;
          statusDot.className = 'status-dot active';

          if (response.cachedLrc) {
              currentLRC = response.cachedLrc;
              lyricsOutput.value = currentLRC;
              copyBtn.disabled = false;
              downloadBtn.disabled = false;
              setStatus('Ready to export', 'success');
          }
      }
    } catch (e) {
      trackTitle.textContent = 'Sync Connection Lost';
      trackArtist.textContent = 'Please refresh Spotify page';
      statusDot.className = 'status-dot inactive';
      setStatus(e.message, 'error');
    }
  }

  // ── Core Actions ─────────────────────────────────────────────────
  async function generateLyrics() {
    try {
      setLoading(true);
      setStatus('Capturing...', '');
      const response = await sendToContentScript({ action: 'GENERATE_LYRICS' });
      
      if (response.error) throw new Error(response.error);
      
      currentLRC = response.lrc;
      currentMeta = response.meta || {};
      lyricsOutput.value = currentLRC;
      
      copyBtn.disabled = false;
      downloadBtn.disabled = false;
      setStatus('✓ Captured', 'success');
    } catch (e) {
      setStatus(e.message, 'error');
    } finally {
      setLoading(false);
    }
  }

  function downloadFile() {
    if (!currentLRC) return;
    const filename = `${currentMeta.artist || 'artist'} - ${currentMeta.title || 'title'}.${currentFormat}`;
    chrome.runtime.sendMessage({
      action: 'DOWNLOAD_FILE',
      content: lyricsOutput.value,
      filename: filename.replace(/[<>:"/\\|?*]/g, ''),
      type: 'text/plain'
    }, () => setStatus('Saved!', 'success'));
  }

  // ── Event Listeners ──────────────────────────────────────────────
  settingsBtn.onclick = () => {
      const isVisible = settingsPanel.style.display === 'block';
      settingsPanel.style.display = isVisible ? 'none' : 'block';
  };

  apiKeyInput.onchange = (e) => {
      const val = e.target.value.trim();
      chrome.storage.local.set({ openrouter_api_key: val });
      if (val) {
          aiLabel.classList.remove('hidden');
          aiCorrectBtn.style.display = 'flex';
      } else {
          aiLabel.classList.add('hidden');
          aiCorrectBtn.style.display = 'none';
      }
  };

  modelIdInput.onchange = (e) => {
      const val = e.target.value.trim();
      chrome.storage.local.set({ openrouter_model_id: val });
  };

  generateBtn.onclick = generateLyrics;
  aiCorrectBtn.onclick = correctWithAI;
  copyBtn.onclick = () => {
      navigator.clipboard.writeText(lyricsOutput.value);
      setStatus('Copied!', 'success');
  };
  downloadBtn.onclick = downloadFile;

  formatChips.forEach(chip => {
    chip.onclick = () => {
        currentFormat = chip.dataset.format;
        formatChips.forEach(c => c.classList.toggle('active', c === chip));
    };
  });

  // Init
  chrome.storage.local.get(['openrouter_api_key', 'openrouter_model_id'], (data) => {
      if (data.openrouter_api_key) {
          apiKeyInput.value = data.openrouter_api_key;
          aiLabel.classList.remove('hidden');
          aiCorrectBtn.style.display = 'flex';
      }
      if (data.openrouter_model_id) {
          modelIdInput.value = data.openrouter_model_id;
      }
  });

  loadTrackInfo();

})();
