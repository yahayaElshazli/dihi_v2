// ---- Check tab ----
  const checkInput = document.getElementById('checkInput');
  const checkResults = document.getElementById('checkResults');
  function checkTitleMatches(item, raw, normalizedQuery, queryWords) {
    const searchable = [item.title, ...(item.providerIds?.tmdbAliases || [])].map(normalizeSearch).join(' ');
    return searchable.includes(normalizedQuery) || (queryWords.length > 1 && queryWords.every(word => searchable.includes(normalizeSearch(word))));
  }

  checkInput.addEventListener('input', () => {
    const raw = checkInput.value.trim();
    const q = normalizeSearch(raw);
    if (!q) checkResults.innerHTML = '';
    else {
      const queryWords = (raw.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/&/g, ' ').toLowerCase().match(/[\p{L}\p{N}]+/gu) || []).filter(word => word !== 'and');
      const matches = data.items.filter(item => checkTitleMatches(item, raw, q, queryWords));
      if (matches.length) checkResults.innerHTML = matches.map(checkLibraryResult).join('');
      else {
        const wishMatch = data.wishlist.find(item => checkTitleMatches(item, raw, q, queryWords));
        checkResults.innerHTML = wishMatch
          ? `<div class="result safe-buy"><strong>Safe to buy</strong>No match for "${escapeHtml(raw)}" in your library. “${escapeHtml(wishMatch.title)}” is already on your wishlist.</div>`
          : `<div class="result safe-buy"><strong>Safe to buy</strong>No match for "${escapeHtml(raw)}" in your library. ${wishlistLinkHtml(raw)}</div>`;
      }
    }
    renderCheckWishlist();
  });

  function checkLibraryResult(item) {
    const title = escapeHtml(item.title);
    const format = escapeHtml(item.format || 'Unknown');
    const rating = Number(item.communityRating);
    if (String(item.format || '').trim().toLowerCase() === 'dvd' && Number.isFinite(rating) && rating > 7.5) {
      return `<div class="result upgrade"><strong>Worth upgrading</strong>${title} — DVD · ★ ${rating.toFixed(1)}</div>`;
    }
    return `<div class="result do-not-buy"><strong>Do not buy</strong>You already have ${title} — ${format}.</div>`;
  }
