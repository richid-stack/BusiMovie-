import { filenameParse } from "@ctrl/video-filename-parser";
import { MediaFile } from "../types.js";

export interface ParsedMediaInfo {
  isSeries: boolean;
  cleanTitle: string;
  season?: number;
  episode?: number;
  endEpisode?: number;
  year?: string;
  quality?: string;
  rawFileName: string;
}

/**
 * Normalizes title strings by stripping emojis, promo handles, channel tags, URLs, track numbers, and video extensions.
 */
export function cleanRawTitleNoise(input: string): string {
  let text = (input || "").split(/[\r\n]+/)[0].trim();
  if (!text) return "";

  // Strip Unicode emojis and special symbols
  text = text.replace(/[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|[\u{1F600}-\u{1F64F}]|[\u{1F680}-\u{1F6FF}]|[\u{1FA70}-\u{1FAFF}]|[\u{200B}-\u{200D}\u{FEFF}]/gu, " ");

  // Remove common video extensions
  text = text.replace(/\.(mkv|mp4|avi|mov|webm|flv|ts|m4v)$/i, "");

  // Remove file size mentions like "950MB", "1.4GB"
  text = text.replace(/\b\d+(?:\.\d+)?\s*(?:gb|mb|gib|mib)\b/gi, " ");

  // Remove URL links
  text = text.replace(/https?:\/\/\S+/gi, "");

  // Remove telegram channel handles & promo tags
  text = text.replace(/@[\w_]+/g, "");
  text = text.replace(/\[[^\]]*\]/g, " "); // Strip all bracketed tags like [720p], [Pahe], [FC]
  text = text.replace(/\([^)]*@+[^)]*\)/gi, " "); // Strip parentheses containing handles
  text = text.replace(/\([^)]*(?:intermedia|pahe|yts|tamildubbed|telugudubbed|dual\s*audio|season|series|ult\s*ext|remastered)[^)]*\)/gi, " ");
  
  // Strip release team prefixes like "FC", "PSA", "HEVC", "CVM", "RQM", "IMDB", "MLM", "CC", "MM", "FBM_HW"
  text = text.replace(/^(?:fc|psa|hevc|webrip|bluray|x265|x264|fbm_hw|fbm|hw|cc|mm|pfm|wmr|pf|cvm|rqm|imdb|mlm|bazar|worldcinematoday)[_.\s-]+/i, "");
  
  // Strip leading track/list numbers like "05.", "1.", "11. ", "08 "
  text = text.replace(/^\s*\d{1,2}\s*[\.\-_\)]\s*/, "");
  text = text.replace(/^s\s*\d+x\s*/i, "");

  text = text.replace(/(?:join\s*@|follow\s*@|telegram\s*@|downloaded\s*from\s*|shared\s*by\s*)[^\s]+/gi, "");

  // Clean trailing noise like "kings x", "Tam Telu", "Tam Hin", open parentheses
  text = text.replace(/\b(?:kings\s*x|tam\s*telu|tam\s*hin|tam\s*eng)\b/gi, "");
  text = text.replace(/[\(\[\{:\-_]+$/, "").trim();

  return text.trim();
}

/**
 * Intelligent parser that extracts show title, season number, episode number,
 * release year, and video quality from filenames or release titles.
 */
export function parseMediaTitleAndSeriesInfo(fileName: string, existingTitle?: string): ParsedMediaInfo {
  const raw = fileName || existingTitle || "";
  const cleanedNoise = cleanRawTitleNoise(raw);

  // Normalize separators to spaces for regex analysis
  const spaced = cleanedNoise.replace(/[\u00a0\s]+/g, " ").replace(/[._]+/g, " ").trim();

  // Extract Quality
  let quality: string = "1080p";
  const qMatch = spaced.match(/\b(2160p|4K|UHD|1080p|720p|480p|HD|SD)\b/i);
  if (qMatch) {
    quality = qMatch[1].toUpperCase();
    if (quality === "UHD") quality = "4K";
  }

  // Extract Year
  let year: string | undefined;
  const yearMatch = spaced.match(/\b(19\d{2}|20\d{2})\b/);
  if (yearMatch) {
    year = yearMatch[1];
  }

  // Check for S.W.A.T. special case
  if (/^s\.w\.a\.t/i.test(cleanedNoise) || /^swat/i.test(cleanedNoise) || /^s w a t/i.test(cleanedNoise) || existingTitle === "S W A T" || existingTitle === "S.W.A.T.") {
    const seMatch = cleanedNoise.match(/[Ss](\d{1,2})[Ee](\d{1,3})/i) || cleanedNoise.match(/Season\s*(\d{1,2})\s*Episode\s*(\d{1,3})/i);
    return {
      isSeries: true,
      cleanTitle: "S.W.A.T.",
      season: seMatch ? parseInt(seMatch[1], 10) : 1,
      episode: seMatch ? parseInt(seMatch[2], 10) : undefined,
      year: year || "2017",
      quality,
      rawFileName: fileName
    };
  }

  // Industry-Standard Filename Parsing (@ctrl/video-filename-parser, Radarr/Sonarr inspired)
  const hasTvMarkers = /\b(?:s\d{1,2}\s*[._\-\s]*e\d{1,3}|season\s*\d{1,2}|series\s*\d{1,2}|\b\d{1,2}x\d{1,3}\b|ep\s*\d{1,3}|episode\s*\d{1,3})\b/i.test(cleanedNoise);

  if (hasTvMarkers) {
    try {
      const ctrlParsed = filenameParse(cleanedNoise, true) as any;
      if (ctrlParsed && ctrlParsed.title && ctrlParsed.title.length >= 2) {
        const isTv = ctrlParsed.isTv || (ctrlParsed.seasons && ctrlParsed.seasons.length > 0) || (ctrlParsed.episodeNumbers && ctrlParsed.episodeNumbers.length > 0);
        if (isTv) {
          return {
            isSeries: true,
            cleanTitle: ctrlParsed.title,
            season: (ctrlParsed.seasons && ctrlParsed.seasons[0]) ? ctrlParsed.seasons[0] : 1,
            episode: (ctrlParsed.episodeNumbers && ctrlParsed.episodeNumbers[0]) ? ctrlParsed.episodeNumbers[0] : undefined,
            endEpisode: (ctrlParsed.episodeNumbers && ctrlParsed.episodeNumbers[1]) ? ctrlParsed.episodeNumbers[1] : undefined,
            year: ctrlParsed.year ? String(ctrlParsed.year) : year,
            quality: ctrlParsed.resolution || quality,
            rawFileName: fileName
          };
        }
      }
    } catch (_) {}
  } else {
    try {
      const movieParsed = filenameParse(cleanedNoise, false) as any;
      if (movieParsed && movieParsed.title && movieParsed.title.length >= 2 && !movieParsed.isTv) {
        return {
          isSeries: false,
          cleanTitle: movieParsed.title,
          year: movieParsed.year ? String(movieParsed.year) : year,
          quality: movieParsed.resolution || quality,
          rawFileName: fileName
        };
      }
    } catch (_) {}
  }

  // Season & Episode Pattern Matchers (in priority order)
  const patterns: Array<{
    regex: RegExp;
    extract: (m: RegExpMatchArray) => { season?: number; episode?: number; endEpisode?: number; cutIndex: number };
  }> = [
    // 1. Standard S01E05 or S01 E05 or S01.E05 or S01_E05 or S01-E05 or S01E01-E02
    {
      regex: /\b[Ss](\d{1,2})\s*[\._\-\s]*[Ee](\d{1,3})(?:\s*[\-_]\s*[Ee]?(\d{1,3}))?\b/i,
      extract: (m) => ({
        season: parseInt(m[1], 10),
        episode: parseInt(m[2], 10),
        endEpisode: m[3] ? parseInt(m[3], 10) : undefined,
        cutIndex: m.index || 0
      })
    },
    // 2. Full words: "Season 1 Episode 5" or "Season 01 Ep 05"
    {
      regex: /\b(?:Season|Series)\s*(\d{1,2})\s*[\._\-\s]*(?:Episode|Ep|Part)\s*(\d{1,3})\b/i,
      extract: (m) => ({
        season: parseInt(m[1], 10),
        episode: parseInt(m[2], 10),
        cutIndex: m.index || 0
      })
    },
    // 3. 1x05 or 01x05 notation
    {
      regex: /\b(\d{1,2})x(\d{1,3})\b/i,
      extract: (m) => ({
        season: parseInt(m[1], 10),
        episode: parseInt(m[2], 10),
        cutIndex: m.index || 0
      })
    },
    // 4. "Show Name 1 17" or "Criminal Minds 1 05" (Season 1 Episode 17)
    {
      regex: /^(.*?)\s+(\d{1,2})\s+(\d{2,3})(?:\s+.*)?$/i,
      extract: (m) => {
        const titlePart = m[1];
        const s = parseInt(m[2], 10);
        const e = parseInt(m[3], 10);
        if (s <= 30 && e <= 100 && titlePart && titlePart.length >= 3 && !/^(19\d{2}|20\d{2})$/.test(titlePart)) {
          return { season: s, episode: e, cutIndex: titlePart.length };
        }
        return { season: 1, episode: e, cutIndex: 0 };
      }
    },
    // 5. Single Season only: "Game of Thrones Season 1" or "Game of Thrones S01"
    {
      regex: /\b(?:Season|Series)\s*(\d{1,2})\b|\b[Ss](\d{1,2})\b/i,
      extract: (m) => ({
        season: parseInt(m[1] || m[2], 10),
        cutIndex: m.index || 0
      })
    },
    // 6. Single Episode only: "Episode 5" or "Ep 05" or "EP05" or "EP.05"
    {
      regex: /\b(?:Episode|Ep|EP)[\._\-\s]*(\d{1,3})\b/i,
      extract: (m) => ({
        season: 1,
        episode: parseInt(m[1], 10),
        cutIndex: m.index || 0
      })
    }
  ];

  for (const pattern of patterns) {
    const match = spaced.match(pattern.regex);
    if (match && match.index !== undefined) {
      const extracted = pattern.extract(match);
      if (extracted.season !== undefined || extracted.episode !== undefined) {
        let cutIdx = extracted.cutIndex;
        if (cutIdx <= 0) {
          cutIdx = match.index;
        }

        if (yearMatch && yearMatch.index !== undefined && yearMatch.index < cutIdx && yearMatch.index > 2) {
          cutIdx = Math.min(cutIdx, yearMatch.index);
        }

        let cleanTitle = spaced.substring(0, cutIdx).trim();

        // Clean trailing hyphens, dots, underscores, colons
        cleanTitle = cleanTitle.replace(/[\-–—:_]+$/, "").trim();

        // Strip release tags from title
        cleanTitle = cleanTitle.replace(/\b(WEBRip|BluRay|BRRip|x264|x265|HEVC|AAC|HDR|HD|HQ|RMSTRD|NF|AMZN|PSA|YIFY)\b/gi, "").trim();
        cleanTitle = cleanTitle.replace(/\s+/g, " ").trim();

        if (cleanTitle && cleanTitle.length >= 2) {
          return {
            isSeries: true,
            cleanTitle,
            season: extracted.season ?? 1,
            episode: extracted.episode,
            endEpisode: extracted.endEpisode,
            year,
            quality,
            rawFileName: fileName
          };
        }
      }
    }
  }

  // Not a series, parse as movie
  let cutIdx = spaced.length;
  if (yearMatch && yearMatch.index !== undefined && yearMatch.index > 2) {
    cutIdx = Math.min(cutIdx, yearMatch.index);
  }
  if (qMatch && qMatch.index !== undefined && qMatch.index > 2) {
    cutIdx = Math.min(cutIdx, qMatch.index);
  }

  let movieTitle = spaced.substring(0, cutIdx).trim();
  movieTitle = movieTitle.replace(/[\-–—:_]+$/, "").trim();
  movieTitle = movieTitle.replace(/\b(WEBRip|BluRay|BRRip|x264|x265|HEVC|AAC|HDR|HD|HQ|RMSTRD|NF|AMZN|PSA|YIFY)\b/gi, "").trim();
  movieTitle = movieTitle.replace(/\s+/g, " ").trim();

  if (!movieTitle || movieTitle.length < 2) {
    movieTitle = existingTitle || cleanedNoise;
  }

  return {
    isSeries: false,
    cleanTitle: movieTitle,
    year,
    quality,
    rawFileName: fileName
  };
}

/**
 * Groups a flat array of MediaFiles into an intelligent catalog of Unified Series & Movies.
 */
export function groupMediaIntoCatalog(files: MediaFile[]): {
  catalog: MediaFile[];
  seriesList: MediaFile[];
  moviesList: MediaFile[];
} {
  const seriesMap = new Map<string, {
    showTitle: string;
    primaryRecord: MediaFile;
    episodes: MediaFile[];
    seasonsSet: Set<number>;
  }>();

  const movieMap = new Map<string, {
    primaryRecord: MediaFile;
    qualities: Array<{ id: number; quality: string; file_size: number; file_name?: string }>;
  }>();

  for (const file of files) {
    const rawTitle = file.movie_title || "";
    const rawFn = file.file_name || "";

    const parsed = parseMediaTitleAndSeriesInfo(rawFn, rawTitle);
    const normalizedKey = (parsed.cleanTitle || rawTitle).toLowerCase().replace(/[^a-z0-9]/g, "");

    const isSeries = Boolean(
      file.season || 
      file.episode || 
      parsed.isSeries || 
      file.is_series
    );

    if (isSeries) {
      const showTitle = parsed.cleanTitle || file.movie_title;
      const seasonNum = file.season || parsed.season || 1;
      const episodeNum = file.episode || parsed.episode || 1;

      const episodeItem: MediaFile = {
        ...file,
        movie_title: showTitle,
        season: seasonNum,
        episode: episodeNum,
        quality: file.quality || parsed.quality || "1080p"
      };

      if (!seriesMap.has(normalizedKey)) {
        seriesMap.set(normalizedKey, {
          showTitle,
          primaryRecord: {
            ...episodeItem,
            is_series: true
          },
          episodes: [episodeItem],
          seasonsSet: new Set([seasonNum])
        });
      } else {
        const existing = seriesMap.get(normalizedKey)!;
        existing.episodes.push(episodeItem);
        existing.seasonsSet.add(seasonNum);
        // Prefer a primary record that has a poster_url
        if (!existing.primaryRecord.poster_url && episodeItem.poster_url) {
          existing.primaryRecord.poster_url = episodeItem.poster_url;
        }
      }
    } else {
      const movieKey = `${normalizedKey}_${file.year || ""}`;
      const qualityEntry = {
        id: file.id,
        quality: file.quality || parsed.quality || "1080p",
        file_size: file.file_size || 0,
        file_name: file.file_name
      };

      if (!movieMap.has(movieKey)) {
        movieMap.set(movieKey, {
          primaryRecord: {
            ...file,
            movie_title: parsed.cleanTitle || file.movie_title,
            is_series: false
          },
          qualities: [qualityEntry]
        });
      } else {
        const existing = movieMap.get(movieKey)!;
        existing.qualities.push(qualityEntry);
        if (!existing.primaryRecord.poster_url && file.poster_url) {
          existing.primaryRecord.poster_url = file.poster_url;
        }
      }
    }
  }

  // Finalize series records
  const seriesList: MediaFile[] = [];
  for (const [, show] of seriesMap.entries()) {
    // Sort episodes by season asc, episode asc
    const sortedEpisodes = [...show.episodes].sort((a, b) => {
      const sDiff = (a.season || 1) - (b.season || 1);
      if (sDiff !== 0) return sDiff;
      return (a.episode || 1) - (b.episode || 1);
    });

    const seasons = Array.from(show.seasonsSet).sort((a, b) => a - b);

    const unifiedShow: MediaFile = {
      ...show.primaryRecord,
      movie_title: show.showTitle,
      is_series: true,
      total_episodes: sortedEpisodes.length,
      seasons: seasons.length > 0 ? seasons : [1],
      episodes: sortedEpisodes
    };

    seriesList.push(unifiedShow);
  }

  // Finalize movie records
  const moviesList: MediaFile[] = [];
  for (const [, movie] of movieMap.entries()) {
    const unifiedMovie: MediaFile = {
      ...movie.primaryRecord,
      is_series: false,
      all_qualities: movie.qualities
    };
    moviesList.push(unifiedMovie);
  }

  // Combine for full catalog
  const catalog = [...seriesList, ...moviesList].sort((a, b) => b.id - a.id);

  return { catalog, seriesList, moviesList };
}
