const CONFIG_KEY = 'reelcheck-config';
  const CACHE_KEY = 'reelcheck-cache';
  const VIEW_KEY = 'reelcheck-view';
  // Public browser-app credentials. Supabase's anon key is safe to ship in a
  // client app; database access is restricted by the tables' RLS policies.
  const APP_SUPABASE_URL = 'https://nxqrjmvghczeygvwzxsl.supabase.co';
  const APP_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im54cXJqbXZnaGN6ZXlndnd6eHNsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA2NTk1NzgsImV4cCI6MjEwNjIzNTU3OH0.bolaxF48R_TH6heuIQasn7LzxRfpV8DbhuzlfT6IXgY';

  function loadConfig() {
    try { return { ...JSON.parse(localStorage.getItem(CONFIG_KEY) || '{}'), supabaseUrl: APP_SUPABASE_URL, supabaseAnonKey: APP_SUPABASE_ANON_KEY }; } catch (e) { return { supabaseUrl: APP_SUPABASE_URL, supabaseAnonKey: APP_SUPABASE_ANON_KEY }; }
  }
  function saveConfig(c) {
    try {
      const { supabaseUrl, supabaseAnonKey, ...userConfig } = c;
      localStorage.setItem(CONFIG_KEY, JSON.stringify(userConfig));
    } catch (e) {}
  }
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
  const SPELLING_PAIRS = [
    ['analyze', 'analyse'], ['organize', 'organise'], ['recognize', 'recognise'], ['realize', 'realise'],
    ['apologize', 'apologise'], ['color', 'colour'], ['favorite', 'favourite'], ['honor', 'honour'],
    ['labor', 'labour'], ['neighbor', 'neighbour'], ['behavior', 'behaviour'], ['rumor', 'rumour'],
    ['flavor', 'flavour'], ['center', 'centre'], ['theater', 'theatre'], ['defense', 'defence'],
    ['offense', 'offence'], ['gray', 'grey'], ['jewelry', 'jewellery'], ['catalog', 'catalogue'],
    ['dialog', 'dialogue'], ['traveled', 'travelled'], ['traveling', 'travelling'],
    ['canceled', 'cancelled'], ['canceling', 'cancelling'], ['license', 'licence'], ['practice', 'practise']
  ];
  const SPELLING_VARIANTS = new Map(SPELLING_PAIRS.flatMap(([us, uk]) => [[us, uk], [uk, us]]));
  function spellingSearchVariants(value) {
    const words = String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
      .replace(/&/g, ' and ').toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
    let variants = [words];
    words.forEach((word, index) => {
      const alternative = SPELLING_VARIANTS.get(word);
      if (alternative && variants.length < 16) {
        variants = [...variants, ...variants.map(variant => {
          const changed = [...variant];
          changed[index] = alternative;
          return changed;
        })].slice(0, 16);
      }
    });
    return [...new Set(variants.map(variant => variant.join(' ')))];
  }
  function titleMatches(title, normalizedQuery, rawQuery = '') {
    if (!normalizedQuery) return true;
    const normalizedTitle = normalizeSearch(title);
    const spellings = spellingSearchVariants(rawQuery || normalizedQuery).map(normalizeSearch);
    if (spellings.some(query => query && normalizedTitle.includes(query))) return true;
    const words = (String(rawQuery || '').toLowerCase().match(/[\p{L}\p{N}]+/gu) || []).filter(word => word !== 'and');
    return words.length > 1 && words.every(word => spellingSearchVariants(word).map(normalizeSearch).some(variant => normalizedTitle.includes(variant)));
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
