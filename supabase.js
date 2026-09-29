// ---- Supabase client, auth, and data sync ----
// Supabase auth and data sync. Keep the app-facing fetchAll() and pushFile()
// functions stable so views can save without knowing the storage details.

let supabaseClient = null;
let currentUser = null;
let lastSupabaseError = '';
let supabaseInitError = '';

function initSupabase() {
  supabaseClient = null;
  supabaseInitError = '';
  if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) {
    supabaseInitError = 'Enter your Supabase project URL and anon public key, then save the settings.';
    return;
  }
  if (!window.supabase) {
    supabaseInitError = 'The Supabase client library did not load. Check your internet connection and reload the app.';
    return;
  }
  try {
    const parsed = new URL(cfg.supabaseUrl.trim());
    if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost') throw new Error('Supabase project URL must use HTTPS.');
    if (parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error('Enter only the Supabase project URL.');
    // The JS client needs the project root, not REST/Auth endpoint URLs.
    const path = parsed.pathname.replace(/\/(rest|auth|storage|functions)\/v1\/?$/, '').replace(/\/+$/, '');
    if (path) throw new Error('Use the root project URL, for example https://your-project.supabase.co, without a path.');
    cfg.supabaseUrl = parsed.origin;
    supabaseClient = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
  } catch (e) { supabaseInitError = e.message || 'Check your Supabase project URL.'; }
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
  if (!supabaseClient) return supabaseInitError || 'Supabase is not configured.';
  const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
  return error ? error.message : null;
}
async function signUp(email, password) {
  if (!supabaseClient) return supabaseInitError || 'Supabase is not configured.';
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
    container: i.container || null, file_size: i.fileSize ?? null, video_label: i.videoLabel || null,
    video_width: i.videoWidth ?? null, video_height: i.videoHeight ?? null, video_codec: i.videoCodec || null,
    audio_label: i.audioLabel || null, audio_codec: i.audioCodec || null, has_subtitles: i.hasSubtitles ?? null,
    played: i.played ?? null, play_count: i.playCount ?? null, last_played: i.lastPlayed || null,
    unplayed_count: i.unplayedCount ?? null, collection_id: i.collectionId || null,
    user_id: currentUser.id
  };
}
function fromItemRow(r) {
  return {
    id: r.id, title: r.title, format: r.format, barcode: r.barcode, cover: r.cover, added: r.added,
    productionYear: r.production_year, premiereDate: r.premiere_date, officialRating: r.official_rating,
    communityRating: r.community_rating, criticRating: r.critic_rating, runtimeMinutes: r.runtime_minutes,
    mediaType: r.media_type, status: r.status, providerIds: r.provider_ids || {}, jellyfinId: r.jellyfin_id,
    jellyfinCollectionIds: r.jellyfin_collection_ids || [], jellyfinCollectionNames: r.jellyfin_collection_names || [],
    container: r.container, fileSize: r.file_size, videoLabel: r.video_label,
    videoWidth: r.video_width, videoHeight: r.video_height, videoCodec: r.video_codec,
    audioLabel: r.audio_label, audioCodec: r.audio_codec, hasSubtitles: r.has_subtitles,
    played: r.played, playCount: r.play_count, lastPlayed: r.last_played,
    unplayedCount: r.unplayed_count, collectionId: r.collection_id
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

// Upsert changed/current rows before deleting removed rows. This avoids the
// old delete-then-insert failure mode that could erase a whole collection.
async function pushFile(kind) {
  if (!supabaseClient || !currentUser) { lastSupabaseError = 'Not signed in.'; markPending(kind); return false; }
  const table = kind === 'items' ? 'items' : 'wishlist';
  const toRow = kind === 'items' ? toItemRow : toWishRow;
  if (kind !== 'items' && kind !== 'wishlist') throw new Error(`Unknown data set: ${kind}`);
  const records = kind === 'items' ? data.items : data.wishlist;
  const payload = records.map(toRow);
  try {
    if (payload.length) {
      const upsert = await supabaseClient.from(table).upsert(payload, { onConflict: 'user_id,id' });
      if (upsert.error) throw upsert.error;
    }
    let delQuery = supabaseClient.from(table).delete().eq('user_id', currentUser.id);
    const ids = records.map(i => i.id).filter(id => id != null).map(String);
    if (ids.length) delQuery = delQuery.not('id', 'in', `(${ids.map(id => `"${id.replace(/"/g, '\\"')}"`).join(',')})`);
    const del = await delQuery;
    if (del.error) throw del.error;
    markSynced(kind);
    return true;
  } catch (e) {
    lastSupabaseError = (e && e.message) ? `Supabase error — ${e.message}` : 'Could not save to Supabase.';
    markPending(kind);
    return false;
  }
}

async function fetchAll() {
  initSupabase();
  if (!supabaseClient) { showAuthGate(); return; }

  const { data: sessionData, error: sessionError } = await supabaseClient.auth.getSession();
  if (sessionError) { showAuthGate(sessionError.message); return; }
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
