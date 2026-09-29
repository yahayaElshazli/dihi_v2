  function renderAll() {
    renderLibrary();
    renderWishlist();
    if (checkInput.value.trim()) checkInput.dispatchEvent(new Event('input'));
    else renderCheckWishlist();
  }

  // ---- Auth gate ----
  document.getElementById('authSaveConfigBtn').addEventListener('click', () => {
    cfg.supabaseUrl = document.getElementById('authSupabaseUrl').value.trim();
    cfg.supabaseAnonKey = document.getElementById('authSupabaseKey').value.trim();
    saveConfig(cfg);
    initSupabase();
    const msg = document.getElementById('authMsg');
    msg.style.color = supabaseClient ? 'var(--teal)' : 'var(--rust)';
    msg.textContent = supabaseClient ? 'Saved. Create an account or sign in above.' : 'Enter both the project URL and the anon key.';
  });
  if (cfg.supabaseUrl) document.getElementById('authSupabaseUrl').value = cfg.supabaseUrl;
  if (cfg.supabaseAnonKey) document.getElementById('authSupabaseKey').value = cfg.supabaseAnonKey;

  async function handleAuth(action) {
    const email = document.getElementById('authEmail').value.trim();
    const password = document.getElementById('authPassword').value;
    const msg = document.getElementById('authMsg');
    if (!email || !password) { msg.style.color = 'var(--rust)'; msg.textContent = 'Enter an email and password.'; return; }
    msg.style.color = 'var(--ink-dim)'; msg.textContent = action === 'signup' ? 'Creating account…' : 'Signing in…';
    const error = action === 'signup' ? await signUp(email, password) : await signIn(email, password);
    if (error) { msg.style.color = 'var(--rust)'; msg.textContent = error; return; }
    if (action === 'signup') { msg.style.color = 'var(--teal)'; msg.textContent = 'Account created — check your email to confirm, then sign in.'; return; }
    msg.textContent = '';
    fetchAll();
  }
  document.getElementById('authSignInBtn').addEventListener('click', () => handleAuth('signin'));
  document.getElementById('authSignUpBtn').addEventListener('click', () => handleAuth('signup'));

  document.getElementById('signOutBtn').addEventListener('click', signOutUser);

  document.getElementById('saveTmdbBtn').addEventListener('click', () => {
    cfg.tmdbToken = document.getElementById('tmdbToken').value.trim();
    saveConfig(cfg);
    setStatus(cfg.tmdbToken ? 'TMDB token saved.' : 'TMDB token cleared — cover art lookups are off until you add one.', cfg.tmdbToken ? 'ok' : 'warn');
  });
  document.getElementById('resyncBtn').addEventListener('click', fetchAll);

  if (cfg.tmdbToken) document.getElementById('tmdbToken').value = cfg.tmdbToken;


// ---- Backup export / restore (covers both files) ----
  document.getElementById('exportBtn').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'do-i-have-it-backup-' + new Date().toISOString().slice(0,10) + '.json';
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  });
  document.getElementById('restoreBtn').addEventListener('click', () => document.getElementById('restoreFile').click());
  document.getElementById('restoreFile').addEventListener('change', (e) => {
    const file = e.target.files[0];
    const msg = document.getElementById('backupMsg');
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const parsed = JSON.parse(reader.result);
        const legacyWishlistFile = Array.isArray(parsed) && /wish/i.test(file.name);
        const incomingItems = Array.isArray(parsed) ? (legacyWishlistFile ? [] : parsed) : normalizeItems(parsed);
        const incomingWishlist = Array.isArray(parsed) ? (legacyWishlistFile ? parsed : []) : normalizeWishlist(parsed);
        const existing = new Set(data.items.map(i => i.title.toLowerCase()));
        let added = 0;
        incomingItems.forEach(i => {
          if (i && i.title && !existing.has(i.title.toLowerCase())) {
            data.items.push({ ...i, id: i.id || Date.now().toString(36) + Math.random().toString(36).slice(2,6), title: i.title, format: i.format || 'Unknown', barcode: i.barcode || '', cover: sanitizeCoverUrl(i.cover), added: i.added || new Date().toISOString() });
            existing.add(i.title.toLowerCase());
            added++;
          }
        });
        const wExisting = new Set(data.wishlist.map(i => i.title.toLowerCase()));
        let addedWish = 0;
        incomingWishlist.forEach(i => { if (i && i.title && !wExisting.has(i.title.toLowerCase())) { data.wishlist.push({ ...i, id: i.id || Date.now().toString(36) + Math.random().toString(36).slice(2,6), added: i.added || new Date().toISOString(), cover: sanitizeCoverUrl(i.cover) }); wExisting.add(i.title.toLowerCase()); addedWish++; } });
        renderAll();
        msg.style.color = 'var(--ink-dim)'; msg.textContent = 'Saving to Supabase…';
        const okItems = await pushFile('items');
        const okWish = addedWish ? await pushFile('wishlist') : true;
        const ok = okItems && okWish;
        msg.style.color = ok ? 'var(--teal)' : 'var(--rust)';
        msg.textContent = ok ? `Restored ${added} title${added===1?'':'s'} and ${addedWish} wishlist item${addedWish===1?'':'s'}.` : 'Merged locally, but could not save everything to Supabase. Try again.';
      } catch (err) {
        msg.style.color = 'var(--rust)'; msg.textContent = "That file didn't look like a valid backup.";
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  });

  // ---- Wishlist tab ----
  const wishlistCoverFetches = new Map();
  let wishlistCoverSaveTimer = null;

  function renderCheckWishlist() {
    const host = document.getElementById('checkWishlistGrid');
    if (!host) return;
    const q = normalizeSearch(checkInput.value);
    const items = [...data.wishlist].filter(i => titleMatches(i.title, q)).sort((a,b) => a.title.localeCompare(b.title));
    if (!items.length) {
      host.innerHTML = `<div class="empty">${q ? 'No wishlist titles match this search.' : 'Nothing on your wishlist yet.'}</div>`;
      return;
    }
    host.innerHTML = `<div class="check-wishlist-grid">${items.map(i => `
      <div class="check-wishlist-card">
        ${i.cover ? `<img src="${escapeHtml(i.cover)}" alt="${escapeHtml(i.title)} poster" loading="lazy">` : '<div class="wish-poster-placeholder">🎬</div>'}
        <div class="check-wishlist-title">${escapeHtml(i.title)}</div>
      </div>`).join('')}</div>`;
  }

  function queueWishlistCoverSave() {
    clearTimeout(wishlistCoverSaveTimer);
    wishlistCoverSaveTimer = setTimeout(async () => {
      if (configComplete(cfg)) await pushFile('wishlist');
    }, 700);
  }

  function renderWishlist() {
    const wishList = document.getElementById('wishList');
    const items = [...data.wishlist].sort((a,b) => a.title.localeCompare(b.title));
    if (!items.length) {
      wishList.innerHTML = `<div class="empty">${!ready ? 'Sign in to save.' : 'Nothing on your wishlist yet.'}</div>`;
      renderCheckWishlist();
      return;
    }
    wishList.innerHTML = items.map((i,index) => `
      <div class="wishlist-row">
        <div class="wishlist-poster-wrap">
          ${i.cover ? `<img class="wishlist-poster" src="${escapeHtml(i.cover)}" alt="${escapeHtml(i.title)} poster" loading="lazy">` : `<div class="wishlist-poster wishlist-poster-placeholder" data-placeholder-index="${index}">🎬</div>`}
        </div>
        <div class="wishlist-title">${escapeHtml(i.title)}</div>
        <button data-id="${escapeHtml(String(i.id || ''))}" class="delw">Remove</button>
      </div>`).join('');
    renderCheckWishlist();
    wishList.querySelectorAll('.delw').forEach(b => b.addEventListener('click', async () => {
      const prev = data.wishlist;
      data.wishlist = data.wishlist.filter(i => i.id !== b.dataset.id);
      renderWishlist();
      if (!(await pushFile('wishlist'))) { data.wishlist = prev; renderWishlist(); }
    }));

    if (!cfg.tmdbToken) return;
    items.forEach((item,index) => {
      if (item.cover || !item.title) return;
      const key = String(item.id || item.title).toLowerCase();
      if (wishlistCoverFetches.has(key)) return;
      const request = fetchCover(item.title, 'Movie').then(cover => {
        if (!cover || !data.wishlist.includes(item)) return;
        item.cover = cover;
        const currentItems = [...data.wishlist].sort((a,b) => a.title.localeCompare(b.title));
        const currentIndex = currentItems.indexOf(item);
        const placeholder = currentIndex >= 0 ? wishList.querySelector(`[data-placeholder-index="${currentIndex}"]`) : null;
        if (placeholder) {
          const img = document.createElement('img');
          img.className = 'wishlist-poster'; img.src = cover; img.alt = `${item.title} poster`; img.loading = 'lazy';
          placeholder.replaceWith(img);
        }
        renderCheckWishlist();
        queueWishlistCoverSave();
      }).finally(() => wishlistCoverFetches.delete(key));
      wishlistCoverFetches.set(key, request);
    });
  }
  // ---- "Add to wishlist" links (Safe to buy message + empty Library) ----
  document.addEventListener('click', async e => {
    const link = e.target.closest('.wish-link');
    if (!link) return;
    e.preventDefault();
    if (link.dataset.busy) return;
    const title = (link.dataset.title || '').trim();
    const wrap = link.closest('.wish-action') || link;
    if (!title) return;
    if (!configComplete(cfg)) { link.textContent = 'Sign in to save'; return; }
    const key = normalizeSearch(title);
    if (data.wishlist.some(w => normalizeSearch(w.title) === key)) { wrap.textContent = 'Already on your wishlist.'; return; }
    link.dataset.busy = '1';
    link.textContent = 'Saving…';
    data.wishlist.push({ id: Date.now().toString(36), title, added: new Date().toISOString() });
    const ok = await pushFile('wishlist');
    renderWishlist();
    wrap.textContent = ok ? 'Added to wishlist ✓' : 'Saved on this device, but syncing to Supabase failed.';
  });

  document.getElementById('wishAddBtn').addEventListener('click', async () => {
    const title = document.getElementById('wishTitle').value.trim();
    const msg = document.getElementById('wishMsg');
    if (!configComplete(cfg)) { msg.style.color = 'var(--rust)'; msg.textContent = 'Sign in to save.'; return; }
    if (!title) { msg.style.color = 'var(--rust)'; msg.textContent = 'Enter a title first.'; return; }
    data.wishlist.push({ id: Date.now().toString(36), title, added: new Date().toISOString() });
    msg.style.color = 'var(--ink-dim)'; msg.textContent = 'Saving to Supabase…';
    const ok = await pushFile('wishlist');
    msg.style.color = ok ? 'var(--teal)' : 'var(--rust)';
    msg.textContent = ok ? `Added "${title}" to your wishlist.` : (lastSupabaseError || 'Could not save to Supabase. Try again.');
    if (ok) document.getElementById('wishTitle').value = '';
    renderWishlist();
  });

  // ---- Add tab ----
  const addTitle = document.getElementById('addTitle');
  const dupWarn = document.getElementById('dupWarn');
  addTitle.addEventListener('input', () => {
    const q = normalizeSearch(addTitle.value);
    if (q.length < 3) { dupWarn.style.display = 'none'; return; }
    const match = data.items.find(i => { const t = normalizeSearch(i.title); return t && (t.includes(q) || q.includes(t)); });
    if (match) { dupWarn.style.display = 'block'; dupWarn.textContent = `⚠ You might already have "${match.title}".`; }
    else dupWarn.style.display = 'none';
  });

  document.getElementById('saveBtn').addEventListener('click', async () => {
    const title = addTitle.value.trim();
    const format = document.getElementById('addFormat').value;
    const barcode = document.getElementById('addBarcode').value.trim();
    const msg = document.getElementById('saveMsg');
    if (!configComplete(cfg)) { msg.style.color = 'var(--rust)'; msg.textContent = 'Sign in to save.'; return; }
    if (!title) { msg.style.color = 'var(--rust)'; msg.textContent = 'Enter a title first.'; return; }
    msg.style.color = 'var(--ink-dim)'; msg.textContent = 'Fetching cover…';
    const cover = await fetchCover(title, format);
    data.items.push({ id: Date.now().toString(36), title, format, barcode, cover, added: new Date().toISOString(), productionYear: null, premiereDate: null, officialRating: null, communityRating: null, criticRating: null, runtimeMinutes: null, container: null, fileSize: null, videoLabel: null, videoWidth: null, videoHeight: null, videoCodec: null, audioLabel: null, audioCodec: null, hasSubtitles: false, played: false, playCount: 0, lastPlayed: null, mediaType: 'Movie', status: null, unplayedCount: null, providerIds: {}, collectionId: null, jellyfinId: null, jellyfinCollectionIds: [], jellyfinCollectionNames: [] });
    msg.textContent = 'Saving to Supabase…';
    const ok = await pushFile('items');
    msg.style.color = ok ? 'var(--teal)' : 'var(--rust)';
    msg.textContent = ok ? `Added "${title}" to your library.` : (lastSupabaseError || 'Could not save to Supabase. Try again.');
    if (ok) { addTitle.value = ''; document.getElementById('addBarcode').value = ''; dupWarn.style.display = 'none'; }
    renderLibrary();
  });

  // ---- Import tab ----
  document.getElementById('importBtn').addEventListener('click', async () => {
    const raw = document.getElementById('importText').value;
    const msg = document.getElementById('importMsg');
    if (!configComplete(cfg)) { msg.style.color = 'var(--rust)'; msg.textContent = 'Sign in to Supabase first.'; return; }
    const incoming = extractItems(raw);
    if (incoming.jsonError) { msg.style.color = 'var(--rust)'; msg.textContent = "That looked like Jellyfin JSON but wasn't complete — copy the entire response, starting from the very first { and ending at the final }."; return; }
    const list = incoming.items;
    if (!list.length) { msg.style.color = 'var(--rust)'; msg.textContent = 'Could not find any titles in that text.'; return; }
    // Jellyfin may return a Movie and a BoxSet with the same title (for
    // example, Dune). Include type and year in the identity so the collection
    // record cannot overwrite the movie that the Library displays.
    const importKey = i => `${i.mediaType || 'Movie'}|${String(i.title || '').trim().toLowerCase()}|${i.productionYear || ''}`;
    const existing = new Map(data.items.map(i => [importKey(i), i]));
    const fresh = [];
    let updated = 0;
    list.forEach(t => {
      const key = importKey(t);
      const existingItem = existing.get(key);
      if (existingItem) {
        Object.keys(t).forEach(k => {
          if (k !== 'title' && k !== 'format' && t[k] !== null && t[k] !== '' && t[k] !== undefined) existingItem[k] = t[k];
        });
        if ((!existingItem.format || existingItem.format === 'Unknown') && t.format) existingItem.format = t.format;
        updated++;
      } else {
        fresh.push({ ...t, id: Date.now().toString(36) + Math.random().toString(36).slice(2,6), title: t.title, format: t.format || 'Unknown', barcode: '', cover: null, added: new Date().toISOString() });
        existing.set(key, fresh[fresh.length - 1]);
      }
    });
    for (let i = 0; i < fresh.length; i++) {
      msg.style.color = 'var(--ink-dim)';
      msg.textContent = `Fetching covers… (${i+1}/${fresh.length})`;
      fresh[i].cover = await fetchCover(fresh[i].title, fresh[i].format, fresh[i].productionYear || fresh[i].premiereDate, fresh[i].mediaType);
    }
    data.items.push(...fresh);
    msg.textContent = 'Saving to Supabase…';
    const ok = await pushFile('items');
    msg.style.color = ok ? 'var(--teal)' : 'var(--rust)';
    msg.textContent = ok ? `Updated ${updated} existing item${updated===1?'':'s'} and added ${fresh.length} new item${fresh.length===1?'':'s'} (movies, series and collections).` : (lastSupabaseError || 'Could not save to Supabase. Try again.');
    if (ok) document.getElementById('importText').value = '';
    renderLibrary();
  });

fetchAll();
