// ---- TMDB poster lookup ----
let lastCoverError = '';
async function fetchCover(title, format = 'Movie', year = '', mediaType = '') {
  const token = cfg.tmdbToken;
  if (!title) return null;
  if (!token) { lastCoverError = 'TMDB token is not saved in this browser. Add it in Admin and save it, then retry.'; return null; }
  const isSeries = /series|tv/i.test(`${mediaType} ${format}`);
  const kind = isSeries ? 'tv' : 'movie';
  const params = new URLSearchParams({ query: title, include_adult: 'false' });
  const yearText = String(year || '').match(/\d{4}/)?.[0];
  if (yearText) params.set(isSeries ? 'first_air_date_year' : 'year', yearText);
  try {
    const response = await fetch(`https://api.themoviedb.org/3/search/${kind}?${params}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }
    });
    if (!response.ok) { lastCoverError = `TMDB request failed (${response.status}).`; return null; }
    const result = await response.json();
    const path = result.results?.[0]?.poster_path;
    lastCoverError = path ? '' : `TMDB returned no poster for ${title}.`;
    return path ? `https://image.tmdb.org/t/p/w500${path}` : null;
  } catch (_) { lastCoverError = 'Could not reach TMDB.'; return null; }
}
