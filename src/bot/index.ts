import fs from "fs";
import path from "path";
import { Telegraf, Markup, Telegram } from "telegraf";
import { searchMovies } from "../services/tmdb.js"; // Note: .js extension for ESM compilation in node
import { getOfficialTrailer } from "../services/trailerService.js";
import {
  db,
  getMediaFilesForMovie,
  getAllMediaFiles,
  addMediaFile,
  logChannelEvent,
  MediaFileRecord,
  getAllUsers,
  getRandomMediaFile,
  getAllVaultTitles,
  searchVaultFilesDirect,
  getVaultSeriesCatalog,
  getSeriesSeasons,
  getSeriesSeasonEpisodes,
  getVaultMovieCatalog,
  getMovieQualities,
  getMediaFileById,
  markRequestsFulfilled,
  saveEphemeralMessage,
  getDueEphemeralMessages,
  deleteEphemeralMessageFromDb,
  clearChatEphemeralMessagesFromDb,
  setCallbackKey,
  getCallbackKey
} from "../db/index.js";
import { getAIMovieRecommendations, analyzeUserIntent, generateMoviePostWatchFollowUp } from "../services/gemini.js";
import { isAdminTelegramId, getWebhookSecret } from "../server/auth.js";
import {
  testQuerySearchBot,
  fetchAndForwardBotMedia,
  dispatchAutomatedSearch,
  getSearchBots,
  fetchSeriesFromQuinson,
  getQuinsonSeriesSeasons,
  getQuinsonSeasonEpisodes,
  isBackOrNavButton,
  selectBestMatchingButton
} from "../services/crawlerService.js";

// Universal 2-Minute Ephemeral Message Management (120 seconds)
export const EPHEMERAL_TTL_MS = 120000;
const ephemeralTimers = new Map<string, NodeJS.Timeout>();

export function registerEphemeralMessage(bot: Telegraf, chatId: string | number, messageId: number, delayMs = EPHEMERAL_TTL_MS) {
  if (!chatId || !messageId) return;
  // Preserve messages in channels / groups (-100... or -...) so channel archives remain intact
  if (String(chatId).startsWith("-")) return;

  // Persist to SQLite database so deletions survive server reloads
  saveEphemeralMessage(chatId, messageId, delayMs).catch(() => {});

  const key = `${chatId}:${messageId}`;
  if (ephemeralTimers.has(key)) {
    clearTimeout(ephemeralTimers.get(key)!);
  }

  const timer = setTimeout(async () => {
    ephemeralTimers.delete(key);
    try {
      await bot.telegram.deleteMessage(chatId, messageId);
    } catch (err: any) {}
    await deleteEphemeralMessageFromDb(chatId, messageId);
  }, delayMs);

  ephemeralTimers.set(key, timer);
}

export function clearChatEphemeralMessages(bot: Telegraf, chatId: string | number) {
  const chatIdStr = String(chatId);
  for (const [key, timer] of ephemeralTimers.entries()) {
    if (key.startsWith(`${chatIdStr}:`)) {
      clearTimeout(timer);
      const msgId = Number(key.split(":")[1]);
      bot.telegram.deleteMessage(chatId, msgId).catch(() => {});
      ephemeralTimers.delete(key);
    }
  }
  clearChatEphemeralMessagesFromDb(chatId).then(items => {
    for (const item of items) {
      bot.telegram.deleteMessage(item.chat_id, item.message_id).catch(() => {});
    }
  }).catch(() => {});
}

export function isTvSeriesEntity(item: { media_type?: string; title?: string } | null | undefined): boolean {
  if (!item) return false;
  const mt = (item.media_type || "").toLowerCase().trim();
  if (
    mt === "tv" ||
    mt === "tv series" ||
    mt === "tvseries" ||
    mt === "series" ||
    mt === "tv_series" ||
    mt === "tvminiseries" ||
    mt === "show"
  ) {
    return true;
  }
  const t = (item.title || "").toLowerCase();
  return /\b(series|season|episode|s\d{1,2}|s\d{1,2}e\d{1,3})\b/i.test(t);
}

// Helper for deterministic short hashes
function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}

// In-memory caches for Telegram inline button limits (max 64 bytes) backed by SQLite callback_cache
const titleCache = new Map<string, string>();
const showKeyCache = new Map<string, string>();
const showTitleToKey = new Map<string, string>();

function getShowKey(title: string): string {
  const clean = title.trim();
  if (showTitleToKey.has(clean)) return showTitleToKey.get(clean)!;
  const slug = clean.toLowerCase().replace(/[^a-z0-9]/g, '_').slice(0, 16);
  const hash = Math.abs(hashString(clean)).toString(36).slice(0, 6);
  const key = `s_${slug}_${hash}`;
  showKeyCache.set(key, clean);
  showTitleToKey.set(clean, key);
  setCallbackKey(key, clean, "show").catch(() => {});
  return key;
}

async function resolveShowTitle(key: string): Promise<string> {
  if (showKeyCache.has(key)) return showKeyCache.get(key)!;
  const dbVal = await getCallbackKey(key);
  if (dbVal) {
    showKeyCache.set(key, dbVal);
    return dbVal;
  }
  return key;
}

// 30-minute caching for discovered TV Series seasons & episodes
const seriesSeasonsCache = new Map<string, { seasons: number[]; timestamp: number }>();
const seriesEpisodesCache = new Map<string, { episodes: Array<{ episodeNum: number; label: string }>; timestamp: number }>();

const movieKeyCache = new Map<string, { title: string; year?: string }>();
const movieTitleToKey = new Map<string, string>();

function getMovieKey(title: string, year?: string): string {
  const cleanTitle = title.trim();
  const cleanYr = year ? year.trim() : "";
  const fullKey = `${cleanTitle}__${cleanYr}`;
  if (movieTitleToKey.has(fullKey)) return movieTitleToKey.get(fullKey)!;
  const slug = cleanTitle.toLowerCase().replace(/[^a-z0-9]/g, '_').slice(0, 16);
  const hash = Math.abs(hashString(fullKey)).toString(36).slice(0, 6);
  const key = `m_${slug}_${hash}`;
  movieKeyCache.set(key, { title: cleanTitle, year: cleanYr });
  movieTitleToKey.set(fullKey, key);
  setCallbackKey(key, JSON.stringify({ title: cleanTitle, year: cleanYr }), "movie").catch(() => {});
  return key;
}

async function resolveMovieMeta(key: string): Promise<{ title: string; year?: string }> {
  if (movieKeyCache.has(key)) return movieKeyCache.get(key)!;
  const dbVal = await getCallbackKey(key);
  if (dbVal) {
    try {
      const parsed = JSON.parse(dbVal);
      movieKeyCache.set(key, parsed);
      return parsed;
    } catch (_) {}
  }
  return { title: key };
}

const queryKeyCache = new Map<string, string>();
function getQueryKey(q: string): string {
  const clean = q.trim();
  const slug = clean.toLowerCase().replace(/[^a-z0-9]/g, '_').slice(0, 16);
  const hash = Math.abs(hashString(clean)).toString(36).slice(0, 6);
  const key = `q_${slug}_${hash}`;
  queryKeyCache.set(key, clean);
  setCallbackKey(key, clean, "query").catch(() => {});
  return key;
}

async function resolveQuery(key: string): Promise<string> {
  if (queryKeyCache.has(key)) return queryKeyCache.get(key)!;
  const dbVal = await getCallbackKey(key);
  if (dbVal) {
    queryKeyCache.set(key, dbVal);
    return dbVal;
  }
  return key;
}

const botRespCache = new Map<string, { botUsername: string; messageId: number; buttons: any[]; query: string }>();
let botRespCounter = 1;
function saveBotResponse(data: { botUsername: string; messageId: number; buttons: any[]; query: string }): string {
  const key = `b${botRespCounter++}`;
  botRespCache.set(key, data);
  return key;
}

export interface TelegramUpdateLog {
  id: string;
  time: string;
  updateType: string;
  chatId?: string;
  chatTitle?: string;
  chatType?: string;
  text?: string;
  fromName?: string;
  status?: string;
}

export const recentTelegramUpdates: TelegramUpdateLog[] = [];

// Helper to format bytes
function formatFileSize(bytes: number): string {
  if (!bytes || bytes === 0) return "Unknown size";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

// Helper to parse filename and caption into movie title, year, quality, season, and episode
// Helper to parse filename and caption into movie title, year, quality, season, and episode
export function parseMediaDetails(rawFilename?: string, rawCaption?: string): {
  title: string;
  year?: string;
  quality: string;
  season?: number;
  episode?: number;
} {
  const isPromo = (text?: string): boolean => {
    if (!text || !text.trim()) return true;
    const lower = text.toLowerCase().trim();
    return (
      lower.startsWith("join ") ||
      lower.startsWith("subscribe") ||
      lower.startsWith("backup channel") ||
      lower.includes("join @") ||
      lower.includes("join our") ||
      lower.includes("t.me/") ||
      lower.includes("@f5") ||
      lower.includes("@apple_movies") ||
      lower.includes("@apple movies") ||
      lower.includes("@apple") ||
      /^(@[a-zA-Z0-9_]+\s*)+$/.test(lower) ||
      /^join\s+@/i.test(lower)
    );
  };

  // Determine primary text source: ALWAYS prefer filename if caption is promo or lacks movie/year info
  let sourceText = "";
  const caption = (rawCaption || "").trim();
  const filename = (rawFilename || "").trim();

  if (filename && !isPromo(filename)) {
    if (caption && !isPromo(caption) && (/movie\s*:/i.test(caption) || /title\s*:/i.test(caption))) {
      sourceText = caption;
    } else {
      sourceText = filename;
    }
  } else if (caption && !isPromo(caption)) {
    sourceText = caption;
  } else if (filename) {
    sourceText = filename;
  } else {
    sourceText = caption || "Untitled Movie";
  }

  // If sourceText has "Movie:" or "Title:", extract that portion
  const moviePrefixMatch = sourceText.match(/(?:movie|title)\s*:\s*([^\n\r]+)/i);
  if (moviePrefixMatch) {
    sourceText = moviePrefixMatch[1].trim();
  }

  // If multi-line, try to find the most relevant line (has year, quality, or season)
  const lines = sourceText.split('\n').map(l => l.trim()).filter(l => l.length > 0 && !isPromo(l));
  let relevantLine = lines[0] || sourceText;
  for (const line of lines) {
    if (
      /\b(19\d{2}|20\d{2})\b/.test(line) || 
      /\b(2160p|4K|1080p|720p|480p|HD|HDR|UHD)\b/i.test(line) || 
      /s(\d{1,2})e(\d{1,3})/i.test(line)
    ) {
      relevantLine = line;
      break;
    }
  }

  // Strip emojis and common junk symbols
  let clean = relevantLine.replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1FA00}-\u{1FAFF}\u{2300}-\u{23FF}📌🎬🍿✅⚡⭐]/gu, '').trim();
  clean = clean.replace(/\.[a-zA-Z0-9]{2,4}$/, ""); // remove extension

  // Strip promo channel phrases
  clean = clean.replace(/join\s+@[\w_]+/gi, "").trim();
  clean = clean.replace(/@[\w_]+/g, "").trim();
  clean = clean.replace(/^\[[A-Za-z0-9 _-]+\]\s*/, "");
  clean = clean.replace(/^(fc|psa|hevc|webrip|bluray|x265|x264)[_.-]+/i, "");

  // Special check for S.W.A.T. / SWAT
  if (/^s\.w\.a\.t/i.test(clean) || /^swat/i.test(clean) || /^s w a t/i.test(clean)) {
    const seMatch = clean.match(/s(\d{1,2})e(\d{1,3})/i) || clean.match(/season\s*(\d{1,2})\s*episode\s*(\d{1,3})/i);
    const qMatch = clean.match(/\b(2160p|4K|1080p|720p|480p|HD)\b/i);
    return {
      title: "S.W.A.T.",
      year: "2017",
      quality: qMatch ? qMatch[1].toUpperCase() : "720P",
      season: seMatch ? parseInt(seMatch[1], 10) : undefined,
      episode: seMatch ? parseInt(seMatch[2], 10) : undefined
    };
  }

  // Convert underscores and dots to spaces to allow regex word boundaries \b to work properly
  const spaced = clean.replace(/[._]+/g, ' ').replace(/\s+/g, ' ').trim();

  // Extract Season & Episode
  let season: number | undefined;
  let episode: number | undefined;
  const seMatch = spaced.match(/\b(?:s(\d{1,2})\s*e(\d{1,3})|season\s*(\d{1,2})\s*episode\s*(\d{1,3}))\b/i);
  if (seMatch) {
    season = parseInt(seMatch[1] || seMatch[3], 10);
    episode = parseInt(seMatch[2] || seMatch[4], 10);
  }

  // Extract quality
  let quality = "1080p";
  const qualityMatch = spaced.match(/\b(2160p|4K|1080p|720p|480p|HD|HDR|UHD)\b/i);
  if (qualityMatch) {
    quality = qualityMatch[1].toUpperCase();
  }

  // Extract year
  let year = "";
  const yearMatch = spaced.match(/\b(19\d{2}|20\d{2})\b/);
  if (yearMatch) {
    year = yearMatch[1];
  }

  // Clean title: take portion before season/episode, year, or quality
  let cutIndex = spaced.length;
  if (seMatch && seMatch.index !== undefined && seMatch.index > 0) {
    cutIndex = Math.min(cutIndex, seMatch.index);
  }
  if (yearMatch && yearMatch.index !== undefined && yearMatch.index > 0) {
    cutIndex = Math.min(cutIndex, yearMatch.index);
  }
  if (qualityMatch && qualityMatch.index !== undefined && qualityMatch.index > 0) {
    cutIndex = Math.min(cutIndex, qualityMatch.index);
  }

  let title = spaced.substring(0, cutIndex).replace(/\b(WEBRip|BluRay|BRRip|x264|x265|HEVC|AAC|HDR|HD|HQ|RMSTRD|NF|AMZN|PSA)\b/gi, "").trim();
  if (!title || title.toLowerCase() === "join" || title.length < 2) {
    // If title was mangled by promo text, fallback strictly to rawFilename
    if (filename && filename !== sourceText) {
      return parseMediaDetails(filename, "");
    }
    title = spaced || "Untitled Movie";
  }

  return { title, year, quality, season, episode };
}

// Helper to extract media payload from any Telegram message or channel post
function extractVideoMedia(post: any): {
  file_id: string;
  file_name?: string;
  file_size?: number;
  mime_type?: string;
} | null {
  if (!post) return null;

  if (post.video) {
    return {
      file_id: post.video.file_id,
      file_name: post.video.file_name,
      file_size: post.video.file_size,
      mime_type: post.video.mime_type || "video/mp4"
    };
  }

  if (post.document) {
    const filename = post.document.file_name || "";
    const mime = (post.document.mime_type || "").toLowerCase();
    const isVideoExt = /\.(mkv|mp4|avi|mov|webm|flv|wmv|ts|m4v|3gp|mpg|mpeg)$/i.test(filename);
    const isVideoMime = mime.startsWith("video/") || mime === "application/x-matroska" || mime === "application/octet-stream";
    if (isVideoExt || isVideoMime) {
      return {
        file_id: post.document.file_id,
        file_name: filename,
        file_size: post.document.file_size,
        mime_type: mime || "video/x-matroska"
      };
    }
  }

  if (post.animation) {
    return {
      file_id: post.animation.file_id,
      file_name: post.animation.file_name || "animation.mp4",
      file_size: post.animation.file_size,
      mime_type: post.animation.mime_type || "video/mp4"
    };
  }

  return null;
}

// Phase 3: Automated notification engine for users who requested a title
export async function notifyRequestingUsers(
  bot: Telegraf,
  movieTitle: string,
  mediaFileId: number,
  quality: string,
  year?: string,
  trailerUrl?: string
) {
  try {
    const cleanTitle = movieTitle.trim().toLowerCase();
    const res = await db.execute({
      sql: `SELECT * FROM requests WHERE status = 'pending' AND (
        LOWER(title) = ? OR 
        LOWER(title) LIKE ? OR 
        ? LIKE '%' || LOWER(title) || '%'
      )`,
      args: [cleanTitle, `%${cleanTitle}%`, cleanTitle]
    });

    const requests = res.rows as any[];
    if (!requests || requests.length === 0) return;

    console.log(`[Phase 3] Notifying ${requests.length} users for newly added title: ${movieTitle}`);

    const notifiedIds: number[] = [];
    for (const req of requests) {
      try {
        const notifButtons: any[] = [
          [Markup.button.callback(`▶️ Watch Now (${quality})`, `watch_${mediaFileId}`)]
        ];
        if (trailerUrl) {
          notifButtons.push([Markup.button.url("🎬 Watch Official Trailer", trailerUrl)]);
        }
        notifButtons.push([Markup.button.callback("📚 View Library", "browse_library")]);

        await bot.telegram.sendMessage(
          req.telegram_id,
          `🎉 <b>Great News! Your Requested Title is Ready!</b>\n\n🎬 <b>${escapeHtml(movieTitle)}</b> ${year ? `(${year})` : ""}\n🎞 <b>Quality:</b> ${quality}\n🍿 Added to BusiMovie! You can stream or download it now:`,
          {
            parse_mode: "HTML",
            ...Markup.inlineKeyboard(notifButtons)
          }
        );
        notifiedIds.push(req.id);
      } catch (sendErr: any) {
        console.warn(`Could not notify user ${req.telegram_id}:`, sendErr?.message);
        notifiedIds.push(req.id); // mark processed to prevent repeating
      }
    }

    if (notifiedIds.length > 0) {
      const placeholders = notifiedIds.map(() => "?").join(",");
      await db.execute({
        sql: `UPDATE requests SET status = 'fulfilled' WHERE id IN (${placeholders})`,
        args: notifiedIds
      });
    }
  } catch (err) {
    console.error("Error in notifyRequestingUsers:", err);
  }
}

// Core media indexing function for channels, groups, and DMs
async function handleMediaUpload(
  bot: Telegraf,
  mediaObj: {
    file_id: string;
    file_name?: string;
    file_size?: number;
    mime_type?: string;
  },
  caption: string,
  chat: { id: number | string; title?: string; type: string },
  messageId: number | string,
  replyCtx?: any
) {
  const filename = mediaObj.file_name || caption || "movie.mp4";
  const parsed = parseMediaDetails(mediaObj.file_name, caption);

  const channelId = chat.type === "channel" || chat.type === "supergroup" || chat.type === "group"
    ? chat.id.toString()
    : "";

  // Prevent duplicate index entries for same message in channel
  if (channelId && messageId) {
    const existing = await db.execute({
      sql: "SELECT id FROM media_files WHERE telegram_channel_id = ? AND telegram_message_id = ? LIMIT 1",
      args: [channelId, messageId.toString()]
    });
    if (existing.rows.length > 0) {
      console.log(`[Media Vault] Message ${messageId} in ${channelId} already indexed (ID: ${existing.rows[0].id}). Skipping.`);
      return Number(existing.rows[0].id);
    }
  }

  let posterUrl = "";
  try {
    const movieMeta = await searchMovies(parsed.title);
    if (movieMeta && movieMeta.length > 0 && movieMeta[0].poster_path) {
      posterUrl = movieMeta[0].poster_path;
    }
  } catch (e) {
    // ignore
  }

  // Auto-Trailer Extraction: Fetches YouTube or TMDB teaser trailer (zero TMDB API key required!)
  let trailerUrl = "";
  try {
    const trailer = await getOfficialTrailer(parsed.title, parsed.year);
    if (trailer?.url) {
      trailerUrl = trailer.url;
      console.log(`[Auto-Trailer] Extracted trailer for "${parsed.title}": ${trailerUrl} (${trailer.source})`);
    }
  } catch (tErr: any) {
    console.warn(`[Auto-Trailer] Trailer extraction warning:`, tErr?.message);
  }

  const insertId = await addMediaFile({
    movie_id: `tg_${Date.now()}`,
    movie_title: parsed.title,
    year: parsed.year,
    telegram_file_id: mediaObj.file_id,
    telegram_channel_id: channelId,
    telegram_message_id: messageId.toString(),
    file_name: filename,
    file_size: mediaObj.file_size || 0,
    quality: parsed.quality,
    language: "English",
    mime_type: mediaObj.mime_type || "video/mp4",
    season: parsed.season,
    episode: parsed.episode,
    poster_url: posterUrl,
    trailer_url: trailerUrl
  });

  // Log into channel_logs for real-time dashboard observability
  await logChannelEvent({
    channel_id: chat.id.toString(),
    channel_title: chat.title || (chat.type === "private" ? "Direct Upload" : "Telegram Group"),
    message_id: messageId.toString(),
    media_type: mediaObj.mime_type || "video",
    parsed_title: parsed.title + (parsed.season ? ` S${parsed.season}E${parsed.episode}` : ""),
    quality: parsed.quality,
    file_size: mediaObj.file_size || 0,
    status: "indexed",
    details: `Indexed from ${chat.type} (${chat.title || "Private"}). Trailer: ${trailerUrl ? "Attached" : "None"}. File: ${filename}`
  });

  console.log(`[Media Vault] Indexed new video: "${parsed.title}" (${parsed.quality}) from Chat ID ${chat.id} with trailer: ${trailerUrl || "None"}`);

  // Phase 3: Notify any users waiting on this title
  await notifyRequestingUsers(bot, parsed.title, insertId, parsed.quality, parsed.year, trailerUrl);

  // Send visual confirmation card if chat context supports replying
  if (replyCtx) {
    try {
      const epText = parsed.season ? ` • S${parsed.season}E${parsed.episode}` : "";
      const inlineButtons: any[] = [
        [Markup.button.callback("▶️ Test Playback", `watch_${insertId}`)]
      ];

      // Auto-Trailer Extraction: Attach "🎬 Watch Official Trailer" button directly to movie card!
      if (trailerUrl) {
        inlineButtons.push([
          Markup.button.url("🎬 Watch Official Trailer", trailerUrl)
        ]);
      }

      inlineButtons.push([
        [Markup.button.callback("📚 View Library", "browse_library")]
      ].flat());

      const confirmationCaption = `✅ <b>Added to BusiMovie Catalog!</b>\n\n🎬 <b>Title:</b> ${escapeHtml(parsed.title)}${epText}\n📅 <b>Year:</b> ${parsed.year || "N/A"}\n🎞 <b>Quality:</b> ${parsed.quality}\n💾 <b>Size:</b> ${formatFileSize(mediaObj.file_size || 0)}\n${trailerUrl ? `\n🍿 <b>Trailer:</b> Auto-extracted & attached below!` : ""}\n\n💡 Users searching for "<b>${escapeHtml(parsed.title)}</b>" can now stream or download it immediately!`;

      if (posterUrl && posterUrl.startsWith("http")) {
        try {
          await replyCtx.replyWithPhoto(posterUrl, {
            caption: confirmationCaption,
            parse_mode: "HTML",
            ...Markup.inlineKeyboard(inlineButtons)
          });
        } catch {
          await replyCtx.reply(confirmationCaption, {
            parse_mode: "HTML",
            ...Markup.inlineKeyboard(inlineButtons)
          });
        }
      } else {
        await replyCtx.reply(confirmationCaption, {
          parse_mode: "HTML",
          ...Markup.inlineKeyboard(inlineButtons)
        });
      }
    } catch (e: any) {
      console.log(`Note: Could not post reply in chat ${chat.id} (check bot permissions):`, e?.message);
    }
  }

  return insertId;
}

// Deliver media file helper (used by watch callback and start deep links)
async function deliverMediaFile(ctx: any, fileId: number) {
  let res = await db.execute({
    sql: "SELECT * FROM media_files WHERE id = ?",
    args: [fileId]
  });
  let file = res.rows[0];

  if (!file) {
    await ctx.reply(
      "❌ <b>Title Unavailable</b>\n\nThis title is currently being prepared for streaming. Please check back shortly or search for another title.",
      { parse_mode: "HTML" }
    );
    return;
  }

  const isSeries = Boolean(file.season || file.episode || file.is_series);
  const badge = isSeries ? "📺" : "🎬";
  const epText = (file.season && file.episode) ? `\n📺 <b>Episode:</b> Season ${file.season}, Episode ${file.episode}` : "";
  const caption = `${badge} <b>${escapeHtml(file.movie_title as string)}</b> ${file.year ? `(${file.year})` : ""}${epText}\n🎞 <b>Quality:</b> ${file.quality || "HD"}\n💾 <b>Size:</b> ${formatFileSize(Number(file.file_size || 0))}\n\n🍿 <i>Delivered by BusiMovie • Cinema Master</i>\n\n⏳ <b>Notice:</b> This file will self-destruct in 2 minutes for privacy.\n💡 <i>Forward to your Saved Messages now to keep it permanently!</i>`;

  let sentMessage: any;

  // 1. Primary delivery: Zero-bandwidth copyMessage from storage channel
  if (file.telegram_channel_id) {
    let chanId = String(file.telegram_channel_id).trim();
    if (/^\d+$/.test(chanId)) {
      chanId = `-100${chanId}`;
    }

    const msgIdToCopy = file.telegram_message_id ? Number(file.telegram_message_id) : 0;

    if (msgIdToCopy > 0) {
      try {
        sentMessage = await ctx.telegram.copyMessage(ctx.chat!.id, chanId, msgIdToCopy, {
          caption,
          parse_mode: "HTML"
        });
      } catch (copyErr: any) {
        console.warn(`copyMessage attempt failed for chat ${chanId} msg ${msgIdToCopy}:`, copyErr?.message);
      }
    }
  }

  // 2. Secondary delivery: Send by Telegram file_id (if valid bot file ID string, not numeric MTProto message ID)
  if (!sentMessage && file.telegram_file_id && !/^\d+$/.test(String(file.telegram_file_id))) {
    try {
      sentMessage = await ctx.replyWithVideo(file.telegram_file_id as string, {
        caption,
        parse_mode: "HTML",
        supports_streaming: true
      });
    } catch (vidErr) {
      try {
        sentMessage = await ctx.replyWithDocument(file.telegram_file_id as string, {
          caption,
          parse_mode: "HTML"
        });
      } catch (docErr: any) {
        console.warn("replyWithDocument failed:", docErr?.message);
      }
    }
  }

  if (sentMessage) {
    if (currentBotInstance && ctx.chat?.id && sentMessage.message_id) {
      registerEphemeralMessage(currentBotInstance, ctx.chat.id, sentMessage.message_id);
    }
    return;
  }

  // Delivery failed or message ID was absent: provide intelligent fallback button
  const failButtons: any[] = [];
  if (file.season && file.episode) {
    const showKey = getShowKey(String(file.movie_title));
    failButtons.push([
      Markup.button.callback(`⚡ Re-Acquire S0${file.season}E0${file.episode} from Quinson`, `qep_${showKey}_${file.season}_${file.episode}`)
    ]);
  } else {
    failButtons.push([Markup.button.callback("🔄 Try Delivery Again", `watch_${file.id}`)]);
  }
  failButtons.push([Markup.button.callback("🔎 Search Catalog", "search_prompt")]);

  await ctx.reply(
    `⚠️ <b>Delivery Interrupted</b>\n\n` +
    `We encountered a momentary delay preparing <b>${escapeHtml(file.movie_title as string)}</b>${epText}.\n\n` +
    `Tap below to re-initiate immediate relay delivery:`,
    {
      parse_mode: "HTML",
      ...Markup.inlineKeyboard(failButtons)
    }
  );
}

// Active bot instance reference for Phase 4 Channel Publishing & Web Streaming
let currentBotInstance: Telegraf | null = null;

export function getBotInstance(): Telegraf | null {
  return currentBotInstance;
}

export async function publishMovieToTelegramChannel(
  bot: Telegraf,
  channelId: string,
  movie: {
    title: string;
    year?: string;
    quality?: string;
    overview?: string;
    poster_path?: string;
    file_id?: number;
    trailer_url?: string;
    rating?: string;
    genres?: string[];
  }
) {
  const botInfo = bot.botInfo || (await bot.telegram.getMe());
  const botUsername = botInfo?.username || "EaziMovie_bot";
  const webAppUrl = process.env.APP_URL || "";

  // Extract trailer if not provided
  let trailerUrl = movie.trailer_url;
  if (!trailerUrl) {
    try {
      const trailer = await getOfficialTrailer(movie.title, movie.year);
      trailerUrl = trailer?.url;
    } catch {
      // ignore
    }
  }

  let caption = `🎬 <b>${escapeHtml(movie.title)}</b> ${movie.year ? `(${movie.year})` : ""}\n`;
  if (movie.rating) caption += `⭐ <b>Rating:</b> ${movie.rating} / 10\n`;
  if (movie.quality) caption += `🎞 <b>Quality:</b> ${movie.quality}\n`;
  if (movie.genres && movie.genres.length > 0) caption += `🏷 <b>Genres:</b> ${movie.genres.join(", ")}\n`;
  if (movie.overview) {
    const cleanOverview = movie.overview.length > 280 ? movie.overview.substring(0, 277) + "..." : movie.overview;
    caption += `\n📝 ${escapeHtml(cleanOverview)}\n`;
  }
  caption += `\n🍿 <i>Available now on BusiMovie!</i>`;

  const buttons: any[] = [];
  if (movie.file_id) {
    buttons.push([Markup.button.url("▶️ Stream / Download Now", `https://t.me/${botUsername}?start=watch_${movie.file_id}`)]);
  } else {
    buttons.push([Markup.button.url("▶️ Search in Bot", `https://t.me/${botUsername}?start=search`)]);
  }

  // Auto-Trailer: Attach official trailer button
  if (trailerUrl) {
    buttons.push([Markup.button.url("🎬 Watch Official Trailer", trailerUrl)]);
  }

  if (webAppUrl) {
    buttons.push([Markup.button.webApp("🌐 Open Web Player", webAppUrl)]);
  }

  const keyboard = Markup.inlineKeyboard(buttons);

  let sentMessage;
  if (movie.poster_path && movie.poster_path.startsWith("http")) {
    try {
      sentMessage = await bot.telegram.sendPhoto(channelId, movie.poster_path, {
        caption,
        parse_mode: "HTML",
        ...keyboard
      });
    } catch (e: any) {
      console.warn("sendPhoto to channel failed, sending message instead:", e?.message);
      sentMessage = await bot.telegram.sendMessage(channelId, caption, {
        parse_mode: "HTML",
        ...keyboard
      });
    }
  } else {
    sentMessage = await bot.telegram.sendMessage(channelId, caption, {
      parse_mode: "HTML",
      ...keyboard
    });
  }

  await logChannelEvent({
    channel_id: String(channelId),
    channel_title: "Channel Broadcast",
    message_id: String(sentMessage?.message_id || "0"),
    media_type: "broadcast",
    parsed_title: movie.title,
    quality: movie.quality || "HD",
    status: "published",
    details: `Published promotional showcase card to channel ${channelId}`
  });

  return sentMessage;
}

export async function broadcastAnnouncement(
  bot: Telegraf,
  messageText: string
): Promise<{ sent: number; failed: number; total: number }> {
  const users = await getAllUsers();
  let sent = 0;
  let failed = 0;

  for (const user of users) {
    try {
      await bot.telegram.sendMessage(
        user.telegram_id,
        `📢 <b>Announcement from BusiMovie</b>\n\n${escapeHtml(messageText)}`,
        {
          parse_mode: "HTML",
          ...Markup.inlineKeyboard([
            [Markup.button.callback("🎬 Open Library", "browse_library"), Markup.button.callback("🔎 Search", "search_prompt")]
          ])
        }
      );
      sent++;
      // Sleep slightly to prevent Telegram broadcast flood limit
      await new Promise((r) => setTimeout(r, 60));
    } catch (err: any) {
      failed++;
      console.warn(`Broadcast to ${user.telegram_id} failed:`, err?.message);
    }
  }

  return { sent, failed, total: users.length };
}

/**
 * Sends engaging follow-ups to users to bring them back to BusiMovie.
 * Highlights a featured movie, trending cinema news, or an interactive quiz/picker.
 */
export async function sendSmartReEngagementBroadcast(
  bot: Telegraf
): Promise<{ sent: number; total: number; title: string }> {
  const users = await getAllUsers();
  if (!users || users.length === 0) {
    return { sent: 0, total: 0, title: "" };
  }

  const randomFile = await getRandomMediaFile();
  if (!randomFile) {
    return { sent: 0, total: users.length, title: "" };
  }

  const movieTitle = String(randomFile.movie_title);
  let followUp: any;
  try {
    followUp = await generateMoviePostWatchFollowUp(movieTitle, randomFile.year ? String(randomFile.year) : undefined);
  } catch {
    followUp = {
      headline: `Tonight's BusiMovie Spotlight: ${movieTitle}! 🍿`,
      question: "Looking for something captivating to stream right now?",
      funFact: "Stream or save directly to Telegram without external storage limits."
    };
  }

  let sent = 0;
  for (const user of users) {
    try {
      await bot.telegram.sendMessage(
        user.telegram_id,
        `🍿 <b>Cinema Night Spotlight</b>\n\n` +
        `🎬 <b>${escapeHtml(movieTitle)}</b> ${randomFile.year ? `(${randomFile.year})` : ""}\n` +
        `🎞 <i>Quality:</i> ${randomFile.quality || "HD"} • 💾 <i>Size:</i> ${formatFileSize(randomFile.file_size || 0)}\n\n` +
        `✨ <b>${escapeHtml(followUp.headline)}</b>\n` +
        `❓ <i>${escapeHtml(followUp.question)}</i>\n\n` +
        `💡 <b>Did you know?</b> ${escapeHtml(followUp.funFact)}\n\n` +
        `Tap below to stream or fetch instantly! 👇`,
        {
          parse_mode: "HTML",
          ...Markup.inlineKeyboard([
            [Markup.button.callback(`▶️ Watch ${movieTitle.substring(0, 16)}`, `watch_${randomFile.id}`)],
            [
              Markup.button.callback("🎲 Surprise Me", "surprise_me"),
              Markup.button.callback("🍿 AI Recommendations", "ai_recs")
            ],
            [Markup.button.callback("📚 Browse Library", "browse_library")]
          ])
        }
      );
      sent++;
      await new Promise((r) => setTimeout(r, 60)); // Rate limit protection
    } catch (e: any) {
      // User may have blocked bot or deleted account
    }
  }

  return { sent, total: users.length, title: movieTitle };
}

export async function getFileStreamInfo(
  _bot: Telegraf,
  fileId: number
): Promise<{ fileName?: string; fileSize?: number; title: string; quality?: string }> {
  // NOTE: never return Telegram file URLs here: they embed the bot token. Deliver through the bot instead.
  const res = await db.execute({
    sql: "SELECT * FROM media_files WHERE id = ?",
    args: [fileId]
  });
  const file = res.rows[0] as any;
  if (!file) throw new Error("File not found");
  return {
    title: file.movie_title,
    fileName: file.file_name,
    fileSize: file.file_size,
    quality: file.quality
  };
}

export async function getBotWebhookInfo(bot: Telegraf) {
  try {
    return await bot.telegram.getWebhookInfo();
  } catch (err: any) {
    console.error("Error getting webhook info:", err?.message || err);
    return null;
  }
}

export async function setBotWebhook(bot: Telegraf, url: string) {
  try {
    const fullUrl = url.endsWith("/api/telegram-webhook") ? url : `${url.replace(/\/$/, "")}/api/telegram-webhook`;
    await bot.telegram.setWebhook(fullUrl, {
      secret_token: getWebhookSecret(),
      drop_pending_updates: true,
      allowed_updates: [
        "message",
        "edited_message",
        "channel_post",
        "edited_channel_post",
        "callback_query",
        "inline_query",
        "chat_member",
        "my_chat_member"
      ]
    });
    console.log(`[Telegram Webhook] Successfully set webhook to: ${fullUrl}`);
    return { success: true, url: fullUrl };
  } catch (err: any) {
    console.error("Error setting webhook:", err?.message || err);
    throw err;
  }
}

export async function deleteBotWebhook(bot: Telegraf) {
  try {
    await bot.telegram.deleteWebhook({ drop_pending_updates: true });
    console.log("[Telegram Webhook] Successfully deleted webhook. Returning to polling mode.");
    return { success: true };
  } catch (err: any) {
    console.error("Error deleting webhook:", err?.message || err);
    throw err;
  }
}

export function initializeBot(): Telegraf | null {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  
  if (!token) {
    console.warn("TELEGRAM_BOT_TOKEN is not set. Bot will not start.");
    return null;
  }

  const bot = new Telegraf(token);
  currentBotInstance = bot;

  // Persistent 2-minute Ephemeral Message Sweeper (Runs every 5s)
  setInterval(async () => {
    try {
      const due = await getDueEphemeralMessages();
      for (const item of due) {
        try {
          await bot.telegram.deleteMessage(item.chat_id, item.message_id);
        } catch (e: any) {}
        await deleteEphemeralMessageFromDb(item.chat_id, item.message_id);
      }
    } catch (err) {}
  }, 5000);

  // Universal 2-Minute Ephemeral Delivery Protection on Telegram Prototype (Intercepts all ctx.reply & bot methods)
  const origProtoCallApi = Telegram.prototype.callApi;
  Telegram.prototype.callApi = async function (method: string, payload: any) {
    const res: any = await origProtoCallApi.call(this, method, payload);

    const msgMethods = [
      "sendMessage",
      "sendPhoto",
      "sendVideo",
      "sendDocument",
      "sendAudio",
      "sendAnimation",
      "sendVoice",
      "sendSticker",
      "sendDice",
      "sendPoll",
      "copyMessage",
      "editMessageText",
      "editMessageCaption",
      "editMessageMedia"
    ];

    if (msgMethods.includes(method) && payload) {
      const chatId = payload.chat_id;
      let messageId: number | undefined;

      if (res && typeof res === "object" && res.message_id) {
        messageId = Number(res.message_id);
      } else if (res === true && payload.message_id) {
        messageId = Number(payload.message_id);
      }

      if (chatId && messageId && !String(chatId).startsWith("-")) {
        registerEphemeralMessage(bot, chatId, messageId);
      }
    }

    return res;
  };

  // Clean all traces when user blocks or leaves the chat
  bot.on("my_chat_member", async (ctx, next) => {
    if (ctx.chat?.type === "private") {
      const status = ctx.myChatMember?.new_chat_member?.status;
      if (status === "kicked" || status === "left") {
        clearChatEphemeralMessages(bot, ctx.chat.id);
      }
    }
    return next();
  });

  // Global Inbound Update Logger and Diagnostic Tracker
  bot.use(async (ctx, next) => {
    try {
      const chat = ctx.chat;
      const from = ctx.from;
      const msg = ctx.message || (ctx as any).channelPost;
      const text = (msg as any)?.text || (msg as any)?.caption || (ctx.callbackQuery as any)?.data || (ctx.inlineQuery as any)?.query || "";
      
      // Auto-register user incoming message in private chat for 2-minute auto-deletion
      if (chat && chat.type === "private" && (msg as any)?.message_id) {
        registerEphemeralMessage(bot, chat.id, (msg as any).message_id);
      }

      // Message Freshness / Anti-Replay Guard:
      const msgTimestamp = (msg as any)?.date;
      const isMediaUpload = Boolean(
        (msg as any)?.video || 
        (msg as any)?.document || 
        ctx.updateType === "channel_post" || 
        ctx.updateType === "edited_channel_post"
      );

      if (msgTimestamp && !isMediaUpload) {
        const ageInSeconds = (Date.now() / 1000) - msgTimestamp;
        if (ageInSeconds > 180) {
          console.log(`[Telegram Anti-Flood] Skipping stale update #${ctx.update.update_id} (${Math.round(ageInSeconds)}s old) to avoid reply replay storm.`);
          return;
        }
      }

      const logItem: TelegramUpdateLog = {
        id: String(ctx.update.update_id),
        time: new Date().toLocaleTimeString(),
        updateType: ctx.updateType,
        chatId: chat?.id ? String(chat.id) : undefined,
        chatType: chat?.type,
        chatTitle: (chat as any)?.title || (from ? `${from.first_name}${from.username ? ` (@${from.username})` : ""}` : undefined),
        fromName: from ? `${from.first_name} (@${from.username || "none"})` : undefined,
        text: text ? (text.length > 80 ? text.substring(0, 80) + "..." : text) : undefined,
        status: "received"
      };

      console.log(`[Telegram Inbound #${ctx.update.update_id}] Type=${ctx.updateType} Chat=${chat?.id} (${chat?.type}) Text="${text}"`);
      recentTelegramUpdates.unshift(logItem);
      if (recentTelegramUpdates.length > 30) recentTelegramUpdates.pop();
    } catch (e) {
      console.warn("Update logging error:", e);
    }
    return next();
  });

  // Helper to ensure user is in DB
  const ensureUser = async (ctx: any) => {
    if (!ctx.from) return;
    try {
      await db.execute({
        sql: "INSERT OR IGNORE INTO users (telegram_id, username, first_name) VALUES (?, ?, ?)",
        args: [ctx.from.id.toString(), ctx.from.username || "", ctx.from.first_name || ""]
      });
    } catch (err) {
      console.error("Error saving user:", err);
    }
  };

  // Bot start with deep-link support
  bot.start(async (ctx) => {
    await ensureUser(ctx);

    const payload = (ctx as any).startPayload;
    if (payload) {
      if (payload.startsWith("watch_")) {
        const fileId = parseInt(payload.replace("watch_", ""), 10);
        if (!isNaN(fileId)) {
          await deliverMediaFile(ctx, fileId);
          return;
        }
      } else if (payload.startsWith("req_")) {
        const reqMovieId = payload.replace("req_", "");
        const movieTitle = titleCache.get(reqMovieId) || reqMovieId;
        await db.execute({
          sql: "INSERT INTO requests (telegram_id, tmdb_id, title) VALUES (?, ?, ?)",
          args: [ctx.from.id.toString(), reqMovieId, movieTitle]
        });
        await ctx.reply(`✅ <b>Request Saved!</b>\n\n🎬 We have logged your request for <b>${escapeHtml(movieTitle)}</b>.\nYou will receive an instant notification here as soon as it is available on BusiMovie!`, { parse_mode: "HTML" });
        return;
      }
    }

    const welcomePhotoPath = path.resolve("./public/busimovie_welcome.jpg");
    const welcomeCaption = `🍿 <b>Welcome to BusiMovie!</b>\n\n` +
      `Your premier destination for blockbuster movies and full TV series.\n\n` +
      `🔍 <b>How to Watch:</b>\n` +
      `Simply type the title of any movie or show below with the correct spelling (e.g., <i>Inception</i>, <i>The Dark Knight</i>, or <i>Game of Thrones</i>).\n\n` +
      `Enjoy the show! 🎬`;

    const welcomeButtons = Markup.inlineKeyboard([
      [Markup.button.callback("🔎 Search Catalog", "search_prompt"), Markup.button.callback("🔥 Trending Now", "trending")],
      [Markup.button.callback("📺 Featured Series", "browse_series"), Markup.button.callback("🎲 Surprise Me", "surprise_me")]
    ]);

    if (fs.existsSync(welcomePhotoPath)) {
      try {
        await ctx.replyWithPhoto({ source: welcomePhotoPath }, {
          caption: welcomeCaption,
          parse_mode: "HTML",
          ...welcomeButtons
        });
        return;
      } catch (photoErr) {
        console.warn("Could not send welcome photo:", photoErr);
      }
    }

    await ctx.reply(welcomeCaption, {
      parse_mode: "HTML",
      ...welcomeButtons
    });
  });

  bot.command("library", async (ctx) => {
    await ensureUser(ctx);
    await showLibrary(ctx);
  });

  bot.action("browse_library", async (ctx) => {
    ctx.answerCbQuery();
    await showLibrary(ctx);
  });

  async function showLibrary(ctx: any) {
    const files = await getAllMediaFiles();
    if (files.length === 0) {
      await ctx.reply(
        "🎬 <b>BusiMovie Library</b>\n\nCatalog is currently refreshing with the latest cinema releases.\n\nType any title in chat to search our full catalog!",
        {
          parse_mode: "HTML",
          ...Markup.inlineKeyboard([
            [Markup.button.callback("🔎 Search Catalog", "search_prompt")]
          ])
        }
      );
      return;
    }

    let msg = `🎬 <b>BusiMovie Library</b>\n\nSelect any title below to download or stream instantly:\n\n`;
    const keyboardButtons: any[] = [];

    for (const file of files.slice(0, 8)) {
      const epText = (file.season && file.episode) ? ` [S${file.season}E${file.episode}]` : "";
      msg += `• 🎬 <b>${escapeHtml(file.movie_title)}</b> ${file.year ? `(${file.year})` : ""}${epText} - <code>${file.quality || "HD"}</code> (${formatFileSize(file.file_size || 0)})\n`;
      keyboardButtons.push([
        Markup.button.callback(`▶️ Watch ${file.movie_title}${epText} [${file.quality || "HD"}]`, `watch_${file.id}`)
      ]);
    }

    if (files.length > 8) {
      msg += `\n<i>Type any title in chat to search our full catalog!</i>`;
    }

    await ctx.reply(msg, {
      parse_mode: "HTML",
      ...Markup.inlineKeyboard(keyboardButtons)
    });
  }

  bot.action("browse_series", async (ctx) => {
    ctx.answerCbQuery();
    const series = await getVaultSeriesCatalog();
    if (series.length === 0) {
      return ctx.reply("📺 <b>Featured Series</b>\n\nSeries catalog is currently updating. Please search for any show title directly!", { parse_mode: "HTML" });
    }
    const buttons: any[] = [];
    for (const s of series.slice(0, 8)) {
      const showKey = getShowKey(s.movie_title);
      buttons.push([Markup.button.callback(`📺 ${s.movie_title} (${s.total_episodes} Episodes)`, `ser_${showKey}`)]);
    }
    await ctx.reply("📺 <b>Featured TV Series on BusiMovie</b>\n\nSelect a show below to browse seasons and episodes:", {
      parse_mode: "HTML",
      ...Markup.inlineKeyboard(buttons)
    });
  });

  // Explicit /request command
  bot.command("request", async (ctx) => {
    await ensureUser(ctx);
    const text = ctx.message.text.replace(/^\/request(@\w+)?/i, "").trim();
    if (!text) {
      return ctx.reply(
        "📝 <b>Request a Movie or TV Show:</b>\n\nUsage: <code>/request Movie Title</code>\nExample: <code>/request Interstellar</code>",
        { parse_mode: "HTML" }
      );
    }
    
    // Check 3 limit per day
    const res = await db.execute({
      sql: "SELECT COUNT(*) as count FROM requests WHERE telegram_id = ? AND date(created_at) = date('now')",
      args: [ctx.from.id.toString()]
    });
    const count = Number(res.rows[0].count || 0);
    if (count >= 3) {
      return ctx.reply("❌ <b>Daily Limit Reached</b>\n\nYou have already reached your limit of 3 movie requests for today.\nThe limit resets automatically at midnight (0:00 UTC).", { parse_mode: "HTML" });
    }

    await db.execute({
      sql: "INSERT INTO requests (telegram_id, tmdb_id, title) VALUES (?, ?, ?)",
      args: [ctx.from.id.toString(), `req_${Date.now()}`, text]
    });
    await ctx.reply(
      `✅ <b>Request Saved! (${count + 1}/3 today)</b>\n\n🎬 We have logged your request for <b>${escapeHtml(text)}</b>.\nYou will be automatically notified here the moment it is available on BusiMovie!`,
      { parse_mode: "HTML" }
    );
  });

  // Support /sync, /id, /status in ANY chat (Channel, Group, Supergroup, or Private DM)
  bot.command(["sync", "id", "status", "help", "channel"], async (ctx) => {
    await ensureUser(ctx);
    const chatType = ctx.chat?.type;
    const chatTitle = (ctx.chat as any)?.title || (ctx.from ? ctx.from.first_name : "Chat");
    const chatId = ctx.chat?.id;

    if ((chatType as string) === "channel" || chatType === "supergroup" || chatType === "group") {
      try {
        await ctx.telegram.sendMessage(
          chatId!,
          `✅ <b>BusiMovie Storage Connected!</b>\n\n` +
          `📡 <b>Chat ID:</b> <code>${chatId}</code>\n` +
          `📢 <b>Chat Name:</b> ${escapeHtml(chatTitle)}\n` +
          `🏷 <b>Chat Type:</b> ${chatType}\n` +
          `⚡ <b>Engine:</b> ACTIVE & Listening\n\n` +
          `🎬 Post or forward video files (.mp4, .mkv) here to auto-index into BusiMovie!`,
          { parse_mode: "HTML" }
        );

        await logChannelEvent({
          channel_id: String(chatId),
          channel_title: chatTitle,
          message_id: String(ctx.message?.message_id || 0),
          media_type: "command",
          parsed_title: `/sync confirmed from ${chatTitle}`,
          status: "active",
          details: `Responded to /sync in ${chatType}`
        });
      } catch (e: any) {
        console.error(`Failed to send /sync response in ${chatType}:`, e?.message);
      }
    } else {
      // In private chat with the user
      const botUser = ctx.botInfo?.username || "EaziMovie_bot";
      await ctx.reply(
        `📡 <b>BusiMovie Channel Sync</b>\n\n` +
        `To connect a private storage channel:\n\n` +
        `1️⃣ Open your private Telegram Channel (or Group).\n` +
        `2️⃣ Go to <b>Channel Settings ➔ Administrators ➔ Add Administrator</b>.\n` +
        `3️⃣ Search for <b>@${botUser}</b> and add it.\n` +
        `4️⃣ <b>Important:</b> Ensure the permission <b>"Post Messages"</b> is turned <b>ON</b>.\n` +
        `5️⃣ Send <code>/sync</code> in your channel to test, or post any movie video!`,
        { parse_mode: "HTML" }
      );
    }
  });

  bot.action("upload_help", (ctx) => {
    ctx.answerCbQuery();
    ctx.reply(
      "🎬 <b>About BusiMovie</b>\n\n" +
      "BusiMovie is your premier on-demand entertainment platform with instant streaming and direct delivery of movies and full series.",
      { parse_mode: "HTML" }
    );
  });

  bot.action("search_prompt", (ctx) => {
    ctx.answerCbQuery();
    ctx.reply("Please type the name of the movie or TV show you want to find:");
  });

  bot.action("trending", (ctx) => {
    ctx.answerCbQuery();
    ctx.reply("🔥 <b>Trending Now:</b>\nTry searching for <i>Dune</i>, <i>Inception</i>, <i>Interstellar</i>, or <i>Breaking Bad</i>!", { parse_mode: "HTML" });
  });

  // Phase 4: Random Movie Picker
  bot.command("random", async (ctx) => {
    await ensureUser(ctx);
    const file = await getRandomMediaFile();
    if (!file) {
      return ctx.reply("📚 No titles available in the catalog yet.");
    }
    const epText = (file.season && file.episode) ? ` [S${file.season}E${file.episode}]` : "";
    let trailerUrl = file.trailer_url;
    if (!trailerUrl) {
      try {
        const trailer = await getOfficialTrailer(file.movie_title, file.year);
        trailerUrl = trailer?.url;
      } catch {}
    }

    const randomButtons: any[] = [
      [Markup.button.callback("▶️ Watch Now", `watch_${file.id}`)]
    ];
    if (trailerUrl) {
      randomButtons.push([Markup.button.url("🎬 Watch Official Trailer", trailerUrl)]);
    }
    randomButtons.push([Markup.button.callback("🎲 Another Random", "random_pick")]);

    await ctx.reply(
      `🎲 <b>BusiMovie Feature Spotlight!</b>\n\n🎬 <b>${escapeHtml(file.movie_title)}</b> ${file.year ? `(${file.year})` : ""}${epText}\n🎞 <b>Quality:</b> ${file.quality || "HD"}\n💾 <b>Size:</b> ${formatFileSize(file.file_size || 0)}\n\nEnjoy your movie night! 🍿`,
      {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard(randomButtons)
      }
    );
  });

  bot.action("random_pick", async (ctx) => {
    ctx.answerCbQuery("🎲 Picking random movie...");
    const file = await getRandomMediaFile();
    if (!file) return ctx.reply("📚 No titles available in the catalog yet.");
    const epText = (file.season && file.episode) ? ` [S${file.season}E${file.episode}]` : "";

    let trailerUrl = file.trailer_url;
    if (!trailerUrl) {
      try {
        const trailer = await getOfficialTrailer(file.movie_title, file.year);
        trailerUrl = trailer?.url;
      } catch {}
    }

    const randomButtons: any[] = [
      [Markup.button.callback("▶️ Watch Now", `watch_${file.id}`)]
    ];
    if (trailerUrl) {
      randomButtons.push([Markup.button.url("🎬 Watch Official Trailer", trailerUrl)]);
    }
    randomButtons.push([Markup.button.callback("🎲 Another Random", "random_pick")]);

    await ctx.reply(
      `🎲 <b>BusiMovie Feature Spotlight!</b>\n\n🎬 <b>${escapeHtml(file.movie_title)}</b> ${file.year ? `(${file.year})` : ""}${epText}\n🎞 <b>Quality:</b> ${file.quality || "HD"}\n💾 <b>Size:</b> ${formatFileSize(file.file_size || 0)}`,
      {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard(randomButtons)
      }
    );
  });

  // Phase 4: AI Movie Concierge & Recommender (Gemini 3.8 Flash)
  bot.command(["ai", "recommend"], async (ctx) => {
    await ensureUser(ctx);
    const prompt = ctx.message.text.replace(/^\/(ai|recommend)(@\w+)?/i, "").trim();
    if (!prompt) {
      return ctx.reply(
        `🤖 <b>AI Movie Concierge</b>\n\nAsk for recommendations based on mood, genre, or vibe!\n\n<b>Usage:</b> <code>/ai &lt;your request&gt;</code>\n<b>Example:</b> <code>/ai fast paced sci-fi thriller like Interstellar</code>`,
        { parse_mode: "HTML" }
      );
    }

    const waitMsg = await ctx.reply("🧠 <i>Consulting Gemini AI cinema models...</i>", { parse_mode: "HTML" });
    const vaultTitles = await getAllVaultTitles();
    const result = await getAIMovieRecommendations(prompt, vaultTitles);

    const buttons: any[] = [];
    for (const title of result.suggestedTitles.slice(0, 3)) {
      const inVaultFiles = await getMediaFilesForMovie(title, title);
      if (inVaultFiles.length > 0) {
        buttons.push([Markup.button.callback(`▶️ Watch ${title}`, `watch_${inVaultFiles[0].id}`)]);
      }
    }

    buttons.push([Markup.button.callback("🎬 View Library", "browse_library")]);

    await ctx.telegram.editMessageText(
      ctx.chat.id,
      waitMsg.message_id,
      undefined,
      `✨ <b>AI Cinema Recommendations</b>\n\n${escapeHtml(result.recommendation)}\n\n💡 <i>${escapeHtml(result.explanation)}</i>`,
      {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard(buttons)
      }
    );
  });

  bot.action("ai_recs", async (ctx) => {
    ctx.answerCbQuery("🧠 Consulting AI...");
    const waitMsg = await ctx.reply("🧠 <i>Consulting Gemini AI cinema concierge...</i>", { parse_mode: "HTML" });
    const vaultTitles = await getAllVaultTitles();
    const result = await getAIMovieRecommendations("Recommend 3 must-watch trending movies or hidden gems from our catalog", vaultTitles);

    const buttons: any[] = [];
    for (const title of result.suggestedTitles.slice(0, 3)) {
      const inVaultFiles = await getMediaFilesForMovie(title, title);
      if (inVaultFiles.length > 0) {
        buttons.push([Markup.button.callback(`▶️ Watch ${title}`, `watch_${inVaultFiles[0].id}`)]);
      }
    }

    buttons.push([
      Markup.button.callback("🎲 Surprise Me", "random_pick"),
      Markup.button.callback("🎬 View Library", "browse_library")
    ]);

    await ctx.telegram.editMessageText(
      ctx.chat.id,
      waitMsg.message_id,
      undefined,
      `✨ <b>AI Cinema Recommendations</b>\n\n${escapeHtml(result.recommendation)}\n\n💡 <i>${escapeHtml(result.explanation)}</i>`,
      {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard(buttons)
      }
    ).catch(() => {});
  });

  bot.action("surprise_me", async (ctx) => {
    ctx.answerCbQuery("🎲 Picking random movie...");
    const file = await getRandomMediaFile();
    if (!file) return ctx.reply("📚 No titles available in the catalog yet.");
    const epText = (file.season && file.episode) ? ` [S${file.season}E${file.episode}]` : "";

    let trailerUrl = file.trailer_url;
    if (!trailerUrl) {
      try {
        const trailer = await getOfficialTrailer(file.movie_title, file.year);
        trailerUrl = trailer?.url;
      } catch {}
    }

    const randomButtons: any[] = [
      [Markup.button.callback("▶️ Watch Now", `watch_${file.id}`)]
    ];
    if (trailerUrl) {
      randomButtons.push([Markup.button.url("🎬 Watch Official Trailer", trailerUrl)]);
    }
    randomButtons.push([Markup.button.callback("🎲 Another Random", "random_pick")]);

    await ctx.reply(
      `🎲 <b>BusiMovie Feature Spotlight!</b>\n\n🎬 <b>${escapeHtml(file.movie_title)}</b> ${file.year ? `(${file.year})` : ""}${epText}\n🎞 <b>Quality:</b> ${file.quality || "HD"}\n💾 <b>Size:</b> ${formatFileSize(file.file_size || 0)}`,
      {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard(randomButtons)
      }
    );
  });

  // Phase 4: Telegram WebApp & Web Player launch command
  bot.command("webapp", async (ctx) => {
    await ensureUser(ctx);
    const appUrl = process.env.APP_URL || "";
    if (!appUrl) {
      return ctx.reply("🌐 Web App URL is not set in APP_URL environment variable.");
    }
    await ctx.reply(
      "📱 <b>BusiMovie Web App & Player</b>\n\nStream movies in full HD, browse collections, and manage downloads via the web interface:",
      {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([
          [Markup.button.webApp("🌐 Open BusiMovie Web Player", appUrl)]
        ])
      }
    );
  });

  bot.command(["subs", "sub", "subtitles", "subtitle"], async (ctx) => {
    await ensureUser(ctx);
    const query = ctx.message.text.replace(/^\/(subs?|subtitles?)(@\w+)?/i, "").trim();
    if (!query) {
      return ctx.reply(
        "📝 <b>Subtitle Finder</b>\n\n" +
        "Usage: <code>/subs &lt;Movie Title&gt;</code>\n" +
        "Example: <code>/subs The Bluff</code> or <code>/sub Inception</code>\n\n" +
        "💡 <i>Tip: Subtitle links are also automatically attached to every movie search result!</i>",
        { parse_mode: "HTML" }
      );
    }

    const searchStr = encodeURIComponent(query);
    const buttons = [
      [Markup.button.url("💬 Subdl (Instant .srt)", `https://subdl.com/subtitle/search?q=${searchStr}`)],
      [Markup.button.url("🌐 OpenSubtitles (All Languages)", `https://www.opensubtitles.org/en/search/sublanguageid-all/searchonlymovies-on/moviename-${searchStr}`)],
      [Markup.button.url("🎬 YIFY Subtitles", `https://yifysubtitles.ch/search?q=${searchStr}`)]
    ];

    const keyboard = Markup.inlineKeyboard(buttons);

    await ctx.reply(
      `📝 <b>Subtitle Results for:</b> <i>${escapeHtml(query)}</i>\n\n` +
      `Select a provider below to download the .srt file:`,
      {
        parse_mode: "HTML",
        ...keyboard
      }
    );
  });

  // Phase 4: Statistics & User Profile
  bot.command("stats", async (ctx) => {
    await ensureUser(ctx);
    const isOwner = isAdminTelegramId(ctx.from?.id);

    if (isOwner) {
      const files = await getAllMediaFiles();
      const users = await getAllUsers();
      const totalBytes = files.reduce((acc, f) => acc + (f.file_size || 0), 0);
      const userReqs = (await db.execute({
        sql: "SELECT COUNT(*) as c FROM requests WHERE telegram_id = ?",
        args: [ctx.from.id.toString()]
      })).rows[0] as any;

      await ctx.reply(
        `📊 <b>BusiMovie System Statistics (Admin)</b>\n\n` +
        `📁 <b>Catalog Titles:</b> ${files.length}\n` +
        `💾 <b>Storage:</b> ${formatFileSize(totalBytes)}\n` +
        `👥 <b>Registered Users:</b> ${users.length}\n` +
        `📝 <b>Pending Requests:</b> ${userReqs?.c || 0}\n` +
        `⚡ <b>Platform:</b> Cloud Run • SQLite • Telegraf`,
        { parse_mode: "HTML" }
      );
    } else {
      const userReqs = (await db.execute({
        sql: "SELECT COUNT(*) as c FROM requests WHERE telegram_id = ?",
        args: [ctx.from.id.toString()]
      })).rows[0] as any;

      await ctx.reply(
        `👤 <b>Your BusiMovie Profile</b>\n\n` +
        `✨ <b>Member:</b> ${escapeHtml(ctx.from?.first_name || "Cinema Member")}\n` +
        `📝 <b>Your Pending Requests:</b> ${userReqs?.c || 0}\n` +
        `🍿 <b>Stream Quality:</b> 1080p Full HD & 4K Ultra HD\n` +
        `⚡ <b>Status:</b> Active Member`,
        { parse_mode: "HTML" }
      );
    }
  });

  // Phase 4: Admin Broadcast Command
  bot.command("broadcast", async (ctx) => {
    await ensureUser(ctx);
    if (!isAdminTelegramId(ctx.from?.id)) {
      // Silent for non-admins: don't reveal that the command exists
      return;
    }
    const msg = ctx.message.text.replace(/^\/broadcast(@\w+)?/i, "").trim();
    if (!msg) {
      return ctx.reply("📢 <b>Broadcast Announcement</b>\n\nUsage: <code>/broadcast Your message here</code>", { parse_mode: "HTML" });
    }
    const result = await broadcastAnnouncement(bot, msg);
    await ctx.reply(`✅ <b>Broadcast Completed!</b>\n\nDelivered to ${result.sent} of ${result.total} users. (${result.failed} failed/blocked).`, { parse_mode: "HTML" });
  });

  // Watch callback
  bot.action(/^watch_(\d+)$/, async (ctx) => {
    await ensureUser(ctx);
    const fileId = parseInt(ctx.match[1], 10);
    await ctx.answerCbQuery("🚀 Preparing media file...");
    try {
      await deliverMediaFile(ctx, fileId);
    } catch (err: any) {
      console.error("Error delivering media file:", err);
      await ctx.reply("❌ Error delivering media file: " + (err?.message || "Unknown error"));
    }
  });

// Release label beautifier: strips ugly channel tags, bot names, brackets into cinema-grade badges
function cleanReleaseButtonLabel(rawText: string): string {
  const sizeMatch = rawText.match(/\[?([\d\.]+\s*(?:GB|MB))\]?/i);
  const sizeStr = sizeMatch ? sizeMatch[1].toUpperCase().replace(/\s+/, " ") : "";

  const resMatch = rawText.match(/\b(2160p|4K|1080p|720p|480p)\b/i);
  let resStr = resMatch ? resMatch[1].toLowerCase() : "";
  if (resStr === "4k" || resStr === "2160p") resStr = "4K UHD";
  else if (resStr === "1080p") resStr = "1080p Full HD";
  else if (resStr === "720p") resStr = "720p HD";
  else if (resStr === "480p") resStr = "480p Standard";
  else resStr = "HD Master";

  const sourceMatch = rawText.match(/\b(BluRay|BRRip|WEB-DL|WEBRip|x265|HEVC|10Bit)\b/i);
  const sourceStr = sourceMatch ? ` • ${sourceMatch[1]}` : "";

  if (sizeStr) {
    return `💿 ${resStr}${sourceStr} (${sizeStr})`;
  }
  return `💿 ${resStr}${sourceStr}`;
}

  // Helper for autonomous crawler request and quality selection
  async function triggerAutonomousCrawlerFlow(ctx: any, targetTitle: string, tmdbId?: string) {
    if (!ctx.from) return;
    const userId = ctx.from.id.toString();
    const cleanTitle = targetTitle.trim();

    // Check daily limit (5 requests per day)
    const resCount = await db.execute({
      sql: "SELECT COUNT(*) as count FROM requests WHERE telegram_id = ? AND date(created_at) = date('now')",
      args: [userId]
    });
    const count = Number(resCount.rows[0]?.count || 0);
    if (count >= 5) {
      await ctx.answerCbQuery("❌ Daily Limit Reached (5 requests). Try again tomorrow!", { show_alert: true });
      return;
    }

    // Insert request record
    const insRes = await db.execute({
      sql: "INSERT INTO requests (telegram_id, tmdb_id, title, status) VALUES (?, ?, ?, 'searching')",
      args: [userId, tmdbId || "", cleanTitle]
    });
    const reqId = Number(insRes.lastInsertRowid || 0);

    await ctx.answerCbQuery("⚡ Connecting to BusiMovie Cinema Intelligence...");
    const statusMsg = await ctx.reply(
      `🧠 <b>BusiMovie Cinema Intelligence</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `🔍 <b>Step 1/4: Analyzing Cinema Network & Relays...</b>\n` +
      `• Scanning high-speed distribution nodes for <b>${escapeHtml(cleanTitle)}</b>\n` +
      `• Checking video bitrates and verified sources...\n\n` +
      `<i>Please hold on while we locate the master release.</i>`,
      { parse_mode: "HTML" }
    );

    // Check if query is a TV series via keyword, local vault catalog, or canonical metadata
    let isSeriesQuery = /\b(s\d{1,2}|season|series|episode|ep\s*\d+)\b/i.test(cleanTitle);
    if (!isSeriesQuery) {
      const vSeries = await getVaultSeriesCatalog(cleanTitle);
      if (vSeries.length > 0) {
        isSeriesQuery = true;
      }
    }
    if (!isSeriesQuery) {
      try {
        const meta = await searchMovies(cleanTitle);
        if (meta && meta.length > 0) {
          const normQuery = cleanTitle.toLowerCase().replace(/[^a-z0-9]/g, '');
          const exactTvMatch = meta.find(m => isTvSeriesEntity(m) && m.title.toLowerCase().replace(/[^a-z0-9]/g, '') === normQuery);
          if (exactTvMatch || isTvSeriesEntity(meta[0])) {
            isSeriesQuery = true;
          }
        }
      } catch {}
    }

    if (isSeriesQuery) {
      try {
        await new Promise(r => setTimeout(r, 600));
        await ctx.telegram.editMessageText(
          ctx.chat.id,
          statusMsg.message_id,
          undefined,
          `🧠 <b>BusiMovie Cinema Intelligence</b>\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
          `📺 <b>Step 2/4: Querying Series Master Relay (@quinsonnbot)...</b>\n` +
          `• Ingesting TV series episodes for <b>${escapeHtml(cleanTitle)}</b>\n` +
          `• Storing into dedicated BusiMovie TV Series Channel (-1003983385552)...\n\n` +
          `<i>Locating verified season releases...</i>`,
          { parse_mode: "HTML" }
        ).catch(() => {});

        const quinsonRes = await fetchSeriesFromQuinson({ seriesTitle: cleanTitle });
        if (quinsonRes.success && quinsonRes.firstMediaFileId) {
          await markRequestsFulfilled([reqId]);
          await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id).catch(() => {});
          await deliverMediaFile(ctx, quinsonRes.firstMediaFileId);
          return;
        }
      } catch (seriesErr: any) {
        console.warn("[CrawlerFlow] Quinson series query failed:", seriesErr?.message);
      }

      // Strict boundary: Do NOT leak TV series into movie search bots!
      await db.execute({
        sql: "UPDATE requests SET status = 'pending' WHERE id = ?",
        args: [reqId]
      });

      await ctx.telegram.editMessageText(
        ctx.chat.id,
        statusMsg.message_id,
        undefined,
        `📺 <b>Series In Acquisition Queue</b>\n\n` +
        `We scanned our series relays for <b>${escapeHtml(cleanTitle)}</b>, but the master release is currently synchronizing.\n\n` +
        `✅ <b>Request Queued:</b> Our cinema distribution nodes are tracking this series. You will be notified the instant an episode is indexed!`,
        {
          parse_mode: "HTML",
          ...Markup.inlineKeyboard([
            [Markup.button.callback("🔄 Re-query Series Relay", `req_q_${getQueryKey(cleanTitle)}`)],
            [Markup.button.callback("🍿 Browse Catalog", "browse_library")]
          ])
        }
      );
      return;
    }

    try {
      const bots = await getSearchBots();
      const activeBots = bots
        .filter(b => b.status === 'active' && !b.bot_username.toLowerCase().includes("quinson"))
        .sort((a, b) => (a.priority || 1) - (b.priority || 1));

      const botList = activeBots.length > 0 ? activeBots : [
        { bot_username: "@Apple_moviebot", priority: 1 },
        { bot_username: "@iPapkornDeltaBot", priority: 2 },
        { bot_username: "@iPapkornEzPzBot", priority: 3 }
      ];

      let foundResult: any = null;
      let usedBotName = "";

      for (const bot of botList) {
        usedBotName = bot.bot_username;
        await ctx.telegram.editMessageText(
          ctx.chat.id,
          statusMsg.message_id,
          undefined,
          `🧠 <b>BusiMovie Cinema Intelligence</b>\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
          `⚡ <b>Step 2/4: Locating High-Definition Release...</b>\n` +
          `• Connecting to cinema distribution relay (${escapeHtml(usedBotName)})\n` +
          `• Scanning master nodes for <b>${escapeHtml(cleanTitle)}</b>...\n\n` +
          `<i>Verifying video container and bitrates...</i>`,
          { parse_mode: "HTML" }
        ).catch(() => {});

        try {
          const searchRes = await testQuerySearchBot(usedBotName, cleanTitle);
          if (searchRes.found && (searchRes.messageId || searchRes.hasDirectMedia)) {
            foundResult = searchRes;
            break; // Stop at first successful bot!
          }
        } catch (botErr: any) {
          console.warn(`[CrawlerFlow] Bot ${usedBotName} search attempt failed:`, botErr?.message);
        }
        // Small pacing between fallback bot attempts
        await new Promise(r => setTimeout(r, 1200));
      }

      if (!foundResult) {
        await db.execute({
          sql: "UPDATE requests SET status = 'pending' WHERE id = ?",
          args: [reqId]
        });

        await ctx.telegram.editMessageText(
          ctx.chat.id,
          statusMsg.message_id,
          undefined,
          `🎬 <b>Title Currently Unavailable</b>\n\n` +
          `We searched our cinema distribution relays, but couldn't locate an active release for <b>${escapeHtml(cleanTitle)}</b> right now.\n\n` +
          `✅ <b>Request Logged:</b> Your request has been queued in our priority acquisition line. We will notify you directly the moment it becomes available on BusiMovie.`,
          {
            parse_mode: "HTML",
            ...Markup.inlineKeyboard([
              [Markup.button.callback("🍿 Browse Catalog", "browse_library")],
              [Markup.button.callback("🔎 Search Another Title", "search_prompt")]
            ])
          }
        );
        return;
      }

      // If search bot returned download/quality options (e.g. 1080p, 720p, 480p, 4K)
      const downloadBtns = (foundResult.buttons || []).filter((b: any) => 
        !isBackOrNavButton(b.text) && (b.isDownload || b.text.match(/\b(1080p|720p|480p|4K|2160p|GB|MB|Download|Get)\b/i))
      );

      if (downloadBtns.length > 1 && foundResult.messageId) {
        const respKey = saveBotResponse({
          botUsername: usedBotName,
          messageId: foundResult.messageId,
          buttons: foundResult.buttons || [],
          query: cleanTitle
        });

        const keyboardRows: any[] = [];
        for (const btn of downloadBtns.slice(0, 6)) {
          const polishedLabel = cleanReleaseButtonLabel(btn.text);
          keyboardRows.push([
            Markup.button.callback(polishedLabel, `botfwd_${respKey}_${btn.row}_${btn.col}_${reqId}`)
          ]);
        }
        keyboardRows.push([Markup.button.callback("❌ Cancel", "noop")]);

        await ctx.telegram.editMessageText(
          ctx.chat.id,
          statusMsg.message_id,
          undefined,
          `🎬 <b>Verified Releases Available!</b>\n\n` +
          `High-definition stream nodes found for <b>${escapeHtml(cleanTitle)}</b>.\n` +
          `Select your preferred edition for immediate delivery:`,
          {
            parse_mode: "HTML",
            ...Markup.inlineKeyboard(keyboardRows)
          }
        );
        return;
      }

      // If single release or direct media
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        statusMsg.message_id,
        undefined,
        `🧠 <b>BusiMovie Cinema Intelligence</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `📥 <b>Step 3/4: Acquiring Master Stream...</b>\n` +
        `• Ingesting 1080p release for <b>${escapeHtml(cleanTitle)}</b>\n` +
        `• Preparing direct cinema delivery to your chat...\n\n` +
        `<i>Your file is arriving shortly!</i>`,
        { parse_mode: "HTML" }
      ).catch(() => {});

      try {
        const bestBtn = selectBestMatchingButton(foundResult.buttons, cleanTitle);
        const fwdRes = await fetchAndForwardBotMedia({
          botUsername: usedBotName,
          messageId: foundResult.messageId || 0,
          buttonRow: bestBtn?.row,
          buttonCol: bestBtn?.col,
          userTelegramId: ctx.from.id
        });

        await markRequestsFulfilled([reqId]);

        if (fwdRes.mediaFileId) {
          await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id).catch(() => {});
          await deliverMediaFile(ctx, fwdRes.mediaFileId);
        } else {
          await ctx.telegram.editMessageText(
            ctx.chat.id,
            statusMsg.message_id,
            undefined,
            `🎬 <b>Ready to Watch!</b>\n\n<b>${escapeHtml(fwdRes.fileName || cleanTitle)}</b> has arrived and is ready for playback:`,
            {
              parse_mode: "HTML",
              ...Markup.inlineKeyboard([
                [Markup.button.callback("▶️ Watch Now", "browse_library")]
              ])
            }
          );
        }
      } catch (fwdErr: any) {
        console.warn("Peer media fetch delay/error:", fwdErr?.message);
        await ctx.telegram.editMessageText(
          ctx.chat.id,
          statusMsg.message_id,
          undefined,
          `🎬 <b>Acquisition Processing</b>\n\n` +
          `We encountered a temporary network delay retrieving <b>${escapeHtml(cleanTitle)}</b>.\n\n` +
          `Your request is queued. We will notify you directly as soon as delivery completes!`,
          {
            parse_mode: "HTML",
            ...Markup.inlineKeyboard([
              [Markup.button.callback("🔄 Re-try Acquisition", `req_q_${getQueryKey(cleanTitle)}`)],
              [Markup.button.callback("🍿 Browse Catalog", "browse_library")]
            ])
          }
        );
      }
    } catch (err: any) {
      console.error("Autonomous request error:", err);
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        statusMsg.message_id,
        undefined,
        `🎬 <b>Title Currently Unavailable</b>\n\n` +
        `We searched our distribution channels, but couldn't locate a verified high-quality release for <b>${escapeHtml(cleanTitle)}</b> right now.\n\n` +
        `✅ <b>Request Logged:</b> Your request has been queued in our acquisition line. We will notify you directly the moment it becomes available on BusiMovie.`,
        {
          parse_mode: "HTML",
          ...Markup.inlineKeyboard([
            [Markup.button.callback("🍿 Browse Catalog", "browse_library")]
          ])
        }
      ).catch(() => {});
    }
  }

  // Handle movie requests from inline buttons (TMDb / catalog IDs)
  bot.action(/^request_(.+)$/, async (ctx) => {
    await ensureUser(ctx);
    const movieId = ctx.match[1];
    const movieTitle = titleCache.get(movieId) || `Movie ${movieId}`;
    await triggerAutonomousCrawlerFlow(ctx, movieTitle, movieId);
  });

  // Handle manual title requests ("Can't find it? Request a title")
  bot.action(/^req_q_(.+)$/, async (ctx) => {
    await ensureUser(ctx);
    const qKey = ctx.match[1];
    const query = await resolveQuery(qKey);
    await triggerAutonomousCrawlerFlow(ctx, query);
  });

  // Handle quality button choice from search bot results
  bot.action(/^botfwd_(.+)_(\d+)_(\d+)_(\d+)$/, async (ctx) => {
    await ensureUser(ctx);
    const respKey = ctx.match[1];
    const row = parseInt(ctx.match[2], 10);
    const col = parseInt(ctx.match[3], 10);
    const reqId = parseInt(ctx.match[4], 10);

    const cached = botRespCache.get(respKey);
    if (!cached) {
      return ctx.answerCbQuery("⚠️ Selection expired. Please search again.");
    }

    await ctx.answerCbQuery("⚡ Preparing high-speed file delivery...");
    await ctx.editMessageText(
      `🧠 <b>BusiMovie Cinema Intelligence</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `📥 <b>Step 3/4: Ingesting & Buffering Video...</b>\n` +
      `• Transferring high-definition release for <b>${escapeHtml(cached.query)}</b>\n` +
      `• Initializing high-speed direct stream buffer...\n\n` +
      `<i>Please hold on, stream arriving in moments!</i>`,
      { parse_mode: "HTML" }
    );

    try {
      const fwdRes = await fetchAndForwardBotMedia({
        botUsername: cached.botUsername,
        messageId: cached.messageId,
        buttonRow: row,
        buttonCol: col,
        userTelegramId: ctx.from.id
      });

      await markRequestsFulfilled([reqId]);

      if (fwdRes.mediaFileId) {
        await ctx.deleteMessage().catch(() => {});
        await deliverMediaFile(ctx, fwdRes.mediaFileId);
      } else {
        await ctx.editMessageText(
          `🎬 <b>Ready to Watch!</b>\n\n<b>${escapeHtml(fwdRes.fileName || cached.query)}</b> (${fwdRes.fileSizeBytes ? formatFileSize(fwdRes.fileSizeBytes) : "HD"})\n\nTap below to start streaming:`,
          {
            parse_mode: "HTML",
            ...Markup.inlineKeyboard([
              [Markup.button.callback("▶️ Watch Now", "browse_library")]
            ])
          }
        );
      }
    } catch (err: any) {
      console.error("Error in botfwd callback:", err);
      await ctx.editMessageText(
        `🎬 <b>Acquisition Processing</b>\n\n` +
        `We encountered a temporary network delay retrieving <b>${escapeHtml(cached.query)}</b>.\n\n` +
        `Your request is queued. We will notify you directly as soon as delivery completes!`,
        {
          parse_mode: "HTML",
          ...Markup.inlineKeyboard([
            [Markup.button.callback("🔄 Re-try Acquisition", `botfwd_${respKey}_${row}_${col}_${reqId}`)],
            [Markup.button.callback("🍿 Browse Catalog", "browse_library")]
          ])
        }
      );
    }
  });

  // Level 2: Series Season Selector (Direct Quinson UX with Merged Catalog)
  bot.action(/^ser_(.+)$/, async (ctx) => {
    await ensureUser(ctx);
    const showKey = ctx.match[1];
    const seriesTitle = await resolveShowTitle(showKey);

    const dbSeasons = await getSeriesSeasons(seriesTitle);

    // Merge SQLite seasons with cached/live Quinson seasons so we NEVER lose any seasons
    const cacheKey = `seasons_${seriesTitle.toLowerCase()}`;
    const cachedSeasons = seriesSeasonsCache.get(cacheKey);
    let qSeasons: number[] = [];

    if (cachedSeasons && Date.now() - cachedSeasons.timestamp < 30 * 60 * 1000) {
      qSeasons = cachedSeasons.seasons;
    } else {
      try {
        qSeasons = await getQuinsonSeriesSeasons(seriesTitle);
        if (qSeasons.length > 0) {
          seriesSeasonsCache.set(cacheKey, { seasons: qSeasons, timestamp: Date.now() });
        }
      } catch (e: any) {
        console.warn("Quinson season check warning:", e?.message);
      }
    }

    const merged = Array.from(new Set([...dbSeasons, ...qSeasons])).sort((a, b) => a - b);
    let seasons = merged.length > 0 ? merged : (dbSeasons.length > 0 ? dbSeasons : [1]);

    if (seasons.length === 0) {
      await ctx.answerCbQuery();
      const qKey = getQueryKey(seriesTitle);
      const text = `You selected the series <b>${escapeHtml(seriesTitle)}</b>.\n\n⚠️ <i>This series is currently being acquired for BusiMovie.</i>\n\nWould you like to request this title?`;
      const kb = Markup.inlineKeyboard([
        [Markup.button.callback("📥 Request Series on BusiMovie", `req_q_${qKey}`)],
        [Markup.button.callback("◀️ Back to Search Results", "back_search")]
      ]);

      try {
        if ((ctx.callbackQuery?.message as any)?.photo) {
          await ctx.editMessageCaption(text, { parse_mode: "HTML", ...kb });
        } else {
          await ctx.editMessageText(text, { parse_mode: "HTML", ...kb });
        }
      } catch {
        await ctx.reply(text, { parse_mode: "HTML", ...kb });
      }
      return;
    }

    await ctx.answerCbQuery();

    // Build 2-column season button grid (Quinson style)
    const seasonButtons: any[] = [];
    let currentRow: any[] = [];

    for (const s of seasons) {
      currentRow.push(Markup.button.callback(`🗓️ Season ${s}`, `eps_${showKey}_${s}_1`));
      if (currentRow.length === 2) {
        seasonButtons.push(currentRow);
        currentRow = [];
      }
    }
    if (currentRow.length > 0) {
      seasonButtons.push(currentRow);
    }

    seasonButtons.push([Markup.button.callback("◀️ Back to Search Results", "back_search")]);

    const text = `📺 <b>${escapeHtml(seriesTitle)}</b>\nPlease choose a season:`;
    try {
      if ((ctx.callbackQuery?.message as any)?.photo) {
        await ctx.editMessageCaption(text, { parse_mode: "HTML", ...Markup.inlineKeyboard(seasonButtons) });
      } else {
        await ctx.editMessageText(text, { parse_mode: "HTML", ...Markup.inlineKeyboard(seasonButtons) });
      }
    } catch {
      await ctx.reply(text, { parse_mode: "HTML", ...Markup.inlineKeyboard(seasonButtons) });
    }
  });

  // Level 3: Episode Browser with True Hybrid Availability
  bot.action(/^eps_(.+)_(\d+)_(\d+)$/, async (ctx) => {
    await ensureUser(ctx);
    const showKey = ctx.match[1];
    const seasonNum = parseInt(ctx.match[2], 10);
    const page = parseInt(ctx.match[3], 10) || 1;

    const seriesTitle = await resolveShowTitle(showKey);
    const dbEpisodes = await getSeriesSeasonEpisodes(seriesTitle, seasonNum);
    const dbEpMap = new Map<number, MediaFileRecord>();
    for (const ep of dbEpisodes) {
      if (ep.episode) dbEpMap.set(ep.episode, ep);
    }

    // Inspect Quinson with 30-min cache so all unarchived episodes remain visible and selectable
    const epCacheKey = `eps_${seriesTitle.toLowerCase()}_s${seasonNum}`;
    const cachedEps = seriesEpisodesCache.get(epCacheKey);
    let quinsonEpisodes: Array<{ episodeNum: number; label: string }> = [];

    if (cachedEps && Date.now() - cachedEps.timestamp < 30 * 60 * 1000) {
      quinsonEpisodes = cachedEps.episodes;
    } else {
      try {
        quinsonEpisodes = await getQuinsonSeasonEpisodes(seriesTitle, seasonNum);
        if (quinsonEpisodes.length > 0) {
          seriesEpisodesCache.set(epCacheKey, { episodes: quinsonEpisodes, timestamp: Date.now() });
        }
      } catch (e: any) {
        console.warn("Quinson episode fetch warning:", e?.message);
      }
    }

    // Collate complete list of all episode numbers
    const allEpNums = new Set<number>();
    for (const ep of dbEpisodes) {
      if (ep.episode) allEpNums.add(ep.episode);
    }
    for (const qep of quinsonEpisodes) {
      allEpNums.add(qep.episodeNum);
    }

    // Fallback minimum 8 episodes if both empty
    if (allEpNums.size === 0) {
      for (let i = 1; i <= 8; i++) allEpNums.add(i);
    }

    await ctx.answerCbQuery();

    const sortedEpNums = Array.from(allEpNums).sort((a, b) => a - b);
    const pageSize = 8;
    const totalPages = Math.ceil(sortedEpNums.length / pageSize) || 1;
    const currentPage = Math.max(1, Math.min(page, totalPages));
    const pageEpNums = sortedEpNums.slice((currentPage - 1) * pageSize, currentPage * pageSize);

    const episodeButtons: any[] = [];

    for (const epNum of pageEpNums) {
      const readyFile = dbEpMap.get(epNum);
      const epLabel = epNum < 10 ? `E0${epNum}` : `E${epNum}`;
      const isRealReady = readyFile && readyFile.telegram_message_id && Number(readyFile.telegram_message_id) > 0;

      if (isRealReady) {
        const qText = readyFile.quality || "HD";
        const sizeText = formatFileSize(Number(readyFile.file_size || 0));
        episodeButtons.push([
          Markup.button.callback(`✅ ${epLabel} • Ready (${qText}) • ${sizeText}`, `watch_${readyFile.id}`)
        ]);
      } else {
        const qInfo = quinsonEpisodes.find(q => q.episodeNum === epNum);
        const namePart = qInfo?.label ? qInfo.label.replace(/^E\d+\s*[-:.]?\s*/i, "") : "720p";
        episodeButtons.push([
          Markup.button.callback(`⚡ ${epLabel} • Get Episode (${namePart || "720p"})`, `qep_${showKey}_${seasonNum}_${epNum}`)
        ]);
      }
    }

    // Batch Ingest Season button
    episodeButtons.push([
      Markup.button.callback(`📦 Ingest Full Season ${seasonNum} (All Episodes)`, `qall_${showKey}_${seasonNum}`)
    ]);

    // Pagination row
    const navRow: any[] = [];
    if (currentPage > 1) {
      navRow.push(Markup.button.callback("⏪ Prev", `eps_${showKey}_${seasonNum}_${currentPage - 1}`));
    }
    navRow.push(Markup.button.callback(`EPs ${currentPage}/${totalPages}`, "noop"));
    if (currentPage < totalPages) {
      navRow.push(Markup.button.callback("Next ⏩", `eps_${showKey}_${seasonNum}_${currentPage + 1}`));
    }

    if (totalPages > 1) {
      episodeButtons.push(navRow);
    }

    episodeButtons.push([
      Markup.button.callback("◀️ Back to Seasons", `ser_${showKey}`)
    ]);

    const caption = `📺 <b>${escapeHtml(seriesTitle)} - Season ${seasonNum}</b>\nChoose an episode:`;

    try {
      if ((ctx.callbackQuery?.message as any)?.photo) {
        await ctx.editMessageCaption(caption, { parse_mode: "HTML", ...Markup.inlineKeyboard(episodeButtons) });
      } else {
        await ctx.editMessageText(caption, { parse_mode: "HTML", ...Markup.inlineKeyboard(episodeButtons) });
      }
    } catch {
      await ctx.reply(caption, { parse_mode: "HTML", ...Markup.inlineKeyboard(episodeButtons) });
    }
  });

  // On-Demand Quinson Episode Ingest & Delivery Handler
  bot.action(/^qep_(.+)_(\d+)_(\d+)$/, async (ctx) => {
    await ensureUser(ctx);
    const showKey = ctx.match[1];
    const seasonNum = parseInt(ctx.match[2], 10);
    const epNum = parseInt(ctx.match[3], 10);

    const seriesTitle = await resolveShowTitle(showKey);

    await ctx.answerCbQuery("⚡ Preparing high-speed episode delivery...");
    await ctx.editMessageText(
      `🧠 <b>BusiMovie Cinema Intelligence</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `📥 <b>Acquiring Season ${seasonNum} Episode ${epNum}...</b>\n` +
      `• Series: <b>${escapeHtml(seriesTitle)}</b>\n` +
      `• Ingesting master stream from Quinson Relay...\n` +
      `• Storing into TV Series Channel (-1003983385552)...\n\n` +
      `<i>Please hold on, your episode is arriving shortly!</i>`,
      { parse_mode: "HTML" }
    );

    try {
      const quinsonRes = await fetchSeriesFromQuinson({
        seriesTitle,
        seasonNum,
        episodeNum: epNum
      });

      if (quinsonRes.success && quinsonRes.firstMediaFileId) {
        await ctx.deleteMessage().catch(() => {});
        await deliverMediaFile(ctx, quinsonRes.firstMediaFileId);
      } else {
        await ctx.editMessageText(
          `📺 <b>Acquisition Notice</b>\n\n` +
          `Episode <b>S${seasonNum}E${epNum}</b> for <b>${escapeHtml(seriesTitle)}</b> is being processed on relay nodes.\n\n` +
          `We will notify you directly the moment it becomes available!`,
          {
            parse_mode: "HTML",
            ...Markup.inlineKeyboard([
              [Markup.button.callback("◀️ Back to Episodes", `eps_${showKey}_${seasonNum}_1`)],
              [Markup.button.callback("🍿 Browse Catalog", "browse_library")]
            ])
          }
        );
      }
    } catch (err: any) {
      console.error("Error in qep callback:", err);
      await ctx.editMessageText(
        `📺 <b>Acquisition Delay</b>\n\n` +
        `We encountered a network delay retrieving <b>${escapeHtml(seriesTitle)} (S${seasonNum}E${epNum})</b>.\n\n` +
        `Your request has been queued in our priority buffer.`,
        {
          parse_mode: "HTML",
          ...Markup.inlineKeyboard([
            [Markup.button.callback("🔄 Re-try Acquisition", `qep_${showKey}_${seasonNum}_${epNum}`)],
            [Markup.button.callback("◀️ Back to Episodes", `eps_${showKey}_${seasonNum}_1`)]
          ])
        }
      );
    }
  });

  // Batch Season Ingestion Handler ("Get All Episodes" from Quinson)
  bot.action(/^qall_(.+)_(\d+)$/, async (ctx) => {
    await ensureUser(ctx);
    const showKey = ctx.match[1];
    const seasonNum = parseInt(ctx.match[2], 10);
    const seriesTitle = await resolveShowTitle(showKey);

    await ctx.answerCbQuery(`⚡ Starting Full Season ${seasonNum} Ingestion...`);
    const statusMsg = await ctx.reply(
      `📺 <b>BusiMovie Cinema Intelligence</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `📦 <b>Batch Ingesting Full Season ${seasonNum}...</b>\n` +
      `• Series: <b>${escapeHtml(seriesTitle)}</b>\n` +
      `• Connecting to Quinson Relay...\n` +
      `• Archiving all season episodes to Channel (-1003983385552)...\n\n` +
      `<i>Please wait while the episodes are captured and indexed...</i>`,
      { parse_mode: "HTML" }
    );

    try {
      const res = await fetchSeriesFromQuinson({
        seriesTitle,
        seasonNum,
        allEpisodes: true,
        onProgress: async (count, latestTitle) => {
          await ctx.telegram.editMessageText(
            ctx.chat.id,
            statusMsg.message_id,
            undefined,
            `📺 <b>BusiMovie Cinema Intelligence</b>\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
            `📦 <b>Ingesting Season ${seasonNum} (${count} episodes captured)...</b>\n` +
            `• Series: <b>${escapeHtml(seriesTitle)}</b>\n` +
            `• Latest: <code>${escapeHtml(latestTitle)}</code>\n` +
            `• Archiving into TV Series Channel (-1003983385552)...`,
            { parse_mode: "HTML" }
          ).catch(() => {});
        }
      });

      if (res.success && res.filesIngested > 0) {
        const finishButtons: any[] = [];
        if (res.firstMediaFileId) {
          finishButtons.push([
            Markup.button.callback("🍿 Stream Episode 1 Now", `watch_${res.firstMediaFileId}`)
          ]);
        }
        finishButtons.push([
          Markup.button.callback(`▶️ Browse Season ${seasonNum} Episodes (${res.filesIngested} ready)`, `eps_${showKey}_${seasonNum}_1`)
        ]);
        finishButtons.push([
          Markup.button.callback("🍿 Browse Catalog", "browse_library")
        ]);

        await ctx.telegram.editMessageText(
          ctx.chat.id,
          statusMsg.message_id,
          undefined,
          `✅ <b>Full Season ${seasonNum} Successfully Ingested!</b>\n\n` +
          `• Series: <b>${escapeHtml(seriesTitle)}</b>\n` +
          `• Total Episodes Captured: <b>${res.filesIngested}</b>\n` +
          `• Storage: Private BusiMovie TV Channel (-1003983385552)\n\n` +
          `All episodes are now ready in your catalog for immediate streaming!`,
          {
            parse_mode: "HTML",
            ...Markup.inlineKeyboard(finishButtons)
          }
        );
      } else {
        await ctx.telegram.editMessageText(
          ctx.chat.id,
          statusMsg.message_id,
          undefined,
          `⚠️ <b>Batch Ingestion Notice</b>\n\n` +
          `Episodes for <b>${escapeHtml(seriesTitle)} (Season ${seasonNum})</b> are currently in high demand on relays.\n\n` +
          `You can still tap individual episodes to stream them on demand!`,
          {
            parse_mode: "HTML",
            ...Markup.inlineKeyboard([
              [Markup.button.callback("◀️ View Episodes", `eps_${showKey}_${seasonNum}_1`)]
            ])
          }
        );
      }
    } catch (err: any) {
      console.error("Error in qall callback:", err);
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        statusMsg.message_id,
        undefined,
        `⚠️ <b>Temporary Delay Ingesting Season ${seasonNum}</b>\n\n` +
        `Relays are synchronizing. You can browse episodes individually below:`,
        {
          parse_mode: "HTML",
          ...Markup.inlineKeyboard([
            [Markup.button.callback("◀️ View Episodes", `eps_${showKey}_${seasonNum}_1`)]
          ])
        }
      );
    }
  });

  // Fold 2: Movie Quality & Release Selector (When a user clicks a movie from search results)
  bot.action(/^mov_sel_(.+)$/, async (ctx) => {
    await ensureUser(ctx);
    const mKey = ctx.match[1];
    const movieMeta = await resolveMovieMeta(mKey);
    if (!movieMeta) {
      return ctx.answerCbQuery("Movie details expired. Please search again.");
    }

    const { title, year } = movieMeta;
    const qualities = await getMovieQualities(title, year);

    if (qualities.length === 0) {
      // Check if this title is actually a TV series
      let isSeries = false;
      const dbSeries = await getVaultSeriesCatalog(title);
      if (dbSeries.length > 0) {
        isSeries = true;
      } else {
        try {
          const meta = await searchMovies(title);
          if (meta && meta[0] && isTvSeriesEntity(meta[0])) {
            isSeries = true;
          }
        } catch {}
      }

      if (isSeries) {
        const showKey = getShowKey(title);
        await ctx.answerCbQuery("📺 Opening TV Series Seasons...");
        const dbSeasons = await getSeriesSeasons(title);
        let qSeasons: number[] = [];
        const cacheKey = `seasons_${title.toLowerCase()}`;
        const cachedSeasons = seriesSeasonsCache.get(cacheKey);
        if (cachedSeasons && Date.now() - cachedSeasons.timestamp < 30 * 60 * 1000) {
          qSeasons = cachedSeasons.seasons;
        } else {
          try {
            qSeasons = await getQuinsonSeriesSeasons(title);
            if (qSeasons.length > 0) {
              seriesSeasonsCache.set(cacheKey, { seasons: qSeasons, timestamp: Date.now() });
            }
          } catch (_) {}
        }
        const merged = Array.from(new Set([...dbSeasons, ...qSeasons])).sort((a, b) => a - b);
        const seasons = merged.length > 0 ? merged : [1];

        const seasonButtons: any[] = [];
        let currentRow: any[] = [];
        for (const s of seasons) {
          currentRow.push(Markup.button.callback(`🗓️ Season ${s}`, `eps_${showKey}_${s}_1`));
          if (currentRow.length === 2) {
            seasonButtons.push(currentRow);
            currentRow = [];
          }
        }
        if (currentRow.length > 0) seasonButtons.push(currentRow);
        seasonButtons.push([Markup.button.callback("◀️ Back to Search Results", "back_search")]);

        const text = `📺 <b>${escapeHtml(title)}</b>\nPlease choose a season:`;
        try {
          if ((ctx.callbackQuery?.message as any)?.photo) {
            await ctx.editMessageCaption(text, { parse_mode: "HTML", ...Markup.inlineKeyboard(seasonButtons) });
          } else {
            await ctx.editMessageText(text, { parse_mode: "HTML", ...Markup.inlineKeyboard(seasonButtons) });
          }
        } catch {
          await ctx.reply(text, { parse_mode: "HTML", ...Markup.inlineKeyboard(seasonButtons) });
        }
        return;
      }

      await ctx.answerCbQuery();
      const qKey = getQueryKey(`${title} ${year || ""}`.trim());
      
      let trailerUrl = "";
      try {
        const trailer = await getOfficialTrailer(title, year);
        trailerUrl = trailer?.url || "";
      } catch {}

      const searchStr = encodeURIComponent(title);
      const kbRows: any[] = [
        [Markup.button.callback("📥 Request & Search Channels", `req_q_${qKey}`)]
      ];
      const extraRow: any[] = [];
      if (trailerUrl) {
        extraRow.push(Markup.button.url("🎬 Watch Trailer", trailerUrl));
      }
      extraRow.push(Markup.button.url("💬 Subtitles", `https://subdl.com/subtitle/search?q=${searchStr}`));
      if (extraRow.length > 0) kbRows.push(extraRow);
      kbRows.push([Markup.button.callback("◀️ Back to Search Results", "back_search")]);

      const caption = `🎬 <b>${escapeHtml(title)}</b> ${year ? `(${escapeHtml(year)})` : ""}\n\n` +
        `⚠️ <i>This title is not currently in our library catalog.</i>\n\n` +
        `Would you like to request this title on BusiMovie?`;

      const kb = Markup.inlineKeyboard(kbRows);

      try {
        if ((ctx.callbackQuery?.message as any)?.photo) {
          await ctx.editMessageCaption(caption, { parse_mode: "HTML", ...kb });
        } else {
          await ctx.editMessageText(caption, { parse_mode: "HTML", ...kb });
        }
      } catch {
        await ctx.reply(caption, { parse_mode: "HTML", ...kb });
      }
      return;
    }

    await ctx.answerCbQuery();

    const yrText = year ? `(${escapeHtml(year)})` : (qualities[0].year ? `(${escapeHtml(qualities[0].year)})` : "");
    const first = qualities[0];

    const qualityButtons: any[] = [];
    for (const qFile of qualities) {
      const qLabel = qFile.quality || "HD";
      const sizeStr = formatFileSize(Number(qFile.file_size || 0));
      qualityButtons.push([
        Markup.button.callback(`💿 Watch ${qLabel} • ${sizeStr}`, `watch_${qFile.id}`)
      ]);
    }

    // Subtitles & Trailer buttons
    const searchStr = encodeURIComponent(title);
    qualityButtons.push([
      Markup.button.url("💬 Subtitles", `https://subdl.com/subtitle/search?q=${searchStr}`),
      Markup.button.url("🌐 OpenSubtitles", `https://www.opensubtitles.org/en/search/sublanguageid-all/searchonlymovies-on/moviename-${searchStr}`)
    ]);

    let trailerUrl = qualities.find(f => f.trailer_url)?.trailer_url;
    if (!trailerUrl) {
      try {
        const trailer = await getOfficialTrailer(title, year || qualities[0].year);
        trailerUrl = trailer?.url;
      } catch {}
    }
    if (trailerUrl) {
      qualityButtons.push([Markup.button.url("🎬 Watch Official Trailer", trailerUrl)]);
    }

    qualityButtons.push([Markup.button.callback("◀️ Back to Search Results", "back_search")]);

    const caption = `🎬 <b>${escapeHtml(title)}</b> ${yrText}\n\n` +
      `🍿 <b>Available Qualities:</b> ${qualities.length} release${qualities.length > 1 ? "s" : ""}\n\n` +
      `Please choose your preferred quality to stream or download:`;

    let poster = first.poster_url;
    if (!poster) {
      try {
        const meta = await searchMovies(title);
        if (meta && meta[0]?.poster_path) {
          poster = meta[0].poster_path;
        }
      } catch {}
    }

    if (poster) {
      const imgUrl = poster.startsWith("http") ? poster : `https://image.tmdb.org/t/p/w500${poster}`;
      try {
        await ctx.replyWithPhoto(imgUrl, {
          caption,
          parse_mode: "HTML",
          ...Markup.inlineKeyboard(qualityButtons)
        });
        return;
      } catch {}
    }

    try {
      await ctx.editMessageText(caption, {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard(qualityButtons)
      });
    } catch {
      await ctx.reply(caption, {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard(qualityButtons)
      });
    }
  });

  // Movie Card Viewer for direct numeric IDs
  bot.action(/^mov_(\d+)$/, async (ctx) => {
    await ensureUser(ctx);
    const fileId = parseInt(ctx.match[1], 10);
    const file = await getMediaFileById(fileId);
    if (!file) {
      return ctx.answerCbQuery("File not found in catalog.");
    }

    const mKey = getMovieKey(file.movie_title, file.year);
    const movieMeta = movieKeyCache.get(mKey);
    if (movieMeta) {
      const qualities = await getMovieQualities(file.movie_title, file.year);
      if (qualities.length > 1) {
        const qualityButtons: any[] = [];
        for (const qFile of qualities) {
          const qLabel = qFile.quality || "HD";
          const sizeStr = formatFileSize(Number(qFile.file_size || 0));
          qualityButtons.push([
            Markup.button.callback(`💿 Watch ${qLabel} • ${sizeStr}`, `watch_${qFile.id}`)
          ]);
        }
        qualityButtons.push([Markup.button.callback("◀️ Back to Search Results", "back_search")]);
        return ctx.reply(
          `🎬 <b>${escapeHtml(file.movie_title)}</b> ${file.year ? `(${escapeHtml(file.year)})` : ""}\n\nPlease choose your preferred quality:`,
          { parse_mode: "HTML", ...Markup.inlineKeyboard(qualityButtons) }
        );
      }
    }

    await ctx.answerCbQuery();
    const yearText = file.year ? `(${file.year})` : "";
    const sizeText = formatFileSize(Number(file.file_size || 0));

    const caption = `🍿 <b>[READY TO WATCH]</b>\n🎬 <b>${escapeHtml(file.movie_title)}</b> ${escapeHtml(yearText)}\n\n` +
      `💿 <b>Quality:</b> ${file.quality || "HD"}\n` +
      `💾 <b>File Size:</b> ${sizeText}\n\n` +
      `⚡ <i>Available right now for instant streaming & download!</i>`;

    const searchStr = encodeURIComponent(file.movie_title);
    const buttons = [
      [Markup.button.callback(`▶️ Watch & Stream Now (${file.quality || "HD"})`, `watch_${file.id}`)],
      [
        Markup.button.url("💬 Subtitles", `https://subdl.com/subtitle/search?q=${searchStr}`),
        Markup.button.url("🌐 OpenSubtitles", `https://www.opensubtitles.org/en/search/sublanguageid-all/searchonlymovies-on/moviename-${searchStr}`)
      ],
      [Markup.button.callback("◀️ Back to Search Results", "back_search")]
    ];

    let poster = file.poster_url;
    if (!poster) {
      try {
        const meta = await searchMovies(file.movie_title);
        if (meta && meta[0]?.poster_path) {
          poster = meta[0].poster_path;
        }
      } catch {}
    }

    if (poster) {
      const imageUrl = poster.startsWith("http") ? poster : `https://image.tmdb.org/t/p/w500${poster}`;
      try {
        await ctx.replyWithPhoto(imageUrl, { caption, parse_mode: "HTML", ...Markup.inlineKeyboard(buttons) });
      } catch {
        await ctx.reply(caption, { parse_mode: "HTML", ...Markup.inlineKeyboard(buttons) });
      }
    } else {
      await ctx.reply(caption, { parse_mode: "HTML", ...Markup.inlineKeyboard(buttons) });
    }
  });

  // Back to Search Results
  bot.action("back_search", async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply("🔍 <b>Please enter your search query:</b>\n\n• Type any title (e.g. <code>Criminal Minds</code>, <code>S.W.A.T.</code>, <code>Passenger</code>)\n• Or tap /library to browse the catalog!", { parse_mode: "HTML" });
  });

  // Phase 6 POC: Direct Download Action
  // Direct video upload to the bot or group
  bot.on("video", async (ctx) => {
    try {
      await ensureUser(ctx);
      // Only admins can add files from a private chat (otherwise anyone could publish videos into the catalog)
      if (ctx.chat.type === "private" && !isAdminTelegramId(ctx.from?.id)) {
        await ctx.reply("🎬 Send me a movie or series name and I'll find it for you.");
        return;
      }
      const video = ctx.message.video;
      const media = {
        file_id: video.file_id,
        file_name: video.file_name,
        file_size: video.file_size,
        mime_type: video.mime_type || "video/mp4"
      };
      const uploadingMsg = await ctx.reply("⏳ Processing video for BusiMovie...");
      await handleMediaUpload(bot, media, ctx.message.caption || "", ctx.chat, ctx.message.message_id, ctx);
      await ctx.telegram.deleteMessage(ctx.chat.id, uploadingMsg.message_id).catch(() => {});
    } catch (err: any) {
      console.error("Video upload error:", err);
      await ctx.reply(`❌ Failed to index video: ${err.message}`);
    }
  });

  // Direct document upload to the bot or group
  bot.on("document", async (ctx) => {
    try {
      await ensureUser(ctx);
      if (ctx.chat.type === "private" && !isAdminTelegramId(ctx.from?.id)) {
        await ctx.reply("🎬 Send me a movie or series name and I'll find it for you.");
        return;
      }
      const media = extractVideoMedia(ctx.message);
      if (!media) {
        await ctx.reply("⚠️ Skipping file: Only video documents (.mp4, .mkv, etc) are supported for BusiMovie.");
        return;
      }
      const uploadingMsg = await ctx.reply("⏳ Processing document for BusiMovie...");
      await handleMediaUpload(bot, media, ctx.message.caption || "", ctx.chat, ctx.message.message_id, ctx);
      await ctx.telegram.deleteMessage(ctx.chat.id, uploadingMsg.message_id).catch(() => {});
    } catch (err: any) {
      console.error("Document upload error:", err);
      await ctx.reply(`❌ Failed to index document: ${err.message}`);
    }
  });

  // Channel posts auto-indexing (Broadcast channels)
  bot.on(["channel_post", "edited_channel_post"], async (ctx) => {
    const post = ((ctx as any).channelPost || (ctx as any).editedChannelPost) as any;
    if (!post) return;

    // Handle channel status / sync test commands
    if (post.text) {
      const text = post.text.trim();
      if (text.startsWith("/id") || text.startsWith("/sync") || text.startsWith("/status") || text.startsWith("/help")) {
        console.log(`[Channel ${ctx.chat.id}] Received command in channel_post: ${text}`);
        const chatTitle = (ctx.chat as any)?.title || "Private Channel";
        try {
          await ctx.telegram.sendMessage(
            ctx.chat.id,
            `✅ <b>BusiMovie Storage Channel Connected!</b>\n\n` +
            `📡 <b>Channel ID:</b> <code>${ctx.chat.id}</code>\n` +
            `📢 <b>Channel Title:</b> ${escapeHtml(chatTitle)}\n` +
            `⚡ <b>Engine:</b> Listening for video uploads and indexing automatically!\n\n` +
            `Drop any movie (.mp4, .mkv) in this channel to save it to BusiMovie.`,
            { parse_mode: "HTML" }
          );

          await logChannelEvent({
            channel_id: ctx.chat.id.toString(),
            channel_title: chatTitle,
            message_id: post.message_id?.toString() || "0",
            media_type: "command",
            parsed_title: `/sync verified in ${chatTitle}`,
            status: "active",
            details: "Bot responded to channel command"
          });
        } catch (e: any) {
          console.error(`Could not reply in channel (may lack post messages permission):`, e?.message);
          await logChannelEvent({
            channel_id: ctx.chat.id.toString(),
            channel_title: chatTitle,
            message_id: post.message_id?.toString() || "0",
            media_type: "error",
            parsed_title: `Permission Error in Channel`,
            status: "error",
            details: `Failed to post response: ${e?.message}. Ensure bot is Admin with "Post Messages" enabled!`
          });
        }
        return;
      }
    }

    const media = extractVideoMedia(post);
    if (!media) {
      console.log(`[Channel ${ctx.chat.id}]: Post received without video media.`);
      return;
    }

    try {
      await handleMediaUpload(bot, media, post.caption || "", ctx.chat, post.message_id, ctx);
    } catch (err: any) {
      console.error(`[Channel ${ctx.chat.id}] Failed to index media:`, err);
      await logChannelEvent({
        channel_id: ctx.chat.id.toString(),
        channel_title: (ctx.chat as any)?.title || "Private Channel",
        message_id: post.message_id?.toString() || "0",
        media_type: "error",
        parsed_title: "Indexing Error",
        status: "error",
        details: `Failed to index video: ${err.message}`
      });
    }
  });

  // Handle when bot is added to a channel or group
  bot.on("my_chat_member", async (ctx) => {
    const update = (ctx as any).myChatMember;
    if (!update) return;
    const newStatus = update.new_chat_member?.status;
    const chatTitle = (ctx.chat as any)?.title || "Private Channel";
    const chatId = ctx.chat?.id?.toString() || "";

    console.log(`[Bot Membership Update]: Chat ${chatTitle} (${chatId}) status is now: ${newStatus}`);

    if (newStatus === "administrator" || newStatus === "member") {
      try {
        await logChannelEvent({
          channel_id: chatId,
          channel_title: chatTitle,
          message_id: "0",
          media_type: "bot_joined",
          parsed_title: "Bot Joined as Admin",
          status: "connected",
          details: `Bot added with status: ${newStatus}`
        });

        // Send a friendly greeting in channel if bot can post
        await ctx.telegram.sendMessage(
          ctx.chat.id,
          `🎬 <b>BusiMovie Storage Connected!</b>\n\n` +
          `📡 <b>Channel ID:</b> <code>${ctx.chat.id}</code>\n` +
          `✅ <b>Sync:</b> Active\n\n` +
          `Whenever you post or forward movies (.mp4, .mkv), they will be automatically indexed into BusiMovie!`,
          { parse_mode: "HTML" }
        );
      } catch (err: any) {
        console.log(`Bot joined channel notice note:`, err?.message || err);
      }
    }
  });

  // Inline query mode: allows @BotUsername <movie> in any chat
  bot.on("inline_query", async (ctx) => {
    const query = ctx.inlineQuery.query.trim();
    if (!query) {
      return ctx.answerInlineQuery([]);
    }

    try {
      const results = await searchMovies(query);
      const inlineResults = await Promise.all(
        results.slice(0, 8).map(async (movie) => {
          titleCache.set(movie.id, movie.title);
          const libFiles = await getMediaFilesForMovie(movie.id, movie.title);
          const inVault = libFiles.length > 0;
          const isShow = isTvSeriesEntity(movie);
          const icon = isShow ? "📺" : "🎬";
          const labelType = isShow ? "Series" : "Movie";

          let messageText = `${icon} <b>${escapeHtml(movie.title)}</b> ${movie.year ? `(${movie.year})` : ""}\n\n`;
          if (movie.overview) {
            messageText += `${escapeHtml(movie.overview.substring(0, 250))}...\n\n`;
          }

          if (inVault) {
            messageText += `✅ <b>Available on BusiMovie!</b> Quality: ${libFiles.map(f => f.quality || "HD").join(", ")}\n🍿 Stream directly via the button below:`;
          } else {
            messageText += `📝 Not in catalog yet. Tap below to request this ${labelType.toLowerCase()}!`;
          }

          const botUsername = ctx.botInfo.username;
          
          const keyboard = inVault
            ? [[Markup.button.url("▶️ Watch in Bot", `https://t.me/${botUsername}?start=watch_${libFiles[0].id}`)]]
            : [[Markup.button.url(`📝 Request ${labelType}`, `https://t.me/${botUsername}?start=req_${movie.id}`)]];

          const searchStr = encodeURIComponent(movie.title);
          keyboard.push([Markup.button.url("💬 Find Subtitles", `https://subdl.com/subtitle/search?q=${searchStr}`)]);

          return {
            type: "article" as const,
            id: movie.id,
            title: `${icon} ${movie.title} ${movie.year ? `(${movie.year})` : ""} ${inVault ? "🟢 [Available]" : ""}`,
            description: movie.overview ? movie.overview.substring(0, 90) : (movie.cast || labelType),
            thumb_url: movie.poster_path || undefined,
            input_message_content: {
              message_text: messageText,
              parse_mode: "HTML" as const
            },
            reply_markup: Markup.inlineKeyboard(keyboard).reply_markup
          };
        })
      );

      await ctx.answerInlineQuery(inlineResults, { cache_time: 15 });
    } catch (err) {
      console.error("Inline query error:", err);
      await ctx.answerInlineQuery([]);
    }
  });

  // Handle text messages as searches
  bot.on("text", async (ctx) => {
    await ensureUser(ctx);
    const query = ctx.message.text.trim();

    if (query.startsWith("/sync") || query.startsWith("/id") || query.startsWith("/status") || query.startsWith("/help") || query.startsWith("/channel")) {
      const botUser = ctx.botInfo?.username || "EaziMovie_bot";
      await ctx.reply(
        `📡 <b>BusiMovie Channel Sync</b>\n\n` +
        `• <b>Bot Username:</b> @${botUser}\n` +
        `• <b>Chat ID:</b> <code>${ctx.chat.id}</code>\n` +
        `• <b>Chat Type:</b> ${ctx.chat.type}\n\n` +
        `<b>To connect a private channel:</b>\n` +
        `1. Open Channel Settings ➔ Administrators ➔ Add Administrator\n` +
        `2. Search for <b>@${botUser}</b>\n` +
        `3. Make sure <b>"Post Messages"</b> is enabled\n` +
        `4. Type <code>/sync</code> in the channel or upload any video!`,
        { parse_mode: "HTML" }
      );
      return;
    }

    // Natural language subtitle query check: "subs The Bluff", "subtitles Inception", "where to get subtitles for ..."
    const cleanLower = query.toLowerCase().trim();
    if (
      cleanLower.startsWith("sub ") ||
      cleanLower.startsWith("subs ") ||
      cleanLower.startsWith("subtitle ") ||
      cleanLower.startsWith("subtitles ") ||
      cleanLower.includes("subtitles for") ||
      cleanLower.includes("subtitle for")
    ) {
      const subTitle = query
        .replace(/^(can you get me|give me|find|where are|get|show me)?\s*(the\s*)?(subs?|subtitles?)\s*(for\s*)?/i, "")
        .replace(/\s*(subs?|subtitles?)$/i, "")
        .trim();

      if (subTitle) {
        const searchStr = encodeURIComponent(subTitle);
        const keyboard = Markup.inlineKeyboard([
          [Markup.button.url("💬 Subdl (Instant .srt)", `https://subdl.com/subtitle/search?q=${searchStr}`)],
          [Markup.button.url("🌐 OpenSubtitles (All Languages)", `https://www.opensubtitles.org/en/search/sublanguageid-all/searchonlymovies-on/moviename-${searchStr}`)],
          [Markup.button.url("🎬 YIFY Subtitles", `https://yifysubtitles.ch/search?q=${searchStr}`)]
        ]);
        await ctx.reply(
          `📝 <b>Subtitles for:</b> <i>${escapeHtml(subTitle)}</i>\n\n` +
          `Choose a provider below to download your subtitle file (.srt / .zip):`,
          { parse_mode: "HTML", ...keyboard }
        );
        return;
      }
    }

    if (query.startsWith("/")) return; // Ignore other slash commands

    await executeMovieSearch(ctx, query);
  });

  // Dedicated /search and /find commands
  bot.command(["search", "find"], async (ctx) => {
    const rawText = ctx.message.text || "";
    const query = rawText.replace(/^\/(search|find)(?:@\w+)?\s*/i, "").trim();
    if (!query) {
      return ctx.reply("🔍 <b>Please enter a movie or series title to search.</b>\n\nExamples:\n• <code>/search Passenger 2026</code>\n• <code>/search SWAT</code>\n• <code>/search Inception</code>", { parse_mode: "HTML" });
    }
    await executeMovieSearch(ctx, query);
  });

  async function executeMovieSearch(ctx: any, query: string) {
    try {
      await db.execute({
        sql: "INSERT INTO searches (telegram_id, query) VALUES (?, ?)",
        args: [ctx.from.id.toString(), query]
      });
    } catch (e) {
      console.error("Failed to log search:", e);
    }

    const waitMsg = await ctx.reply("🔍 Searching BusiMovie catalog...");

    // 1. Get Series matching query
    const vaultSeries = await getVaultSeriesCatalog(query);

    // 2. Get Standalone Movies matching query
    const vaultMovies = await getVaultMovieCatalog(query);

    // 3. Online metadata search
    let onlineResults: any[] = [];
    try {
      onlineResults = await searchMovies(query);
    } catch {}

    await ctx.telegram.deleteMessage(ctx.chat.id, waitMsg.message_id).catch(() => {});

    const totalHits = vaultSeries.length + vaultMovies.length + onlineResults.length;
    if (totalHits === 0) {
      const qKey = getQueryKey(query);
      await ctx.reply(
        `🔍 <b>No Results Found for:</b> "${escapeHtml(query)}"\n\n` +
        `• Please check the spelling or try a shorter title.\n` +
        `• Or tap below to request this title on BusiMovie!`,
        {
          parse_mode: "HTML",
          ...Markup.inlineKeyboard([
            [Markup.button.callback("⚡ Acquire & Stream on BusiMovie", `req_q_${qKey}`)],
            [Markup.button.callback("🍿 Browse Catalog", "browse_library")]
          ])
        }
      );
      return;
    }

    // Build Search Results Menu
    const resultButtons: any[] = [];
    const addedNormalized = new Set<string>();

    // A. Series First
    for (const s of vaultSeries.slice(0, 5)) {
      const showTitle = s.movie_title;
      const showKey = getShowKey(showTitle);
      const yr = s.year ? ` (${s.year})` : "";
      resultButtons.push([
        Markup.button.callback(`📺 ${showTitle}${yr}`, `ser_${showKey}`)
      ]);
      addedNormalized.add(showTitle.toLowerCase().replace(/[^a-z0-9]/g, ''));
    }

    // B. Movies
    for (const m of vaultMovies.slice(0, 5)) {
      const movieTitle = m.title;
      const norm = `${movieTitle.toLowerCase()}_${m.year || ""}`.replace(/[^a-z0-9]/g, '');
      if (addedNormalized.has(norm)) continue;
      const yr = m.year ? ` (${m.year})` : "";
      const mKey = getMovieKey(movieTitle, m.year);
      resultButtons.push([
        Markup.button.callback(`🎬 ${movieTitle}${yr}`, `mov_sel_${mKey}`)
      ]);
      addedNormalized.add(norm);
    }

    // C. Online Results
    for (const item of onlineResults.slice(0, 5)) {
      const norm = `${(item.title || "").toLowerCase()}_${item.year || ""}`.replace(/[^a-z0-9]/g, '');
      if (addedNormalized.has(norm)) continue;
      const isShow = isTvSeriesEntity(item);
      const yr = item.year ? ` (${item.year})` : "";
      const icon = isShow ? "📺" : "🎬";

      if (isShow) {
        const showKey = getShowKey(item.title);
        resultButtons.push([
          Markup.button.callback(`${icon} ${item.title}${yr}`, `ser_${showKey}`)
        ]);
      } else {
        const mKey = getMovieKey(item.title, item.year);
        titleCache.set(item.id, item.title);
        resultButtons.push([
          Markup.button.callback(`${icon} ${item.title}${yr}`, `mov_sel_${mKey}`)
        ]);
      }
      addedNormalized.add(norm);
    }

    // D. Bottom "Acquire & Stream On-Demand" button
    const qKey = getQueryKey(query);
    resultButtons.push([
      Markup.button.callback("⚡ Acquire & Stream On-Demand ▫️", `req_q_${qKey}`)
    ]);

    const caption = `🔎 <b>Results for:</b> <code>${escapeHtml(query)}</code>`;

    await ctx.reply(caption, {
      parse_mode: "HTML",
      ...Markup.inlineKeyboard(resultButtons)
    });
    return;
  }

  // Interactive movie rating callback
  bot.action(/^rate_(\d+)$/, async (ctx) => {
    const fileId = parseInt(ctx.match[1], 10);
    ctx.answerCbQuery("⭐ Opening ratings...");
    await ctx.reply(
      "⭐ <b>How would you rate this movie?</b>\nYour rating helps personalize future AI recommendations!",
      {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([
          [
            Markup.button.callback("⭐⭐⭐⭐⭐ (10/10 Masterpiece)", `voted_${fileId}_5`),
            Markup.button.callback("⭐⭐⭐⭐ (8/10 Great)", `voted_${fileId}_4`)
          ],
          [
            Markup.button.callback("⭐⭐⭐ (6/10 Good)", `voted_${fileId}_3`),
            Markup.button.callback("⭐⭐ (4/10 Mediocre)", `voted_${fileId}_2`)
          ],
          [Markup.button.callback("🍿 What to Watch Next", `next_${fileId}`)]
        ])
      }
    );
  });

  bot.action(/^voted_(\d+)_(\d+)$/, async (ctx) => {
    const stars = ctx.match[2];
    ctx.answerCbQuery(`Thank you! Recorded ${stars} stars.`);
    await ctx.editMessageText(
      `⭐ <b>Rating Recorded!</b>\nThank you for rating! We have customized your cinema preferences.\n\nReady for your next movie? Tap below to explore what to watch next:`,
      {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([
          [Markup.button.callback("🍿 What to Watch Next", `similar_${ctx.match[1]}`)],
          [Markup.button.callback("🎲 Surprise Me", "surprise_me")]
        ])
      }
    ).catch(() => {});
  });

  // What to Watch Next / Similar callback
  bot.action(/^(next|similar)_(\d+)$/, async (ctx) => {
    const fileId = parseInt(ctx.match[2], 10);
    ctx.answerCbQuery("🔍 Curating recommendations...");
    
    let fileTitle = "movies";
    try {
      const res = await db.execute({
        sql: "SELECT movie_title, year FROM media_files WHERE id = ?",
        args: [fileId]
      });
      if (res.rows[0]?.movie_title) {
        fileTitle = String(res.rows[0].movie_title);
      }
    } catch {}

    const waitMsg = await ctx.reply(`🧠 <i>Curating brilliant follow-up titles similar to <b>${escapeHtml(fileTitle)}</b>...</i>`, { parse_mode: "HTML" });
    const vaultTitles = await getAllVaultTitles();
    const result = await getAIMovieRecommendations(`Find 3 exciting movies or TV shows similar in tone, plot, or style to ${fileTitle}`, vaultTitles);

    const buttons: any[] = [];
    for (const title of result.suggestedTitles.slice(0, 3)) {
      const inVaultFiles = await getMediaFilesForMovie(title, title);
      if (inVaultFiles.length > 0) {
        buttons.push([Markup.button.callback(`▶️ Watch ${title}`, `watch_${inVaultFiles[0].id}`)]);
      } else {
        buttons.push([Markup.button.callback(`🔍 Search "${title}"`, "search_prompt")]);
      }
    }

    buttons.push([
      Markup.button.callback("🎲 Surprise Me", "surprise_me"),
      Markup.button.callback("⚡ Re-fetch Previous", `watch_${fileId}`)
    ]);

    await ctx.telegram.editMessageText(
      ctx.chat!.id,
      waitMsg.message_id,
      undefined,
      `🍿 <b>What to Watch After ${escapeHtml(fileTitle)}:</b>\n\n${escapeHtml(result.recommendation)}\n\n💡 <i>${escapeHtml(result.explanation)}</i>`,
      {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard(buttons)
      }
    ).catch(() => {});
  });

  bot.action("noop", (ctx) => {
    ctx.answerCbQuery();
  });

  return bot;
}

// Helper to escape HTML characters
function escapeHtml(text: string): string {
  return (text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
