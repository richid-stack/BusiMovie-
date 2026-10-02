import axios from "axios";

export interface UnifiedMovie {
  id: string;
  title: string;
  year?: string;
  overview: string;
  poster_path: string | null;
  cast?: string;
  vote_average?: string | number;
  media_type?: string;
  source: "imdb" | "tvmaze" | "omdb" | "tmdb";
}

/**
 * Fetch a short synopsis/plot from Wikipedia's public REST API (No API key needed)
 */
async function fetchWikiSynopsis(title: string, year?: string): Promise<string | null> {
  const attempts = [
    title,
    `${title} (${year} film)`,
    `${title} (film)`,
    `${title} (TV series)`,
  ];

  for (const term of attempts) {
    try {
      const res = await axios.get(
        `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(term)}`,
        {
          headers: { "User-Agent": "MovieBot/1.0 (movie-discovery-service)" },
          timeout: 2500,
        }
      );
      if (res.data?.extract && !res.data.extract.includes("may refer to:")) {
        return res.data.extract;
      }
    } catch {
      // Continue to next attempt
    }
  }
  return null;
}

/**
 * Search movies and TV shows using IMDb's public suggestion API (Zero API key required)
 */
async function searchIMDb(query: string): Promise<UnifiedMovie[]> {
  try {
    const cleanQuery = query.toLowerCase().replace(/[^a-z0-9]/g, "_");
    const url = `https://v3.sg.media-imdb.com/suggestion/x/${cleanQuery}.json`;

    const res = await axios.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
      timeout: 4000,
    });

    const items = res.data?.d || [];
    const validItems = items.filter(
      (item: any) =>
        item.id &&
        item.l &&
        (item.qid === "movie" ||
          item.qid === "tvSeries" ||
          item.qid === "tvMiniSeries" ||
          item.q === "feature" ||
          item.q === "TV series" ||
          !item.q)
    );

    const topItems = validItems.slice(0, 4);

    const results: UnifiedMovie[] = await Promise.all(
      topItems.map(async (item: any) => {
        const title = item.l;
        const year = item.y ? item.y.toString() : "";
        const cast = item.s || "";
        const poster = item.i?.imageUrl || null;
        const type = item.qid === "tvSeries" ? "TV Series" : "Movie";

        // Try getting plot synopsis from Wikipedia
        let overview = await fetchWikiSynopsis(title, year);
        if (!overview) {
          overview = cast
            ? `Starring: ${cast}. ${type} released in ${year || "recent years"}.`
            : `Information and media files for ${title} (${year || "N/A"}).`;
        }

        return {
          id: item.id,
          title,
          year,
          overview,
          poster_path: poster,
          cast,
          vote_average: "IMDb",
          media_type: type,
          source: "imdb",
        };
      })
    );

    return results;
  } catch (error: any) {
    console.warn("IMDb search error:", error.message);
    return [];
  }
}

/**
 * Search TV shows using TVmaze API (100% free, zero API key)
 */
async function searchTVmaze(query: string): Promise<UnifiedMovie[]> {
  try {
    const res = await axios.get(`https://api.tvmaze.com/search/shows`, {
      params: { q: query },
      timeout: 4000,
    });

    const list = res.data || [];
    return list.slice(0, 3).map((item: any) => {
      const show = item.show;
      const cleanSummary = show.summary
        ? show.summary.replace(/<[^>]*>/g, "")
        : `A TV series airing on ${show.network?.name || "television"}.`;

      return {
        id: `tvmaze_${show.id}`,
        title: show.name,
        year: show.premiered ? show.premiered.split("-")[0] : "",
        overview: cleanSummary,
        poster_path: show.image?.original || show.image?.medium || null,
        vote_average: show.rating?.average ? `${show.rating.average}/10` : "N/A",
        media_type: "TV Series",
        source: "tvmaze",
      };
    });
  } catch (error: any) {
    console.warn("TVmaze search error:", error.message);
    return [];
  }
}

let isOmdbKeyDisabled = false;

/**
 * Search using OMDb API if user provided valid OMDB_API_KEY
 */
async function searchOMDb(query: string, apiKey: string): Promise<UnifiedMovie[]> {
  if (isOmdbKeyDisabled) return [];
  try {
    const res = await axios.get("https://www.omdbapi.com/", {
      params: { apikey: apiKey, s: query },
      timeout: 3000,
    });

    if (res.data?.Response === "False" || !res.data?.Search) {
      return [];
    }

    const items = res.data.Search.slice(0, 3);
    return Promise.all(
      items.map(async (item: any) => {
        // Fetch full details for plot
        let plot = `Type: ${item.Type}. Released in ${item.Year}.`;
        try {
          const detailRes = await axios.get("https://www.omdbapi.com/", {
            params: { apikey: apiKey, i: item.imdbID, plot: "short" },
            timeout: 2000,
          });
          if (detailRes.data?.Plot && detailRes.data.Plot !== "N/A") {
            plot = detailRes.data.Plot;
          }
        } catch {
          // ignore
        }

        return {
          id: item.imdbID,
          title: item.Title,
          year: item.Year,
          overview: plot,
          poster_path: item.Poster !== "N/A" ? item.Poster : null,
          vote_average: "OMDb",
          media_type: item.Type === "series" ? "TV Series" : "Movie",
          source: "omdb",
        };
      })
    );
  } catch (error: any) {
    if (error.response?.status === 401 || error.response?.status === 403) {
      isOmdbKeyDisabled = true;
    }
    return [];
  }
}

/**
 * Search using TMDB API if user provided TMDB_API_KEY
 */
async function searchTMDB(query: string, apiKey: string): Promise<UnifiedMovie[]> {
  try {
    const res = await axios.get("https://api.themoviedb.org/3/search/multi", {
      params: { api_key: apiKey, query, include_adult: false, language: 'en-US', page: 1 },
      timeout: 4000,
    });
    
    if (!res.data?.results) return [];
    
    const validItems = res.data.results.filter((item: any) => item.media_type === 'movie' || item.media_type === 'tv').slice(0, 4);
    
    return validItems.map((item: any) => {
      const title = item.title || item.name;
      const releaseDate = item.release_date || item.first_air_date;
      const year = releaseDate ? releaseDate.split('-')[0] : '';
      const poster = item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : null;
      
      return {
        id: `tmdb_${item.id}`,
        title,
        year,
        overview: item.overview || "No description available.",
        poster_path: poster,
        vote_average: item.vote_average ? `${item.vote_average.toFixed(1)}/10` : 'N/A',
        media_type: item.media_type === 'tv' ? 'TV Series' : 'Movie',
        source: 'tmdb',
      };
    });
  } catch (error: any) {
    console.warn("TMDB error:", error.message);
    return [];
  }
}

/**
 * Main unified movie search function:
 * Automatically uses:
 * 1. TMDB (if TMDB_API_KEY provided)
 * 2. OMDb (if OMDB_API_KEY provided)
 * 3. Keyless primary: IMDb Public Suggestion API (instant, rich posters, cast, synopsis)
 * 4. Keyless secondary: TVmaze API (specialized in television series & shows)
 */
export async function searchMovies(query: string): Promise<UnifiedMovie[]> {
  if (!query || !query.trim()) return [];
  const cleanQuery = query.trim();

  // 1. If user configured TMDB API Key
  if (process.env.TMDB_API_KEY) {
    const tmdbResults = await searchTMDB(cleanQuery, process.env.TMDB_API_KEY);
    if (tmdbResults.length > 0) {
      return tmdbResults;
    }
  }

  // 2. If user configured OMDb API Key
  if (process.env.OMDB_API_KEY) {
    const omdbResults = await searchOMDb(cleanQuery, process.env.OMDB_API_KEY);
    if (omdbResults.length > 0) {
      return omdbResults;
    }
  }

  // 3. Keyless primary: IMDb Public Suggestion API
  try {
    const imdbResults = await searchIMDb(cleanQuery);
    if (imdbResults.length > 0) {
      return imdbResults;
    }
  } catch (err: any) {
    // Graceful fallback to secondary
  }

  // 4. Keyless secondary: TVmaze API (especially great for series/shows)
  try {
    const tvmazeResults = await searchTVmaze(cleanQuery);
    if (tvmazeResults.length > 0) {
      return tvmazeResults;
    }
  } catch (err: any) {
    // Graceful fallback
  }

  return [];
}
