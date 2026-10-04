  function renderAll() {
    renderLibrary();
    renderWishlist();
    if (checkInput.value.trim()) checkInput.dispatchEvent(new Event('input'));
    else renderCheckWishlist();
  }

  // ---- Auth gate ----
  initSupabase();

  async function handleAuth(action) {
    const email = document.getElementById('authEmail').value.trim();
    const password = document.getElementById('authPassword').value;
    const msg = document.getElementById('authMsg');
    const button = document.getElementById(action === 'signup' ? 'authSignUpBtn' : 'authSignInBtn');
    if (!supabaseClient) {
      msg.style.color = 'var(--rust)';
      msg.textContent = supabaseInitError || 'Save your Supabase settings before creating an account.';
      return;
    }
    if (!email || !password) { msg.style.color = 'var(--rust)'; msg.textContent = 'Enter an email and password.'; return; }
    msg.style.color = 'var(--ink-dim)'; msg.textContent = action === 'signup' ? 'Creating account…' : 'Signing in…';
    button.disabled = true;
    try {
      const error = action === 'signup' ? await signUp(email, password) : await signIn(email, password);
      if (error) { msg.style.color = 'var(--rust)'; msg.textContent = error; return; }
      if (action === 'signup') { msg.style.color = 'var(--teal)'; msg.textContent = 'Account created — check your email to confirm, then sign in.'; return; }
      msg.textContent = '';
      await fetchAll();
    } catch (error) {
      msg.style.color = 'var(--rust)';
      msg.textContent = error?.message || 'Could not reach Supabase. Check your connection and project settings, then try again.';
    } finally {
      button.disabled = false;
    }
  }
  document.getElementById('authForm').addEventListener('submit', event => {
    event.preventDefault();
    handleAuth('signin');
  });
  document.getElementById('authSignUpBtn').addEventListener('click', () => handleAuth('signup'));

  document.getElementById('signOutBtn').addEventListener('click', signOutUser);
  document.getElementById('menuSignOutBtn').addEventListener('click', signOutUser);

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
        const existingIds = new Set(data.items.map(i => String(i.id)).filter(Boolean));
        const itemKey = i => [normalizeSearch(i.title), i.productionYear || '', i.mediaType || 'Movie', i.format || 'Unknown', i.jellyfinId || ''].join('|');
        const existingKeys = new Set(data.items.map(itemKey));
        let added = 0;
        incomingItems.forEach(i => {
          const key = i && i.title ? itemKey(i) : '';
          if (i && i.title && !existingIds.has(String(i.id)) && !existingKeys.has(key)) {
            data.items.push({ ...i, id: i.id || Date.now().toString(36) + Math.random().toString(36).slice(2,6), title: i.title, format: i.format || 'Unknown', barcode: i.barcode || '', cover: sanitizeCoverUrl(i.cover), added: i.added || new Date().toISOString() });
            existingIds.add(String(i.id || ''));
            existingKeys.add(key);
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
    const items = [...data.wishlist].filter(i => titleMatches(i.title, q, checkInput.value)).sort((a,b) => a.title.localeCompare(b.title));
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
        <button type="button" data-id="${escapeHtml(String(i.id || ''))}" class="wish-add-btn">Got it!</button>
        <button data-id="${escapeHtml(String(i.id || ''))}" class="delw">Remove</button>
      </div>`).join('');
    renderCheckWishlist();
    wishList.querySelectorAll('.wish-add-btn').forEach(button => button.addEventListener('click', () => {
      const item = data.wishlist.find(entry => String(entry.id || '') === button.dataset.id);
      if (!item) return;
      document.getElementById('wishSheetTitle').textContent = item.title;
      document.getElementById('wishSheetMsg').textContent = '';
      document.getElementById('wishFormat').value = 'DVD';
      document.getElementById('wishSheetAdd').disabled = false;
      document.getElementById('wishSheetCancel').disabled = false;
      document.getElementById('wishSheetAdd').textContent = 'Add to library';
      document.getElementById('wishAddSheet').dataset.wishlistId = String(item.id || '');
      document.getElementById('wishAddSheet').showModal();
    }));
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

  document.getElementById('wishSheetCancel').addEventListener('click', () => document.getElementById('wishAddSheet').close());
  document.getElementById('wishAddSheet').addEventListener('click', event => {
    if (event.target === event.currentTarget) event.currentTarget.close();
  });
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
  const addBarcode = document.getElementById('addBarcode');
  const barcodeLookupMsg = document.getElementById('barcodeLookupMsg');
  let scannedMovieData = null;
  let barcodeLookupSequence = 0;

  function stripBarcodeCatalogId(value) {
    return String(value || '').normalize('NFKC').replace(/[\u200B-\u200D\u2060\uFEFF]/g, '')
      .replace(/^\s*(?:(?:id|item|sku)\s*[:#-]\s*)?[\[(]?#?\s*\d{5,}\s*[\])]?\s*[-\u2010-\u2015\u2212:|]\s*/i, '');
  }

  function parseBarcodeProduct(product) {
    const rawTitle = stripBarcodeCatalogId(product?.title || product?.name);
    const yearMatches = [...rawTitle.matchAll(/\b((?:18|19|20|21)\d{2})\b/g)];
    const yearMatch = yearMatches.filter(match => match.index > 0).pop();
    const descriptionYear = String(product?.description || '').match(/\b((?:18|19|20|21)\d{2})\b/);
    const year = yearMatch?.[1] || descriptionYear?.[1] || '';
    let title = yearMatch ? rawTitle.slice(0, yearMatch.index) : rawTitle;
    // Product listings often append bundle/edition details and cast names after the film title.
    // Cut at the first recognizable packaging marker so TMDB sees the actual movie title.
    title = title.replace(/\s*(?:[-–—|:]\s*)?\b(?:triple\s*play|double\s*play|combo\s*pack|steelbook|limited\s+edition|special\s+edition|collector(?:'s|s)?\s+edition|includes?\b|with\s+(?:digital|dvd|blu[ -]?ray)|digital\s+(?:copy|download)|bonus\s+(?:disc|features?)|\d+\s*[- ]?disc)\b[\s\S]*$/i, ' ');
    title = title.replace(/\b(?:brand\s+)?new\s*(?:&|and)\s*sealed\b/gi, ' ')
      .replace(/\b(?:blu[ -]?ray|4k\s*(?:ultra\s*)?hd|ultra\s*hd|dvd(?:-video)?)\b/gi, ' ')
      .replace(/(?<=[a-z])4(?=[a-z])/gi, 'a')
      .replace(/[\[\](){}]/g, ' ').replace(/\s+/g, ' ').replace(/[\s\-–—:|,]+$/, '').trim()
      .replace(/^\s*\d{5,}\s*[-\u2010-\u2015\u2212:|]\s*/, '');
    return { title, year };
  }

  addBarcode.addEventListener('barcode:scanned', async event => {
    const barcode = String(event.detail?.barcode || addBarcode.value).trim();
    const request = ++barcodeLookupSequence;
    scannedMovieData = null;
    barcodeLookupMsg.style.color = 'var(--ink-dim)';
    barcodeLookupMsg.textContent = 'Looking up barcode…';
    try {
      if (!supabaseClient) throw new Error('Sign in before looking up a barcode.');
      const { data: result, error } = await supabaseClient.functions.invoke('barcode-lookup', { body: { barcode } });
      if (error) throw new Error('Barcode lookup service is unavailable. The Supabase barcode-lookup function must be deployed.');
      if (result?.error) throw new Error(result.error);
      if (request !== barcodeLookupSequence) return;
      const product = (result.items || []).find(item => item.title || item.name);
      if (!product) {
        barcodeLookupMsg.textContent = 'No product title found for this barcode. Enter the film title manually.';
        return;
      }
      const { title: productTitle, year: productYear } = parseBarcodeProduct(product);
      if (!productTitle) {
        barcodeLookupMsg.textContent = 'The barcode matched a product, but it did not include a usable title.';
        return;
      }

      barcodeLookupMsg.textContent = 'Found a product. Matching it to TMDB…';
      const movieData = await fetchMovieData(productTitle, productYear);
      if (request !== barcodeLookupSequence) return;
      if (movieData.title) {
        const canonicalTitle = stripBarcodeCatalogId(movieData.title);
        const year = movieData.metadata.productionYear || productYear;
        addTitle.value = canonicalTitle;
        document.getElementById('addReleaseYear').value = year;
        addTitle.dispatchEvent(new Event('input', { bubbles: true }));
        scannedMovieData = { barcode, title: canonicalTitle, year: String(year), metadata: movieData.metadata, cover: movieData.cover };
        barcodeLookupMsg.textContent = `Found “${canonicalTitle}”${year ? ` (${year})` : ''} and loaded its TMDB details.`;
      } else {
        addTitle.value = productTitle;
        document.getElementById('addReleaseYear').value = productYear;
        addTitle.dispatchEvent(new Event('input', { bubbles: true }));
        barcodeLookupMsg.textContent = `Found “${productTitle}”, but TMDB could not match it. Check the title before adding.`;
      }
    } catch (error) {
      if (request !== barcodeLookupSequence) return;
      barcodeLookupMsg.style.color = 'var(--rust)';
      barcodeLookupMsg.textContent = error.message || 'Could not look up this barcode. Enter the film title manually.';
    }
  });

  function createLibraryMovie({ title, tmdbTitle, format, barcode = '', cover, metadata = {}, year = '' }) {
    return {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      title: tmdbTitle || title, format, barcode, cover, added: new Date().toISOString(),
      premiereDate: null, officialRating: null, communityRating: null, criticRating: null,
      runtimeMinutes: null, container: null, fileSize: null, videoLabel: null, videoWidth: null,
      videoHeight: null, videoCodec: null, audioLabel: null, audioCodec: null, hasSubtitles: false,
      played: false, playCount: 0, lastPlayed: null, mediaType: 'Movie', status: null,
      unplayedCount: null, providerIds: {}, collectionId: null, jellyfinId: null,
      jellyfinCollectionIds: [], jellyfinCollectionNames: [], ...metadata,
      productionYear: metadata.productionYear || (year ? Number(year) : null)
    };
  }

  document.getElementById('wishSheetAdd').addEventListener('click', async () => {
    const sheet = document.getElementById('wishAddSheet');
    const addButton = document.getElementById('wishSheetAdd');
    const cancelButton = document.getElementById('wishSheetCancel');
    const message = document.getElementById('wishSheetMsg');
    const wishlistItem = data.wishlist.find(entry => String(entry.id || '') === sheet.dataset.wishlistId);
    if (!wishlistItem) { sheet.close(); return; }
    if (!configComplete(cfg)) { message.textContent = 'Sign in to add items to your library.'; return; }
    const parsedTitle = parseMovieTitle(wishlistItem.title);
    const existing = data.items.find(item => normalizeSearch(item.title) === normalizeSearch(parsedTitle.title) &&
      (!item.productionYear || !parsedTitle.year || Number(item.productionYear) === Number(parsedTitle.year)));
    if (existing) { message.textContent = `“${existing.title}” is already in your library.`; return; }

    const format = document.getElementById('wishFormat').value;
    addButton.disabled = true;
    cancelButton.disabled = true;
    document.getElementById('wishFormat').disabled = true;
    message.textContent = 'Looking up TMDB details and cover…';
    const { metadata, cover, title: tmdbTitle } = await fetchMovieData(wishlistItem.title, parsedTitle.year);
    const movie = createLibraryMovie({ title: wishlistItem.title, tmdbTitle, format, cover, metadata, year: parsedTitle.year });
    data.items.push(movie);
    message.textContent = 'Saving to your library…';
    const librarySaved = await pushFile('items');
    renderLibrary();
    if (!librarySaved) {
      const wishMsg = document.getElementById('wishMsg');
      wishMsg.style.color = 'var(--rust)';
      wishMsg.textContent = 'Added on this device, but the library could not sync to Supabase. The wishlist item is still here.';
      sheet.close();
      document.getElementById('wishFormat').disabled = false;
      return;
    }

    data.wishlist = data.wishlist.filter(item => item !== wishlistItem);
    const wishlistSaved = await pushFile('wishlist');
    renderWishlist();
    const wishMsg = document.getElementById('wishMsg');
    wishMsg.style.color = wishlistSaved ? 'var(--teal)' : 'var(--rust)';
    wishMsg.textContent = wishlistSaved
      ? `Added “${movie.title}” to your library${metadata.productionYear || parsedTitle.year ? ` (${metadata.productionYear || parsedTitle.year})` : ''}.${tmdbTitle ? '' : ' TMDB found no match; you can use Update info later.'}`
      : `Added “${movie.title}” to your library, but the wishlist change could not sync yet.`;
    sheet.close();
    document.getElementById('wishFormat').disabled = false;
  });

  addTitle.addEventListener('input', () => {
    if (scannedMovieData && normalizeTmdbTitle(addTitle.value) !== normalizeTmdbTitle(scannedMovieData.title)) scannedMovieData = null;
    const q = normalizeSearch(addTitle.value);
    if (q.length < 3) { dupWarn.style.display = 'none'; return; }
    const match = data.items.find(i => { const t = normalizeSearch(i.title); return t && (t.includes(q) || q.includes(t)); });
    if (match) { dupWarn.style.display = 'block'; dupWarn.textContent = `⚠ You might already have "${match.title}".`; }
    else dupWarn.style.display = 'none';
  });

  document.getElementById('saveBtn').addEventListener('click', async () => {
    const title = addTitle.value.trim();
    const yearInput = document.getElementById('addReleaseYear').value.trim();
    const format = document.getElementById('addFormat').value;
    const barcode = addBarcode.value.trim();
    const msg = document.getElementById('saveMsg');
    if (!configComplete(cfg)) { msg.style.color = 'var(--rust)'; msg.textContent = 'Sign in to save.'; return; }
    if (!title) { msg.style.color = 'var(--rust)'; msg.textContent = 'Enter a title first.'; return; }
    if (yearInput && (!/^\d{4}$/.test(yearInput) || Number(yearInput) < 1888 || Number(yearInput) > 2100)) { msg.style.color = 'var(--rust)'; msg.textContent = 'Enter a valid four-digit release year.'; return; }
    msg.style.color = 'var(--ink-dim)'; msg.textContent = 'Looking up movie details and cover…';
    const parsedTitle = parseMovieTitle(title, yearInput);
    const cachedScan = scannedMovieData && scannedMovieData.barcode === barcode
      && normalizeTmdbTitle(scannedMovieData.title) === normalizeTmdbTitle(parsedTitle.title)
      && (!parsedTitle.year || scannedMovieData.year === parsedTitle.year) ? scannedMovieData : null;
    const { metadata, cover, title: tmdbTitle } = cachedScan || await fetchMovieData(title, parsedTitle.year);
    data.items.push(createLibraryMovie({ title, tmdbTitle, format, barcode, cover, metadata, year: parsedTitle.year }));
    msg.textContent = 'Saving to Supabase…';
    const ok = await pushFile('items');
    msg.style.color = ok ? 'var(--teal)' : 'var(--rust)';
    msg.textContent = ok ? `Added "${title}" to your library.` : (lastSupabaseError || 'Could not save to Supabase. Try again.');
    if (ok) { addTitle.value = ''; document.getElementById('addReleaseYear').value = ''; document.getElementById('addBarcode').value = ''; dupWarn.style.display = 'none'; }
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
    const coverTargets = new Set();
    let updated = 0;
    list.forEach(t => {
      const key = importKey(t);
      const existingItem = existing.get(key);
      if (existingItem) {
        Object.keys(t).forEach(k => {
          if (k !== 'title' && k !== 'format' && t[k] !== null && t[k] !== '' && t[k] !== undefined) existingItem[k] = t[k];
        });
        if ((!existingItem.format || existingItem.format === 'Unknown') && t.format) existingItem.format = t.format;
        if (!existingItem.cover) coverTargets.add(existingItem);
        updated++;
      } else {
        const newItem = { ...t, id: Date.now().toString(36) + Math.random().toString(36).slice(2,6), title: t.title, format: t.format || 'Unknown', barcode: '', cover: null, added: new Date().toISOString() };
        fresh.push(newItem);
        coverTargets.add(newItem);
        existing.set(key, newItem);
      }
    });
    const missingCovers = [...coverTargets].filter(item => !item.cover);
    for (let i = 0; i < missingCovers.length; i++) {
      msg.style.color = 'var(--ink-dim)';
      msg.textContent = `Fetching covers… (${i+1}/${missingCovers.length})`;
      const item = missingCovers[i];
      item.cover = await fetchCover(item.title, item.format, item.productionYear || item.premiereDate, item.mediaType);
    }
    data.items.push(...fresh);
    msg.textContent = 'Saving to Supabase…';
    const missingCoverCount = missingCovers.filter(item => !item.cover).length;
    const ok = await pushFile('items');
    msg.style.color = ok ? 'var(--teal)' : 'var(--rust)';
    msg.textContent = ok
      ? `Updated ${updated} existing item${updated===1?'':'s'} and added ${fresh.length} new item${fresh.length===1?'':'s'} (movies, series and collections).${missingCoverCount ? ` ${missingCoverCount} cover${missingCoverCount===1?'':'s'} could not be fetched. ${lastCoverError || 'Check the TMDB token and search result.'}` : ''}`
      : (lastSupabaseError || 'Could not save to Supabase. Try again.');
    if (ok) document.getElementById('importText').value = '';
    renderLibrary();
  });

fetchAll();
