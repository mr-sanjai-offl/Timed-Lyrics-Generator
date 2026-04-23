/**
 * Timed Lyrics Generator — Utility Functions
 * Handles timestamp conversion, lyrics cleaning, and LRC formatting.
 */

const LRCUtils = (() => {

  /**
   * Convert milliseconds to LRC timestamp format [mm:ss.xxx]
   * @param {number|string} ms - Milliseconds
   * @returns {string} Formatted timestamp
   */
  function msToLRC(ms) {
    const totalMs = parseInt(ms, 10);
    if (isNaN(totalMs) || totalMs < 0) return '[00:00.000]';

    const minutes = Math.floor(totalMs / 60000);
    const seconds = Math.floor((totalMs % 60000) / 1000);
    const milliseconds = totalMs % 1000;

    const mm = String(minutes).padStart(2, '0');
    const ss = String(seconds).padStart(2, '0');
    const xxx = String(milliseconds).padStart(3, '0');

    return `[${mm}:${ss}.${xxx}]`;
  }

  /**
   * Detect language of a text line
   * @param {string} text
   * @returns {'tamil'|'english'|'tanglish'}
   */
  function detectLanguage(text) {
    const tamilPattern = /[\u0B80-\u0BFF]/;
    const latinPattern = /[a-zA-Z]/;

    const hasTamil = tamilPattern.test(text);
    const hasLatin = latinPattern.test(text);

    if (hasTamil && hasLatin) return 'tanglish';
    if (hasTamil) return 'tamil';
    return 'english';
  }

  /**
   * Clean a single lyric line
   * @param {string} text
   * @returns {string|null} Cleaned text or null if should be skipped
   */
  function cleanLine(text) {
    if (!text || typeof text !== 'string') return null;

    let cleaned = text
      .replace(/♪/g, '')
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      .trim();

    if (!cleaned) return null;
    if (/^[^\w\u0B80-\u0BFF]+$/.test(cleaned)) return null;

    return cleaned;
  }

  /**
   * Advanced normalization and correction based on detected language
   * @param {string} text
   * @returns {string}
   */
  function normalizeText(text) {
    const lang = detectLanguage(text);

    // ── Pre-Cleanup (Universal) ──
    let normalized = text
      .replace(/\s+/g, ' ')
      .trim();

    switch (lang) {
      case 'tamil':
        // ── Tamil Advanced Correction ──
        return normalized
          // Fix common spelling/character artifacts
          .replace(/ஸ்ரீ/g, 'ஸ்ரீ')
          // Sandhi awareness: Join common prefixes/suffixes
          .replace(/\s+(ஆக|இன்|உம்|ஆல்|ஐ|கு|உடன்)\b/g, '$1')
          .replace(/\s+இருந்து\b/g, 'இருந்து')
          .trim();

      case 'english':
        // ── English Advanced Correction ──
        return normalized
          // Fix capitalization for "I"
          .replace(/\bi\b/g, 'I')
          .replace(/\bi'm\b/gi, "I'm")
          .replace(/\bi'll\b/gi, "I'll")
          .replace(/\bi've\b/gi, "I've")
          // Fix common missing apostrophes
          .replace(/\b(cant|dont|wont|isnt|arent|couldnt|shouldnt)\b/gi, (m) => {
             const map = { cant:"can't", dont:"don't", wont:"won't", isnt:"isn't", arent:"aren't", couldnt:"couldn't", shouldnt:"shouldn't" };
             return map[m.toLowerCase()] || m;
          })
          // Capitalize first letter of line (English standard)
          .replace(/^[a-z]/, (m) => m.toUpperCase())
          .trim();

      case 'tanglish':
        // ── Tanglish Advanced Correction ──
        return normalized
          // Handle the "God'u mode'u" -> "God-u mode-u" requirement
          // Matches 'u, 'ah, 'oh etc after a word
          .replace(/([a-zA-Z])'([a-z]{1,2})\b/g, '$1-$2')
          .replace(/([a-zA-Z])'ah\b/g, '$1-ah')
          // Optional: Add Tamil script for known Tanglish suffixes (Lorry'ah -> லாரியக்)
          // But prioritizing clarity as requested: lorry-ah
          .replace(/\s{2,}/g, ' ')
          .trim();

      default:
        return normalized;
    }
  }

  /**
   * Process raw Spotify lyrics data into LRC lines
   * @param {Array} lines - Array of {startTimeMs, words}
   * @returns {string} Full LRC content
   */
  function processLyrics(lines) {
    if (!Array.isArray(lines)) return '';

    const lrcLines = [];

    for (const line of lines) {
      const timeMs = line.startTimeMs || line.time;
      const words = line.words || line.text;

      const cleaned = cleanLine(words);
      if (!cleaned) continue;

      const normalized = normalizeText(cleaned);
      const timestamp = msToLRC(timeMs);

      lrcLines.push(`${timestamp} ${normalized}`);
    }

    return lrcLines.join('\n');
  }

  /**
   * Generate LRC file header metadata
   * @param {object} meta - {title, artist, album}
   * @returns {string}
   */
  function generateHeader(meta = {}) {
    const parts = [];
    if (meta.title) parts.push(`[ti:${meta.title}]`);
    if (meta.artist) parts.push(`[ar:${meta.artist}]`);
    if (meta.album) parts.push(`[al:${meta.album}]`);
    parts.push('[by:Timed Lyrics Generator]');
    parts.push('');
    return parts.join('\n');
  }

  /**
   * Build complete LRC content with header + lyrics
   * @param {Array} lines
   * @param {object} meta
   * @returns {string}
   */
  function buildLRC(lines, meta = {}) {
    const header = generateHeader(meta);
    const body = processLyrics(lines);
    return header + body;
  }

  /**
   * Extract track ID from Spotify URL
   * @param {string} url
   * @returns {string|null}
   */
  function extractTrackId(url) {
    const match = url.match(/track\/([a-zA-Z0-9]{22})/);
    return match ? match[1] : null;
  }

  /**
   * Sanitize filename
   * @param {string} name
   * @returns {string}
   */
  function sanitizeFilename(name) {
    return name
      .replace(/[<>:"/\\|?*]/g, '')
      .replace(/\s+/g, '_')
      .substring(0, 100);
  }

  return {
    msToLRC,
    detectLanguage,
    cleanLine,
    normalizeText,
    processLyrics,
    generateHeader,
    buildLRC,
    extractTrackId,
    sanitizeFilename
  };

})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = LRCUtils;
}
