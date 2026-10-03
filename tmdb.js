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
  else if (spellingSearchVariants(title).slice(1).map(normalizeTmdbTitle).some(variant => candidateTitles.includes(variant))) score += 90;
  else if (candidateTitles.some(value => value.startsWith(wanted) || wanted.startsWith(value))) score += 45;
  else if (candidateTitles.some(value => value.includes(wanted) || wanted.includes(value))) score += 25;
  else {
    const wantedWords = new Set(wanted.split(/\s+/).filter(Boolean));
    const bestOverlap = Math.max(0, ...candidateTitles.map(value => {
      const candidateWords = new Set(value.split(/\s+/).filter(Boolean));
      const shared = [...wantedWords].filter(word => candidateWords.has(word)).length;
      if (shared === wantedWords.size && shared === candidateWords.size) return 90;
      return Math.round(60 * shared / Math.max(wantedWords.size, candidateWords.size, 1));
    }));
    score += bestOverlap;
  }
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
  const normalizedTitle = normalizeTmdbTitle(searchTitle);
  const words = normalizedTitle.split(/\s+/).filter(Boolean);
  const spellingQueries = spellingSearchVariants(searchTitle);
  const queries = [...new Set([
    ...spellingQueries,
    searchTitle,
    words.length === 2 ? words.reverse().join(' ') : ''
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

  // Normalize punctuation and merge UK/US spelling variants before ranking.
  for (const includeYear of (searchYear ? [true, false] : [false])) {
    const variantPool = new Map();
    for (const query of spellingQueries) {
      (await runSearch(query, includeYear)).forEach(result => variantPool.set(String(result.id), result));
    }
    const rankedVariants = [...variantPool.values()].sort((a, b) => rankTmdbResult(b, searchTitle, searchYear, isSeries) - rankTmdbResult(a, searchTitle, searchYear, isSeries));
    if (rankedVariants.length && rankTmdbResult(rankedVariants[0], searchTitle, searchYear, isSeries) >= 20) {
      lastCoverError = '';
      return { token, kind, result: rankedVariants[0] };
    }
    for (const query of queries.slice(spellingQueries.length)) {
      const results = await runSearch(query, includeYear);
      results.sort((a, b) => rankTmdbResult(b, searchTitle, searchYear, isSeries) - rankTmdbResult(a, searchTitle, searchYear, isSeries));
      if (results.length && rankTmdbResult(results[0], searchTitle, searchYear, isSeries) >= 20) {
        lastCoverError = '';
        return { token, kind, result: results[0] };
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
    let alternateTitles = [];
    try {
      const aliasesResponse = await fetch(`https://api.themoviedb.org/3/movie/${encodeURIComponent(result.id)}/alternative_titles`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }
      });
      if (aliasesResponse.ok) {
        const aliases = await aliasesResponse.json();
        alternateTitles = (aliases.titles || []).map(entry => entry.title).filter(Boolean);
      }
    } catch (_) { /* Alternate titles are optional; the main metadata is still useful. */ }
    return {
      title: movie.title || result.title || null,
      metadata: {
        productionYear: releaseDate ? Number(releaseDate.slice(0, 4)) || null : null,
        premiereDate: releaseDate,
        communityRating: movie.vote_average || result.vote_average || null,
        runtimeMinutes: movie.runtime || null,
        officialRating: certification,
        providerIds: {
          tmdb: String(movie.id || result.id),
          ...(movie.external_ids?.imdb_id ? { imdb: movie.external_ids.imdb_id } : {}),
          tmdbAliases: [...new Set(alternateTitles)].slice(0, 30)
        }
      }
    };
  } catch (_) { lastCoverError = 'Could not reach TMDB for movie details.'; return { title: result.title || null, metadata: {} }; }
}

function coverFromTmdbMatch(match) {
  const path = match?.result?.poster_path;
  return path ? `https://image.tmdb.org/t/p/w500${path}` : null;
}

async function fetchMovieData(title, year = '') {
  const match = await searchTmdb(title, 'Movie', year, 'Movie');
  if (!match) return { metadata: {}, cover: null, title: null };
  const details = await fetchMovieDetails(match);
  return { metadata: details.metadata || {}, cover: coverFromTmdbMatch(match), title: details.title || match.result.title || null };
}

async function findTmdbMovieCandidates(title, year = '') {
  const token = cfg.tmdbToken;
  if (!token) { lastCoverError = 'TMDB token is not saved in this browser.'; return []; }
  const parsed = parseMovieTitle(title, year);
  if (!parsed.title) return [];
  const normalized = normalizeTmdbTitle(parsed.title);
  const words = normalized.split(/\s+/).filter(Boolean);
  const spellingQueries = spellingSearchVariants(parsed.title);
  const queries = [...new Set([...spellingQueries, normalized, parsed.title, words.length === 2 ? [...words].reverse().join(' ') : ''].filter(Boolean))];
  const findCandidates = pool => [...pool.values()]
    .map(result => ({ token, kind: 'movie', result, score: rankTmdbResult(result, parsed.title, parsed.year) }))
    .filter(candidate => candidate.score >= 20)
    .sort((a, b) => b.score - a.score || Number(b.result.popularity || 0) - Number(a.result.popularity || 0))
    .slice(0, 6);
  const search = async (query, useYear) => {
    const params = new URLSearchParams({ query, include_adult: 'false' });
    if (useYear && parsed.year) params.set('year', parsed.year);
    try {
      const response = await fetch(`https://api.themoviedb.org/3/search/movie?${params}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }
      });
      if (!response.ok) return [];
      const result = await response.json();
      return result.results || [];
    } catch (_) { return []; }
  };
  for (const useYear of (parsed.year ? [true, false] : [false])) {
    const pool = new Map();
    for (const query of spellingQueries) {
      (await search(query, useYear)).forEach(result => pool.set(String(result.id), result));
    }
    if (!findCandidates(pool).length) for (const query of queries.slice(spellingQueries.length)) {
      (await search(query, useYear)).forEach(result => pool.set(String(result.id), result));
      if (findCandidates(pool).length) break;
    }
    const candidates = findCandidates(pool);
    if (candidates.length) {
      lastCoverError = '';
      return candidates;
    }
  }
  lastCoverError = `TMDB found no matches for ${parsed.title}.`;
  return [];
}

async function fetchMovieDataForMatch(match) {
  if (!match?.result) return { metadata: {}, cover: null, title: null };
  const details = await fetchMovieDetails(match);
  return { metadata: details.metadata || {}, cover: coverFromTmdbMatch(match), title: details.title || match.result.title || null };
}

async function fetchCover(title, format = 'Movie', year = '', mediaType = '') {
  const match = await searchTmdb(title, format, year, mediaType);
  const cover = coverFromTmdbMatch(match);
  if (!cover && !lastCoverError) lastCoverError = `TMDB returned no poster for ${title}.`;
  return cover;
}
