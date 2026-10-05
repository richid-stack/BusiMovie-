import axios from "axios";
import torrentStream from "torrent-stream";
import path from "path";
import fs from "fs";

export interface TorrentSearchResult {
  title: string;
  year: number;
  quality: string;
  size: string;
  hash: string;
  url: string;
}

const YTS_MIRRORS = [
  "https://yts.lt",
  "https://yts.ag",
  "https://yts.am",
  "https://yts.mx"
];

/**
 * Searches open trackers for movie torrents using resilient multi-mirror fallback.
 * Handled gracefully and silently if trackers are unreachable or return 500.
 */
export async function searchOpenTracker(query: string): Promise<TorrentSearchResult[]> {
  if (!query || !query.trim()) return [];
  const cleanQuery = query.trim();

  for (const mirror of YTS_MIRRORS) {
    try {
      const res = await axios.get(`${mirror}/api/v2/list_movies.json`, {
        params: { query_term: cleanQuery, limit: 4 },
        timeout: 3000,
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept": "application/json"
        }
      });

      if (!res.data || !res.data.data || !res.data.data.movies) {
        continue;
      }

      const results: TorrentSearchResult[] = [];
      for (const movie of res.data.data.movies) {
        if (movie.torrents && Array.isArray(movie.torrents)) {
          for (const torrent of movie.torrents) {
            results.push({
              title: movie.title,
              year: movie.year,
              quality: torrent.quality,
              size: torrent.size,
              hash: torrent.hash,
              url: torrent.url
            });
          }
        }
      }

      if (results.length > 0) {
        return results;
      }
    } catch (err: any) {
      // Graceful fallback to next mirror if mirror returns 500 or network error
      console.warn(`[TorrentEngine] YTS mirror ${mirror} unreachable (${err?.response?.status || err?.message}), trying next mirror...`);
    }
  }

  return [];
}

/**
 * Initiates download of a magnet/torrent hash via torrent-stream.
 */
export function downloadTorrent(
  hash: string,
  onProgress: (progress: number, downloadSpeed: number) => void
): Promise<{ filePath: string; fileName: string; size: number }> {
  return new Promise((resolve, reject) => {
    const magnetURI = `magnet:?xt=urn:btih:${hash}`;
    
    console.log(`[Torrent Engine] Starting download for: ${hash}`);
    
    const engine = torrentStream(magnetURI, { path: "/tmp/webtorrent" });
    
    engine.on("ready", () => {
      // Find the largest file (likely the movie)
      const file = engine.files.reduce((a, b) => (a.length > b.length ? a : b));
      
      console.log(`[Torrent Engine] Downloading: ${file.name}`);
      file.select();

      let lastProgress = 0;
      let downloaded = 0;
      
      engine.on("download", (bytes) => {
        downloaded += bytes;
        const currentProgress = Math.floor((downloaded / file.length) * 100);
        
        // Only trigger progress callback every 5% to avoid rate-limiting Telegram API
        if (currentProgress >= lastProgress + 5) {
          lastProgress = currentProgress;
          const speed = typeof (engine.swarm as any).downloadSpeed === "function" ? (engine.swarm as any).downloadSpeed() : 0;
          onProgress(currentProgress, speed);
        }
      });

      engine.on("idle", () => {
        console.log(`[Torrent Engine] Download complete: ${file.name}`);
        resolve({
          filePath: path.join("/tmp/webtorrent", file.path),
          fileName: file.name,
          size: file.length
        });
        
        engine.destroy(() => {});
      });
    });

    engine.on("error", (err: any) => {
      reject(err);
    });
  });
}
