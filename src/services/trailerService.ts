import axios from "axios";

// In-memory cache to prevent redundant lookups
const trailerCache = new Map<string, string>();

export interface TrailerResult {
  url: string;
  videoId?: string;
  source: "tmdb" | "youtube_extract" | "youtube_search";
}

/**
 * Fetch official teaser trailer for a movie or TV show without requiring TMDB API key.
 * Strategy:
 * 1. Check in-memory cache.
 * 2. If TMDB_API_KEY is available in env, query TMDB videos endpoint.
 * 3. Otherwise (or as primary keyless engine), search YouTube directly using public search scraper
 *    to extract the exact 11-character videoId for the official trailer.
 * 4. Fall back to guaranteed high-relevance YouTube search query link.
 */
export async function getOfficialTrailer(title: string, year?: string): Promise<TrailerResult> {
  const cacheKey = `${title.trim().toLowerCase()}_${year || ""}`;
  if (trailerCache.has(cacheKey)) {
    const cachedUrl = trailerCache.get(cacheKey)!;
    return {
      url: cachedUrl,
      videoId: extractVideoId(cachedUrl),
      source: "youtube_extract"
    };
  }

  // 1. Try TMDB if API key happens to be present
  if (process.env.TMDB_API_KEY) {
    try {
      const tmdbApiKey = process.env.TMDB_API_KEY;
      const searchRes = await axios.get("https://api.themoviedb.org/3/search/multi", {
        params: { api_key: tmdbApiKey, query: title },
        timeout: 3000
      });

      const firstMatch = searchRes.data?.results?.[0];
      if (firstMatch?.id) {
        const mediaType = firstMatch.media_type === "tv" ? "tv" : "movie";
        const videoRes = await axios.get(`https://api.themoviedb.org/3/${mediaType}/${firstMatch.id}/videos`, {
          params: { api_key: tmdbApiKey },
          timeout: 3000
        });

        const videos = videoRes.data?.results || [];
        const trailer = videos.find((v: any) => v.site === "YouTube" && (v.type === "Trailer" || v.type === "Teaser")) ||
                        videos.find((v: any) => v.site === "YouTube");

        if (trailer?.key) {
          const trailerUrl = `https://www.youtube.com/watch?v=${trailer.key}`;
          trailerCache.set(cacheKey, trailerUrl);
          return {
            url: trailerUrl,
            videoId: trailer.key,
            source: "tmdb"
          };
        }
      }
    } catch (e: any) {
      console.warn("[TrailerService] TMDB trailer lookup failed or skipped:", e.message);
    }
  }

  // 2. High-speed Keyless YouTube Video ID Extraction
  try {
    const cleanTitle = title.replace(/[._\-–—[\]()]+/g, " ").trim();
    const query = `${cleanTitle} ${year || ""} official trailer`.trim();
    const ytSearchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;

    const ytRes = await axios.get(ytSearchUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9"
      },
      timeout: 3500
    });

    const html: string = typeof ytRes.data === "string" ? ytRes.data : JSON.stringify(ytRes.data);

    // Extract potential video IDs from the response
    const videoMatches = [...html.matchAll(/"videoId":"([a-zA-Z0-9_-]{11})"/g)];
    if (videoMatches.length > 0) {
      // Pick the first distinct valid video ID
      const candidateId = videoMatches[0][1];
      const directUrl = `https://www.youtube.com/watch?v=${candidateId}`;
      trailerCache.set(cacheKey, directUrl);
      console.log(`[TrailerService] Keyless extraction succeeded for "${title}": ${directUrl}`);
      return {
        url: directUrl,
        videoId: candidateId,
        source: "youtube_extract"
      };
    }
  } catch (err: any) {
    console.warn(`[TrailerService] Keyless scrape error for "${title}":`, err.message);
  }

  // 3. Fallback: Guaranteed direct YouTube Search deep link
  const fallbackUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(`${title} ${year || ""} official trailer`.trim())}`;
  trailerCache.set(cacheKey, fallbackUrl);
  return {
    url: fallbackUrl,
    source: "youtube_search"
  };
}

function extractVideoId(url: string): string | undefined {
  const match = url.match(/(?:watch\?v=|\/embed\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  return match ? match[1] : undefined;
}
