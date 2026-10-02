import { Telegraf, Markup } from "telegraf";
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
  searchVaultFilesDirect
} from "../db/index.js";
import { getAIMovieRecommendations, analyzeUserIntent, generateMoviePostWatchFollowUp } from "../services/gemini.js";
import { addMovieToRadarr } from "../services/arr.js";
import { searchOpenTracker, downloadTorrent } from "../services/torrentEngine.js";

// In-memory cache for movie titles to support clean requests
const titleCache = new Map<string, string>();

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
          `🎉 <b>Great News! Your Requested Title is Ready!</b>\n\n🎬 <b>${escapeHtml(movieTitle)}</b> ${year ? `(${year})` : ""}\n🎞 <b>Quality:</b> ${quality}\n🍿 Added to the Vault! You can stream or download it now:`,
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

      const confirmationCaption = `✅ <b>Indexed in Telegram Movie Vault!</b>\n\n🎬 <b>Title:</b> ${escapeHtml(parsed.title)}${epText}\n📅 <b>Year:</b> ${parsed.year || "N/A"}\n🎞 <b>Quality:</b> ${parsed.quality}\n💾 <b>Size:</b> ${formatFileSize(mediaObj.file_size || 0)}\n${trailerUrl ? `\n🍿 <b>Trailer:</b> Auto-extracted & attached below!` : ""}\n\n💡 Users searching for "<b>${escapeHtml(parsed.title)}</b>" can now stream or download it immediately!`;

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

  // If not found by numeric ID, check if there's any file in the library
  if (!file) {
    const allFiles = await getAllMediaFiles();
    if (allFiles.length > 0) {
      // Pick the most recently added file as fallback
      file = allFiles[0] as any;
    }
  }

  if (!file) {
    await ctx.reply(
      "❌ <b>Media file not found in library.</b>\n\n" +
      "💡 <b>To add or restore files to the Vault:</b>\n" +
      "1. Simply forward or send the video file directly to this bot.\n" +
      "2. Or post it to your connected Telegram storage channel.\n" +
      "The bot will automatically capture the Telegram file and index it!",
      { parse_mode: "HTML" }
    );
    return;
  }

  const epText = (file.season && file.episode) ? `\n📺 <b>Episode:</b> Season ${file.season}, Episode ${file.episode}` : "";
  const caption = `🎬 <b>${escapeHtml(file.movie_title as string)}</b> ${file.year ? `(${file.year})` : ""}${epText}\n🎞 <b>Quality:</b> ${file.quality || "HD"}\n💾 <b>Size:</b> ${formatFileSize(Number(file.file_size || 0))}\n\n🍿 <i>Delivered directly from your Telegram Cloud Vault</i>\n\n⏳ <b>Self-Destruct Timer:</b> 2 minutes (120s)\n💡 <i>Forward to your "Saved Messages" now to keep it forever!</i>`;

  let sentMessage: any;

  // 1. First attempt: Zero-bandwidth copyMessage from private channel
  if (file.telegram_channel_id && file.telegram_message_id) {
    try {
      sentMessage = await ctx.telegram.copyMessage(ctx.chat!.id, file.telegram_channel_id as string, Number(file.telegram_message_id), {
        caption,
        parse_mode: "HTML"
      });
    } catch (copyErr: any) {
      console.warn("copyMessage fallback:", copyErr?.message);
    }
  }

  // 2. Second attempt: Send by Telegram file_id
  if (!sentMessage) {
    try {
      sentMessage = await ctx.replyWithVideo(file.telegram_file_id as string, {
        caption,
        parse_mode: "HTML",
        supports_streaming: true
      });
    } catch (vidErr) {
      sentMessage = await ctx.replyWithDocument(file.telegram_file_id as string, {
        caption,
        parse_mode: "HTML"
      });
    }
  }

  if (!sentMessage) {
    await ctx.reply(
      `⚠️ <b>Unable to deliver "${escapeHtml(file.movie_title as string)}" right now.</b>\n\n` +
      `The file could not be transferred from the Telegram channel (it may be processing or restricted).\n\n` +
      `💡 <i>Tip: Forward the video into your Telegram vault channel or search again to trigger an on-demand re-fetch!</i>`,
      { parse_mode: "HTML" }
    );
    return;
  }

  // Send an interactive countdown & companion notification card
  const companionMsg = await ctx.reply(
    `⏳ <b>Streaming & Vault Session Started</b>\n\n` +
    `🎬 <b>${escapeHtml(file.movie_title as string)}</b> is now in your chat!\n` +
    `⚠️ <i>Telegram Vault files are automatically deleted after 2 minutes to protect storage and maintain privacy.</i>\n\n` +
    `💡 <i>Missed it or need the file again? You will receive an instant <b>Fetch Again</b> notification right after deletion!</i>`,
    {
      parse_mode: "HTML",
      ...Markup.inlineKeyboard([
        [Markup.button.callback("🔄 Re-fetch File", `watch_${file.id}`)],
        [Markup.button.callback("🍿 AI Recommendations", "ai_recs"), Markup.button.callback("🎲 Surprise Me", "surprise_me")]
      ])
    }
  ).catch(() => null);

  // Set 2-minute strict self-destruct timer with brilliant deletion notification and re-fetch trigger
  if (sentMessage && sentMessage.message_id) {
    setTimeout(async () => {
      try {
        // 1. Delete the media message
        await ctx.telegram.deleteMessage(ctx.chat!.id, sentMessage.message_id);
      } catch (err) {
        console.warn("Failed to delete media message, it may have been deleted already.");
      }

      // 2. Also clean up the companion message if present
      if (companionMsg && companionMsg.message_id) {
        try {
          await ctx.telegram.deleteMessage(ctx.chat!.id, companionMsg.message_id);
        } catch {}
      }

      // 3. Send the brilliant "File Expired" notification with instant 1-tap "Fetch File Again"
      try {
        const deletedNotice = await ctx.telegram.sendMessage(
          ctx.chat!.id,
          `⏱ <b>Timer Reached — Movie File Deleted!</b>\n\n` +
          `🎬 <b>${escapeHtml(file.movie_title as string)}</b> ${file.year ? `(${file.year})` : ""}\n` +
          `The 2-minute playback window has closed and the media file was removed from this chat to keep your Telegram lightweight.\n\n` +
          `Did you miss the download or want to watch it again? Tap below to re-fetch the file instantly from the Vault! 👇`,
          {
            parse_mode: "HTML",
            ...Markup.inlineKeyboard([
              [Markup.button.callback("⚡ Fetch File Again (Instant)", `watch_${file.id}`)],
              [
                Markup.button.callback("⭐ Rate Movie", `rate_${file.id}`),
                Markup.button.callback("🍿 What to Watch Next", `next_${file.id}`)
              ],
              [
                Markup.button.callback("📚 Browse Vault", "browse_library"),
                Markup.button.callback("🎲 Random Pick", "random_pick")
              ]
            ])
          }
        );

        // 4. Schedule a thoughtful follow-up interaction 15 seconds after deletion to keep user engaged
        setTimeout(async () => {
          try {
            const followUp = await generateMoviePostWatchFollowUp(file.movie_title as string, file.year as string);
            await ctx.telegram.sendMessage(
              ctx.chat!.id,
              `✨ <b>${escapeHtml(followUp.headline)}</b>\n\n` +
              `❓ <i>${escapeHtml(followUp.question)}</i>\n\n` +
              `🎬 <b>Cinema Trivia:</b> ${escapeHtml(followUp.funFact)}\n\n` +
              `Hungry for your next movie? Explore recommendations tailored for you!`,
              {
                parse_mode: "HTML",
                ...Markup.inlineKeyboard([
                  [
                    Markup.button.callback("🍿 Similar Recommendations", `similar_${file.id}`),
                    Markup.button.callback("🎲 Surprise Me", "surprise_me")
                  ],
                  [
                    Markup.button.callback("⚡ Re-fetch " + (file.movie_title as string).substring(0, 16), `watch_${file.id}`)
                  ]
                ])
              }
            );
          } catch (followUpErr) {
            console.warn("Follow-up error:", followUpErr);
          }
        }, 15000); // 15 seconds after deletion for maximum delight and engagement

      } catch (notifyErr: any) {
        console.warn("Failed to send post-deletion notice:", notifyErr?.message);
      }
    }, 120000); // 120,000 ms = 2 minutes
  }
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
  caption += `\n🍿 <i>Available now in the Telegram Movie Vault!</i>`;

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
        `📢 <b>Announcement from Telegram Movie Vault</b>\n\n${escapeHtml(messageText)}`,
        {
          parse_mode: "HTML",
          ...Markup.inlineKeyboard([
            [Markup.button.callback("📚 Open Library", "browse_library"), Markup.button.callback("🔎 Search", "search_prompt")]
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
 * Sends engaging follow-ups to users to bring them back to the Vault.
 * Highlights a random Vault movie, trending cinema news, or an interactive quiz/picker.
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
      headline: `Tonight's Vault Spotlight: ${movieTitle}! 🍿`,
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
  bot: Telegraf,
  fileId: number
): Promise<{ streamUrl?: string; fileName?: string; fileSize?: number; title: string; quality?: string; tgDirectLink?: string }> {
  const res = await db.execute({
    sql: "SELECT * FROM media_files WHERE id = ?",
    args: [fileId]
  });
  const file = res.rows[0] as any;
  if (!file) throw new Error("File not found");

  let tgDirectLink: string | undefined;
  try {
    const fileLink = await bot.telegram.getFileLink(file.telegram_file_id);
    tgDirectLink = fileLink.toString();
  } catch (e: any) {
    console.warn("Could not get Telegram direct link (file may be > 20MB):", e?.message);
  }

  return {
    title: file.movie_title,
    fileName: file.file_name,
    fileSize: file.file_size,
    quality: file.quality,
    streamUrl: tgDirectLink,
    tgDirectLink
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

  // Global Inbound Update Logger and Diagnostic Tracker
  bot.use(async (ctx, next) => {
    try {
      const chat = ctx.chat;
      const from = ctx.from;
      const msg = ctx.message || (ctx as any).channelPost;
      const text = (msg as any)?.text || (msg as any)?.caption || (ctx.callbackQuery as any)?.data || (ctx.inlineQuery as any)?.query || "";
      
      // Message Freshness / Anti-Replay Guard:
      // When the server/dev container wakes up after idle, Telegram may deliver backlogged updates from hours ago.
      // We safely drop old conversational DMs/searches older than 3 minutes (180s) to avoid message replay storms.
      // Channel posts and media file uploads are kept so movies posted while reconnecting are never lost.
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
        await ctx.reply(`✅ <b>Request Saved!</b>\n\n🎬 We have logged your request for <b>${escapeHtml(movieTitle)}</b>.\nYou will receive an instant notification here as soon as it is uploaded to the Vault!`, { parse_mode: "HTML" });
        return;
      }
    }

    ctx.reply(
      "🎬 <b>Welcome to your Telegram Movie Vault!</b>\n\nFind movies & TV shows, stream or download directly from Telegram's cloud storage.\n\nWhat would you like to do?",
      {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([
          [Markup.button.callback("🔎 Search Movies", "search_prompt"), Markup.button.callback("📚 Browse Library", "browse_library")],
          [Markup.button.callback("🔥 Trending", "trending"), Markup.button.callback("ℹ️ How to Upload", "upload_help")]
        ])
      }
    );
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
        "📚 <b>Telegram Movie Vault</b>\n\nNo movies are in the library yet.\n\n💡 <b>How to add movies:</b>\n1. Simply forward or upload any video file (MP4, MKV) directly to this bot!\n2. Or add this bot to your private storage channel as an admin.\n3. The bot will automatically index the file, extract the title, and make it instantly streamable!",
        {
          parse_mode: "HTML",
          ...Markup.inlineKeyboard([
            [Markup.button.callback("🔎 Search Online Titles", "search_prompt")]
          ])
        }
      );
      return;
    }

    let msg = `📚 <b>Telegram Movie Vault (${files.length} files available)</b>\n\nTap any title below to download or stream instantly:\n\n`;
    const keyboardButtons: any[] = [];

    for (const file of files.slice(0, 8)) {
      const epText = (file.season && file.episode) ? ` [S${file.season}E${file.episode}]` : "";
      msg += `• 🎬 <b>${escapeHtml(file.movie_title)}</b> ${file.year ? `(${file.year})` : ""}${epText} - <code>${file.quality || "HD"}</code> (${formatFileSize(file.file_size || 0)})\n`;
      keyboardButtons.push([
        Markup.button.callback(`▶️ Watch ${file.movie_title}${epText} [${file.quality || "HD"}]`, `watch_${file.id}`)
      ]);
    }

    if (files.length > 8) {
      msg += `\n<i>...and ${files.length - 8} more. Use search to find any title!</i>`;
    }

    await ctx.reply(msg, {
      parse_mode: "HTML",
      ...Markup.inlineKeyboard(keyboardButtons)
    });
  }

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
      `✅ <b>Request Saved! (${count + 1}/3 today)</b>\n\n🎬 We have logged your request for <b>${escapeHtml(text)}</b>.\nYou will be automatically notified here the moment it is added to the Vault!`,
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
          `✅ <b>Telegram Movie Vault Connected!</b>\n\n` +
          `📡 <b>Chat ID:</b> <code>${chatId}</code>\n` +
          `📢 <b>Chat Name:</b> ${escapeHtml(chatTitle)}\n` +
          `🏷 <b>Chat Type:</b> ${chatType}\n` +
          `⚡ <b>Vault Engine:</b> ACTIVE & Listening\n\n` +
          `🎬 Post or forward video files (.mp4, .mkv) here to auto-index into the Vault!`,
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
        `📡 <b>Telegram Movie Vault Channel Sync</b>\n\n` +
        `To automatically sync movies from your private storage channel:\n\n` +
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
      "📤 <b>How to Store Movies in your Telegram Vault</b>\n\n" +
      "Telegram provides <b>free, unlimited cloud storage</b> up to 2GB per file (or 4GB with Telegram Premium).\n\n" +
      "<b>Method 1: Direct Send</b>\n" +
      "Send or forward any video or MKV file directly to this bot.\n\n" +
      "<b>Method 2: Private Channel Vault</b>\n" +
      "1. Create a private Telegram channel (e.g. 'My Movie Vault').\n" +
      "2. Add this bot as an <b>Administrator</b> with 'Post Messages' permission.\n" +
      "3. Post videos to the channel. The bot will automatically index every file and notify anyone waiting for it!",
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
      return ctx.reply("📚 No movies in the Vault yet. Upload or sync videos to get started!");
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
      `🎲 <b>Random Vault Pick!</b>\n\n🎬 <b>${escapeHtml(file.movie_title)}</b> ${file.year ? `(${file.year})` : ""}${epText}\n🎞 <b>Quality:</b> ${file.quality || "HD"}\n💾 <b>Size:</b> ${formatFileSize(file.file_size || 0)}\n\nEnjoy your movie night! 🍿`,
      {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard(randomButtons)
      }
    );
  });

  bot.action("random_pick", async (ctx) => {
    ctx.answerCbQuery("🎲 Picking random movie...");
    const file = await getRandomMediaFile();
    if (!file) return ctx.reply("📚 No movies in the Vault yet.");
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
      `🎲 <b>Random Vault Pick!</b>\n\n🎬 <b>${escapeHtml(file.movie_title)}</b> ${file.year ? `(${file.year})` : ""}${epText}\n🎞 <b>Quality:</b> ${file.quality || "HD"}\n💾 <b>Size:</b> ${formatFileSize(file.file_size || 0)}`,
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
        buttons.push([Markup.button.callback(`▶️ Watch ${title} (In Vault)`, `watch_${inVaultFiles[0].id}`)]);
      }
    }

    buttons.push([Markup.button.callback("📚 View Library", "browse_library")]);

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
    const result = await getAIMovieRecommendations("Recommend 3 must-watch trending movies or hidden gems from our vault", vaultTitles);

    const buttons: any[] = [];
    for (const title of result.suggestedTitles.slice(0, 3)) {
      const inVaultFiles = await getMediaFilesForMovie(title, title);
      if (inVaultFiles.length > 0) {
        buttons.push([Markup.button.callback(`▶️ Watch ${title} (In Vault)`, `watch_${inVaultFiles[0].id}`)]);
      }
    }

    buttons.push([
      Markup.button.callback("🎲 Surprise Me", "random_pick"),
      Markup.button.callback("📚 View Library", "browse_library")
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
    if (!file) return ctx.reply("📚 No movies in the Vault yet.");
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
      `🎲 <b>Random Vault Pick!</b>\n\n🎬 <b>${escapeHtml(file.movie_title)}</b> ${file.year ? `(${file.year})` : ""}${epText}\n🎞 <b>Quality:</b> ${file.quality || "HD"}\n💾 <b>Size:</b> ${formatFileSize(file.file_size || 0)}`,
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
      "📱 <b>Telegram Movie Vault Web App & Player</b>\n\nStream movies in full HD, browse collections, and manage downloads via the web interface:",
      {
        parse_mode: "HTML",
        ...Markup.inlineKeyboard([
          [Markup.button.webApp("🌐 Open Movie Vault Web Player", appUrl)]
        ])
      }
    );
  });

  bot.command(["subs", "sub", "subtitles", "subtitle"], async (ctx) => {
    await ensureUser(ctx);
    const query = ctx.message.text.replace(/^\/(subs?|subtitles?)(@\w+)?/i, "").trim();
    if (!query) {
      const helpMsg = await ctx.reply(
        "📝 <b>Subtitle Finder</b>\n\n" +
        "Usage: <code>/subs &lt;Movie Title&gt;</code>\n" +
        "Example: <code>/subs The Bluff</code> or <code>/sub Inception</code>\n\n" +
        "💡 <i>Tip: Subtitle links are also automatically attached to every movie search result!</i>\n\n" +
        "⚠️ <i>This message will self-destruct in 2 minutes.</i>",
        { parse_mode: "HTML" }
      );
      setTimeout(() => {
        ctx.telegram.deleteMessage(ctx.chat.id, helpMsg.message_id).catch(() => {});
      }, 120000);
      return;
    }

    const searchStr = encodeURIComponent(query);
    const buttons = [
      [Markup.button.url("💬 Subdl (Instant .srt)", `https://subdl.com/subtitle/search?q=${searchStr}`)],
      [Markup.button.url("🌐 OpenSubtitles (All Languages)", `https://www.opensubtitles.org/en/search/sublanguageid-all/searchonlymovies-on/moviename-${searchStr}`)],
      [Markup.button.url("🎬 YIFY Subtitles", `https://yifysubtitles.ch/search?q=${searchStr}`)]
    ];

    const keyboard = Markup.inlineKeyboard(buttons);

    // Auto delete after 2 minutes
    const sentMsg = await ctx.reply(
      `📝 <b>Subtitle Results for:</b> <i>${escapeHtml(query)}</i>\n\n` +
      `Select a provider below to download the .srt file. You can then load it directly in your media player or the Web App Player!\n\n` +
      `⚠️ <i>This message will self-destruct in 2 minutes.</i>`,
      {
        parse_mode: "HTML",
        ...keyboard
      }
    );
    
    setTimeout(() => {
      ctx.telegram.deleteMessage(ctx.chat.id, sentMsg.message_id).catch(() => {});
    }, 120000);
  });

  // Phase 4: Statistics & User Profile
  bot.command("stats", async (ctx) => {
    await ensureUser(ctx);
    const files = await getAllMediaFiles();
    const users = await getAllUsers();
    const totalBytes = files.reduce((acc, f) => acc + (f.file_size || 0), 0);
    const userReqs = (await db.execute({
      sql: "SELECT COUNT(*) as c FROM requests WHERE telegram_id = ?",
      args: [ctx.from.id.toString()]
    })).rows[0] as any;

    await ctx.reply(
      `📊 <b>Telegram Movie Vault Statistics</b>\n\n` +
      `📁 <b>Total Vault Movies:</b> ${files.length}\n` +
      `💾 <b>Total Storage Used:</b> ${formatFileSize(totalBytes)}\n` +
      `👥 <b>Registered Bot Users:</b> ${users.length}\n` +
      `📝 <b>Your Pending Requests:</b> ${userReqs?.c || 0}\n` +
      `⚡ <b>Platform:</b> Cloud Run • SQLite • Telegraf`,
      { parse_mode: "HTML" }
    );
  });

  // Phase 4: Admin Broadcast Command
  bot.command("broadcast", async (ctx) => {
    await ensureUser(ctx);
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
    await ctx.answerCbQuery("🚀 Delivering media file from Vault...");
    try {
      await deliverMediaFile(ctx, fileId);
    } catch (err: any) {
      console.error("Error delivering media file:", err);
      await ctx.reply("❌ Error delivering media file: " + (err?.message || "Unknown error"));
    }
  });

  // Handle movie requests from inline buttons
  bot.action(/^request_(.+)$/, async (ctx) => {
    await ensureUser(ctx);
    const movieId = ctx.match[1];
    
    if (!ctx.from) return;

    // Check 3 limit per day
    const resCount = await db.execute({
      sql: "SELECT COUNT(*) as count FROM requests WHERE telegram_id = ? AND date(created_at) = date('now')",
      args: [ctx.from.id.toString()]
    });
    const count = Number(resCount.rows[0].count || 0);
    if (count >= 3) {
      await ctx.answerCbQuery("❌ Daily Limit Reached (3 requests). Try again tomorrow!", { show_alert: true });
      return;
    }

    const movieTitle = titleCache.get(movieId) || `Movie ${movieId}`;

    try {
      await db.execute({
        sql: "INSERT INTO requests (telegram_id, tmdb_id, title) VALUES (?, ?, ?)",
        args: [ctx.from.id.toString(), movieId, movieTitle]
      });

      // Phase 6: Automatic Radarr push
      let radarrMessage = "";
      if (movieId.startsWith("tmdb_")) {
        const cleanTmdbId = movieId.replace("tmdb_", "");
        const arrResult = await addMovieToRadarr(cleanTmdbId);
        if (arrResult.success) {
          radarrMessage = " (Sent to Radarr for automated download!)";
        } else {
          console.log("[Radarr/Sonarr] Skipped or failed:", arrResult.message);
        }
      }

      ctx.answerCbQuery("✅ Request received! We'll notify you when it's added to the Vault.");
      ctx.editMessageReplyMarkup(Markup.inlineKeyboard([
        Markup.button.callback(`✅ Requested${radarrMessage ? " ⚙️" : ""}`, "noop")
      ]).reply_markup);
      
      if (radarrMessage) {
        await ctx.reply(`⚙️ <b>Automation Triggered:</b> ${escapeHtml(movieTitle)} was successfully sent to the download automation queue! You will be notified when it arrives in the Vault.`, { parse_mode: "HTML" });
      }
    } catch (error) {
      console.error("Error recording request:", error);
      ctx.answerCbQuery("❌ Error processing request.");
    }
  });

  // Phase 6 POC: Direct Download Action
  bot.action(/^dl_(.+)$/, async (ctx) => {
    await ensureUser(ctx);
    const hash = ctx.match[1];
    
    ctx.answerCbQuery("Starting download...");
    const progressMsg = await ctx.reply("⬇️ Initiating direct download pipeline...");
    
    try {
      const { filePath, fileName, size } = await downloadTorrent(hash, (progress, speed) => {
        // Debounce or update safely
        ctx.telegram.editMessageText(
          ctx.chat.id,
          progressMsg.message_id,
          undefined,
          `⬇️ Downloading: ${progress}% (Speed: ${(speed / 1024 / 1024).toFixed(2)} MB/s)`
        ).catch(() => {});
      });

      await ctx.telegram.editMessageText(
        ctx.chat.id,
        progressMsg.message_id,
        undefined,
        `✅ Download complete! File: ${fileName} (${(size / 1024 / 1024).toFixed(2)} MB)\n\nUploading to Telegram Vault...`
      );

      // Attempt to upload to Telegram
      try {
        await ctx.replyWithVideo({ source: filePath }, { caption: `🎬 ${fileName}\n\nIngested via BusiMovie Automation` });
        await ctx.reply("🎉 Successfully ingested to Vault!");
      } catch (uploadErr: any) {
        if (uploadErr.message?.includes("Request Entity Too Large")) {
           await ctx.reply(`⚠️ **Telegram API Limit Reached.**\n\nThe file (${(size / 1024 / 1024).toFixed(2)} MB) exceeds the standard 50MB bot upload limit. In production, the BusiMovie worker (Telegramarr) uses a user-client (MTProto) or local bot server to upload files up to 2GB.\n\nHowever, the download automation succeeded!`);
        } else {
           await ctx.reply(`❌ Upload failed: ${uploadErr.message}`);
        }
      }

    } catch (error: any) {
      console.error("Torrent DL Error:", error);
      ctx.reply(`❌ Download failed: ${error.message}`);
    }
  });

  // Direct video upload to the bot or group
  bot.on("video", async (ctx) => {
    try {
      await ensureUser(ctx);
      const video = ctx.message.video;
      const media = {
        file_id: video.file_id,
        file_name: video.file_name,
        file_size: video.file_size,
        mime_type: video.mime_type || "video/mp4"
      };
      const uploadingMsg = await ctx.reply("⏳ Indexing video in Vault...");
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
      const media = extractVideoMedia(ctx.message);
      if (!media) {
        await ctx.reply("⚠️ Skipping file: Only video documents (.mp4, .mkv, etc) are supported for the Vault.");
        return;
      }
      const uploadingMsg = await ctx.reply("⏳ Indexing document in Vault...");
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
            `✅ <b>Telegram Movie Vault Channel Connected!</b>\n\n` +
            `📡 <b>Channel ID:</b> <code>${ctx.chat.id}</code>\n` +
            `📢 <b>Channel Title:</b> ${escapeHtml(chatTitle)}\n` +
            `⚡ <b>Vault Engine:</b> Listening for video uploads and indexing automatically!\n\n` +
            `Drop any movie (.mp4, .mkv) in this channel to save it to your Vault.`,
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
          `🎬 <b>Telegram Movie Vault Connected!</b>\n\n` +
          `📡 <b>Channel ID:</b> <code>${ctx.chat.id}</code>\n` +
          `✅ <b>Vault Sync:</b> Active\n\n` +
          `Whenever you post or forward movies (.mp4, .mkv), they will be automatically indexed into your Vault!`,
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

          let messageText = `🎬 <b>${escapeHtml(movie.title)}</b> ${movie.year ? `(${movie.year})` : ""}\n\n`;
          if (movie.overview) {
            messageText += `${escapeHtml(movie.overview.substring(0, 250))}...\n\n`;
          }

          if (inVault) {
            messageText += `✅ <b>Available in Vault!</b> Quality: ${libFiles.map(f => f.quality || "HD").join(", ")}\n🍿 Stream directly via the button below:`;
          } else {
            messageText += `📝 Not in vault yet. Tap below to request this title!`;
          }

          const botUsername = ctx.botInfo.username;
          
          const keyboard = inVault
            ? [[Markup.button.url("▶️ Watch in Bot", `https://t.me/${botUsername}?start=watch_${libFiles[0].id}`)]]
            : [[Markup.button.url("📝 Request Movie", `https://t.me/${botUsername}?start=req_${movie.id}`)]];

          const searchStr = encodeURIComponent(movie.title);
          keyboard.push([Markup.button.url("💬 Find Subtitles", `https://subdl.com/subtitle/search?q=${searchStr}`)]);

          return {
            type: "article" as const,
            id: movie.id,
            title: `${movie.title} ${movie.year ? `(${movie.year})` : ""} ${inVault ? "🟢 [In Vault]" : ""}`,
            description: movie.overview ? movie.overview.substring(0, 90) : (movie.cast || "Movie"),
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
        `📡 <b>Telegram Movie Vault Channel Sync</b>\n\n` +
        `• <b>Bot Username:</b> @${botUser}\n` +
        `• <b>Chat ID:</b> <code>${ctx.chat.id}</code>\n` +
        `• <b>Chat Type:</b> ${ctx.chat.type}\n\n` +
        `<b>To connect your private channel:</b>\n` +
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
        const sentMsg = await ctx.reply(
          `📝 <b>Subtitles for:</b> <i>${escapeHtml(subTitle)}</i>\n\n` +
          `Choose a provider below to download your subtitle file (.srt / .zip):\n\n` +
          `⚠️ <i>This message will self-destruct in 2 minutes.</i>`,
          { parse_mode: "HTML", ...keyboard }
        );
        setTimeout(() => {
          ctx.telegram.deleteMessage(ctx.chat.id, sentMsg.message_id).catch(() => {});
        }, 120000);
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
    // Log search
    try {
      await db.execute({
        sql: "INSERT INTO searches (telegram_id, query) VALUES (?, ?)",
        args: [ctx.from.id.toString(), query]
      });
    } catch (e) {
      console.error("Failed to log search:", e);
    }

    const waitMsg = await ctx.reply("🔍 Searching your Vault and catalog...");

    // 1. Check Vault FIRST! If user uploaded this movie, give them instant access!
    const directVaultFiles = await searchVaultFilesDirect(query);
    
    if (directVaultFiles.length > 0) {
      await ctx.telegram.deleteMessage(ctx.chat.id, waitMsg.message_id).catch(() => {});

      // Group files by cleaned movie_title
      const groups = new Map<string, typeof directVaultFiles>();
      for (const f of directVaultFiles) {
        const key = f.movie_title.trim();
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(f);
      }

      let renderedCount = 0;
      for (const [title, files] of groups.entries()) {
        if (renderedCount >= 3) break;
        renderedCount++;

        const first = files[0];
        const year = first.year ? `(${first.year})` : "";
        const isSeries = files.some(f => f.season !== null && f.season !== undefined);

        let caption = `🍿 <b>[VAULT READY]</b>\n🎬 <b>${escapeHtml(title)}</b> ${escapeHtml(year)}\n\n`;
        if (isSeries) {
          caption += `📺 <b>Episodes in Vault:</b> ${files.length}\n`;
        } else {
          caption += `💿 <b>Available Qualities:</b> ${files.map(f => f.quality || "HD").join(", ")}\n`;
        }
        caption += `⚡ <i>Available right now for instant streaming & download!</i>\n\n`;

        const buttons: any[] = [];

        if (isSeries) {
          // Sort episodes chronologically
          files.sort((a, b) => ((a.season || 0) * 1000 + (a.episode || 0)) - ((b.season || 0) * 1000 + (b.episode || 0)));
          // Group into rows of 2 buttons for clean Telegram layout
          let currentRow: any[] = [];
          for (const file of files) {
            const epLabel = (file.season && file.episode) ? `S${file.season}E${file.episode}` : `Ep ${file.id}`;
            currentRow.push(Markup.button.callback(`▶️ ${epLabel} (${file.quality || "HD"})`, `watch_${file.id}`));
            if (currentRow.length === 2) {
              buttons.push(currentRow);
              currentRow = [];
            }
          }
          if (currentRow.length > 0) {
            buttons.push(currentRow);
          }
        } else {
          for (const file of files) {
            buttons.push([
              Markup.button.callback(
                `▶️ Watch (${file.quality || "HD"}) • ${formatFileSize(file.file_size || 0)}`,
                `watch_${file.id}`
              )
            ]);
          }
        }

        // Subtitles & trailer buttons
        const searchStr = encodeURIComponent(title);
        buttons.push([
          Markup.button.url("💬 Subtitles", `https://subdl.com/subtitle/search?q=${searchStr}`),
          Markup.button.url("🌐 OpenSubtitles", `https://www.opensubtitles.org/en/search/sublanguageid-all/searchonlymovies-on/moviename-${searchStr}`)
        ]);

        let trailerUrl = files.find(f => f.trailer_url)?.trailer_url;
        if (!trailerUrl) {
          try {
            const trailer = await getOfficialTrailer(title, first.year);
            trailerUrl = trailer?.url;
          } catch {}
        }
        if (trailerUrl) {
          buttons.push([Markup.button.url("🎬 Watch Official Trailer", trailerUrl)]);
        }

        caption += `⚠️ <i>This card will self-destruct in 2 minutes.</i>`;
        const keyboard = Markup.inlineKeyboard(buttons);

        let poster = first.poster_url;
        if (!poster) {
          try {
            const meta = await searchMovies(title);
            if (meta && meta[0]?.poster_path) {
              poster = meta[0].poster_path;
              first.poster_url = poster;
              db.execute({ sql: "UPDATE media_files SET poster_url = ? WHERE id = ?", args: [poster, first.id] }).catch(() => {});
            }
          } catch {}
        }

        let sentMsg: any;
        if (poster) {
          const imageUrl = poster.startsWith("http") ? poster : `https://image.tmdb.org/t/p/w500${poster}`;
          try {
            sentMsg = await ctx.replyWithPhoto(imageUrl, { caption, parse_mode: "HTML", ...keyboard });
          } catch {
            sentMsg = await ctx.reply(caption, { parse_mode: "HTML", ...keyboard });
          }
        } else {
          sentMsg = await ctx.reply(caption, { parse_mode: "HTML", ...keyboard });
        }

        if (sentMsg?.message_id) {
          setTimeout(() => {
            ctx.telegram.deleteMessage(ctx.chat.id, sentMsg.message_id).catch(() => {});
          }, 120000);
        }
      }
      return;
    }

    // 2. If not found directly in Vault, route via AI intent & external metadata catalog
    const intentResult = await analyzeUserIntent(query, "User is interacting via Telegram bot. Vault has media.");
    console.log(`[BusiMovie Intent]: ${intentResult.intent} (Conf: ${intentResult.confidence}) -> Target: ${intentResult.mediaTitle}`);

    if (intentResult.intent === "search_library" || intentResult.intent === "request_media" || (intentResult.intent === "general_chat" && intentResult.mediaTitle)) {
      const targetQuery = intentResult.mediaTitle || query;
      
      try {
        const results = await searchMovies(targetQuery);
        await ctx.telegram.deleteMessage(ctx.chat.id, waitMsg.message_id).catch(() => {});
        
        if (results.length === 0) {
          const noMatchMsg = await ctx.reply(
            `I understood you are looking for "${targetQuery}", but I couldn't find any exact matches in Vault or catalogs.\n\n` +
            `• Check spelling or try a shorter title\n` +
            `• Or send /request to queue automated crawler fulfillment!`,
            { parse_mode: "HTML" }
          );
          setTimeout(() => {
            ctx.telegram.deleteMessage(ctx.chat.id, noMatchMsg.message_id).catch(() => {});
          }, 120000);
          return;
        }

        if (intentResult.aiResponse && intentResult.confidence > 0.6) {
          const aiMsg = await ctx.reply(intentResult.aiResponse);
          if (aiMsg?.message_id) {
            setTimeout(() => {
              ctx.telegram.deleteMessage(ctx.chat.id, aiMsg.message_id).catch(() => {});
            }, 120000);
          }
        }

        const topResults = results.slice(0, 3);
        for (const movie of topResults) {
          titleCache.set(movie.id, movie.title);

          const title = movie.title || "Unknown Title";
          const year = movie.year ? `(${movie.year})` : "";
          const type = movie.media_type ? `• ${movie.media_type}` : "";
          const castLine = movie.cast ? `👥 <b>Cast:</b> ${escapeHtml(movie.cast)}\n\n` : "";
          
          let caption = `🎬 <b>${escapeHtml(title)}</b> ${escapeHtml(year)} ${escapeHtml(type)}\n\n`;
          if (castLine) {
            caption += castLine;
          }
          if (movie.overview) {
            const shortOverview = movie.overview.length > 250
              ? movie.overview.substring(0, 245) + "..."
              : movie.overview;
            caption += `${escapeHtml(shortOverview)}\n\n`;
          }

          const libraryFiles = await getMediaFilesForMovie(movie.id, movie.title);

          const buttons: any[] = [];
          if (libraryFiles.length > 0) {
            for (const file of libraryFiles) {
              const epText = (file.season && file.episode) ? `S${file.season}E${file.episode} ` : "";
              buttons.push([
                Markup.button.callback(
                  `▶️ Watch ${epText}(${file.quality || "HD"}) • ${formatFileSize(file.file_size || 0)}`,
                  `watch_${file.id}`
                )
              ]);
            }
          } else {
            buttons.push([
              Markup.button.callback("📝 Request Movie", `request_${movie.id}`)
            ]);
            
            // Phase 6 POC: Open Tracker / Torrent Fetch
            const torrents = await searchOpenTracker(movie.title);
            if (torrents.length > 0) {
              const t = torrents[0];
              buttons.push([
                Markup.button.callback(`⬇️ Direct Download POC (${t.quality})`, `dl_${t.hash}`)
              ]);
            }
          }

          // Subtitle links directly on every search card!
          const searchStr = encodeURIComponent(title);
          buttons.push([
            Markup.button.url("💬 Subtitles (Subdl)", `https://subdl.com/subtitle/search?q=${searchStr}`),
            Markup.button.url("🌐 OpenSubtitles", `https://www.opensubtitles.org/en/search/sublanguageid-all/searchonlymovies-on/moviename-${searchStr}`)
          ]);

          // Auto-Trailer: Attach official trailer button directly on movie card!
          let trailerUrl = libraryFiles.find(f => f.trailer_url)?.trailer_url;
          if (!trailerUrl) {
            try {
              const trailer = await getOfficialTrailer(title, movie.year);
              trailerUrl = trailer?.url;
            } catch {}
          }
          if (trailerUrl) {
            buttons.push([Markup.button.url("🎬 Watch Official Trailer", trailerUrl)]);
          }

          caption += `⚠️ <i>This card will self-destruct in 2 minutes.</i>`;

          const keyboard = Markup.inlineKeyboard(buttons);

          let sentMsg: any;
          if (movie.poster_path) {
            const imageUrl = movie.poster_path.startsWith("http")
              ? movie.poster_path
              : `https://image.tmdb.org/t/p/w500${movie.poster_path}`;

            try {
              sentMsg = await ctx.replyWithPhoto(imageUrl, { caption, parse_mode: "HTML", ...keyboard });
            } catch (imgError) {
              sentMsg = await ctx.reply(caption, { parse_mode: "HTML", ...keyboard });
            }
          } else {
            sentMsg = await ctx.reply(caption, { parse_mode: "HTML", ...keyboard });
          }

          if (sentMsg?.message_id) {
            setTimeout(() => {
              ctx.telegram.deleteMessage(ctx.chat.id, sentMsg.message_id).catch(() => {});
            }, 120000);
          }
        }
      } catch (err) {
        console.error("Search try-catch error:", err);
        await ctx.telegram.deleteMessage(ctx.chat.id, waitMsg.message_id).catch(() => {});
        await ctx.reply("Sorry, I encountered an error searching for that.");
      }
    } else if (intentResult.intent === "recommend_content") {
      await ctx.telegram.deleteMessage(ctx.chat.id, waitMsg.message_id).catch(() => {});
      const vaultTitles = await getAllVaultTitles();
      const recs = await getAIMovieRecommendations(query, vaultTitles);
      
      const recMsg = await ctx.reply(recs.recommendation + "\n\n⚠️ <i>This recommendation will self-destruct in 2 minutes.</i>", { parse_mode: "HTML" });
      setTimeout(() => {
        ctx.telegram.deleteMessage(ctx.chat.id, recMsg.message_id).catch(() => {});
      }, 120000);
      
      if (recs.suggestedTitles.length > 0) {
        const results = await searchMovies(recs.suggestedTitles[0]);
        if (results.length > 0) {
          const topMatch = results[0];
          titleCache.set(topMatch.id, topMatch.title);
          
          let caption = `🎬 <b>${escapeHtml(topMatch.title)}</b> ${topMatch.year ? `(${escapeHtml(topMatch.year)})` : ""}\n\n`;
          if (topMatch.overview) {
            caption += `${escapeHtml(topMatch.overview.substring(0, 250))}...\n\n`;
          }

          const libraryFiles = await getMediaFilesForMovie(topMatch.id, topMatch.title);
          const buttons: any[] = [];
          if (libraryFiles.length > 0) {
            buttons.push([Markup.button.callback(`▶️ Watch Now`, `watch_${libraryFiles[0].id}`)]);
          } else {
            buttons.push([Markup.button.callback("📝 Request Movie", `request_${topMatch.id}`)]);
          }
          
          const searchStr = encodeURIComponent(topMatch.title);
          buttons.push([
            Markup.button.url("💬 Subtitles (Subdl)", `https://subdl.com/subtitle/search?q=${searchStr}`),
            Markup.button.url("🌐 OpenSubtitles", `https://www.opensubtitles.org/en/search/sublanguageid-all/searchonlymovies-on/moviename-${searchStr}`)
          ]);

          caption += `⚠️ <i>This card will self-destruct in 2 minutes.</i>`;

          const keyboard = Markup.inlineKeyboard(buttons);
          
          let topMsg: any;
          if (topMatch.poster_path) {
             const imgUrl = topMatch.poster_path.startsWith("http") ? topMatch.poster_path : `https://image.tmdb.org/t/p/w500${topMatch.poster_path}`;
             topMsg = await ctx.replyWithPhoto(imgUrl, { caption, parse_mode: "HTML", ...keyboard }).catch(() => ctx.reply(caption, { parse_mode: "HTML", ...keyboard }));
          } else {
             topMsg = await ctx.reply(caption, { parse_mode: "HTML", ...keyboard });
          }

          if (topMsg?.message_id) {
            setTimeout(() => {
              ctx.telegram.deleteMessage(ctx.chat.id, topMsg.message_id).catch(() => {});
            }, 120000);
          }
        }
      }
    } else {
      // check_status or general_chat
      await ctx.telegram.deleteMessage(ctx.chat.id, waitMsg.message_id).catch(() => {});
      
      const buttons = [
        [
          Markup.button.callback("🍿 AI Recommendations", "ai_recs"),
          Markup.button.callback("🎲 Surprise Me", "surprise_me")
        ]
      ];
      const keyboard = Markup.inlineKeyboard(buttons);

      let chatMsg: any;
      const aiText = intentResult.aiResponse || "I'm your Movie Vault AI concierge! Type any movie title to search or ask for a recommendation.";
      
      try {
        chatMsg = await ctx.reply(
          `${aiText}\n\n⚠️ <i>This message will self-destruct in 2 minutes.</i>`,
          { parse_mode: "HTML", ...keyboard }
        );
      } catch (err) {
        // Fallback without parse_mode if HTML entities caused parsing issue
        chatMsg = await ctx.reply(aiText, keyboard).catch(() => {});
      }

      if (chatMsg?.message_id) {
        setTimeout(() => {
          ctx.telegram.deleteMessage(ctx.chat.id, chatMsg.message_id).catch(() => {});
        }, 120000);
      }
    }
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
        buttons.push([Markup.button.callback(`▶️ Watch ${title} (In Vault)`, `watch_${inVaultFiles[0].id}`)]);
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
