const CONFIG_KEY = 'reelcheck-config';
  const CACHE_KEY = 'reelcheck-cache';
  const VIEW_KEY = 'reelcheck-view';

  function loadConfig() {
    try { return JSON.parse(localStorage.getItem(CONFIG_KEY)) || {}; } catch (e) { return {}; }
  }
  function saveConfig(c) { try { localStorage.setItem(CONFIG_KEY, JSON.stringify(c)); } catch (e) {} }
  function loadCache() { try { return JSON.parse(localStorage.getItem(CACHE_KEY)) || null; } catch (e) { return null; } }
  function persistCache() { try { localStorage.setItem(CACHE_KEY, JSON.stringify(cacheState)); } catch (e) {} }

  let cfg = loadConfig();
  // Drop settings from earlier versions of the app (Jellyfin direct-connect,
  // then later the Supabase-backed storage) that are no longer used.
  ['jfUrl','jfUserId','jfApiKey','owner','repo','libraryPath','wishlistPath','token'].forEach(k => { if (cfg[k] !== undefined) delete cfg[k]; });
  saveConfig(cfg);
  let data = { items: [], wishlist: [] };
  let ready = false;
  let view = localStorage.getItem(VIEW_KEY) || 'grid';
  let activeFormat = 'all';
  let activeType = 'all';
  let cacheState = loadCache() || { userId: null, items: [], wishlist: [], itemsPending: false, wishlistPending: false, timestamp: null };

  function configComplete() { return !!currentUser; }
  function escapeHtml(s) { return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  // Search helper: lowercases, strips accents, and drops every character that
  // isn't a letter or number (hyphens, colons, apostrophes, spaces, etc.), so
  // "spiderman", "spider man" and "Spider-Man: Homecoming" all line up.
  function normalizeSearch(s) {
    return String(s || '')
      .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/&/g, 'and')
      .replace(/[^\p{L}\p{N}]+/gu, '');
  }
  function titleMatches(title, normalizedQuery) {
    return !normalizedQuery || normalizeSearch(title).includes(normalizedQuery);
  }
  // "Add to wishlist" link shown in the Safe to buy message and the empty Library
  // state. The click is handled in app.js.
  function wishlistLinkHtml(title) {
    return `<span class="wish-action"><a href="#" class="wish-link" role="button" data-title="${escapeHtml(title)}">Add to wishlist</a>.</span>`;
  }
  // Only accept http(s) image URLs from untrusted sources (restored backups,
  // pasted import data). Escaping already prevents markup injection, but this
  // stops anything odd (javascript:, data:, etc.) from being stored at all.
  function sanitizeCoverUrl(url) {
    if (!url) return null;
    try { const u = new URL(String(url), document.baseURI); return /^https?:$/.test(u.protocol) ? u.href : null; }
    catch (e) { return null; }
  }
  function normalizeItems(raw) { return Array.isArray(raw) ? raw : (raw && Array.isArray(raw.items) ? raw.items : []); }
  function normalizeWishlist(raw) { return Array.isArray(raw) ? raw : (raw && Array.isArray(raw.wishlist) ? raw.wishlist : []); }

  const statusEl = document.getElementById('syncStatus');
  function setStatus(msg, kind) {
    statusEl.textContent = msg;
    statusEl.style.borderColor = kind === 'ok' ? 'var(--teal)' : kind === 'err' ? 'var(--rust)' : kind === 'warn' ? 'var(--amber)' : 'var(--line)';
    statusEl.style.color = kind === 'ok' ? 'var(--teal)' : kind === 'err' ? 'var(--rust)' : kind === 'warn' ? 'var(--amber)' : 'var(--ink-dim)';
  }
