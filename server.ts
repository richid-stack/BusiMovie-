import { BOT_ALLOWED_UPDATES } from "./src/bot/updates.js";
import express from "express";
import path from "path";
import { fetchNow, submitJob, startCrawlWorker, PRIORITY } from "./src/crawler/service.js";
import { getTraces, listJobs, getJob } from "./src/crawler/jobs.js";
import { createServer as createViteServer } from "vite";
import {
  setupDatabase,
  db,
  getAllMediaFiles,
  getDatabaseInfo,
  purgeExpiredCallbacks,
  addMediaFile,
  deleteMediaFile,
  getChannelLogs,
  getPendingRequests,
  markRequestsFulfilled,
  getAllUsers,
  getRandomMediaFile,
  getAllVaultTitles,
  getCollections,
  createCollection,
  addFileToCollection,
  removeFileFromCollection,
  getCollectionItems,
  importVaultData,
  getVaultCatalogGrouped,
  getVaultSeriesCatalog,
  getSeriesSeasonEpisodes,
  sanitizeAndStructureAllSeries
} from "./src/db/index.js";
import {
  initializeBot,
  notifyRequestingUsers,
  recentTelegramUpdates,
  publishMovieToTelegramChannel,
  broadcastAnnouncement,
  sendSmartReEngagementBroadcast,
  getBotWebhookInfo,
  setBotWebhook,
  deleteBotWebhook,
  getBotInstance
} from "./src/bot/index.js";
import { startChannelWatcher, scheduleReconcile, targetStats, watcherState } from "./src/crawler/channels.js";
import { getGateSettings, saveGateSettings, listGateChannels, addGateChannel, updateGateChannel, deleteGateChannel, normalizeChatRef, gateStats, joinLinkOf } from "./src/bot/gate.js";
import { inspectChannel, ensureInviteLink } from "./src/bot/gateAdmin.js";
import { workerHealth, probeBot, pressBotButton } from "./src/crawler/service.js";
import { recentAlerts } from "./src/services/alerts.js";
import { banViewer, findViewer, getDailyCap, listBans, moderationStats, setDailyCap, takedownTitle, unbanViewer } from "./src/services/moderation.js";
import { listBlocks, unblock } from "./src/crawler/blocklist.js";
import { botHealthMap } from "./src/crawler/botHealth.js";
import { rebuildState, startRebuild } from "./src/crawler/rebuild.js";
import { digestSettings, previewDigest, sendDigest, setDigestEnabled } from "./src/bot/digest.js";
import { isAdminTelegramId } from "./src/server/auth.js";
import { addWish, listWishes, updateWish, deleteWish, runWishNow, parseSeriesLine, startWishlistRunner } from "./src/crawler/wishlist.js";
import { getCrawlerSettings, saveCrawlerSettings } from "./src/crawler/settings.js";
import { recordView, recentViews, viewKey, purgeOldViews } from "./src/db/views.js";
import { getAIMovieRecommendations } from "./src/services/gemini.js";
import {
  registerAuthRoutes,
  apiGate,
  verifyWebhookRequest,
  getWebhookSecret,
  createRateLimiter,
  clientIp,
  getSessionFromRequest
} from "./src/server/auth.js";
import { searchMovies } from "./src/services/movieProvider.js";
import { getOfficialTrailer } from "./src/services/trailerService.js";
import * as pdfModule from "pdf-parse";

async function parsePdfBufferToText(buffer: Buffer): Promise<string> {
  try {
    if (typeof (pdfModule as any).PDFParse === "function") {
      const PDFParse = (pdfModule as any).PDFParse;
      const parser = new PDFParse({ data: buffer });
      if (typeof parser.load === "function") {
        await parser.load();
      }
      if (typeof parser.getText === "function") {
        const res = await parser.getText();
        return typeof res === "string" ? res : (res?.text || "");
      }
    }

    const fn = typeof pdfModule === "function" ? pdfModule : (pdfModule as any).default;
    if (typeof fn === "function") {
      const res = await fn(buffer);
      return res?.text || "";
    }
  } catch (err: any) {
    console.warn("[PDFParse] Extraction error:", err.message);
  }
  return "";
}

import {
  initCrawlerService,
  getCrawlerStatus,
  getCrawlerTargets,
  addCrawlerTarget,
  updateCrawlerTarget,
  deleteCrawlerTarget,
  runChannelBackfill,
  getSearchBots,
  addSearchBot,
  updateSearchBot,
  deleteSearchBot,
  getCrawlerLogs,
  requestAuxiliaryLoginCode,
  verifyAuxiliaryLoginCode,
  disconnectAuxiliarySession,
  getAuxiliarySessionStatus,
  saveDirectSessionString,
  setEffectiveVaultChannelId,
  setEffectiveSeriesVaultChannelId,
  getJoinedDialogs,
  parseAndQueueCsvMovies,
  processCronBatch,
  configureCronJob,
  stopAllCronJobs,
  getCronStatus,
  getCronBatchQueue,
  clearCronBatchQueue,
  requeueBatchQueue
} from "./src/services/crawlerService.js";

// A network hiccup in a background task (Telegram, Firestore, external bots) must never take the whole server down.
process.on("unhandledRejection", (reason: any) => {
  console.error("[unhandledRejection]", reason?.message || reason);
});
process.on("uncaughtException", (err: any) => {
  console.error("[uncaughtException]", err?.message || err);
});

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Behind Cloud Run / AI Studio proxy: trust X-Forwarded-* so req.ip and req.secure are correct
  app.set("trust proxy", 1);

  // Middleware for JSON
  app.use(express.json({ limit: "10mb" }));

  // Ensure all /api responses have JSON content-type
  app.use("/api", (req, res, next) => {
    res.setHeader("Content-Type", "application/json");
    next();
  });

  // ---- Security: every /api route is ADMIN-ONLY unless listed in src/server/auth.ts PUBLIC_ROUTES ----
  registerAuthRoutes(app, () => (bot as any)?.botInfo?.username || cachedBotUsername);
  app.use("/api", apiGate);

  // ---- Public-data helpers ----
  const INTERNAL_KEYS = new Set(["telegram_file_id", "telegram_channel_id", "telegram_message_id"]);
  const stripInternal = (value: any): any => {
    if (Array.isArray(value)) return value.map(stripInternal);
    if (value && typeof value === "object") {
      const out: any = {};
      for (const [k, v] of Object.entries(value)) {
        if (INTERNAL_KEYS.has(k)) continue;
        out[k] = stripInternal(v);
      }
      return out;
    }
    return value;
  };
  const isAdminRequest = (req: any) => !!getSessionFromRequest(req);

  // Public requests are limited per IP, and never crawl inline (they go through a single sequential queue)
  const requestLimiter = createRateLimiter({ windowMs: 24 * 60 * 60 * 1000, max: 5, keyPrefix: "request" });
  const searchLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 40, keyPrefix: "search" });
  const viewLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 60, keyPrefix: "view" });
  const seenViews = new Map<string, number>(); // ip+title -> last counted (ms): one view per viewer per title per 30 min
  app.use("/api/search-test", searchLimiter.middleware());
  app.use("/api/trailer", searchLimiter.middleware());

  // Public visitors never trigger a crawl inline: the title joins the single durable queue.
  const enqueueAutoFetch = (title: string, userId: string) => {
    void submitJob({ kind: "movie", title, priority: PRIORITY.user, source: "web", requestedBy: userId }).catch((e) => console.warn("[AutoFetch] enqueue failed:", e?.message));
  };

  // Database initialization state
  let dbReady = false;
  setupDatabase()
    .then(async () => {
      dbReady = true;
      console.log("Database initialized.");
      await initCrawlerService();
      await startCrawlWorker();
      startChannelWatcher();
      startWishlistRunner();
      purgeOldViews().catch(() => {});
    })
    .catch((err) => {
      console.error("Database setup error:", err);
    });

  // Telegram Bot initialization & Dual Mode (24/7 Webhook or Long Polling)
  let bot: any = null;
  let cachedBotUsername: string | undefined;
  let botActive = false;
  let botMode: "polling" | "webhook" | "inactive" = "inactive";

  try {
    bot = initializeBot();
    if (bot) {
      // Check if Telegram currently has a webhook configured
      bot.telegram
        .getWebhookInfo()
        .then(async (info: any) => {
          try {
            const me = await bot.telegram.getMe();
            cachedBotUsername = me?.username;
          } catch (_) {}
          if (info?.url) {
            botActive = true;
            botMode = "webhook";
            console.log(`[Telegram Bot] Webhook active at: ${info.url}`);
            // Make sure the registered webhook carries our secret token (older webhooks had none).
            try {
              await bot.telegram.setWebhook(info.url, {
                secret_token: getWebhookSecret(),
                drop_pending_updates: false,
                allowed_updates: [...BOT_ALLOWED_UPDATES]
              });
              console.log("[Telegram Bot] Webhook re-registered with secret token.");
            } catch (e: any) {
              console.warn("[Telegram Bot] Could not refresh webhook secret:", e?.message || e);
            }
          } else {
            // Launch polling if no webhook is registered
            botActive = true;
            botMode = "polling";
            bot
              .launch({
                allowedUpdates: [...BOT_ALLOWED_UPDATES]
              })
              .then(() => {
                console.log("[Telegram Bot] Successfully launched and listening in Long Polling mode.");
              })
              .catch((err: any) => {
                const errMsg = String(err?.message || err);
                if (errMsg.includes("Conflict") && errMsg.includes("setWebhook")) {
                  botActive = true;
                  botMode = "webhook";
                  console.log("[Telegram] Webhook mode detected on conflict.");
                } else {
                  botActive = false;
                  botMode = "inactive";
                  console.error("Failed to run polling bot:", errMsg);
                }
              });
          }
        })
        .catch((err: any) => {
          console.error("Failed to check webhook / start bot:", err?.message || err);
        });
    } else {
      console.log("Telegram bot initialization skipped (missing token).");
    }
  } catch (botErr: any) {
    console.error("Bot initialization error:", botErr?.message || botErr);
  }

  // Telegram Inbound Webhook Endpoint (Called directly by Telegram for 24/7 responsiveness)
  app.post("/api/telegram-webhook", async (req, res) => {
    if (!bot) {
      return res.status(503).json({ error: "Bot not initialized" });
    }
    // Only Telegram knows this secret (it is registered with setWebhook). Rejects forged updates.
    if (!verifyWebhookRequest(req)) {
      return res.status(401).json({ error: "Invalid webhook secret" });
    }
    try {
      await bot.handleUpdate(req.body, res);
      if (!res.headersSent) {
        res.status(200).send("OK");
      }
    } catch (webhookErr: any) {
      console.error("[Telegram Webhook Error]:", webhookErr?.message || webhookErr);
      if (!res.headersSent) {
        res.status(500).send("Error");
      }
    }
  });

  // Telegram Webhook Management APIs
  app.get("/api/telegram/webhook-status", async (req, res) => {
    if (!bot) {
      return res.json({ active: false, mode: "disabled", error: "TELEGRAM_BOT_TOKEN is not configured" });
    }
    try {
      const info = await getBotWebhookInfo(bot);
      const appUrl = process.env.APP_URL || `${req.protocol}://${req.get("host")}`;
      
      // If Telegram reports a valid webhook registered, the bot is running in webhook mode
      if (info?.url) {
        botActive = true;
        botMode = "webhook";
      }

      res.json({
        active: botActive,
        mode: botMode,
        webhookInfo: info,
        detectedAppUrl: appUrl
      });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || "Failed to get webhook info" });
    }
  });

  app.post("/api/telegram/set-webhook", async (req, res) => {
    if (!bot) return res.status(400).json({ error: "Telegram bot is not configured." });
    try {
      const targetUrl = req.body?.url?.trim() || process.env.APP_URL;
      if (!targetUrl || !targetUrl.startsWith("http")) {
        return res.status(400).json({ 
          error: "A valid public HTTPS URL is required to set up a Telegram webhook." 
        });
      }

      // Stop polling before activating webhook if currently polling
      if (botMode === "polling") {
        try {
          bot.stop("SWITCHING_TO_WEBHOOK");
        } catch (stopErr) {
          // ignore
        }
      }

      const result = await setBotWebhook(bot, targetUrl);
      botActive = true;
      botMode = "webhook";
      res.json({ success: true, mode: "webhook", url: result.url });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || "Failed to configure webhook with Telegram" });
    }
  });

  app.post("/api/telegram/delete-webhook", async (req, res) => {
    if (!bot) return res.status(400).json({ error: "Telegram bot is not configured." });
    try {
      await deleteBotWebhook(bot);

      // Re-enable polling
      bot.launch({
        allowedUpdates: [...BOT_ALLOWED_UPDATES]
      }).catch((launchErr: any) => console.warn("Polling restart:", launchErr?.message));

      botActive = true;
      botMode = "polling";
      res.json({ success: true, mode: "polling" });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || "Failed to switch back to polling" });
    }
  });

  // Add a graceful stop handler for the bot
  process.once("SIGINT", () => bot?.stop("SIGINT"));
  process.once("SIGTERM", () => bot?.stop("SIGTERM"));

  // API endpoints for the dashboard
  app.get("/api/status", async (req, res) => {
    try {
      let usersCount = 0;
      let searchesCount = 0;
      let requestsCount = 0;
      let pendingRequestsCount = 0;
      let libraryCount = 0;
      let totalLibrarySize = 0;
      let requests: any[] = [];
      let recentLogs: any[] = [];

      if (dbReady) {
        try {
          usersCount = (await db.execute("SELECT COUNT(*) as count FROM users")).rows[0]?.count as number || 0;
          searchesCount = (await db.execute("SELECT COUNT(*) as count FROM searches")).rows[0]?.count as number || 0;
          requestsCount = (await db.execute("SELECT COUNT(*) as count FROM requests")).rows[0]?.count as number || 0;
          const pendingRes = await db.execute("SELECT COUNT(*) as count FROM requests WHERE status = 'pending'");
          pendingRequestsCount = (pendingRes.rows[0]?.count as number) || 0;

          const libStat = (await db.execute("SELECT COUNT(*) as count, SUM(file_size) as total_size FROM media_files")).rows[0];
          libraryCount = (libStat?.count as number) || 0;
          totalLibrarySize = (libStat?.total_size as number) || 0;
          requests = (await db.execute("SELECT * FROM requests ORDER BY created_at DESC LIMIT 10")).rows || [];
          recentLogs = await getChannelLogs(10);
        } catch (dbErr) {
          console.warn("DB query warning:", dbErr);
        }
      }

      const provider = process.env.OMDB_API_KEY
        ? "OMDb API (Active)"
        : process.env.TMDB_API_KEY
        ? "TMDB API (Active)"
        : "IMDb + TVmaze (Built-in Zero-Key)";

      res.json({
        botRunning: botActive || !!bot,
        hasTelegramToken: !!process.env.TELEGRAM_BOT_TOKEN,
        metadataProvider: provider,
        metadataReady: true,
        database: getDatabaseInfo(),
        stats: {
          users: usersCount,
          searches: searchesCount,
          requests: requestsCount,
          pendingRequests: pendingRequestsCount,
          libraryFiles: libraryCount,
          totalVaultBytes: totalLibrarySize,
        },
        recentRequests: requests,
        recentLogs,
        worker: workerHealth(),
        alerts: recentAlerts(),
        recentUpdates: recentTelegramUpdates
      });
    } catch (error: any) {
      console.error("Status endpoint error:", error);
      res.status(500).json({ error: "Failed to fetch status" });
    }
  });


  // Telegram Library Endpoints (Phase 2 & TV Series Grouping)
  app.get("/api/library", async (req, res) => {
    try {
      const q = req.query.q as string | undefined;
      const raw = req.query.raw === "true";

      if (raw) {
        if (!isAdminRequest(req)) return res.status(401).json({ error: "Admin login required", code: "AUTH_REQUIRED" });
        const files = await getAllMediaFiles();
        return res.json({ count: files.length, files });
      }

      // Grouped view: TV series grouped as 1 entry per show with seasons & episodes, Movies with qualities
      const files = await getVaultCatalogGrouped(q);
      try {
        const views = await recentViews(7);
        for (const f of files as any[]) f.views = views.get(viewKey(f.movie_title || "")) || 0;
      } catch { /* views are cosmetic */ }

      // Auto-populate poster_url for items missing posters in background without blocking response
      setTimeout(async () => {
        for (const file of files.slice(0, 20)) {
          if (!file.poster_url && file.movie_title) {
            try {
              const results = await searchMovies(file.movie_title);
              if (results && results.length > 0 && results[0].poster_path) {
                file.poster_url = results[0].poster_path;
                await db.execute({
                  sql: "UPDATE media_files SET poster_url = ? WHERE LOWER(movie_title) = LOWER(?) AND (poster_url IS NULL OR poster_url = '')",
                  args: [file.poster_url, file.movie_title]
                });
              }
            } catch (e) {
              // ignore
            }
          }
        }
      }, 0);

      res.json({ count: files.length, files: isAdminRequest(req) ? files : stripInternal(files) });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Anonymous "someone opened this title" ping from the storefront; feeds Top 10 this week
  app.post("/api/library/view", async (req, res) => {
    try {
      if (!viewLimiter.hit(clientIp(req)).allowed) return res.status(429).json({ ok: false });
      const title = String(req.body?.title || "");
      const k = `${clientIp(req)}|${viewKey(title)}`;
      const last = seenViews.get(k) || 0;
      if (Date.now() - last < 30 * 60 * 1000) return res.json({ ok: true, counted: false });
      if (seenViews.size > 5000) seenViews.clear();
      seenViews.set(k, Date.now());
      res.json({ ok: true, counted: await recordView(title) });
    } catch (err: any) {
      res.status(500).json({ ok: false });
    }
  });

  // Series Specific APIs
  app.get("/api/series", async (req, res) => {
    try {
      const q = req.query.q as string | undefined;
      const catalog = await getVaultSeriesCatalog(q);
      res.json(isAdminRequest(req) ? catalog : stripInternal(catalog));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/series/:title/episodes", async (req, res) => {
    try {
      const title = req.params.title;
      const season = req.query.season ? parseInt(req.query.season as string, 10) : undefined;
      if (season) {
        const episodes = await getSeriesSeasonEpisodes(title, season);
        return res.json(isAdminRequest(req) ? episodes : stripInternal(episodes));
      }
      const allFiles = await getAllMediaFiles();
      const episodes = allFiles.filter(f => f.movie_title.toLowerCase().trim() === title.toLowerCase().trim() && f.season !== null && f.season !== undefined)
        .sort((a, b) => ((Number(a.season) || 0) * 1000 + (Number(a.episode) || 0)) - ((Number(b.season) || 0) * 1000 + (Number(b.episode) || 0)));
      res.json(isAdminRequest(req) ? episodes : stripInternal(episodes));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/series/rescan", async (req, res) => {
    try {
      const result = await sanitizeAndStructureAllSeries();
      res.json({ success: true, ...result });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/library/add", async (req, res) => {
    try {
      const { movie_id, movie_title, year, telegram_file_id, quality, file_size, file_name, season, episode, poster_url } = req.body;
      let { trailer_url } = req.body;
      if (!movie_title || !telegram_file_id) {
        return res.status(400).json({ error: "movie_title and telegram_file_id are required" });
      }

      if (!trailer_url) {
        try {
          const trailer = await getOfficialTrailer(movie_title, year);
          trailer_url = trailer?.url || null;
        } catch {
          // ignore
        }
      }

      const insertId = await addMediaFile({
        movie_id: movie_id || `tt_${Date.now()}`,
        movie_title,
        year: year || "",
        telegram_file_id,
        quality: quality || "1080p",
        file_size: file_size || 1500000000,
        file_name: file_name || `${movie_title}.${quality || "1080p"}.mp4`,
        language: "English",
        mime_type: "video/mp4",
        season: season ? parseInt(season, 10) : undefined,
        episode: episode ? parseInt(episode, 10) : undefined,
        poster_url: poster_url || null,
        trailer_url: trailer_url || null
      });

      // Phase 3: Automatically notify users who requested this movie
      if (bot) {
        await notifyRequestingUsers(bot, movie_title, insertId, quality || "1080p", year, trailer_url);
      }

      res.json({ success: true, id: insertId, trailer_url });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Auto-Trailer Endpoint (YouTube scraper + TMDB fallback, 100% keyless ready)
  app.get("/api/trailer", async (req, res) => {
    try {
      const title = req.query.title as string;
      const year = req.query.year as string | undefined;
      if (!title) {
        return res.status(400).json({ error: "title parameter is required" });
      }
      const trailer = await getOfficialTrailer(title, year);
      res.json(trailer || { title, url: null, source: "none" });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/library/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const success = await deleteMediaFile(id);
      res.json({ success });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Vault Backup Export endpoint
  app.get("/api/library/export", async (req, res) => {
    try {
      const files = await getAllMediaFiles();
      res.setHeader("Content-Disposition", "attachment; filename=\"vault_backup.json\"");
      res.json(files);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Vault Backup Import endpoint
  app.post("/api/library/import", async (req, res) => {
    try {
      const items = req.body;
      if (!Array.isArray(items)) {
        return res.status(400).json({ error: "Expected a JSON array of movie objects" });
      }
      const imported = await importVaultData(items);
      res.json({ success: true, count: imported });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Batch index movie titles (auto-fetches posters & metadata)
  app.post("/api/library/batch", async (req, res) => {
    try {
      const { titles } = req.body;
      if (!Array.isArray(titles)) {
        return res.status(400).json({ error: "Expected an array of movie titles" });
      }
      const results = [];
      for (const rawTitle of titles) {
        const clean = (typeof rawTitle === "string" ? rawTitle : rawTitle.title || "").trim();
        if (!clean) continue;
        
        let year = "";
        let posterUrl = "";
        try {
          const meta = await searchMovies(clean);
          if (meta && meta.length > 0) {
            posterUrl = meta[0].poster_path || "";
            year = meta[0].year || "";
          }
        } catch (e) {}

        const insertId = await addMediaFile({
          movie_id: `tt_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
          movie_title: clean,
          year: year,
          telegram_file_id: `BAACAgIAAxkBA_${Date.now()}`,
          telegram_channel_id: "",
          telegram_message_id: "",
          file_name: `${clean}.${year ? year + "." : ""}1080p.mp4`,
          file_size: 1800000000,
          quality: "1080p",
          language: "English",
          mime_type: "video/mp4",
          poster_url: posterUrl
        });
        results.push({ id: insertId, title: clean, poster_url: posterUrl });
      }
      res.json({ success: true, count: results.length, results });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Phase 3: Channel logs and auto-detection feed
  app.get("/api/channel/logs", async (req, res) => {
    try {
      const limit = parseInt((req.query.limit as string) || "30", 10);
      const logs = await getChannelLogs(limit);
      res.json({ count: logs.length, logs });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Phase 3: User requests management & manual fulfillment
  app.get("/api/requests", async (req, res) => {
    try {
      const pending = await getPendingRequests();
      const allRes = await db.execute("SELECT * FROM requests ORDER BY created_at DESC LIMIT 50");
      res.json({
        pendingCount: pending.length,
        pending,
        all: allRes.rows
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/requests/:id/fulfill", async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const reqRecord = (await db.execute({
        sql: "SELECT * FROM requests WHERE id = ?",
        args: [id]
      })).rows[0] as any;

      if (!reqRecord) {
        return res.status(404).json({ error: "Request not found" });
      }

      await markRequestsFulfilled([id]);

      // If bot is active, send direct notice to user
      if (bot && reqRecord.telegram_id) {
        try {
          const safeTitle = (reqRecord.title || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
          await bot.telegram.sendMessage(
            reqRecord.telegram_id,
            `🎉 <b>Great News! Your Requested Title is Ready!</b>\n\n🎬 <b>${safeTitle}</b> has been uploaded to the Vault!\nOpen the bot menu or search "${safeTitle}" to stream or download now!`,
            { parse_mode: "HTML" }
          );
        } catch (sendErr: any) {
          console.warn("Could not notify user on manual fulfillment:", sendErr?.message);
        }
      }

      res.json({ success: true, message: "Request marked fulfilled and user notified." });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Create request from Storefront/WebApp with optional auto-fetch
  app.post("/api/requests/create", async (req, res, next) => {
    // Anonymous visitors are rate limited per IP; admins are not.
    if (!isAdminRequest(req)) {
      const r = requestLimiter.hit(clientIp(req));
      if (!r.allowed) {
        res.setHeader("Retry-After", String(r.retryAfterSec));
        return res.status(429).json({ error: "You've reached today's request limit. Please try again tomorrow." });
      }
    }
    next();
  }, async (req, res) => {
    try {
      const { title, telegram_id, auto_fetch } = req.body;
      if (!title || !title.trim()) {
        return res.status(400).json({ error: "Movie title is required" });
      }
      const cleanTitle = String(title).trim().slice(0, 120);
      // Public callers can't impersonate a Telegram user (that would let them make the bot message anyone)
      const userId = isAdminRequest(req) ? (telegram_id || "web_user") : "web_user";

      // Check if already in vault
      const existing = (await db.execute({
        sql: "SELECT id, movie_title FROM media_files WHERE LOWER(movie_title) = LOWER(?) LIMIT 1",
        args: [cleanTitle]
      })).rows;

      if (existing.length > 0) {
        return res.json({ 
          alreadyInVault: true, 
          media: existing[0],
          message: `"${cleanTitle}" is already in the Vault!` 
        });
      }

      // Check if request already pending
      const pendingCheck = (await db.execute({
        sql: "SELECT id FROM requests WHERE LOWER(title) = LOWER(?) AND status = 'pending' LIMIT 1",
        args: [cleanTitle]
      })).rows;

      let reqId = pendingCheck[0]?.id;
      if (!reqId) {
        const ins = await db.execute({
          sql: "INSERT INTO requests (telegram_id, tmdb_id, title, status) VALUES (?, ?, ?, 'pending')",
          args: [userId, `req_${Date.now()}`, cleanTitle]
        });
        reqId = Number(ins.lastInsertRowid);
      }

      // If auto-fetch requested, dispatch search immediately
      let fetchResult: any = null;
      if (auto_fetch !== false) {
        if (isAdminRequest(req)) {
          fetchResult = await fetchNow(cleanTitle, userId);
        } else {
          // Public visitors never trigger a crawl inline: queue it (one at a time)
          enqueueAutoFetch(cleanTitle, userId);
        }
      }

      res.json({
        success: true,
        requestId: reqId,
        title: cleanTitle,
        autoFetch: fetchResult,
        message: fetchResult?.success 
          ? `"${cleanTitle}" was found and added!`
          : `Request received for "${cleanTitle}". We'll look for it and let you know.`
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 1-Click Auto-Fetch specific request using External Search Bots
  app.post("/api/requests/:id/auto-fetch", async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const reqRecord = (await db.execute({
        sql: "SELECT * FROM requests WHERE id = ?",
        args: [id]
      })).rows[0] as any;

      if (!reqRecord) {
        return res.status(404).json({ error: "Request not found" });
      }

      const result = await fetchNow(reqRecord.title, reqRecord.telegram_id);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ================= CRAWLER & SEARCH BOT AUTOMATION ROUTES =================
  app.get("/api/crawler/status", async (req, res) => {
    try {
      const status = await getCrawlerStatus();
      res.json(status);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Request Telegram login code sent directly to user's auxiliary phone
  app.post("/api/crawler/session/request-code", async (req, res) => {
    try {
      const { phone } = req.body;
      if (!phone) {
        return res.status(400).json({ error: "Phone number with country code is required (e.g. +1234567890)" });
      }
      const result = await requestAuxiliaryLoginCode(phone);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Verify the 5-digit code sent by Telegram & save session
  app.post("/api/crawler/session/verify-code", async (req, res) => {
    try {
      const { code, password } = req.body;
      if (!code) {
        return res.status(400).json({ error: "Verification code is required" });
      }
      const result = await verifyAuxiliaryLoginCode(code, password);
      scheduleReconcile();
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Disconnect auxiliary userbot
  app.post("/api/crawler/session/disconnect", async (req, res) => {
    try {
      await disconnectAuxiliarySession();
      res.json({ success: true, message: "Auxiliary session disconnected." });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Save raw StringSession if pasted directly
  app.post("/api/crawler/session/save-session", async (req, res) => {
    try {
      const { session } = req.body;
      if (!session) {
        return res.status(400).json({ error: "Session string is required" });
      }
      await saveDirectSessionString(session);
      scheduleReconcile();
      res.json({ success: true, message: "Session string saved successfully!" });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Update Movies Vault Channel ID
  app.post("/api/crawler/vault-channel", async (req, res) => {
    try {
      const { channel_id } = req.body;
      if (!channel_id) {
        return res.status(400).json({ error: "Channel ID is required (e.g. -1001234567890)" });
      }
      await setEffectiveVaultChannelId(channel_id);
      res.json({ success: true, message: "Movies Vault Channel ID saved!" });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Update TV Series Vault Channel ID
  app.post("/api/crawler/series-vault-channel", async (req, res) => {
    try {
      const { channel_id } = req.body;
      if (!channel_id) {
        return res.status(400).json({ error: "Channel ID is required (e.g. -1001234567890)" });
      }
      await setEffectiveSeriesVaultChannelId(channel_id);
      res.json({ success: true, message: "TV Series Vault Channel ID saved!" });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/crawler/targets", async (req, res) => {
    try {
      const targetsList = await getCrawlerTargets();
      const stats = await targetStats();
      const live = watcherState();
      res.json(targetsList.map((t: any) => ({ ...t, ingest: stats[t.id] || { saved: 0, skipped: 0, failed: 0, reasons: [] }, watch: live[t.id] || { live: false } })));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/crawler/targets", async (req, res) => {
    try {
      const { channel_identifier, title, min_file_size_mb, quality_filter } = req.body;
      if (!channel_identifier) {
        return res.status(400).json({ error: "channel_identifier is required (e.g. @MoviesChannel or link)" });
      }
      const created = await addCrawlerTarget({
        channel_identifier,
        title: title || channel_identifier,
        min_file_size_mb: min_file_size_mb ? parseInt(min_file_size_mb, 10) : 500,
        quality_filter: quality_filter || "all"
      });
      scheduleReconcile();
      res.json({ success: true, target: created });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put("/api/crawler/targets/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const success = await updateCrawlerTarget(id, req.body);
      scheduleReconcile();
      res.json({ success });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/crawler/targets/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const success = await deleteCrawlerTarget(id);
      scheduleReconcile();
      res.json({ success });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/crawler/targets/:id/backfill", async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const limit = Math.min(1000, Math.max(1, parseInt(req.body.limit || "50", 10)));
      if (limit > 100) {
        // long scans run in the background; progress shows in Activity and the channel's counters
        runChannelBackfill(id, limit).catch((e) => console.warn("[backfill] failed:", e?.message));
        return res.json({ success: true, background: true, limit });
      }
      const result = await runChannelBackfill(id, limit);
      res.json({ success: true, ...result });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/crawler/bots", async (req, res) => {
    try {
      const bots = await getSearchBots();
      const health = await botHealthMap().catch(() => ({} as Record<string, any>));
      res.json(bots.map((b: any) => {
        let scope: string | undefined;
        try { scope = b.profile ? JSON.parse(b.profile).scope : undefined; } catch { /* ignore */ }
        const h = health[`@${String(b.bot_username).replace(/^@/, "").toLowerCase()}`];
        return { ...b, scope: scope || (/quinson/i.test(b.bot_username) ? "series" : "movie"), health: h ? { state: h.state, reason: h.reason } : null };
      }));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/crawler/bots", async (req, res) => {
    try {
      const { bot_username, bot_type, command_template, priority, scope } = req.body;
      if (!bot_username) {
        return res.status(400).json({ error: "bot_username is required" });
      }
      const created = await addSearchBot({
        bot_username,
        bot_type: bot_type || "inline",
        command_template: command_template || "/search {query}",
        priority: priority ? parseInt(priority, 10) : 1,
        scope: ["movie", "series", "both"].includes(scope) ? scope : undefined
      });
      res.json({ success: true, bot: created });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put("/api/crawler/bots/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const success = await updateSearchBot(id, req.body);
      res.json({ success });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/crawler/bots/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const success = await deleteSearchBot(id);
      res.json({ success });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/crawler/bots/test-query", async (req, res) => {
    try {
      const { bot_username, query } = req.body;
      if (!bot_username || !query) {
        return res.status(400).json({ error: "bot_username and query are required" });
      }
      const result = await probeBot(bot_username, query);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/crawler/bots/forward", async (req, res) => {
    try {
      const { bot_username, message_id, button_row, button_col } = req.body;
      if (!bot_username || !message_id) {
        return res.status(400).json({ error: "bot_username and message_id are required" });
      }
      if (button_row === undefined || button_col === undefined) return res.status(400).json({ error: "Pick a button to press" });
      const result = await pressBotButton({ botUsername: bot_username, messageId: Number(message_id), row: Number(button_row), col: Number(button_col) });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/crawler/joined-dialogs", async (req, res) => {
    try {
      const dialogs = await getJoinedDialogs();
      res.json(dialogs);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/crawler/logs", (req, res) => {
    try {
      const logs = getCrawlerLogs();
      res.json(logs);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ================= WEEKLY DIGEST =================
  app.get("/api/digest", async (_req, res) => {
    try { const [s, p] = await Promise.all([digestSettings(), previewDigest()]); res.json({ ...s, preview: p ? { count: p.count, text: p.text } : null, botRunning: !!getBotInstance() }); }
    catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  app.put("/api/digest", async (req, res) => {
    try { await setDigestEnabled(!!req.body?.enabled); res.json(await digestSettings()); } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  app.post("/api/digest/send", async (_req, res) => {
    try { const b = getBotInstance(); if (!b) return res.status(409).json({ error: "The bot isn't running." }); res.json(await sendDigest(b)); }
    catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ================= REBUILD LIBRARY FROM VAULT =================
  app.get("/api/library/rebuild", (_req, res) => res.json(rebuildState()));
  app.post("/api/library/rebuild", async (_req, res) => {
    try { const r = await startRebuild(); if (!r.started) return res.status(409).json({ error: r.reason }); res.json(rebuildState()); }
    catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ================= SAFETY: takedowns, bans, daily limit, blocklist =================
  app.get("/api/safety", async (_req, res) => {
    try {
      const [cap, stats, bans, blocks] = await Promise.all([getDailyCap(), moderationStats(), listBans(), listBlocks()]);
      res.json({ cap, stats, bans, blocks });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  app.put("/api/safety/cap", async (req, res) => {
    try { const n = Number(req.body?.cap); if (!Number.isFinite(n) || n < 0 || n > 1000) return res.status(400).json({ error: "Give a number from 0 to 1000 (0 = no limit)." }); await setDailyCap(n); res.json({ cap: await getDailyCap() }); }
    catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  app.post("/api/safety/bans", async (req, res) => {
    try {
      const v = await findViewer(String(req.body?.who || ""));
      if (!v) return res.status(400).json({ error: "Use a Telegram id (digits) or the @username of someone who has used the bot." });
      if (isAdminTelegramId(Number(v.telegram_id))) return res.status(400).json({ error: "That's an admin account." });
      await banViewer(v.telegram_id, req.body?.reason ? String(req.body.reason).slice(0, 200) : undefined);
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  app.delete("/api/safety/bans/:id", async (req, res) => {
    try { await unbanViewer(req.params.id); res.json({ success: true }); } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  app.post("/api/safety/takedown", async (req, res) => {
    try {
      const title = String(req.body?.title || "").trim();
      if (title.length < 2) return res.status(400).json({ error: "Which title?" });
      res.json(await takedownTitle({ title, year: req.body?.year ? String(req.body.year).trim() : null, reason: req.body?.reason ? String(req.body.reason).slice(0, 200) : "admin takedown" }));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  app.delete("/api/safety/blocks/:id", async (req, res) => {
    try { await unblock(Number(req.params.id)); res.json({ success: true }); } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ================= REQUIRED CHANNELS (JOIN GATE) =================
  app.get("/api/gate", async (_req, res) => {
    try {
      const [settings, channels, stats] = await Promise.all([getGateSettings(), listGateChannels(), gateStats()]);
      res.json({ settings, stats, botRunning: !!getBotInstance(), channels: channels.map((c) => ({ ...c, link: joinLinkOf(c), members: stats.members[c.chat_id] ?? 0 })) });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  app.put("/api/gate/settings", async (req, res) => {
    try { await saveGateSettings({ enabled: req.body?.enabled, ttlHours: req.body?.ttlHours }); res.json(await getGateSettings()); } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  app.post("/api/gate/channels", async (req, res) => {
    try {
      const ref = normalizeChatRef(req.body?.ref);
      if ("error" in ref) return res.status(400).json({ error: ref.error });
      const kind = ["discussion", "ads", "general"].includes(req.body?.kind) ? req.body.kind : "general";
      const mode = req.body?.mode === "request" ? "request" : "check";
      const b = getBotInstance();
      const look = b ? await inspectChannel(b, ref.chat_id) : null;
      const id = await addGateChannel({
        chat_id: ref.chat_id, username: look?.username ?? ref.username, title: (req.body?.title || look?.title || ref.chat_id).toString().slice(0, 80),
        invite_link: req.body?.invite_link || null, kind, mode,
      });
      const row = (await listGateChannels()).find((c) => c.id === id)!;
      if (b && look?.canInvite) await ensureInviteLink(b, row);
      res.json({ success: true, id, inspection: look });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  app.put("/api/gate/channels/:id", async (req, res) => {
    try {
      const { title, invite_link, kind, mode, active, position } = req.body || {};
      await updateGateChannel(Number(req.params.id), { title, invite_link, kind, mode, active: active === undefined ? undefined : active ? 1 : 0, position });
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  app.delete("/api/gate/channels/:id", async (req, res) => {
    try { await deleteGateChannel(Number(req.params.id)); res.json({ success: true }); } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  app.post("/api/gate/channels/:id/test", async (req, res) => {
    try {
      const b = getBotInstance();
      if (!b) return res.json({ ok: false, problem: "The Telegram bot isn't running." });
      const row = (await listGateChannels()).find((c) => c.id === Number(req.params.id));
      if (!row) return res.status(404).json({ error: "Not found" });
      const look = await inspectChannel(b, row.chat_id);
      let link = joinLinkOf(row);
      if (look.canInvite && !link) link = await ensureInviteLink(b, row);
      if (look.ok && look.title && row.title === row.chat_id) await updateGateChannel(row.id, { title: look.title });
      res.json({ ...look, link, needsLink: !link });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ================= SERIES WISHLIST =================
  app.get("/api/crawler/wishlist", async (_req, res) => {
    try { res.json({ wishes: await listWishes() }); } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  app.post("/api/crawler/wishlist", async (req, res) => {
    try {
      const { title, year, mode, seasons } = req.body || {};
      if (!title || typeof title !== "string" || title.trim().length < 2) return res.status(400).json({ error: "Give the series a title." });
      const m = ["all", "seasons", "follow"].includes(mode) ? mode : "all";
      const list = Array.isArray(seasons) ? seasons.map(Number).filter((n) => n >= 1 && n <= 60) : null;
      if (m === "seasons" && !list?.length) return res.status(400).json({ error: "Pick at least one season." });
      res.json({ success: true, ...(await addWish({ title: title.trim(), year, mode: m, seasons: m === "seasons" ? list : null })) });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  app.put("/api/crawler/wishlist/:id", async (req, res) => {
    try { await updateWish(Number(req.params.id), req.body || {}); res.json({ success: true }); } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  app.delete("/api/crawler/wishlist/:id", async (req, res) => {
    try { await deleteWish(Number(req.params.id)); res.json({ success: true }); } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  app.post("/api/crawler/wishlist/:id/run", async (req, res) => {
    try { await runWishNow(Number(req.params.id)); res.json({ success: true }); } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // ================= BATCH CRON CSV / PDF / MD INDEXER ROUTES =================
  app.post("/api/crawler/cron/upload-csv", async (req, res) => {
    try {
      const { csvContent, fileBase64, sourceName } = req.body;
      let textToParse = (csvContent as string) || "";

      // Handle PDF uploads sent as base64 or data URLs
      const isPdf = (sourceName && sourceName.toLowerCase().endsWith(".pdf")) ||
                    (typeof fileBase64 === "string" && fileBase64.length > 0) ||
                    (typeof csvContent === "string" && csvContent.startsWith("data:application/pdf;base64,"));

      if (isPdf) {
        try {
          const rawBase64 = (fileBase64 || csvContent).replace(/^data:application\/pdf;base64,/, "");
          const buffer = Buffer.from(rawBase64, "base64");
          textToParse = await parsePdfBufferToText(buffer);
        } catch (pdfErr: any) {
          console.warn("[CrawlerUpload] PDF parsing error:", pdfErr.message);
          return res.status(400).json({ error: "Failed to extract text from PDF document: " + pdfErr.message });
        }
      }

      if (!textToParse || typeof textToParse !== "string" || !textToParse.trim()) {
        return res.status(400).json({ error: "No readable movie titles found in the uploaded file." });
      }

      // Series lines ("Severance S2", "Show (series)", "series: Show") go to the wishlist; the rest are movies.
      const movieLines: string[] = [];
      let seriesAdded = 0;
      for (const line of textToParse.split(/\r?\n/)) {
        const wish = parseSeriesLine(line.replace(/^\s*["']|["']\s*$/g, ""));
        if (wish) {
          const r = await addWish(wish);
          if (!r.existing) seriesAdded++;
        } else movieLines.push(line);
      }
      const movieText = movieLines.join("\n");
      const result: any = movieText.trim()
        ? await parseAndQueueCsvMovies(movieText, sourceName || "batch_upload.csv")
        : { totalParsed: 0, queued: 0, duplicatesSkipped: 0 };
      res.json({ success: true, ...result, seriesAdded });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/crawler/cron/status", async (req, res) => {
    try {
      const status = await getCronStatus();
      res.json(status);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/crawler/cron/config", (req, res) => {
    try {
      const updated = configureCronJob(req.body);
      res.json({ success: true, config: updated });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/crawler/cron/run-batch-now", async (req, res) => {
    try {
      const limit = req.body.limit ? parseInt(req.body.limit, 10) : 5;
      const result = await processCronBatch(limit, true);
      res.json({ success: true, ...result });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/crawler/cron/queue", async (req, res) => {
    try {
      const status = req.query.status as string | undefined;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 100;
      const queue = await getCronBatchQueue(status, limit);
      res.json(queue);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/crawler/cron/clear-queue", async (req, res) => {
    try {
      const type = (req.body.type || "completed") as "all" | "completed" | "failed";
      const success = await clearCronBatchQueue(type);
      res.json({ success });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/crawler/cron/stop-all", (req, res) => {
    try {
      stopAllCronJobs();
      res.json({ success: true, message: "Emergency Stop: All active cron jobs and running batches cancelled." });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/crawler/cron/requeue", async (req, res) => {
    try {
      const type = (req.body.type || "all") as "failed" | "skipped" | "all";
      const count = await requeueBatchQueue(type);
      res.json({ success: true, requeuedCount: count });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/crawler/dispatch-search", async (req, res) => {
    try {
      const { query, telegram_id } = req.body;
      if (!query) {
        return res.status(400).json({ error: "query is required" });
      }
      const result = await fetchNow(query, telegram_id);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/crawler/settings", async (_req, res) => {
    try { res.json(await getCrawlerSettings()); } catch (err: any) { res.status(500).json({ error: err.message }); }
  });
  app.post("/api/crawler/settings", async (req, res) => {
    try { res.json(await saveCrawlerSettings({ secondQuality: req.body?.secondQuality })); } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Crawl jobs + the step-by-step trace of what each external bot showed and what we pressed
  app.get("/api/crawler/jobs", async (req, res) => {
    try {
      const rows = await listJobs(Math.min(200, Number(req.query.limit) || 50), (req.query.status as any) || undefined);
      // Shape kept compatible with the dashboard's job list (query / bot_used / fulfilled …) plus the new fields
      res.json(rows.map((j) => {
        let r: any = {};
        try { r = JSON.parse(j.result_json || "{}"); } catch { /* ignore */ }
        return {
          ...j,
          query: j.title,
          user_telegram_id: j.requested_by,
          bot_used: r.bot,
          file_name: r.fileName,
          fulfilled_at: j.finished_at,
          status: j.status === "done" ? "fulfilled" : j.status === "queued" ? "pending" : j.status === "running" ? "searching" : "failed",
          crawl_status: j.status,
        };
      }));
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });
  app.post("/api/crawler/jobs/:id/retry", async (req, res) => {
    try {
      const j = await getJob(Number(req.params.id));
      if (!j) return res.status(404).json({ error: "Job not found" });
      const r = await submitJob({ kind: j.kind, title: j.title, year: j.year, season: j.season, episode: j.episode, quality: j.quality, priority: PRIORITY.admin, source: "admin", requestedBy: j.requested_by });
      res.json({ success: true, id: r.id, existing: r.existing });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });
  app.get("/api/crawler/jobs/:id", async (req, res) => {
    try {
      const id = Number(req.params.id);
      const job = await getJob(id);
      if (!job) return res.status(404).json({ error: "Job not found" });
      res.json({ job, traces: await getTraces(id) });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // Phase 4: AI Recommendations
  app.post("/api/ai/recommend", async (req, res) => {
    try {
      const { prompt } = req.body;
      if (!prompt) {
        return res.status(400).json({ error: "Prompt is required" });
      }
      const vaultTitles = await getAllVaultTitles();
      const result = await getAIMovieRecommendations(prompt, vaultTitles);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Phase 4: 1-Click Telegram Channel Publisher
  app.post("/api/channel/publish", async (req, res) => {
    try {
      if (!bot) {
        return res.status(503).json({ error: "Telegram bot is not active. Please ensure TELEGRAM_BOT_TOKEN is configured." });
      }

      const { channelId, title, year, quality, overview, poster_path, fileId, rating, genres } = req.body;
      if (!title) {
        return res.status(400).json({ error: "Movie title is required" });
      }

      // If channelId is not specified, get the most recent channel from logs
      let targetChannel = channelId;
      if (!targetChannel) {
        const recentLog = (await db.execute("SELECT channel_id FROM channel_logs WHERE channel_id IS NOT NULL AND channel_id != '' ORDER BY id DESC LIMIT 1")).rows[0] as any;
        if (recentLog?.channel_id) {
          targetChannel = recentLog.channel_id;
        }
      }

      if (!targetChannel) {
        return res.status(400).json({
          error: "No target channel identified. Please provide a Channel ID or type /sync in your channel first so the bot can auto-detect it."
        });
      }

      const result = await publishMovieToTelegramChannel(bot, targetChannel, {
        title,
        year,
        quality,
        overview,
        poster_path,
        file_id: fileId,
        rating,
        genres
      });

      res.json({
        success: true,
        channelId: targetChannel,
        messageId: result?.message_id
      });
    } catch (err: any) {
      console.error("Channel publish error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // Phase 4: Admin Broadcast to all bot users
  app.post("/api/admin/broadcast", async (req, res) => {
    try {
      if (!bot) {
        return res.status(503).json({ error: "Telegram bot is not active." });
      }
      const { message } = req.body;
      if (!message || !message.trim()) {
        return res.status(400).json({ error: "Message content is required" });
      }

      const result = await broadcastAnnouncement(bot, message.trim());
      res.json({ success: true, ...result });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Automated & On-Demand Smart Re-Engagement Follow-Up
  app.post("/api/bot/trigger-followup", async (req, res) => {
    try {
      if (!bot) {
        return res.status(400).json({ error: "Telegram bot is not configured or active." });
      }
      const result = await sendSmartReEngagementBroadcast(bot);
      res.json({ success: true, ...result });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Periodic intelligent re-engagement (Every 6 hours)
  // Housekeeping: drop expired button data every 6 hours
  setInterval(() => { purgeExpiredCallbacks().catch(() => {}); }, 6 * 3600 * 1000).unref?.();

  setInterval(async () => {
    if (bot) {
      try {
        console.log("[Engagement] Running smart re-engagement spotlight check...");
        await sendSmartReEngagementBroadcast(bot);
      } catch (cronErr) {
        console.warn("[Engagement] Follow-up check skipped:", cronErr);
      }
    }
  }, 6 * 60 * 60 * 1000); // 6 hours

  // Phase 4: Media Streaming & Direct URL Info
  app.get("/api/media/:id/stream", async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });
      const row = (await db.execute({ sql: "SELECT id, movie_title, file_name, file_size, quality FROM media_files WHERE id = ?", args: [id] })).rows[0] as any;
      if (!row) return res.status(404).json({ error: "File not found" });
      const username = cachedBotUsername || (bot as any)?.botInfo?.username;
      // Deep link only: the Telegram bot delivers the file. Never expose Telegram file URLs (they contain the bot token).
      res.json({
        success: true,
        title: row.movie_title,
        fileName: row.file_name,
        fileSize: row.file_size,
        quality: row.quality,
        watchUrl: username ? `https://t.me/${username}?start=watch_${id}` : null
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Phase 4: Random Media Picker
  app.get("/api/media/random", async (req, res) => {
    try {
      const file = await getRandomMediaFile();
      if (!file) {
        return res.status(404).json({ error: "No media files available in the Vault." });
      }
      res.json(file);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Phase 4: Bot Users List
  app.get("/api/users", async (req, res) => {
    try {
      const users = await getAllUsers();
      res.json({ count: users.length, users });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Phase 5: Collections API
  app.get("/api/collections", async (req, res) => {
    try {
      const collections = await getCollections();
      res.json(collections);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/collections", async (req, res) => {
    try {
      const { name, description } = req.body;
      if (!name) return res.status(400).json({ error: "Collection name required" });
      await createCollection(name, description);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/collections/:id/items", async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const items = await getCollectionItems(id);
      res.json(items);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/collections/:id/items", async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const { mediaFileId } = req.body;
      await addFileToCollection(id, mediaFileId);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/collections/:id/items/:fileId", async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const fileId = parseInt(req.params.fileId, 10);
      await removeFileFromCollection(id, fileId);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Movie search preview/test endpoint
  app.get("/api/search-test", async (req, res) => {
    try {
      const query = (req.query.q as string) || "Inception";
      const { searchMovies } = await import("./src/services/movieProvider.js");
      const results = await searchMovies(query);
      res.json({ query, count: results.length, results });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Catch-all 404 for unknown /api/* requests so they NEVER fall through to HTML Vite middleware
  app.all("/api/*", (req, res) => {
    res.status(404).json({ error: "Endpoint not found" });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer().catch(console.error);
