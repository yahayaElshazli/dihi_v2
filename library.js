// ---- Library tab ----
  const libList = document.getElementById('libList');
  const libFilter = document.getElementById('libFilter');
  const libCount = document.getElementById('libCount');

  libFilter.addEventListener('input', renderLibrary);

  document.getElementById('viewGridBtn').addEventListener('click', () => { view = 'grid'; localStorage.setItem(VIEW_KEY, view); renderLibrary(); });
  document.getElementById('viewListBtn').addEventListener('click', () => { view = 'list'; localStorage.setItem(VIEW_KEY, view); renderLibrary(); });
  document.querySelectorAll('#typeChips .chip').forEach(c => c.addEventListener('click', () => {
    activeType = c.dataset.type;
    document.querySelectorAll('#typeChips .chip').forEach(x => x.classList.remove('active'));
    c.classList.add('active');
    renderLibrary();
  }));

  document.querySelectorAll('#formatChips .chip').forEach(c => c.addEventListener('click', () => {
    activeFormat = c.dataset.fmt;
    document.querySelectorAll('#formatChips .chip').forEach(x => x.classList.remove('active'));
    c.classList.add('active');
    renderLibrary();
  }));

  function coverOrPlaceholder(i, cls) {
    return i.cover
      ? `<img class="${cls}" src="${escapeHtml(i.cover)}" alt="" loading="lazy">`
      : `<div class="${cls} ${cls === 'thumb' ? 'thumb-ph' : ''}" ${cls==='cover' ? 'style="display:flex;align-items:center;justify-content:center;"' : ''}>${escapeHtml(i.title[0] || '?')}</div>`;
  }

  function formatRuntime(minutes) {
    if (!minutes || !isFinite(minutes)) return '';
    const h = Math.floor(minutes / 60), m = Math.round(minutes % 60);
    return h ? `${h}h ${m}m` : `${m}m`;
  }
  function metaLine(i) {
    const bits = [];
    if (i.productionYear) bits.push(String(i.productionYear));
    if (i.format) bits.push(i.format);
    if (i.communityRating) bits.push(`★ ${Number(i.communityRating).toFixed(1)}`);
    return bits.join(' · ');
  }

  function detailRows(i) {
    const rows = [];
    const add = (label, value) => { if (value !== null && value !== undefined && String(value).trim() !== '') rows.push(`<div class="detail-label">${escapeHtml(label)}</div><div class="detail-value">${escapeHtml(String(value))}</div>`); };

    add('Format', i.format);
    add('Year', i.productionYear);
    add('Premiere', i.premiereDate ? new Date(i.premiereDate).toLocaleDateString() : '');
    add('Runtime', i.runtimeMinutes ? formatRuntime(Number(i.runtimeMinutes)) : '');
    add('Community rating', i.communityRating ? `★ ${Number(i.communityRating).toFixed(1)}` : '');
    add('Critic rating', i.criticRating ? `★ ${Number(i.criticRating).toFixed(1)}` : '');
    add('Age rating', i.officialRating);
    add('Barcode', i.barcode);
    add('Status', i.status);
    return rows.join('');
  }

  function displayTitle(i) {
    const year = i.productionYear || (i.premiereDate && String(i.premiereDate).match(/\d{4}/)?.[0]);
    return year ? `${i.title} (${year})` : i.title;
  }

  function mediaLabel(i) {
    if (i.mediaType === 'Series') return 'Series';
    return 'Movie';
  }

  function renderLibrary() {
    document.getElementById('viewGridBtn').classList.toggle('active', view === 'grid');
    document.getElementById('viewListBtn').classList.toggle('active', view === 'list');
    const q = normalizeSearch(libFilter.value);

    // Keep every movie visible as its own library entry, including movies
    // that Jellyfin groups into BoxSet collections. BoxSet records are hidden.
    const topLevelItems = data.items.filter(i => i.mediaType !== 'BoxSet');

    const items = topLevelItems
      .filter(i => activeType === 'all' || (i.mediaType || 'Movie') === activeType)
      .filter(i => titleMatches(i.title, q))
      .filter(i => activeFormat === 'all' || (i.format || 'Unknown') === activeFormat)
      .sort((a,b) => a.title.localeCompare(b.title));

    const movieCount = topLevelItems.filter(i => (i.mediaType || 'Movie') === 'Movie').length;
    const seriesCount = topLevelItems.filter(i => i.mediaType === 'Series').length;

    libCount.textContent = items.length;
    document.querySelector('#typeChips [data-type="all"]').textContent = `All (${topLevelItems.length})`;
    document.querySelector('#typeChips [data-type="Movie"]').textContent = `Movies (${movieCount})`;
    document.querySelector('#typeChips [data-type="Series"]').textContent = `Series (${seriesCount})`;
    if (!items.length) {
      const filterText = libFilter.value.trim();
      const noMatches = filterText && normalizeSearch(filterText)
        ? `No matches for "${escapeHtml(filterText)}" in your library. ${wishlistLinkHtml(filterText)}`
        : 'No matches.';
      libList.innerHTML = `<div class="empty">${!ready ? 'Open Admin to configure GitHub saving.' : (topLevelItems.length ? noMatches : (data.items.length ? 'No movies or series in the library yet.' : 'Nothing added yet — use the Add tab.'))}</div>`;
      return;
    }
    if (view === 'grid') {
      libList.innerHTML = `<div class="libgrid">${items.map(i => `
        <div class="gridcard">
          ${coverOrPlaceholder(i, 'cover')}
          <span class="grid-format">${escapeHtml(i.format || 'Unknown')}</span>
          <div class="gtitle">${escapeHtml(displayTitle(i))}</div>
        </div>`).join('')}</div>`;
    } else {
      libList.innerHTML = items.map(i => `
        <div class="libitem">
          <div class="libitem-main" role="button" tabindex="0" aria-expanded="false">
            ${coverOrPlaceholder(i, 'thumb')}
            <div class="meta">
              <div class="title">${escapeHtml(i.title)}</div>
              <div class="sub">${escapeHtml(mediaLabel(i))}${metaLine(i) ? ` · ${escapeHtml(metaLine(i))}` : ''}</div>
            </div>
            <button type="button" class="expand" aria-label="Show details">⌄</button>
          </div>
          <div class="libitem-details"><div class="detail-grid">${detailRows(i)}</div></div>
        </div>`).join('');
      libList.querySelectorAll('.libitem-main').forEach(row => {
        const toggle = () => {
          const item = row.closest('.libitem');
          const open = item.classList.toggle('open');
          row.setAttribute('aria-expanded', String(open));
          row.querySelector('.expand').textContent = open ? '⌃' : '⌄';
          row.querySelector('.expand').setAttribute('aria-label', open ? 'Hide details' : 'Show details');
        };
        row.addEventListener('click', toggle);
        row.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && !e.target.closest('button')) { e.preventDefault(); toggle(); } });
      });
    }
  }

  document.getElementById('fetchCoversBtn').addEventListener('click', async () => {
    const msg = document.getElementById('backupMsg');
    const missing = data.items.filter(i => !i.cover);
    if (!missing.length) { msg.style.color = 'var(--teal)'; msg.textContent = 'Every title already has a cover.'; return; }
    for (let i = 0; i < missing.length; i++) {
      msg.style.color = 'var(--ink-dim)';
      msg.textContent = `Fetching covers… (${i+1}/${missing.length})`;
      const url = await fetchCover(missing[i].title, missing[i].format, missing[i].productionYear || missing[i].premiereDate);
      if (url) missing[i].cover = url;
    }
    renderLibrary();
    const stillMissing = missing.filter(i => !i.cover).length;
    msg.style.color = stillMissing ? 'var(--amber)' : 'var(--ink-dim)';
    msg.textContent = stillMissing
      ? `${stillMissing} cover${stillMissing === 1 ? '' : 's'} could not be found. ${lastCoverError || 'Check your TMDB credentials.'}`
      : 'Saving to GitHub…';
    const ok = await pushFile('items');
    msg.style.color = ok ? 'var(--teal)' : 'var(--rust)';
    msg.textContent = ok ? 'Covers updated.' : `Fetched covers, but could not save to GitHub. ${lastGitHubError}`;
  });

  document.getElementById('refreshCoversBtn').addEventListener('click', async () => {
    const msg = document.getElementById('backupMsg');
    const titles = data.items.filter(i => i.mediaType !== 'BoxSet');
    if (!titles.length) { msg.style.color = 'var(--teal)'; msg.textContent = 'There are no movies or series to refresh.'; return; }
    let refreshed = 0, missing = 0;
    for (let i = 0; i < titles.length; i++) {
      msg.style.color = 'var(--ink-dim)';
      msg.textContent = `Refreshing year-matched covers… (${i + 1}/${titles.length})`;
      const cover = await fetchCover(titles[i].title, titles[i].format, titles[i].productionYear || titles[i].premiereDate);
      if (cover) { titles[i].cover = cover; refreshed++; } else missing++;
    }
    renderLibrary();
    msg.textContent = 'Saving refreshed covers…';
    const ok = await pushFile('items');
    msg.style.color = ok ? (missing ? 'var(--amber)' : 'var(--teal)') : 'var(--rust)';
    msg.textContent = ok
      ? `Updated ${refreshed} cover${refreshed === 1 ? '' : 's'} using release years where available${missing ? `; ${missing} could not be matched` : ''}.`
      : `Refreshed covers locally, but could not save to GitHub. ${lastGitHubError}`;
  });

  document.getElementById('clearLibBtn').addEventListener('click', async () => {
    const msg = document.getElementById('backupMsg');
    if (!data.items.length) { msg.style.color = 'var(--teal)'; msg.textContent = 'Library is already empty.'; return; }
    if (!confirm(`Remove all ${data.items.length} items from your library? This cannot be undone.`)) return;
    const prev = data.items;
    data.items = [];
    renderLibrary();
    msg.style.color = 'var(--ink-dim)'; msg.textContent = 'Saving to GitHub…';
    const ok = await pushFile('items');
    if (ok) { msg.style.color = 'var(--teal)'; msg.textContent = 'Library cleared.'; }
    else { data.items = prev; renderLibrary(); msg.style.color = 'var(--rust)'; msg.textContent = `Could not save to GitHub — clear undone. ${lastGitHubError || ''}`.trim(); }
  });
