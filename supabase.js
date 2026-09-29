// ---- Supabase client, auth, and data sync ----
// This file replaces github.js. It keeps the same two function names the
// rest of the app already calls — fetchAll() and pushFile(kind) — so
// library.js, check.js and app.js did not need to change how they save.

let supabaseClient = null;
let currentUser = null;
let lastGitHubError = ''; // kept under this name so existing UI messages elsewhere don't need edits

function initSupabase() {
  if (!cfg.supabaseUrl || !cfg.supabaseAnonKey || !window.supabase) { supabaseClient = null; return; }
  try { supabaseClient = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey); }
  catch (e) { supabaseClient = null; }
}

function showAuthGate(message) {
  document.getElementById('appRoot').style.display = 'none';
  document.getElementById('authGate').style.display = 'flex';
  if (message) { const m = document.getElementById('authMsg'); m.style.color = 'var(--rust)'; m.textContent = message; }
}
function hideAuthGate() {
  document.getElementById('authGate').style.display = 'none';
  document.getElementById('appRoot').style.display = '';
}

async function signIn(email, password) {
  if (!supabaseClient) return 'Enter your Supabase project URL and anon key below first, then save.';
  const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
  return error ? error.message : null;
}
async function signUp(email, password) {
  if (!supabaseClient) return 'Enter your Supabase project URL and anon key below first, then save.';
  const { error } = await supabaseClient.auth.signUp({ email, password });
  return error ? error.message : null;
}
async function signOutUser() {
  if (supabaseClient) { try { await supabaseClient.auth.signOut(); } catch (e) {} }
  currentUser = null;
  showAuthGate();
}

// ---- Row <-> app-object mapping (Postgres uses snake_case; the app uses camelCase) ----
function toItemRow(i) {
  return {
    id: i.id, title: i.title, format: i.format || 'Unknown', barcode: i.barcode || null,
    cover: sanitizeCoverUrl(i.cover), added: i.added || new Date().toISOString(),
    production_year: i.productionYear || null, premiere_date: i.premiereDate || null,
    official_rating: i.officialRating || null, community_rating: i.communityRating || null,
    critic_rating: i.criticRating || null, runtime_minutes: i.runtimeMinutes || null,
    media_type: i.mediaType || 'Movie', status: i.status || null,
    provider_ids: i.providerIds || {}, jellyfin_id: i.jellyfinId || null,
    jellyfin_collection_ids: i.jellyfinCollectionIds || [], jellyfin_collection_names: i.jellyfinCollectionNames || [],
    user_id: currentUser.id
  };
}
function fromItemRow(r) {
  return {
    id: r.id, title: r.title, format: r.format, barcode: r.barcode, cover: r.cover, added: r.added,
    productionYear: r.production_year, premiereDate: r.premiere_date, officialRating: r.official_rating,
    communityRating: r.community_rating, criticRating: r.critic_rating, runtimeMinutes: r.runtime_minutes,
    mediaType: r.media_type, status: r.status, providerIds: r.provider_ids || {}, jellyfinId: r.jellyfin_id,
    jellyfinCollectionIds: r.jellyfin_collection_ids || [], jellyfinCollectionNames: r.jellyfin_collection_names || []
  };
}
function toWishRow(i) { return { id: i.id, title: i.title, cover: sanitizeCoverUrl(i.cover), added: i.added || new Date().toISOString(), user_id: currentUser.id }; }
function fromWishRow(r) { return { id: r.id, title: r.title, cover: r.cover, added: r.added }; }

function markPending(kind) {
  cacheState = { userId: currentUser && currentUser.id, items: data.items, wishlist: data.wishlist, timestamp: Date.now(),
    itemsPending: kind === 'items' ? true : cacheState.itemsPending,
    wishlistPending: kind === 'wishlist' ? true : cacheState.wishlistPending };
  persistCache();
}
function markSynced(kind) {
  cacheState = { userId: currentUser && currentUser.id, items: data.items, wishlist: data.wishlist, timestamp: Date.now(),
    itemsPending: kind === 'items' ? false : cacheState.itemsPending,
    wishlistPending: kind === 'wishlist' ? false : cacheState.wishlistPending };
  persistCache();
}

// Mirrors the in-memory array into the table: replaces every row this user
// owns with the current array. Simple and correct for one person's library;
// if you ever use the app from two devices at once, the last save wins,
// same as the old whole-file GitHub approach.
async function pushFile(kind) {
  if (!supabaseClient || !currentUser) { lastGitHubError = 'Not signed in.'; markPending(kind); return false; }
  const table = kind === 'items' ? 'items' : 'wishlist';
  const toRow = kind === 'items' ? toItemRow : toWishRow;
  const payload = (kind === 'items' ? data.items : data.wishlist).map(toRow);
  try {
    const del = await supabaseClient.from(table).delete().eq('user_id', currentUser.id);
    if (del.error) throw del.error;
    if (payload.length) {
      const ins = await supabaseClient.from(table).insert(payload);
      if (ins.error) throw ins.error;
    }
    markSynced(kind);
    return true;
  } catch (e) {
    lastGitHubError = (e && e.message) ? `Supabase error — ${e.message}` : 'Could not save to Supabase.';
    markPending(kind);
    return false;
  }
}

async function fetchAll() {
  initSupabase();
  if (!supabaseClient) { showAuthGate(); return; }

  const { data: sessionData } = await supabaseClient.auth.getSession();
  if (!sessionData || !sessionData.session) { showAuthGate(); return; }
  currentUser = sessionData.session.user;
  document.getElementById('acctEmail').textContent = currentUser.email || '';
  hideAuthGate();

  setStatus('Loading your library…', null);
  const cacheValid = cacheState && cacheState.userId === currentUser.id;
  try {
    const [itemsRes, wishRes] = await Promise.all([
      supabaseClient.from('items').select('*').order('title'),
      supabaseClient.from('wishlist').select('*').order('title')
    ]);
    if (itemsRes.error) throw itemsRes.error;
    if (wishRes.error) throw wishRes.error;

    data = { items: itemsRes.data.map(fromItemRow), wishlist: wishRes.data.map(fromWishRow) };
    ready = true;

    let resynced = false;
    if (cacheValid && cacheState.itemsPending) { data.items = cacheState.items; if (await pushFile('items')) resynced = true; }
    if (cacheValid && cacheState.wishlistPending) { data.wishlist = cacheState.wishlist; if (await pushFile('wishlist')) resynced = true; }

    cacheState = { userId: currentUser.id, items: data.items, wishlist: data.wishlist, itemsPending: false, wishlistPending: false, timestamp: Date.now() };
    persistCache();
    setStatus(`Library loaded — ${data.items.filter(i => (i.mediaType || 'Movie') === 'Movie').length} movies, ${data.items.filter(i => i.mediaType === 'Series').length} series, ${data.wishlist.length} on wishlist.${resynced ? ' Offline changes synced.' : ''}`, 'ok');
  } catch (e) {
    if (cacheValid) {
      data = { items: cacheState.items, wishlist: cacheState.wishlist };
      ready = true;
      const when = cacheState.timestamp ? new Date(cacheState.timestamp).toLocaleString() : 'earlier';
      setStatus(`Offline — showing cached data from ${when}.${(cacheState.itemsPending || cacheState.wishlistPending) ? ' You have unsynced changes.' : ''}`, 'warn');
    } else {
      setStatus('Could not reach Supabase and no offline copy is saved yet.', 'err');
    }
  }
  renderAll();
}
