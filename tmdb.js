// ---- TMDB poster lookup ----
let lastCoverError = '';
async function searchTmdb(title, format = 'Movie', year = '', mediaType = '') {
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
    lastCoverError = result.results?.length ? '' : `TMDB found no match for ${title}.`;
    return { token, kind, result: result.results?.[0] || null };
  } catch (_) { lastCoverError = 'Could not reach TMDB.'; return null; }
}

async function fetchCover(title, format = 'Movie', year = '', mediaType = '') {
  const match = await searchTmdb(title, format, year, mediaType);
  const path = match?.result?.poster_path;
  lastCoverError = path ? '' : (lastCoverError || `TMDB returned no poster for ${title}.`);
  return path ? `https://image.tmdb.org/t/p/w500${path}` : null;
}

async function fetchMovieMetadata(title, year = '') {
  const match = await searchTmdb(title, 'Movie', year, 'Movie');
  if (!match?.result) return {};
  const { token, result } = match;
  try {
    const response = await fetch(`https://api.themoviedb.org/3/movie/${encodeURIComponent(result.id)}?append_to_response=release_dates,external_ids`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }
    });
    if (!response.ok) { lastCoverError = `TMDB details request failed (${response.status}).`; return {}; }
    const movie = await response.json();
    const release = (movie.release_dates?.results || []).find(country => country.iso_3166_1 === 'GB');
    const certification = release?.release_dates?.find(date => date.certification)?.certification || null;
    const releaseDate = movie.release_date || result.release_date || null;
    return {
      productionYear: releaseDate ? Number(releaseDate.slice(0, 4)) || null : null,
      premiereDate: releaseDate,
      communityRating: movie.vote_average || result.vote_average || null,
      runtimeMinutes: movie.runtime || null,
      officialRating: certification,
      providerIds: { tmdb: String(movie.id || result.id), ...(movie.external_ids?.imdb_id ? { imdb: movie.external_ids.imdb_id } : {}) }
    };
  } catch (_) { lastCoverError = 'Could not reach TMDB for movie details.'; return {}; }
}
