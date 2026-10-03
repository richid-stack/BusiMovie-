import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import {
  setupDatabase,
  db,
  getAllMediaFiles,
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
  syncVaultWithFirestore
} from "./src/db/index.js";
import {
  initializeBot,
  notifyRequestingUsers,
  recentTelegramUpdates,
  publishMovieToTelegramChannel,
  broadcastAnnouncement,
  sendSmartReEngagementBroadcast,
  getFileStreamInfo,
  getBotWebhookInfo,
  setBotWebhook,
  deleteBotWebhook
} from "./src/bot/index.js";
import { getAIMovieRecommendations } from "./src/services/gemini.js";
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
  testQuerySearchBot,
  getCrawlerLogs,
  getSearchJobs,
  dispatchAutomatedSearch,
  requestAuxiliaryLoginCode,
  verifyAuxiliaryLoginCode,
  disconnectAuxiliarySession,
  getAuxiliarySessionStatus,
  saveDirectSessionString,
  setEffectiveVaultChannelId,
  fetchAndForwardBotMedia,
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

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Middleware for JSON
  app.use(express.json());

  // Ensure all /api responses have JSON content-type
  app.use("/api", (req, res, next) => {
    res.setHeader("Content-Type", "application/json");
    next();
  });

  // Database initialization state
  let dbReady = false;
  setupDatabase()
    .then(async () => {
      dbReady = true;
      console.log("Database initialized.");
      await initCrawlerService();
    })
    .catch((err) => {
      console.error("Database setup error:", err);
    });

  // Telegram Bot initialization & Dual Mode (24/7 Webhook or Long Polling)
  let bot: any = null;
  let botActive = false;
  let botMode: "polling" | "webhook" | "inactive" = "inactive";

  try {
    bot = initializeBot();
    if (bot) {
      // Check if Telegram currently has a webhook configured
      bot.telegram
        .getWebhookInfo()
        .then(async (info: any) => {
          // If a webhook is set to an internal ais-dev URL, Telegram cannot reach it due to Google auth 302 redirect.
          // Auto-clear it and revert to polling.
          if (info?.url && info.url.includes("ais-dev-")) {
            console.log(`[Telegram] Detected inaccessible dev webhook (${info.url}). Removing webhook and switching to Long Polling...`);
            try {
              await deleteBotWebhook(bot);
              info.url = "";
            } catch (delErr: any) {
              console.warn("Error clearing dev webhook:", delErr?.message);
            }
          }

          if (info?.url) {
            botActive = true;
            botMode = "webhook";
            console.log(`[Telegram] Bot active in Webhook mode. Receiving events from: ${info.url}`);
          } else {
            // Launch polling if no webhook is registered
            botActive = true;
            botMode = "polling";
            bot
              .launch({
                allowedUpdates: [
                  "message",
                  "edited_message",
                  "channel_post",
                  "edited_channel_post",
                  "callback_query",
                  "inline_query",
                  "chat_member",
                  "my_chat_member"
                ]
              })
              .catch((err: any) => {
                const errMsg = String(err?.message || err);
                if (errMsg.includes("Conflict") && errMsg.includes("setWebhook")) {
                  // A webhook was set (e.g. on production / Cloud Run), so polling was intentionally terminated
                  botActive = true;
                  botMode = "webhook";
                  console.log("[Telegram] Polling terminated in favor of active Webhook mode.");
                } else {
                  botActive = false;
                  botMode = "inactive";
                  console.error("Failed to run polling bot:", errMsg);
                }
              });
            console.log("[Telegram] Bot started in Long Polling mode with channel_post updates enabled.");
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

      if (targetUrl.includes("ais-dev-")) {
        return res.status(400).json({ 
          error: "AI Studio preview URLs ('ais-dev-*.run.app') are protected behind Google Account authentication and reject Telegram with a 302 redirect. Keep the bot in 'Long Polling' mode while developing in AI Studio, or deploy to Cloud Run to use 24/7 Webhooks." 
        });
      }

      // If running in polling mode, stop polling before activating webhook
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
        allowedUpdates: [
          "message",
          "edited_message",
          "channel_post",
          "edited_channel_post",
          "callback_query",
          "inline_query",
          "chat_member",
          "my_chat_member"
        ]
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
        firebaseConnected: true,
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
        recentUpdates: recentTelegramUpdates
      });
    } catch (error: any) {
      console.error("Status endpoint error:", error);
      res.status(500).json({ error: "Failed to fetch status" });
    }
  });

  // Manual Firebase Firestore cloud sync endpoint
  app.post("/api/firebase/sync", async (req, res) => {
    try {
      await syncVaultWithFirestore();
      const files = await getAllMediaFiles();
      res.json({ success: true, count: files.length, message: "Firestore synchronization completed." });
    } catch (err: any) {
      console.error("Firebase sync error:", err);
      res.status(500).json({ error: err?.message || "Sync failed" });
    }
  });

  // Telegram Library Endpoints (Phase 2)
  app.get("/api/library", async (req, res) => {
    try {
      const files = await getAllMediaFiles();
      // Auto-populate poster_url if missing
      for (const file of files) {
        if (!file.poster_url) {
          try {
            const results = await searchMovies(file.movie_title);
            if (results && results.length > 0 && results[0].poster_path) {
              file.poster_url = results[0].poster_path;
              await db.execute({
                sql: "UPDATE media_files SET poster_url = ? WHERE id = ?",
                args: [file.poster_url, file.id]
              });
            }
          } catch (e) {
            // ignore
          }
        }
      }
      res.json({ count: files.length, files });
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
  app.post("/api/requests/create", async (req, res) => {
    try {
      const { title, telegram_id, auto_fetch } = req.body;
      if (!title || !title.trim()) {
        return res.status(400).json({ error: "Movie title is required" });
      }
      const cleanTitle = title.trim();
      const userId = telegram_id || "web_user";

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
        fetchResult = await dispatchAutomatedSearch(cleanTitle, userId, bot);
      }

      res.json({
        success: true,
        requestId: reqId,
        title: cleanTitle,
        autoFetch: fetchResult,
        message: fetchResult?.success 
          ? `Auto-fetched "${cleanTitle}" and added to Vault!` 
          : `Request submitted for "${cleanTitle}". Automated bots queued to search.`
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

      const result = await dispatchAutomatedSearch(reqRecord.title, reqRecord.telegram_id, bot);
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
      res.json({ success: true, message: "Session string saved successfully!" });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Update Vault Channel ID
  app.post("/api/crawler/vault-channel", async (req, res) => {
    try {
      const { channel_id } = req.body;
      if (!channel_id) {
        return res.status(400).json({ error: "Channel ID is required (e.g. -1001234567890)" });
      }
      await setEffectiveVaultChannelId(channel_id);
      res.json({ success: true, message: "Vault Channel ID saved!" });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/crawler/targets", async (req, res) => {
    try {
      const targetsList = await getCrawlerTargets();
      res.json(targetsList);
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
      res.json({ success: true, target: created });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put("/api/crawler/targets/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const success = await updateCrawlerTarget(id, req.body);
      res.json({ success });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/crawler/targets/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const success = await deleteCrawlerTarget(id);
      res.json({ success });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/crawler/targets/:id/backfill", async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const limit = parseInt(req.body.limit || "50", 10);
      const result = await runChannelBackfill(id, limit);
      res.json({ success: true, ...result });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/crawler/bots", async (req, res) => {
    try {
      const bots = await getSearchBots();
      res.json(bots);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/crawler/bots", async (req, res) => {
    try {
      const { bot_username, bot_type, command_template, priority } = req.body;
      if (!bot_username) {
        return res.status(400).json({ error: "bot_username is required" });
      }
      const created = await addSearchBot({
        bot_username,
        bot_type: bot_type || "inline",
        command_template: command_template || "/search {query}",
        priority: priority ? parseInt(priority, 10) : 1
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
      const result = await testQuerySearchBot(bot_username, query);
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
      const result = await fetchAndForwardBotMedia({
        botUsername: bot_username,
        messageId: Number(message_id),
        buttonRow: button_row !== undefined ? Number(button_row) : undefined,
        buttonCol: button_col !== undefined ? Number(button_col) : undefined
      });
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

  app.get("/api/crawler/jobs", async (req, res) => {
    try {
      const jobs = await getSearchJobs();
      res.json(jobs);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
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

      const result = await parseAndQueueCsvMovies(textToParse, sourceName || "batch_upload.csv");
      res.json({ success: true, ...result });
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
      const result = await dispatchAutomatedSearch(query, telegram_id, bot);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
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
      if (!bot) {
        return res.status(503).json({ error: "Bot not initialized" });
      }
      const streamInfo = await getFileStreamInfo(bot, id);
      res.json({ success: true, ...streamInfo });
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

  // Phase 6: Radarr/Sonarr Webhook Ingestion (Telegramarr Architecture)
  // Radarr sends a POST here when a movie finishes downloading.
  app.post("/api/webhooks/arr", async (req, res) => {
    try {
      const payload = req.body;
      console.log("[Webhook] Received event from *Arr:", payload.eventType);

      if (payload.eventType === "Download" || payload.eventType === "Test") {
        const title = payload.movie?.title || payload.series?.title || "Unknown Media";
        const tmdbId = payload.movie?.tmdbId?.toString() || payload.series?.tvdbId?.toString();
        
        console.log(`[Webhook] Media Ready: ${title} (ID: ${tmdbId})`);
        
        // In a full production setup:
        // 1. This triggers a worker to ingest the file into the Telegram channel
        // 2. The worker gets the Telegram file_id
        // 3. The worker updates our local DB
        // 4. The worker notifies the user
        
        // For now, we mock the ingestion success response back to Radarr
        res.status(200).json({ success: true, message: "Webhook acknowledged by BusiMovie" });
      } else {
        res.status(200).json({ ignored: true, message: "Event type not handled" });
      }
    } catch (err: any) {
      console.error("[Webhook Error]:", err);
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
