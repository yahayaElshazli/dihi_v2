// ---- TMDB poster and movie metadata lookup ----
let lastCoverError = '';

function parseMovieTitle(title, year = '') {
  const originalTitle = String(title || '').trim();
  const suffix = originalTitle.match(/\s+\(((?:18|19|20|21)\d{2})\)\s*$/);
  return {
    title: suffix ? originalTitle.slice(0, suffix.index).trim() : originalTitle,
    year: String(year || suffix?.[1] || '').match(/\d{4}/)?.[0] || ''
  };
}

function normalizeTmdbTitle(title) {
  return String(title || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim().toLowerCase();
}

function rankTmdbResult(result, title, year, isSeries = false) {
  const wanted = normalizeTmdbTitle(title);
  const candidateTitles = [result.title || result.name, result.original_title || result.original_name].filter(Boolean).map(normalizeTmdbTitle);
  let score = 0;
  if (candidateTitles.includes(wanted)) score += 100;
  else if (candidateTitles.some(value => value.startsWith(wanted) || wanted.startsWith(value))) score += 45;
  else if (candidateTitles.some(value => value.includes(wanted) || wanted.includes(value))) score += 25;
  const resultYear = String(isSeries ? result.first_air_date || '' : result.release_date || '').slice(0, 4);
  if (year && resultYear) score += resultYear === year ? 100 : -70;
  return score;
}

async function searchTmdb(title, format = 'Movie', year = '', mediaType = '') {
  const token = cfg.tmdbToken;
  if (!title) return null;
  if (!token) { lastCoverError = 'TMDB token is not saved in this browser. Add it in Admin and save it, then retry.'; return null; }
  const isSeries = /series|tv/i.test(`${mediaType} ${format}`);
  const kind = isSeries ? 'tv' : 'movie';
  const parsed = parseMovieTitle(title, year);
  const searchTitle = parsed.title;
  const searchYear = parsed.year;
  const queries = [...new Set([
    normalizeTmdbTitle(searchTitle),
    searchTitle,
  ].filter(Boolean))];
  let requestFailed = false;
  const runSearch = async (query, includeYear) => {
    const params = new URLSearchParams({ query, include_adult: 'false' });
    if (includeYear && searchYear) params.set(isSeries ? 'first_air_date_year' : 'year', searchYear);
    try {
      const response = await fetch(`https://api.themoviedb.org/3/search/${kind}?${params}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }
      });
      if (!response.ok) { requestFailed = true; return []; }
      const result = await response.json();
      return result.results || [];
    } catch (_) { requestFailed = true; return []; }
  };

  // Normalize punctuation first (e.g. “Avengers: Endgame” -> “avengers endgame”),
  // then fall back to the user's wording, and finally relax the year filter.
  for (const includeYear of (searchYear ? [true, false] : [false])) {
    for (const query of queries) {
      const results = await runSearch(query, includeYear);
      if (results.length) {
        results.sort((a, b) => rankTmdbResult(b, searchTitle, searchYear, isSeries) - rankTmdbResult(a, searchTitle, searchYear, isSeries));
        if (rankTmdbResult(results[0], searchTitle, searchYear, isSeries) >= 20) {
          lastCoverError = '';
          return { token, kind, result: results[0] };
        }
      }
    }
  }
  lastCoverError = requestFailed ? 'Could not complete the TMDB search.' : `TMDB found no match for ${searchTitle}.`;
  return null;
}

async function fetchMovieDetails(match) {
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

function coverFromTmdbMatch(match) {
  const path = match?.result?.poster_path;
  return path ? `https://image.tmdb.org/t/p/w500${path}` : null;
}

async function fetchMovieData(title, year = '') {
  const match = await searchTmdb(title, 'Movie', year, 'Movie');
  if (!match) return { metadata: {}, cover: null };
  const metadata = await fetchMovieDetails(match);
  return { metadata, cover: coverFromTmdbMatch(match) };
}

async function fetchCover(title, format = 'Movie', year = '', mediaType = '') {
  const match = await searchTmdb(title, format, year, mediaType);
  const cover = coverFromTmdbMatch(match);
  if (!cover && !lastCoverError) lastCoverError = `TMDB returned no poster for ${title}.`;
  return cover;
}
