import axios from "axios";

/**
 * Phase 6: Radarr / Sonarr Automation Layer
 * Translating the architectures of Addarr and Telegramarr into native TypeScript services.
 */

export interface ArrConfig {
  url: string;
  apiKey: string;
  rootFolderPath: string;
  qualityProfileId: number;
}

function getRadarrConfig(): ArrConfig | null {
  if (!process.env.RADARR_URL || !process.env.RADARR_API_KEY) return null;
  return {
    url: process.env.RADARR_URL.replace(/\/$/, ""),
    apiKey: process.env.RADARR_API_KEY,
    rootFolderPath: process.env.RADARR_ROOT_FOLDER_PATH || "/data/movies",
    qualityProfileId: parseInt(process.env.RADARR_QUALITY_PROFILE_ID || "1", 10)
  };
}

/**
 * Pushes a requested movie directly to Radarr to begin the automation pipeline.
 * Replaces the need for manual approval if configured.
 */
export async function addMovieToRadarr(tmdbId: string | number): Promise<{ success: boolean; message: string }> {
  const config = getRadarrConfig();
  if (!config) {
    return { success: false, message: "Radarr is not configured in environment variables." };
  }

  try {
    // 1. Look up the movie details in Radarr using TMDB ID
    const lookupRes = await axios.get(`${config.url}/api/v3/movie/lookup`, {
      params: { term: `tmdb:${tmdbId}` },
      headers: { "X-Api-Key": config.apiKey }
    });

    if (!lookupRes.data || lookupRes.data.length === 0) {
      return { success: false, message: "Radarr could not find this TMDB ID." };
    }

    const movieData = lookupRes.data[0];

    // Check if it already exists
    if (movieData.id) {
      return { success: true, message: "Movie is already in Radarr." };
    }

    // 2. Build the payload to add the movie
    const payload = {
      title: movieData.title,
      qualityProfileId: config.qualityProfileId,
      titleSlug: movieData.titleSlug,
      images: movieData.images,
      tmdbId: movieData.tmdbId,
      year: movieData.year,
      rootFolderPath: config.rootFolderPath,
      monitored: true,
      addOptions: {
        searchForMovie: true // Instantly tell Prowlarr/Indexers to start searching
      }
    };

    // 3. Send POST request to Radarr
    const addRes = await axios.post(`${config.url}/api/v3/movie`, payload, {
      headers: { "X-Api-Key": config.apiKey }
    });

    return { success: true, message: "Successfully added to Radarr and began searching!" };
  } catch (error: any) {
    console.error("Radarr Add Error:", error.response?.data || error.message);
    return { success: false, message: `Failed to add to Radarr: ${error.message}` };
  }
}
