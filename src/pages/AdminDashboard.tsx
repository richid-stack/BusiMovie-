import React, { useEffect, useState, useRef, FormEvent } from "react";
import { 
  Database, Users, Search, Bell, HardDrive, ShieldCheck, 
  RefreshCw, Webhook, Sparkles, Megaphone, Layers, FileVideo, 
  DownloadCloud, Bot, Cpu, PlayCircle, PauseCircle, CheckCircle2, 
  AlertTriangle, Radio, Terminal, PlusCircle, Trash2, Zap, 
  ArrowRight, FastForward, ExternalLink, Play, Phone, KeyRound, 
  Lock, LogOut, Check, ChevronDown, ChevronUp, Clock, FileText,
  UploadCloud, RotateCw, Sliders, ListFilter, Edit2, Save, X
} from "lucide-react";
import { 
  Status, 
  MediaFile, 
  CrawlerTarget, 
  SearchBot, 
  SearchJob, 
  CrawlerActivityLog, 
  CrawlerStatus 
} from "../types";

function formatBytes(bytes?: number): string {
  if (!bytes || bytes === 0) return "0 MB";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

export default function AdminDashboard() {
  const [status, setStatus] = useState<Status | null>(null);
  const [botUsersCount, setBotUsersCount] = useState(0);
  const [webhookInfo, setWebhookInfo] = useState<any>(null);
  const [webhookMode, setWebhookMode] = useState<string>("polling");
  const [detectedUrl, setDetectedUrl] = useState<string>("");
  const [customWebhookUrl, setCustomWebhookUrl] = useState<string>("");
  const [webhookLoading, setWebhookLoading] = useState(false);
  const [cloudSyncLoading, setCloudSyncLoading] = useState(false);
  const [cloudSyncMsg, setCloudSyncMsg] = useState<string | null>(null);
  const [engagementLoading, setEngagementLoading] = useState(false);
  const [engagementMsg, setEngagementMsg] = useState<string | null>(null);
  const [broadcastMsg, setBroadcastMsg] = useState("");
  const [broadcastSending, setBroadcastSending] = useState(false);
  const [broadcastStatus, setBroadcastStatus] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  
  // Tabs
  const [activeTab, setActiveTab] = useState<"overview" | "automation" | "requests" | "library" | "comms">("overview");

  // Requests Data
  const [pendingRequests, setPendingRequests] = useState<any[]>([]);
  const [allRequests, setAllRequests] = useState<any[]>([]);
  const [autoFetchingId, setAutoFetchingId] = useState<number | null>(null);
  const [autoFetchNotice, setAutoFetchNotice] = useState<string | null>(null);
  
  // Library Data
  const [libraryFiles, setLibraryFiles] = useState<MediaFile[]>([]);
  const [librarySearch, setLibrarySearch] = useState("");
  
  // Index File Form
  const [newFileTitle, setNewFileTitle] = useState("");
  const [newFileYear, setNewFileYear] = useState("");
  const [newFileQuality, setNewFileQuality] = useState("1080p");
  const [newFileId, setNewFileId] = useState("");

  // ================= AUTOMATION & CRAWLER STATE =================
  const [crawlerStatus, setCrawlerStatus] = useState<CrawlerStatus | null>(null);
  const [targets, setTargets] = useState<CrawlerTarget[]>([]);
  const [bots, setBots] = useState<SearchBot[]>([]);
  const [logs, setLogs] = useState<CrawlerActivityLog[]>([]);
  const [searchJobs, setSearchJobs] = useState<SearchJob[]>([]);

  // Add Target Form
  const [showAddTargetModal, setShowAddTargetModal] = useState(false);
  const [targetIdentifier, setTargetIdentifier] = useState("");
  const [targetTitle, setTargetTitle] = useState("");
  const [targetMinSize, setTargetMinSize] = useState("500");
  const [targetQuality, setTargetQuality] = useState("all");

  // Add Bot Form
  const [showAddBotModal, setShowAddBotModal] = useState(false);
  const [botUsername, setBotUsername] = useState("");
  const [botType, setBotType] = useState<"inline" | "command">("command");
  const [botCommandTemplate, setBotCommandTemplate] = useState("/search {query}");
  const [botPriority, setBotPriority] = useState("1");
  const [editingBot, setEditingBot] = useState<SearchBot | null>(null);
  const [editingTarget, setEditingTarget] = useState<CrawlerTarget | null>(null);

  // Interactive Playground
  const [playgroundQuery, setPlaygroundQuery] = useState("Inception 2010");
  const [playgroundBot, setPlaygroundBot] = useState("");
  const [playgroundLoading, setPlaygroundLoading] = useState(false);
  const [playgroundResult, setPlaygroundResult] = useState<any>(null);
  const [playgroundForwarding, setPlaygroundForwarding] = useState(false);
  const [forwardingButtonIdx, setForwardingButtonIdx] = useState<number | null>(null);
  const [playgroundNotice, setPlaygroundNotice] = useState<string | null>(null);
  const [joinedDialogs, setJoinedDialogs] = useState<Array<{ id: string; title: string; username: string | null; isChannel: boolean; isGroup: boolean }>>([]);

  // Backfill execution
  const [backfillingId, setBackfillingId] = useState<number | null>(null);
  const [backfillDepth, setBackfillDepth] = useState<number>(50);
  const [backfillNotice, setBackfillNotice] = useState<string | null>(null);

  // Auxiliary Telegram Userbot Account & Vault Storage State
  const [auxPhone, setAuxPhone] = useState("");
  const [auxCode, setAuxCode] = useState("");
  const [auxPassword, setAuxPassword] = useState("");
  const [auxLoading, setAuxLoading] = useState(false);
  const [auxCodeSent, setAuxCodeSent] = useState(false);
  const [auxNotice, setAuxNotice] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [vaultChannelInput, setVaultChannelInput] = useState("");
  const [vaultChannelSaving, setVaultChannelSaving] = useState(false);
  const [vaultChannelNotice, setVaultChannelNotice] = useState<string | null>(null);
  const [showManualSession, setShowManualSession] = useState(false);
  const [manualSessionInput, setManualSessionInput] = useState("");

  // ================= BATCH CRON PIPELINE STATE =================
  const [cronStatus, setCronStatus] = useState<any>(null);
  const [cronQueue, setCronQueue] = useState<any[]>([]);
  const [cronFilter, setCronFilter] = useState<string>("all");
  const [csvInputText, setCsvInputText] = useState("");
  const [csvSourceName, setCsvSourceName] = useState("movies_list.csv");
  const [csvUploading, setCsvUploading] = useState(false);
  const [csvReport, setCsvReport] = useState<any>(null);
  const [showCsvModal, setShowCsvModal] = useState(false);
  const [cronBatchSize, setCronBatchSize] = useState("5");
  const [cronIntervalMins, setCronIntervalMins] = useState("15");
  const [cronDelayMs, setCronDelayMs] = useState("7000");
  const [cronMaxRetries, setCronMaxRetries] = useState("3");
  const [runningBatchNow, setRunningBatchNow] = useState(false);
  const [cronNotice, setCronNotice] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelected = async (file: File) => {
    if (!file) return;
    setCsvUploading(true);
    setCsvSourceName(file.name);
    setCsvReport(null);
    setCronNotice(null);
    setShowCsvModal(true);

    try {
      const isPdf = file.name.toLowerCase().endsWith(".pdf") || file.type === "application/pdf";
      const payload: any = { sourceName: file.name };

      if (isPdf) {
        // Read as Base64 data URL for server-side PDF extraction
        const base64Promise = new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
        const dataUrl = await base64Promise;
        payload.fileBase64 = dataUrl;
        setCsvInputText(`[PDF Document: ${file.name} (${Math.round(file.size / 1024)} KB)]\nExtracting text and titles...`);
      } else {
        const text = await file.text();
        setCsvInputText(text);
        payload.csvContent = text;
      }

      const res = await fetch("/api/crawler/cron/upload-csv", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setCsvReport(data);
        setCronNotice({
          type: "success",
          text: `Successfully ingested "${file.name}": ${data.totalParsed} movies parsed (${data.queued} queued for cron crawl, ${data.duplicatesSkipped} duplicates filtered). Missing years automatically resolved!`
        });
        fetchCronData();
      } else {
        setCronNotice({ type: "error", text: data.error || "Failed to parse and queue movie list." });
      }
    } catch (err: any) {
      setCronNotice({ type: "error", text: "Error reading file: " + err.message });
    } finally {
      setCsvUploading(false);
    }
  };

  const fetchCronData = async () => {
    try {
      const [statusRes, queueRes] = await Promise.all([
        fetch("/api/crawler/cron/status"),
        fetch(`/api/crawler/cron/queue?status=${cronFilter}&limit=100`)
      ]);
      if (statusRes.ok) {
        const s = await statusRes.json();
        setCronStatus(s);
        if (s.config) {
          setCronBatchSize(String(s.config.batchSize || 5));
          setCronIntervalMins(String(s.config.intervalMinutes || 15));
          setCronDelayMs(String(s.config.delayBetweenItemsMs || 7000));
          setCronMaxRetries(String(s.config.maxRetries || 3));
        }
      }
      if (queueRes.ok) {
        setCronQueue(await queueRes.json());
      }
    } catch (e) {
      console.warn("Cron data fetch error:", e);
    }
  };

  const handleUploadCsv = async (e: FormEvent) => {
    e.preventDefault();
    if (!csvInputText.trim()) return;
    setCsvUploading(true);
    setCsvReport(null);
    setCronNotice(null);

    try {
      const res = await fetch("/api/crawler/cron/upload-csv", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          csvContent: csvInputText,
          sourceName: csvSourceName.trim() || "batch_upload.csv"
        })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setCsvReport(data);
        setCronNotice({
          type: "success",
          text: `Ingested ${data.totalParsed} movies: ${data.queued} queued for cron crawl, ${data.duplicatesSkipped} duplicates filtered!`
        });
        setCsvInputText("");
        fetchCronData();
      } else {
        setCronNotice({ type: "error", text: data.error || "Failed to parse and queue CSV." });
      }
    } catch (err: any) {
      setCronNotice({ type: "error", text: err.message });
    } finally {
      setCsvUploading(false);
    }
  };

  const handleToggleCron = async (enable: boolean) => {
    try {
      const res = await fetch("/api/crawler/cron/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          isEnabled: enable,
          batchSize: parseInt(cronBatchSize, 10) || 5,
          intervalMinutes: parseInt(cronIntervalMins, 10) || 15,
          delayBetweenItemsMs: parseInt(cronDelayMs, 10) || 7000,
          maxRetries: parseInt(cronMaxRetries, 10) || 3
        })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setCronNotice({
          type: "success",
          text: enable 
            ? `Cron Job Active! Will crawl ${data.config.batchSize} movies every ${data.config.intervalMinutes} minutes.`
            : "Cron Job paused."
        });
        fetchCronData();
      }
    } catch (err: any) {
      setCronNotice({ type: "error", text: err.message });
    }
  };

  const handleSaveCronConfig = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch("/api/crawler/cron/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          batchSize: parseInt(cronBatchSize, 10) || 5,
          intervalMinutes: parseInt(cronIntervalMins, 10) || 15,
          delayBetweenItemsMs: parseInt(cronDelayMs, 10) || 7000,
          maxRetries: parseInt(cronMaxRetries, 10) || 3
        })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setCronNotice({ type: "success", text: "Cron settings saved successfully!" });
        fetchCronData();
      }
    } catch (err: any) {
      setCronNotice({ type: "error", text: err.message });
    }
  };

  const handleRunBatchNow = async () => {
    setRunningBatchNow(true);
    setCronNotice(null);
    try {
      const res = await fetch("/api/crawler/cron/run-batch-now", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit: parseInt(cronBatchSize, 10) || 5 })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setCronNotice({
          type: "success",
          text: `Batch completed: ${data.fulfilled} fulfilled into Vault, ${data.failed} failed/retry, ${data.skipped} skipped.`
        });
        fetchCronData();
        fetchCrawlerData();
      } else {
        setCronNotice({ type: "error", text: data.error || data.message || "Batch run hit an error." });
      }
    } catch (err: any) {
      setCronNotice({ type: "error", text: err.message });
    } finally {
      setRunningBatchNow(false);
    }
  };

  const handleClearQueue = async (type: "all" | "completed" | "failed") => {
    if (!confirm(`Are you sure you want to clear ${type} items from the queue?`)) return;
    try {
      const res = await fetch("/api/crawler/cron/clear-queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type })
      });
      if (res.ok) {
        fetchCronData();
      }
    } catch (err) {
      console.warn("Clear queue error:", err);
    }
  };

  const handleEmergencyStop = async () => {
    try {
      const res = await fetch("/api/crawler/cron/stop-all", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        setCronNotice({ type: "success", text: "Emergency Stop triggered: All active background cron timers and crawls stopped!" });
        fetchCronData();
      }
    } catch (err: any) {
      setCronNotice({ type: "error", text: "Stop failed: " + err.message });
    }
  };

  const handleRequeueBatch = async (type: "failed" | "skipped" | "all" = "all") => {
    try {
      const res = await fetch("/api/crawler/cron/requeue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setCronNotice({
          type: "success",
          text: `Re-queued ${data.requeuedCount} items back to 'pending'! You don't need to re-upload your file!`
        });
        fetchCronData();
      }
    } catch (err: any) {
      setCronNotice({ type: "error", text: "Re-queue error: " + err.message });
    }
  };

  const handleRequestAuxCode = async (e: FormEvent) => {
    e.preventDefault();
    if (!auxPhone.trim()) return;
    setAuxLoading(true);
    setAuxNotice(null);
    try {
      const res = await fetch("/api/crawler/session/request-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: auxPhone.trim() })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setAuxCodeSent(true);
        setAuxNotice({ type: "success", text: data.message });
      } else {
        setAuxNotice({ type: "error", text: data.error || "Failed to send code." });
      }
    } catch (err: any) {
      setAuxNotice({ type: "error", text: "Error: " + err.message });
    } finally {
      setAuxLoading(false);
    }
  };

  const handleVerifyAuxCode = async (e: FormEvent) => {
    e.preventDefault();
    if (!auxCode.trim()) return;
    setAuxLoading(true);
    setAuxNotice(null);
    try {
      const res = await fetch("/api/crawler/session/verify-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: auxCode.trim(), password: auxPassword.trim() || undefined })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setAuxCodeSent(false);
        setAuxCode("");
        setAuxPassword("");
        setAuxNotice({ type: "success", text: `Auxiliary account connected as @${data.username}!` });
        fetchCrawlerData();
      } else {
        setAuxNotice({ type: "error", text: data.error || "Invalid code or 2FA password." });
      }
    } catch (err: any) {
      setAuxNotice({ type: "error", text: "Error: " + err.message });
    } finally {
      setAuxLoading(false);
    }
  };

  const handleDisconnectAux = async () => {
    if (!confirm("Disconnect auxiliary userbot session?")) return;
    setAuxLoading(true);
    try {
      await fetch("/api/crawler/session/disconnect", { method: "POST" });
      setAuxCodeSent(false);
      setAuxNotice({ type: "success", text: "Auxiliary session disconnected." });
      fetchCrawlerData();
    } catch (err: any) {
      setAuxNotice({ type: "error", text: "Error: " + err.message });
    } finally {
      setAuxLoading(false);
    }
  };

  const handleSaveVaultChannel = async (e: FormEvent) => {
    e.preventDefault();
    if (!vaultChannelInput.trim()) return;
    setVaultChannelSaving(true);
    setVaultChannelNotice(null);
    try {
      const res = await fetch("/api/crawler/vault-channel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel_id: vaultChannelInput.trim() })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setVaultChannelNotice("Vault Channel ID saved!");
        fetchCrawlerData();
      } else {
        setVaultChannelNotice("Error: " + (data.error || "Failed to save"));
      }
    } catch (err: any) {
      setVaultChannelNotice("Error: " + err.message);
    } finally {
      setVaultChannelSaving(false);
    }
  };

  const handleSaveManualSession = async (e: FormEvent) => {
    e.preventDefault();
    if (!manualSessionInput.trim()) return;
    setAuxLoading(true);
    setAuxNotice(null);
    try {
      const res = await fetch("/api/crawler/session/save-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session: manualSessionInput.trim() })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setShowManualSession(false);
        setManualSessionInput("");
        setAuxNotice({ type: "success", text: "Session string saved!" });
        fetchCrawlerData();
      } else {
        setAuxNotice({ type: "error", text: data.error || "Failed" });
      }
    } catch (err: any) {
      setAuxNotice({ type: "error", text: "Error: " + err.message });
    } finally {
      setAuxLoading(false);
    }
  };

  const fetchData = async () => {
    try {
      const [statusRes, usersRes, reqsRes, libRes] = await Promise.all([
        fetch("/api/status"),
        fetch("/api/users"),
        fetch("/api/requests"),
        fetch("/api/library")
      ]);
      if (statusRes.ok) {
        setStatus(await statusRes.json());
      }
      if (usersRes.ok) {
        const u = await usersRes.json();
        setBotUsersCount(u.count || 0);
      }
      if (reqsRes.ok) {
        const r = await reqsRes.json();
        setPendingRequests(r.pending || []);
        setAllRequests(r.all || []);
      }
      if (libRes.ok) {
        const l = await libRes.json();
        setLibraryFiles(l.files || []);
      }
      fetchWebhookStatus();
      fetchCrawlerData();
    } catch (e) {
      console.error(e);
    }
  };

  const fetchWebhookStatus = async () => {
    try {
      const res = await fetch("/api/telegram/webhook-status");
      if (res.ok) {
        const data = await res.json();
        setWebhookInfo(data.webhookInfo);
        setWebhookMode(data.mode);
        setDetectedUrl(data.detectedAppUrl || "");
        if (data.webhookInfo?.url && !customWebhookUrl) {
          setCustomWebhookUrl(data.webhookInfo.url);
        }
      }
    } catch (e) {
      console.warn("Could not fetch webhook status:", e);
    }
  };

  const fetchCrawlerData = async () => {
    try {
      const [cStatusRes, targetsRes, botsRes, logsRes, jobsRes] = await Promise.all([
        fetch("/api/crawler/status"),
        fetch("/api/crawler/targets"),
        fetch("/api/crawler/bots"),
        fetch("/api/crawler/logs"),
        fetch("/api/crawler/jobs")
      ]);
      if (cStatusRes.ok) setCrawlerStatus(await cStatusRes.json());
      if (targetsRes.ok) setTargets(await targetsRes.json());
      if (botsRes.ok) {
        const b = await botsRes.json();
        setBots(b);
        if (b.length > 0 && !playgroundBot) {
          setPlaygroundBot(b[0].bot_username);
        }
      }
      if (logsRes.ok) setLogs(await logsRes.json());
      if (jobsRes.ok) setSearchJobs(await jobsRes.json());

      // Fetch joined dialogs if auxiliary session is active
      fetch("/api/crawler/joined-dialogs")
        .then(r => r.ok ? r.json() : [])
        .then(d => { if (Array.isArray(d)) setJoinedDialogs(d); })
        .catch(() => {});
      fetchCronData();
    } catch (err) {
      console.warn("Crawler fetch error:", err);
    }
  };

  useEffect(() => {
    fetchData();
    const int = setInterval(fetchData, 10000);
    return () => clearInterval(int);
  }, []);

  const handleSetWebhook = async (urlToUse?: string) => {
    const target = (urlToUse || customWebhookUrl || "").trim();
    if (!target) return alert("Please enter a public HTTPS URL.");
    setWebhookLoading(true);
    try {
      const res = await fetch("/api/telegram/set-webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: target })
      });
      const data = await res.json();
      if (res.ok) {
        fetchWebhookStatus();
      } else {
        alert("Failed to set webhook: " + (data.error || "Unknown error"));
      }
    } catch (err: any) {
      alert("Error setting webhook: " + err.message);
    } finally {
      setWebhookLoading(false);
    }
  };

  const handleDeleteWebhook = async () => {
    setWebhookLoading(true);
    try {
      const res = await fetch("/api/telegram/delete-webhook", { method: "POST" });
      if (res.ok) {
        fetchWebhookStatus();
      }
    } catch (err: any) {
      alert("Error: " + err.message);
    } finally {
      setWebhookLoading(false);
    }
  };

  const handleTriggerCloudSync = async () => {
    setCloudSyncLoading(true);
    setCloudSyncMsg(null);
    try {
      const res = await fetch("/api/firebase/sync", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        setCloudSyncMsg(`Synced ${data.count} movies.`);
        fetchData();
      } else {
        setCloudSyncMsg("Sync failed: " + data.error);
      }
    } catch (err: any) {
      setCloudSyncMsg("Sync error: " + err.message);
    } finally {
      setCloudSyncLoading(false);
    }
  };

  const handleTriggerReEngagement = async () => {
    setEngagementLoading(true);
    setEngagementMsg(null);
    try {
      const res = await fetch("/api/bot/trigger-followup", { method: "POST" });
      const data = await res.json();
      if (res.ok && data.success) {
        setEngagementMsg(`Spotlight sent to ${data.sent} users for "${data.title}"!`);
      } else {
        setEngagementMsg(data.error || "Failed");
      }
    } catch (err: any) {
      setEngagementMsg("Error: " + err.message);
    } finally {
      setEngagementLoading(false);
    }
  };

  const handleSendBroadcast = async () => {
    if (!broadcastMsg.trim()) return;
    setBroadcastSending(true);
    setBroadcastStatus(null);
    try {
      const res = await fetch("/api/admin/broadcast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: broadcastMsg.trim() })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setBroadcastStatus(`Delivered to ${data.sent} users!`);
        setBroadcastMsg("");
      } else {
        setBroadcastStatus(data.error || "Failed");
      }
    } catch (err: any) { setBroadcastStatus("Error: " + err.message); } 
    finally { setBroadcastSending(false); }
  };

  const handleFulfillRequest = async (id: number) => {
    try {
      const res = await fetch(`/api/requests/${id}/fulfill`, { method: "POST" });
      if (res.ok) {
        fetchData();
      } else {
        const data = await res.json();
        alert(data.error || "Failed to fulfill request");
      }
    } catch (err: any) {
      alert("Error: " + err.message);
    }
  };

  // 1-Click Autonomous Bot Auto-Fetch for any request
  const handleAutoFetchRequest = async (id: number) => {
    setAutoFetchingId(id);
    setAutoFetchNotice(null);
    try {
      const res = await fetch(`/api/requests/${id}/auto-fetch`, { method: "POST" });
      const data = await res.json();
      if (res.ok && data.success) {
        setAutoFetchNotice(`Auto-fetched "${data.title}" via ${data.botUsed} and added to Vault!`);
        fetchData();
      } else {
        setAutoFetchNotice(`Auto-fetch note: ${data.message || "Could not resolve"}`);
      }
    } catch (err: any) {
      setAutoFetchNotice(`Error: ${err.message}`);
    } finally {
      setAutoFetchingId(null);
    }
  };

  const handleManualAdd = async (e: FormEvent) => {
    e.preventDefault();
    if (!newFileTitle.trim() || !newFileId.trim()) return;
    try {
      await fetch("/api/library/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          movie_title: newFileTitle.trim(),
          year: newFileYear.trim(),
          quality: newFileQuality,
          telegram_file_id: newFileId.trim(),
          file_size: 1800000000,
        })
      });
      setNewFileTitle(""); setNewFileId(""); setNewFileYear(""); setShowAddForm(false);
      fetchData();
    } catch (err) {}
  };

  // ================= CRAWLER HANDLERS =================
  const handleRunBackfill = async (targetId: number) => {
    setBackfillingId(targetId);
    setBackfillNotice(null);
    try {
      const res = await fetch(`/api/crawler/targets/${targetId}/backfill`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit: backfillDepth })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setBackfillNotice(`Crawl complete: scanned ${data.scanned} msgs, auto-ingested ${data.ingested} movies into Vault!`);
        fetchData();
      } else {
        setBackfillNotice(`Backfill error: ${data.error || "Unknown"}`);
      }
    } catch (err: any) {
      setBackfillNotice(`Error: ${err.message}`);
    } finally {
      setBackfillingId(null);
    }
  };

  const handleToggleTargetStatus = async (target: CrawlerTarget) => {
    const nextStatus = target.status === "active" ? "paused" : "active";
    try {
      await fetch(`/api/crawler/targets/${target.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus })
      });
      fetchCrawlerData();
    } catch (err) {
      console.error(err);
    }
  };

  const handleDeleteTarget = async (id: number) => {
    try {
      setTargets(prev => prev.filter(t => t.id !== id));
      const res = await fetch(`/api/crawler/targets/${id}`, { method: "DELETE" });
      if (res.ok) {
        setBackfillNotice("Target channel removed successfully.");
        fetchCrawlerData();
      }
    } catch (err) {
      console.error("Delete target error:", err);
    }
  };

  const handleSaveEditTarget = async (e: FormEvent) => {
    e.preventDefault();
    if (!editingTarget) return;
    try {
      const res = await fetch(`/api/crawler/targets/${editingTarget.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: editingTarget.title,
          channel_identifier: editingTarget.channel_identifier,
          min_file_size_mb: editingTarget.min_file_size_mb,
          quality_filter: editingTarget.quality_filter,
          status: editingTarget.status
        })
      });
      if (res.ok) {
        setEditingTarget(null);
        fetchCrawlerData();
      }
    } catch (err) {
      console.error("Save edit target error:", err);
    }
  };

  const handleAddTarget = async (e: FormEvent) => {
    e.preventDefault();
    if (!targetIdentifier.trim()) return;
    try {
      const res = await fetch("/api/crawler/targets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channel_identifier: targetIdentifier.trim(),
          title: targetTitle.trim() || targetIdentifier.trim(),
          min_file_size_mb: parseInt(targetMinSize, 10) || 500,
          quality_filter: targetQuality
        })
      });
      if (res.ok) {
        setTargetIdentifier("");
        setTargetTitle("");
        setShowAddTargetModal(false);
        fetchCrawlerData();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleAddBot = async (e: FormEvent) => {
    e.preventDefault();
    if (!botUsername.trim()) return;
    try {
      const res = await fetch("/api/crawler/bots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bot_username: botUsername.trim().startsWith("@") ? botUsername.trim() : `@${botUsername.trim()}`,
          bot_type: botType,
          command_template: botCommandTemplate.trim(),
          priority: parseInt(botPriority, 10) || 1
        })
      });
      if (res.ok) {
        setBotUsername("");
        setShowAddBotModal(false);
        fetchCrawlerData();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleQuickToggleBotType = async (b: SearchBot) => {
    const nextType = b.bot_type === "inline" ? "command" : "inline";
    const nextTemplate = nextType === "command" ? "/search {query}" : "/search {query}";
    try {
      setBots(prev => prev.map(item => item.id === b.id ? { ...item, bot_type: nextType, command_template: nextTemplate } : item));
      await fetch(`/api/crawler/bots/${b.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bot_type: nextType, command_template: nextTemplate })
      });
      fetchCrawlerData();
    } catch (err) {
      console.error("Toggle bot type error:", err);
    }
  };

  const handleQuickToggleBotStatus = async (b: SearchBot) => {
    const nextStatus = b.status === "active" ? "inactive" : "active";
    try {
      setBots(prev => prev.map(item => item.id === b.id ? { ...item, status: nextStatus } : item));
      await fetch(`/api/crawler/bots/${b.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus })
      });
      fetchCrawlerData();
    } catch (err) {
      console.error("Toggle bot status error:", err);
    }
  };

  const handleSaveEditBot = async (e: FormEvent) => {
    e.preventDefault();
    if (!editingBot) return;
    try {
      const res = await fetch(`/api/crawler/bots/${editingBot.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bot_username: editingBot.bot_username.startsWith("@") ? editingBot.bot_username : `@${editingBot.bot_username}`,
          bot_type: editingBot.bot_type,
          command_template: editingBot.command_template,
          priority: editingBot.priority,
          status: editingBot.status
        })
      });
      if (res.ok) {
        setEditingBot(null);
        fetchCrawlerData();
      }
    } catch (err) {
      console.error("Save edit bot error:", err);
    }
  };

  const handleDeleteBot = async (id: number) => {
    try {
      setBots(prev => prev.filter(b => b.id !== id));
      const res = await fetch(`/api/crawler/bots/${id}`, { method: "DELETE" });
      if (res.ok) {
        fetchCrawlerData();
      }
    } catch (err) {
      console.error("Delete bot error:", err);
    }
  };

  const handleTestPlayground = async (e: FormEvent) => {
    e.preventDefault();
    if (!playgroundQuery.trim()) return;
    setPlaygroundLoading(true);
    setPlaygroundResult(null);
    setPlaygroundNotice(null);
    try {
      const botToUse = playgroundBot || (bots[0]?.bot_username || "@TGMovieSearchBot");
      const res = await fetch("/api/crawler/bots/test-query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bot_username: botToUse,
          query: playgroundQuery.trim()
        })
      });
      const data = await res.json();
      if (res.ok) {
        setPlaygroundResult(data);
      } else {
        setPlaygroundNotice(data.error || "Query failed");
      }
    } catch (err: any) {
      setPlaygroundNotice("Query error: " + err.message);
    } finally {
      setPlaygroundLoading(false);
    }
  };

  const handleForwardPlaygroundResult = async (buttonRow?: number, buttonCol?: number, btnIdx?: number) => {
    if (!playgroundResult?.messageId) {
      // Fallback to query title if no message ID
      if (!playgroundResult?.match) return;
    }
    setPlaygroundForwarding(true);
    if (btnIdx !== undefined) setForwardingButtonIdx(btnIdx);
    setPlaygroundNotice(null);
    try {
      const res = await fetch("/api/crawler/bots/forward", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bot_username: playgroundResult.bot,
          message_id: playgroundResult.messageId,
          button_row: buttonRow,
          button_col: buttonCol
        })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setPlaygroundNotice(`✅ ${data.message}`);
        fetchData();
        fetchCrawlerData();
      } else {
        setPlaygroundNotice(data.error || "Failed to forward file to Vault channel.");
      }
    } catch (err: any) {
      setPlaygroundNotice("Forward error: " + err.message);
    } finally {
      setPlaygroundForwarding(false);
      setForwardingButtonIdx(null);
    }
  };

  return (
    <div className="min-h-screen bg-[#141414] text-zinc-200 font-sans p-3.5 sm:p-6 md:p-10 overflow-x-hidden">
      <div className="max-w-7xl mx-auto space-y-6 sm:space-y-8">
        
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-zinc-800">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-white flex items-center gap-2.5 tracking-tight">
              <Database className="w-6 h-6 sm:w-7 sm:h-7 text-red-600" />
              Management Console
            </h1>
            <p className="text-xs sm:text-sm text-zinc-400 mt-1 max-w-2xl">
              Control center for BusiMovie. Manage cloud sync, MTProto crawlers, search bots, and scheduled batch ingestion.
            </p>
          </div>
          <div className="flex items-center gap-2.5 flex-wrap">
             <button 
               onClick={() => setShowAddForm(!showAddForm)} 
               className="flex-1 sm:flex-none px-4 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-white rounded-xl flex items-center justify-center gap-2 text-xs sm:text-sm font-semibold transition border border-zinc-700"
             >
               <FileVideo className="w-4 h-4" /> Index Media
             </button>
             <button 
               onClick={() => setActiveTab("automation")} 
               className="flex-1 sm:flex-none px-4 py-2.5 bg-red-600 hover:bg-red-500 text-white rounded-xl flex items-center justify-center gap-2 text-xs sm:text-sm font-semibold transition shadow-md"
             >
               <Bot className="w-4 h-4" /> Crawlers & Bots
             </button>
          </div>
        </div>

        {/* Index Form */}
        {showAddForm && (
          <form onSubmit={handleManualAdd} className="p-4 sm:p-6 bg-zinc-900 border border-zinc-800 rounded-2xl space-y-4 animate-in fade-in slide-in-from-top-4">
            <h3 className="text-sm sm:text-base font-semibold text-white">Index Media File Reference</h3>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3.5">
              <div className="sm:col-span-2">
                <label className="block text-xs text-zinc-300 mb-1.5 font-medium">Movie Title</label>
                <input type="text" value={newFileTitle} onChange={e => setNewFileTitle(e.target.value)} required className="w-full px-3.5 py-2.5 bg-zinc-950 border border-zinc-800 rounded-xl outline-none focus:border-zinc-500 text-sm text-white" />
              </div>
              <div>
                <label className="block text-xs text-zinc-300 mb-1.5 font-medium">Year</label>
                <input type="text" value={newFileYear} onChange={e => setNewFileYear(e.target.value)} placeholder="e.g. 2024" className="w-full px-3.5 py-2.5 bg-zinc-950 border border-zinc-800 rounded-xl outline-none focus:border-zinc-500 text-sm text-white" />
              </div>
              <div>
                <label className="block text-xs text-zinc-300 mb-1.5 font-medium">Quality</label>
                <select value={newFileQuality} onChange={e => setNewFileQuality(e.target.value)} className="w-full px-3.5 py-2.5 bg-zinc-950 border border-zinc-800 rounded-xl outline-none focus:border-zinc-500 text-sm text-white">
                  <option value="1080p">1080p</option><option value="720p">720p</option><option value="4K">4K</option>
                </select>
              </div>
              <div className="sm:col-span-4">
                <label className="block text-xs text-zinc-300 mb-1.5 font-medium">Telegram File ID</label>
                <input type="text" value={newFileId} onChange={e => setNewFileId(e.target.value)} required className="w-full px-3.5 py-2.5 bg-zinc-950 border border-zinc-800 rounded-xl outline-none focus:border-zinc-500 text-sm text-white font-mono" />
              </div>
            </div>
            <div className="flex justify-end gap-2.5 pt-2">
              <button type="button" onClick={() => setShowAddForm(false)} className="px-4 py-2 text-sm text-zinc-400 hover:text-white transition">Cancel</button>
              <button type="submit" className="px-5 py-2 bg-red-600 hover:bg-red-500 text-white text-sm font-semibold rounded-xl transition">Save Reference</button>
            </div>
          </form>
        )}

        {/* Tab Navigation */}
        <div className="flex items-center gap-1.5 sm:gap-2 border-b border-zinc-800 pb-1 overflow-x-auto no-scrollbar">
          {[
            { id: "overview", label: "Overview", icon: Database },
            { id: "automation", label: "Crawlers & Bots", icon: Bot },
            { id: "requests", label: "User Requests", icon: Bell },
            { id: "library", label: "Vault Inventory", icon: HardDrive },
            { id: "comms", label: "Engagement", icon: Megaphone }
          ].map(tab => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`px-3.5 py-2.5 text-xs sm:text-sm font-semibold flex items-center gap-2 whitespace-nowrap rounded-xl transition-all ${
                  isActive 
                    ? "bg-zinc-800 text-white shadow-sm" 
                    : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900"
                }`}
              >
                <Icon className={`w-4 h-4 ${isActive ? "text-red-500" : "text-zinc-500"}`} />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* ================= OVERVIEW TAB ================= */}
        {activeTab === "overview" && (
          <div className="space-y-10 animate-in fade-in duration-300">
            {/* Core Stats Bento Grid */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
              <div className="bg-zinc-900/40 border border-zinc-800/60 p-6 rounded-2xl flex flex-col justify-between hover:bg-zinc-900/60 transition duration-300">
                 <div className="flex items-center justify-between text-zinc-400 mb-4">
                   <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Total Users</span>
                   <div className="p-2 bg-blue-500/10 text-blue-400 rounded-lg"><Users className="w-4 h-4"/></div>
                 </div>
                 <div>
                   <p className="text-4xl font-bold text-zinc-100 tracking-tight">{botUsersCount}</p>
                   <p className="text-xs text-zinc-500 mt-2 font-medium">Active in Telegram Bot</p>
                 </div>
              </div>
              <div className="bg-zinc-900/40 border border-zinc-800/60 p-6 rounded-2xl flex flex-col justify-between hover:bg-zinc-900/60 transition duration-300">
                 <div className="flex items-center justify-between text-zinc-400 mb-4">
                   <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Vault Capacity</span>
                   <div className="p-2 bg-purple-500/10 text-purple-400 rounded-lg"><HardDrive className="w-4 h-4"/></div>
                 </div>
                 <div>
                   <p className="text-4xl font-bold text-zinc-100 tracking-tight">{status?.stats.libraryFiles || 0}</p>
                   <p className="text-xs text-zinc-500 mt-2 font-medium">{formatBytes(status?.stats.totalVaultBytes)} Indexed</p>
                 </div>
              </div>
              <div className="bg-zinc-900/40 border border-zinc-800/60 p-6 rounded-2xl flex flex-col justify-between hover:bg-zinc-900/60 transition duration-300">
                 <div className="flex items-center justify-between text-zinc-400 mb-4">
                   <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Search Queries</span>
                   <div className="p-2 bg-amber-500/10 text-amber-400 rounded-lg"><Search className="w-4 h-4"/></div>
                 </div>
                 <div>
                   <p className="text-4xl font-bold text-zinc-100 tracking-tight">{status?.stats.searches || 0}</p>
                   <p className="text-xs text-zinc-500 mt-2 font-medium">Since last boot</p>
                 </div>
              </div>
              <div className="bg-zinc-900/40 border border-zinc-800/60 p-6 rounded-2xl flex flex-col justify-between hover:bg-zinc-900/60 transition duration-300">
                 <div className="flex items-center justify-between text-zinc-400 mb-4">
                   <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Pending Requests</span>
                   <div className="p-2 bg-rose-500/10 text-rose-400 rounded-lg"><Bell className="w-4 h-4"/></div>
                 </div>
                 <div>
                   <p className="text-4xl font-bold text-zinc-100 tracking-tight">{status?.stats.pendingRequests || 0}</p>
                   <p className="text-xs text-zinc-500 mt-2 font-medium">Auto-fetch enabled</p>
                 </div>
              </div>
            </div>

            {/* Infrastructure Control Panel */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              
              {/* Firebase Persistence Card */}
              <div className="bg-zinc-900/50 border border-zinc-800/80 p-8 rounded-3xl flex flex-col justify-between relative overflow-hidden">
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="p-3 bg-amber-500/10 text-amber-400 rounded-xl">
                        <Database className="w-6 h-6" />
                      </div>
                      <div>
                        <h2 className="text-lg font-bold text-zinc-100">Google Cloud Firestore</h2>
                        <p className="text-xs text-zinc-500">Persistent Cloud Database & Backup</p>
                      </div>
                    </div>
                    <span className="px-3 py-1 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-xs font-bold rounded-full flex items-center gap-1.5">
                      <ShieldCheck className="w-3.5 h-3.5" /> Synchronized
                    </span>
                  </div>
                  <p className="text-sm text-zinc-400 leading-relaxed">
                    All indexed movies, requests, and Telegram file references are continuously mirrored to Firestore for high availability across deployments.
                  </p>
                </div>
                
                <div className="pt-6 border-t border-zinc-800/60 flex items-center justify-between mt-6">
                  <span className="text-xs text-zinc-500">{cloudSyncMsg || "Syncs every boot automatically"}</span>
                  <button 
                    onClick={handleTriggerCloudSync} 
                    disabled={cloudSyncLoading}
                    className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-white rounded-xl text-xs font-semibold transition flex items-center gap-2 disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${cloudSyncLoading ? "animate-spin text-amber-400" : ""}`} />
                    {cloudSyncLoading ? "Syncing..." : "Force Sync Now"}
                  </button>
                </div>
              </div>

              {/* Telegram Webhook & Routing Card */}
              <div className="bg-zinc-900/50 border border-zinc-800/80 p-8 rounded-3xl flex flex-col justify-between">
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="p-3 bg-blue-500/10 text-blue-400 rounded-xl">
                        <Webhook className="w-6 h-6" />
                      </div>
                      <div>
                        <h2 className="text-lg font-bold text-zinc-100">Telegram Bot Delivery</h2>
                        <p className="text-xs text-zinc-500">Dual-Mode: 24/7 Webhook or Polling</p>
                      </div>
                    </div>
                    <span className={`px-3 py-1 text-xs font-bold rounded-full flex items-center gap-1.5 ${
                      webhookMode === "webhook" 
                        ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" 
                        : "bg-blue-500/10 text-blue-400 border border-blue-500/20"
                    }`}>
                      <Radio className="w-3.5 h-3.5 animate-pulse" /> {webhookMode === "webhook" ? "Webhook Live" : "Polling Active"}
                    </span>
                  </div>
                  <p className="text-sm text-zinc-400 leading-relaxed">
                    {webhookMode === "webhook" 
                      ? `Receiving real-time events from: ${webhookInfo?.url || detectedUrl}` 
                      : "Running in instant Long-Polling mode for zero-latency development & testing."}
                  </p>
                </div>

                <div className="pt-6 border-t border-zinc-800/60 flex items-center justify-between mt-6">
                  <span className="text-xs text-zinc-500 font-mono truncate max-w-[220px]">
                    {webhookInfo?.url ? "Production Webhook" : "Local dev polling"}
                  </span>
                  <div className="flex gap-2">
                    {webhookMode === "webhook" ? (
                      <button 
                        onClick={handleDeleteWebhook}
                        disabled={webhookLoading}
                        className="px-3.5 py-2 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20 rounded-xl text-xs font-semibold transition"
                      >
                        Switch to Polling
                      </button>
                    ) : (
                      <button 
                        onClick={() => handleSetWebhook(detectedUrl)}
                        disabled={webhookLoading || !detectedUrl}
                        className="px-3.5 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-semibold transition shadow-md shadow-blue-500/20"
                      >
                        Set Production Webhook
                      </button>
                    )}
                  </div>
                </div>
              </div>

            </div>

            {/* Smart Retention Spotlight Trigger */}
            <div className="p-6 bg-gradient-to-r from-blue-950/30 to-purple-950/20 border border-zinc-800/80 rounded-2xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-purple-500/20 text-purple-300 rounded-xl">
                  <Sparkles className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-zinc-100">Intelligent 6-Hour Audience Spotlight</h4>
                  <p className="text-xs text-zinc-400 mt-0.5">Dispatches personalized movie recommendations to Telegram users based on vault additions.</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                {engagementMsg && <span className="text-xs text-emerald-400 font-medium">{engagementMsg}</span>}
                <button
                  onClick={handleTriggerReEngagement}
                  disabled={engagementLoading}
                  className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-white text-xs font-semibold rounded-lg transition whitespace-nowrap"
                >
                  {engagementLoading ? "Running..." : "Trigger Spotlight Now"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ================= AUTOMATION & CRAWLERS TAB ================= */}
        {activeTab === "automation" && (
          <div className="space-y-6 animate-in fade-in duration-300">
            
            {/* Top KPI Metrics Bar */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4">
              <div className="bg-zinc-900/60 border border-zinc-800/80 p-4 rounded-xl">
                <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wide">Target Channels</span>
                <p className="text-xl sm:text-2xl font-bold text-zinc-100 mt-1">{crawlerStatus?.activeTargets || 0} <span className="text-xs font-normal text-zinc-500">/ {targets.length}</span></p>
                <span className="text-xs text-emerald-400 font-medium flex items-center gap-1.5 mt-1.5">
                  <Radio className="w-3.5 h-3.5 animate-pulse" /> Live Monitoring
                </span>
              </div>
              <div className="bg-zinc-900/60 border border-zinc-800/80 p-4 rounded-xl">
                <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wide">Search Bots</span>
                <p className="text-xl sm:text-2xl font-bold text-zinc-100 mt-1">{crawlerStatus?.activeBots || 0} <span className="text-xs font-normal text-zinc-500">Active</span></p>
                <span className="text-xs text-zinc-400 font-medium mt-1.5 block">Priority Fallback</span>
              </div>
              <div className="bg-zinc-900/60 border border-zinc-800/80 p-4 rounded-xl">
                <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wide">Search Queue</span>
                <p className="text-xl sm:text-2xl font-bold text-zinc-100 mt-1">{crawlerStatus?.pendingJobsCount || 0}</p>
                <span className="text-xs text-amber-400 font-medium mt-1.5 block">Auto-fulfillment</span>
              </div>
              <div className="bg-zinc-900/60 border border-zinc-800/80 p-4 rounded-xl">
                <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wide">Bot Fulfillments</span>
                <p className="text-xl sm:text-2xl font-bold text-zinc-100 mt-1">{crawlerStatus?.fulfilledJobsCount || 0}</p>
                <span className="text-xs text-emerald-400 font-medium mt-1.5 block">Added to Vault</span>
              </div>
              <div className="bg-zinc-900/60 border border-zinc-800/80 p-4 rounded-xl col-span-2 sm:col-span-1">
                <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wide">FloodWait Protection</span>
                <p className="text-sm sm:text-base font-bold text-emerald-400 mt-1.5 flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4" />
                  {crawlerStatus?.floodWaitActive ? `Cooldown: ${crawlerStatus.floodWaitCooldownSeconds}s` : "Optimal"}
                </p>
                <span className="text-xs text-zinc-500 mt-1 block">Adaptive Backoff</span>
              </div>
            </div>

            {/* Notification alert if backfill or action performed */}
            {backfillNotice && (
              <div className="p-4 bg-zinc-900 border border-zinc-800 text-zinc-200 rounded-xl text-sm flex items-center justify-between">
                <span>{backfillNotice}</span>
                <button onClick={() => setBackfillNotice(null)} className="text-xs text-zinc-400 hover:text-white underline">Dismiss</button>
              </div>
            )}

            {/* Auxiliary Userbot & Private Storage Vault Card */}
            <div className="bg-zinc-900/60 border border-zinc-800/80 rounded-2xl p-4 sm:p-6 space-y-6">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-zinc-800/80 pb-4">
                <div>
                  <h3 className="text-lg sm:text-xl font-bold text-zinc-100 flex items-center gap-2">
                    <Bot className="w-5 h-5 text-zinc-300" />
                    Telegram Userbot & Vault Channel Integration
                  </h3>
                  <p className="text-xs sm:text-sm text-zinc-400 mt-1">
                    Connect your auxiliary account for background crawling and link your private archive channel.
                  </p>
                </div>
                <div className="flex items-center gap-2 text-xs flex-wrap">
                  <span className={`px-3 py-1.5 rounded-lg font-medium flex items-center gap-1.5 ${
                    crawlerStatus?.auxiliarySession?.apiIdConfigured 
                      ? "bg-zinc-800 text-emerald-400 border border-zinc-700" 
                      : "bg-zinc-800 text-amber-400 border border-zinc-700"
                  }`}>
                    <KeyRound className="w-3.5 h-3.5" />
                    API Credentials: {crawlerStatus?.auxiliarySession?.apiIdConfigured ? "Active" : "Missing"}
                  </span>
                  <span className={`px-3 py-1.5 rounded-lg font-medium flex items-center gap-1.5 ${
                    crawlerStatus?.auxiliarySession?.connected 
                      ? "bg-zinc-800 text-emerald-400 border border-zinc-700" 
                      : "bg-zinc-800 text-zinc-400 border border-zinc-700"
                  }`}>
                    <Bot className="w-3.5 h-3.5" />
                    Userbot: {crawlerStatus?.auxiliarySession?.connected ? `@${crawlerStatus.auxiliarySession.username || "Connected"}` : "Standby"}
                  </span>
                </div>
              </div>

              {auxNotice && (
                <div className={`p-3.5 rounded-xl text-xs sm:text-sm flex items-center justify-between ${
                  auxNotice.type === "success" 
                    ? "bg-emerald-500/10 border border-emerald-500/20 text-emerald-300"
                    : "bg-rose-500/10 border border-rose-500/20 text-rose-300"
                }`}>
                  <span>{auxNotice.text}</span>
                  <button onClick={() => setAuxNotice(null)} className="text-xs underline ml-2">Dismiss</button>
                </div>
              )}

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
                
                {/* 1. Auxiliary Telegram Account Authentication */}
                <div className="bg-zinc-950 border border-zinc-800/80 rounded-xl p-4 sm:p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-bold text-zinc-100 flex items-center gap-2">
                      <Phone className="w-4 h-4 text-zinc-400" /> 1. Auxiliary Telegram Account
                    </h4>
                    {crawlerStatus?.auxiliarySession?.connected && (
                      <button
                        onClick={handleDisconnectAux}
                        disabled={auxLoading}
                        className="px-2.5 py-1 text-xs bg-zinc-900 hover:bg-rose-950/40 text-rose-400 border border-zinc-800 rounded-lg flex items-center gap-1 transition"
                      >
                        <LogOut className="w-3.5 h-3.5" /> Disconnect
                      </button>
                    )}
                  </div>

                  {crawlerStatus?.auxiliarySession?.connected ? (
                    <div className="p-4 bg-zinc-900/80 border border-zinc-800 rounded-xl space-y-2">
                      <div className="flex items-center gap-2 text-emerald-400 font-semibold text-xs sm:text-sm">
                        <CheckCircle2 className="w-4 h-4" /> Live Auxiliary Session Active
                      </div>
                      <p className="text-xs sm:text-sm text-zinc-300">
                        Logged in as <strong className="text-white">@{crawlerStatus.auxiliarySession.username || crawlerStatus.auxiliarySession.firstName}</strong>
                        {crawlerStatus.auxiliarySession.phone && <span className="text-zinc-400"> ({crawlerStatus.auxiliarySession.phone})</span>}.
                      </p>
                      <p className="text-xs text-zinc-500">
                        Autonomous channel crawler & search engine are using this account session with flood-protection.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <p className="text-xs sm:text-sm text-zinc-400">
                        Log in with your auxiliary phone number. Telegram will send a verification code directly to your Telegram app.
                      </p>

                      {!auxCodeSent ? (
                        <form onSubmit={handleRequestAuxCode} className="space-y-3">
                          <div>
                            <label className="block text-xs text-zinc-400 font-medium mb-1.5">Auxiliary Phone Number (with Country Code)</label>
                            <input
                              type="tel"
                              placeholder="+1234567890"
                              value={auxPhone}
                              onChange={e => setAuxPhone(e.target.value)}
                              required
                              className="w-full px-4 py-2.5 bg-zinc-900 border border-zinc-800 rounded-xl text-sm text-white placeholder-zinc-500 outline-none focus:border-zinc-500"
                            />
                          </div>
                          <button
                            type="submit"
                            disabled={auxLoading || !auxPhone.trim()}
                            className="w-full py-2.5 bg-zinc-100 hover:bg-white text-zinc-950 disabled:opacity-50 rounded-xl text-xs sm:text-sm font-semibold flex items-center justify-center gap-2 transition"
                          >
                            {auxLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Phone className="w-4 h-4" />}
                            {auxLoading ? "Connecting to Telegram..." : "Send Telegram Login Code"}
                          </button>
                        </form>
                      ) : (
                        <form onSubmit={handleVerifyAuxCode} className="space-y-3 animate-in fade-in duration-200">
                          <div className="p-3 bg-zinc-900 border border-zinc-800 rounded-xl text-xs text-zinc-300">
                            Code sent! Open Telegram on your auxiliary account and check the official chat from <strong>Telegram</strong> for the code.
                          </div>
                          <div>
                            <label className="block text-xs text-zinc-400 font-medium mb-1.5">5-Digit Verification Code</label>
                            <input
                              type="text"
                              placeholder="e.g. 58291"
                              value={auxCode}
                              onChange={e => setAuxCode(e.target.value)}
                              required
                              className="w-full px-4 py-2.5 bg-zinc-900 border border-zinc-800 rounded-xl text-sm text-white placeholder-zinc-500 outline-none focus:border-zinc-500 tracking-widest font-mono"
                            />
                          </div>
                          <div>
                            <label className="block text-xs text-zinc-400 font-medium mb-1.5">2FA Password (If enabled on account)</label>
                            <input
                              type="password"
                              placeholder="Optional 2-Step Password"
                              value={auxPassword}
                              onChange={e => setAuxPassword(e.target.value)}
                              className="w-full px-4 py-2.5 bg-zinc-900 border border-zinc-800 rounded-xl text-sm text-white placeholder-zinc-500 outline-none focus:border-zinc-500"
                            />
                          </div>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => setAuxCodeSent(false)}
                              className="px-4 py-2.5 text-xs text-zinc-400 hover:text-white bg-zinc-900 border border-zinc-800 rounded-xl"
                            >
                              Back
                            </button>
                            <button
                              type="submit"
                              disabled={auxLoading || !auxCode.trim()}
                              className="flex-1 py-2.5 bg-zinc-100 hover:bg-white text-zinc-950 disabled:opacity-50 rounded-xl text-xs sm:text-sm font-semibold flex items-center justify-center gap-2 transition"
                            >
                              {auxLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                              {auxLoading ? "Verifying..." : "Verify & Save Session"}
                            </button>
                          </div>
                        </form>
                      )}

                      {/* Manual Session String Expander */}
                      <div className="pt-2 border-t border-zinc-800/80">
                        <button
                          type="button"
                          onClick={() => setShowManualSession(!showManualSession)}
                          className="text-xs text-zinc-400 hover:text-zinc-200 flex items-center gap-1.5"
                        >
                          {showManualSession ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                          Or paste pre-generated StringSession
                        </button>

                        {showManualSession && (
                          <form onSubmit={handleSaveManualSession} className="mt-3 space-y-2">
                            <textarea
                              rows={2}
                              placeholder="Paste Telethon or GramJS 1BVts..."
                              value={manualSessionInput}
                              onChange={e => setManualSessionInput(e.target.value)}
                              className="w-full p-2.5 bg-zinc-900 border border-zinc-800 rounded-xl text-xs text-white font-mono"
                            />
                            <button
                              type="submit"
                              disabled={auxLoading || !manualSessionInput.trim()}
                              className="px-3.5 py-2 bg-zinc-800 hover:bg-zinc-700 text-white rounded-xl text-xs font-semibold"
                            >
                              Save StringSession
                            </button>
                          </form>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {/* 2. Private Storage Vault Channel */}
                <div className="bg-zinc-950 border border-zinc-800/80 rounded-xl p-4 sm:p-5 space-y-4">
                  <h4 className="text-sm font-bold text-zinc-100 flex items-center gap-2">
                    <Database className="w-4 h-4 text-zinc-400" /> 2. Private Storage Vault Channel
                  </h4>
                  <p className="text-xs sm:text-sm text-zinc-400">
                    Your private Telegram channel where movies are archived. The bot must be added as an Administrator.
                  </p>

                  <div className="p-3.5 bg-zinc-900 border border-zinc-800 rounded-xl text-xs space-y-1">
                    <div className="text-xs text-zinc-500 uppercase font-semibold flex items-center justify-between">
                      <span>Active Storage Channel</span>
                      {crawlerStatus?.auxiliarySession?.vaultChannelId && (
                        <span className="text-xs text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded font-mono">
                          Linked & Active
                        </span>
                      )}
                    </div>
                    <div className="font-mono text-zinc-200 font-bold text-sm">
                      {crawlerStatus?.auxiliarySession?.vaultChannelId || "Not configured yet"}
                    </div>
                  </div>

                  {vaultChannelNotice && (
                    <div className="p-3 bg-zinc-900 border border-zinc-800 text-zinc-200 rounded-xl text-xs">
                      {vaultChannelNotice}
                    </div>
                  )}

                  <form onSubmit={handleSaveVaultChannel} className="space-y-3">
                    <div>
                      <label className="block text-xs text-zinc-400 font-medium mb-1.5">Update Storage Channel ID</label>
                      <input
                        type="text"
                        placeholder="e.g. -1004314551318"
                        value={vaultChannelInput}
                        onChange={e => setVaultChannelInput(e.target.value)}
                        className="w-full px-4 py-2.5 bg-zinc-900 border border-zinc-800 rounded-xl text-sm text-white placeholder-zinc-500 outline-none focus:border-zinc-500 font-mono"
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={vaultChannelSaving || !vaultChannelInput.trim()}
                      className="w-full py-2.5 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-white rounded-xl text-xs sm:text-sm font-semibold flex items-center justify-center gap-2 transition"
                    >
                      {vaultChannelSaving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                      {vaultChannelSaving ? "Saving..." : "Update Vault Channel ID"}
                    </button>
                  </form>
                </div>

              </div>
            </div>

            {/* Grid: Channels Crawler & External Bot Registry */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 sm:gap-8">
              
              {/* Left Column: Target Channels Crawler (7 cols) */}
              <div className="lg:col-span-7 space-y-4 sm:space-y-6">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-lg sm:text-xl font-bold text-white flex items-center gap-2">
                      <Radio className="w-5 h-5 text-red-500" /> Monitored Channels
                    </h2>
                    <p className="text-xs sm:text-sm text-zinc-400 mt-0.5">Autonomous crawler monitors these channels and forwards movies to your vault.</p>
                  </div>
                  <button 
                    onClick={() => setShowAddTargetModal(!showAddTargetModal)}
                    className="px-3.5 py-2 bg-red-600 hover:bg-red-500 text-white rounded-xl text-xs sm:text-sm font-semibold flex items-center gap-1.5 transition shrink-0 shadow-sm"
                  >
                    <PlusCircle className="w-4 h-4" /> Add Channel
                  </button>
                </div>

                {/* Add Target Modal Form */}
                {showAddTargetModal && (
                  <form onSubmit={handleAddTarget} className="p-4 sm:p-5 bg-zinc-900 border border-zinc-800 rounded-2xl space-y-4 animate-in fade-in duration-200">
                    <h4 className="text-sm sm:text-base font-bold text-white">Add Target Channel to Monitor</h4>
                    
                    {joinedDialogs.length > 0 && (
                      <div className="p-3 bg-zinc-950 border border-zinc-800 rounded-xl space-y-1.5">
                        <label className="block text-xs text-zinc-300 font-semibold">
                          ⚡ Quick Select from Channels & Groups You've Joined ({joinedDialogs.length})
                        </label>
                        <select
                          onChange={e => {
                            const d = joinedDialogs.find(x => x.id === e.target.value);
                            if (d) {
                              setTargetIdentifier(d.username || d.id);
                              setTargetTitle(d.title);
                            }
                          }}
                          defaultValue=""
                          className="w-full px-3 py-2 bg-zinc-900 border border-zinc-700 rounded-lg text-xs sm:text-sm text-white outline-none focus:border-zinc-500"
                        >
                          <option value="" disabled>-- Pick a channel joined by auxiliary account --</option>
                          {joinedDialogs.map(d => (
                            <option key={d.id} value={d.id}>
                              {d.title} {d.username ? `(${d.username})` : `[ID: ${d.id}]`}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs text-zinc-300 mb-1 font-medium">Channel Username or Link</label>
                        <input 
                          type="text" 
                          placeholder="@MoviesChannel or https://t.me/..." 
                          value={targetIdentifier} 
                          onChange={e => setTargetIdentifier(e.target.value)} 
                          required 
                          className="w-full px-3.5 py-2.5 bg-zinc-950 border border-zinc-800 rounded-xl text-sm outline-none focus:border-zinc-500 text-white" 
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-zinc-300 mb-1 font-medium">Friendly Display Name</label>
                        <input 
                          type="text" 
                          placeholder="Cinema 1080p Releases" 
                          value={targetTitle} 
                          onChange={e => setTargetTitle(e.target.value)} 
                          className="w-full px-3.5 py-2.5 bg-zinc-950 border border-zinc-800 rounded-xl text-sm outline-none focus:border-zinc-500 text-white" 
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-zinc-300 mb-1 font-medium">Min File Size (MB)</label>
                        <input 
                          type="number" 
                          value={targetMinSize} 
                          onChange={e => setTargetMinSize(e.target.value)} 
                          className="w-full px-3.5 py-2.5 bg-zinc-950 border border-zinc-800 rounded-xl text-sm outline-none focus:border-zinc-500 text-white" 
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-zinc-300 mb-1 font-medium">Quality Filter</label>
                        <select 
                          value={targetQuality} 
                          onChange={e => setTargetQuality(e.target.value)} 
                          className="w-full px-3.5 py-2.5 bg-zinc-950 border border-zinc-800 rounded-xl text-sm outline-none focus:border-zinc-500 text-white"
                        >
                          <option value="all">All Qualities (720p+)</option>
                          <option value="1080p">1080p Only</option>
                          <option value="4k">4K Only</option>
                        </select>
                      </div>
                    </div>
                    <div className="flex justify-end gap-2.5 pt-2">
                      <button type="button" onClick={() => setShowAddTargetModal(false)} className="px-4 py-2 text-sm text-zinc-400 hover:text-white">Cancel</button>
                      <button type="submit" className="px-5 py-2 bg-red-600 hover:bg-red-500 text-white text-sm font-semibold rounded-xl">Save Channel</button>
                    </div>
                  </form>
                )}

                {/* Target Channels Cards */}
                <div className="space-y-3">
                  {targets.map(target => (
                    <div key={target.id} className="p-4 sm:p-5 bg-zinc-900 border border-zinc-800 rounded-2xl hover:border-zinc-700 transition flex flex-col justify-between gap-4">
                      {editingTarget && editingTarget.id === target.id ? (
                        <form onSubmit={handleSaveEditTarget} className="space-y-3 w-full animate-in fade-in duration-200">
                          <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
                            <span className="text-sm font-bold text-white">Edit Target Channel #{target.id}</span>
                            <button type="button" onClick={() => setEditingTarget(null)} className="text-zinc-400 hover:text-white p-1">
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs sm:text-sm">
                            <div>
                              <label className="block text-xs text-zinc-300 mb-1 font-medium">Display Title</label>
                              <input
                                type="text"
                                value={editingTarget.title}
                                onChange={e => setEditingTarget({ ...editingTarget, title: e.target.value })}
                                required
                                className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-xl text-white outline-none focus:border-zinc-500 text-sm"
                              />
                            </div>
                            <div>
                              <label className="block text-xs text-zinc-300 mb-1 font-medium">Channel Identifier / Link</label>
                              <input
                                type="text"
                                value={editingTarget.channel_identifier}
                                onChange={e => setEditingTarget({ ...editingTarget, channel_identifier: e.target.value })}
                                required
                                className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-xl text-white outline-none focus:border-zinc-500 font-mono text-sm"
                              />
                            </div>
                            <div>
                              <label className="block text-xs text-zinc-300 mb-1 font-medium">Min File Size (MB)</label>
                              <input
                                type="number"
                                value={editingTarget.min_file_size_mb}
                                onChange={e => setEditingTarget({ ...editingTarget, min_file_size_mb: parseInt(e.target.value, 10) || 100 })}
                                className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-xl text-white outline-none focus:border-zinc-500 text-sm"
                              />
                            </div>
                            <div>
                              <label className="block text-xs text-zinc-300 mb-1 font-medium">Quality Filter</label>
                              <select
                                value={editingTarget.quality_filter}
                                onChange={e => setEditingTarget({ ...editingTarget, quality_filter: e.target.value })}
                                className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-xl text-white outline-none focus:border-zinc-500 text-sm"
                              >
                                <option value="all">All Qualities (720p+)</option>
                                <option value="1080p">1080p Only</option>
                                <option value="4k">4K Only</option>
                              </select>
                            </div>
                          </div>
                          <div className="flex justify-end gap-2 pt-2">
                            <button type="button" onClick={() => setEditingTarget(null)} className="px-3.5 py-1.5 text-xs sm:text-sm text-zinc-400 hover:text-white">Cancel</button>
                            <button type="submit" className="px-4 py-1.5 bg-red-600 hover:bg-red-500 text-white text-xs sm:text-sm font-semibold rounded-xl flex items-center gap-1.5">
                              <Save className="w-3.5 h-3.5" /> Save Changes
                            </button>
                          </div>
                        </form>
                      ) : (
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 w-full">
                          <div className="space-y-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <h4 className="font-bold text-white text-sm sm:text-base">{target.title}</h4>
                              <button
                                onClick={() => handleToggleTargetStatus(target)}
                                className={`px-2.5 py-0.5 rounded-md text-xs font-semibold uppercase transition ${
                                  target.status === "active" 
                                    ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30" 
                                    : target.status === "syncing"
                                    ? "bg-zinc-800 text-white animate-pulse"
                                    : "bg-zinc-800 text-zinc-400"
                                }`}
                                title="Click to toggle active / paused status"
                              >
                                {target.status}
                              </button>
                            </div>
                            <p className="text-xs sm:text-sm text-zinc-400 font-mono">{target.channel_identifier}</p>
                            <div className="flex items-center gap-2.5 pt-1 text-xs text-zinc-400 flex-wrap">
                              <span>Min: <strong className="text-zinc-200">{target.min_file_size_mb}MB</strong></span>
                              <span>•</span>
                              <span>Quality: <strong className="text-zinc-200 uppercase">{target.quality_filter}</strong></span>
                              <span>•</span>
                              <span>Indexed: <strong className="text-zinc-200">{target.total_files_found || 0} files</strong></span>
                            </div>
                          </div>

                          {/* Channel Actions - Full width & clean touch buttons on mobile */}
                          <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap pt-2 sm:pt-0 border-t sm:border-t-0 border-zinc-800">
                            <div className="flex items-center bg-zinc-950 border border-zinc-800 rounded-xl p-1">
                              <select 
                                value={backfillDepth} 
                                onChange={e => setBackfillDepth(parseInt(e.target.value, 10))}
                                className="bg-transparent text-xs px-2 py-1.5 text-zinc-300 outline-none"
                              >
                                <option value={20}>20 msgs</option>
                                <option value={50}>50 msgs</option>
                                <option value={100}>100 msgs</option>
                              </select>
                              <button
                                onClick={() => handleRunBackfill(target.id)}
                                disabled={backfillingId === target.id}
                                className="px-3 py-1.5 bg-red-600 hover:bg-red-500 text-white rounded-lg text-xs font-semibold transition flex items-center gap-1 disabled:opacity-50"
                              >
                                <FastForward className="w-3.5 h-3.5" />
                                {backfillingId === target.id ? "Crawling..." : "Crawl"}
                              </button>
                            </div>
                            <button
                              onClick={() => setEditingTarget(target)}
                              className="p-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-xl transition"
                              title="Edit Channel Parameters"
                            >
                              <Edit2 className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => handleToggleTargetStatus(target)}
                              className="p-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-xl transition"
                              title={target.status === "active" ? "Pause Crawler" : "Activate Crawler"}
                            >
                              {target.status === "active" ? <PauseCircle className="w-4 h-4 text-amber-400" /> : <PlayCircle className="w-4 h-4 text-emerald-400" />}
                            </button>
                            <button
                              onClick={() => handleDeleteTarget(target.id)}
                              className="p-2.5 bg-zinc-800 hover:bg-rose-950/50 text-zinc-400 hover:text-rose-400 rounded-xl transition border border-transparent hover:border-rose-500/30"
                              title="Delete Channel"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                  {targets.length === 0 && (
                    <div className="p-8 text-center text-zinc-500 text-sm border border-zinc-800 rounded-2xl bg-zinc-900/40">
                      No channels added yet. Click "+ Add Channel" to start autonomous crawling.
                    </div>
                  )}
                </div>
              </div>

              {/* Right Column: External Bot Query Registry & Interactive Playground (5 cols) */}
              <div className="lg:col-span-5 space-y-4 sm:space-y-6">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-lg sm:text-xl font-bold text-white flex items-center gap-2">
                      <Cpu className="w-5 h-5 text-red-500" /> External Search Bots
                    </h2>
                    <p className="text-xs sm:text-sm text-zinc-400 mt-0.5">Queried on demand via MTProto client in priority order.</p>
                  </div>
                  <button 
                    onClick={() => setShowAddBotModal(!showAddBotModal)}
                    className="px-3.5 py-2 bg-red-600 hover:bg-red-500 text-white rounded-xl text-xs sm:text-sm font-semibold flex items-center gap-1.5 transition shrink-0 shadow-sm"
                  >
                    <PlusCircle className="w-4 h-4" /> Register Bot
                  </button>
                </div>

                {/* Add Bot Modal Form */}
                {showAddBotModal && (
                  <form onSubmit={handleAddBot} className="p-4 sm:p-5 bg-zinc-900 border border-zinc-800 rounded-2xl space-y-3.5 animate-in fade-in duration-200">
                    <h4 className="text-sm sm:text-base font-bold text-white">Register Telegram Search Bot</h4>
                    <div>
                      <label className="block text-xs text-zinc-300 mb-1 font-medium">Bot Username</label>
                      <input 
                        type="text" 
                        placeholder="@iPapkornEzPzBot" 
                        value={botUsername} 
                        onChange={e => setBotUsername(e.target.value)} 
                        required 
                        className="w-full px-3.5 py-2.5 bg-zinc-950 border border-zinc-800 rounded-xl text-sm text-white outline-none focus:border-zinc-500 font-mono" 
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2.5">
                      <div>
                        <label className="block text-xs text-zinc-300 mb-1 font-medium">Query Type</label>
                        <select 
                          value={botType} 
                          onChange={e => {
                            const t = e.target.value as any;
                            setBotType(t);
                            setBotCommandTemplate(t === "command" ? "/search {query}" : "/search {query}");
                          }} 
                          className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-xl text-xs sm:text-sm text-white"
                        >
                          <option value="command">Command (/search query)</option>
                          <option value="inline">Inline (@bot query)</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs text-zinc-300 mb-1 font-medium">Priority (1 = Top)</label>
                        <input 
                          type="number" 
                          min={1} 
                          max={10} 
                          value={botPriority} 
                          onChange={e => setBotPriority(e.target.value)} 
                          className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-xl text-xs sm:text-sm text-white" 
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs text-zinc-300 mb-1 font-medium">Command Template</label>
                      <input 
                        type="text" 
                        placeholder="/search {query}" 
                        value={botCommandTemplate} 
                        onChange={e => setBotCommandTemplate(e.target.value)} 
                        className="w-full px-3.5 py-2.5 bg-zinc-950 border border-zinc-800 rounded-xl text-xs sm:text-sm text-white font-mono" 
                      />
                    </div>
                    <div className="flex justify-end gap-2 pt-2">
                      <button type="button" onClick={() => setShowAddBotModal(false)} className="px-3.5 py-1.5 text-xs sm:text-sm text-zinc-400">Cancel</button>
                      <button type="submit" className="px-4 py-1.5 bg-red-600 hover:bg-red-500 text-white text-xs sm:text-sm font-semibold rounded-xl">Save Bot</button>
                    </div>
                  </form>
                )}

                {/* Bot Registry Cards */}
                <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden divide-y divide-zinc-800">
                  {bots.map(b => (
                    <div key={b.id} className="p-4 text-xs sm:text-sm hover:bg-zinc-850 transition">
                      {editingBot && editingBot.id === b.id ? (
                        <form onSubmit={handleSaveEditBot} className="space-y-3 animate-in fade-in duration-200">
                          <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
                            <span className="font-bold text-white text-sm">Edit Search Bot #{b.id}</span>
                            <button type="button" onClick={() => setEditingBot(null)} className="text-zinc-400 hover:text-white p-1">
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                            <div>
                              <label className="block text-xs text-zinc-300 mb-1">Username</label>
                              <input
                                type="text"
                                value={editingBot.bot_username}
                                onChange={e => setEditingBot({ ...editingBot, bot_username: e.target.value })}
                                required
                                className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-xl text-xs sm:text-sm text-white font-mono"
                              />
                            </div>
                            <div>
                              <label className="block text-xs text-zinc-300 mb-1">Query Type</label>
                              <select
                                value={editingBot.bot_type}
                                onChange={e => setEditingBot({ ...editingBot, bot_type: e.target.value as any })}
                                className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-xl text-xs sm:text-sm text-white"
                              >
                                <option value="command">Command (/search)</option>
                                <option value="inline">Inline (@bot)</option>
                              </select>
                            </div>
                            <div>
                              <label className="block text-xs text-zinc-300 mb-1">Command Template</label>
                              <input
                                type="text"
                                value={editingBot.command_template}
                                onChange={e => setEditingBot({ ...editingBot, command_template: e.target.value })}
                                className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-xl text-xs sm:text-sm text-white font-mono"
                              />
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                              <div>
                                <label className="block text-xs text-zinc-300 mb-1">Priority</label>
                                <input
                                  type="number"
                                  min={1}
                                  max={10}
                                  value={editingBot.priority}
                                  onChange={e => setEditingBot({ ...editingBot, priority: parseInt(e.target.value, 10) || 1 })}
                                  className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-xl text-xs sm:text-sm text-white"
                                />
                              </div>
                              <div>
                                <label className="block text-xs text-zinc-300 mb-1">Status</label>
                                <select
                                  value={editingBot.status}
                                  onChange={e => setEditingBot({ ...editingBot, status: e.target.value as any })}
                                  className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-xl text-xs sm:text-sm text-white"
                                >
                                  <option value="active">Active</option>
                                  <option value="inactive">Inactive</option>
                                </select>
                              </div>
                            </div>
                          </div>
                          <div className="flex justify-end gap-2 pt-2">
                            <button type="button" onClick={() => setEditingBot(null)} className="px-3 py-1.5 text-zinc-400 hover:text-white text-xs sm:text-sm">Cancel</button>
                            <button type="submit" className="px-4 py-1.5 bg-red-600 hover:bg-red-500 text-white rounded-xl text-xs sm:text-sm font-semibold flex items-center gap-1.5">
                              <Save className="w-3.5 h-3.5" /> Save
                            </button>
                          </div>
                        </form>
                      ) : (
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                          <div className="space-y-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-bold text-white text-sm sm:text-base">{b.bot_username}</span>
                              
                              {/* 1-Click Interactive Type Toggle Badge */}
                              <button
                                onClick={() => handleQuickToggleBotType(b)}
                                className={`px-2 py-0.5 rounded text-xs font-mono uppercase font-bold transition flex items-center gap-1 border ${
                                  b.bot_type === "inline"
                                    ? "bg-zinc-800 text-white border-zinc-700 hover:bg-zinc-700"
                                    : "bg-zinc-800 text-zinc-200 border-zinc-700 hover:bg-zinc-700"
                                }`}
                                title="Click to toggle between Command and Inline mode"
                              >
                                <RotateCw className="w-3 h-3 text-red-500" />
                                {b.bot_type}
                              </button>

                              {/* 1-Click Active / Inactive Status Toggle */}
                              <button
                                onClick={() => handleQuickToggleBotStatus(b)}
                                className={`px-2 py-0.5 rounded text-xs font-medium transition ${
                                  b.status === "active"
                                    ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/20"
                                    : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
                                }`}
                                title="Click to activate / pause this bot"
                              >
                                {b.status}
                              </button>

                              <span className="text-xs text-zinc-400 font-mono">Priority #{b.priority}</span>
                            </div>
                            <p className="text-xs text-zinc-400 font-mono">{b.command_template}</p>
                          </div>

                          <div className="flex items-center justify-between sm:justify-end gap-2 pt-2 sm:pt-0 border-t sm:border-t-0 border-zinc-800">
                            <span className="text-xs text-emerald-400 font-semibold">{b.success_count || 0} hits</span>
                            
                            <div className="flex items-center gap-1.5">
                              <button 
                                onClick={() => setEditingBot(b)} 
                                className="p-2 text-zinc-300 hover:text-white bg-zinc-800 hover:bg-zinc-700 rounded-xl transition"
                                title="Edit bot settings"
                              >
                                <Edit2 className="w-4 h-4" />
                              </button>

                              <button 
                                onClick={() => handleDeleteBot(b.id)} 
                                className="p-2 text-zinc-400 hover:text-rose-400 bg-zinc-800 hover:bg-rose-950/40 rounded-xl transition border border-transparent hover:border-rose-500/30"
                                title="Delete search bot"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                  {bots.length === 0 && (
                    <div className="p-6 text-center text-zinc-500 text-sm">
                      No search bots registered. Click "+ Register Bot" above to add search bots.
                    </div>
                  )}
                </div>

                {/* Interactive Search Bot Playground */}
                <div className="bg-zinc-900 border border-zinc-800 p-4 sm:p-5 rounded-2xl space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm sm:text-base font-bold text-white flex items-center gap-2">
                      <Zap className="w-4 h-4 text-red-500" /> Bot Query Playground
                    </h3>
                    <span className="text-xs text-zinc-500 font-mono">Live MTProto Test</span>
                  </div>
                  
                  <form onSubmit={handleTestPlayground} className="space-y-3">
                    <div className="flex flex-col sm:flex-row gap-2.5">
                      <input 
                        type="text" 
                        value={playgroundQuery} 
                        onChange={e => setPlaygroundQuery(e.target.value)} 
                        placeholder="Movie name (e.g. Oppenheimer)" 
                        className="flex-1 px-3.5 py-2.5 bg-zinc-950 border border-zinc-800 rounded-xl text-sm text-white outline-none focus:border-zinc-500" 
                      />
                      <select 
                        value={playgroundBot} 
                        onChange={e => setPlaygroundBot(e.target.value)} 
                        className="bg-zinc-950 border border-zinc-800 rounded-xl text-xs sm:text-sm text-zinc-300 px-3 py-2.5 outline-none"
                      >
                        {bots.map(b => (
                          <option key={b.id} value={b.bot_username}>{b.bot_username}</option>
                        ))}
                      </select>
                      <button 
                        type="submit" 
                        disabled={playgroundLoading || !playgroundQuery.trim()} 
                        className="px-4 py-2.5 bg-red-600 hover:bg-red-500 text-white rounded-xl text-xs sm:text-sm font-semibold transition disabled:opacity-50 flex items-center justify-center gap-2 shrink-0"
                      >
                        {playgroundLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                        {playgroundLoading ? "Querying..." : "Test Query"}
                      </button>
                    </div>
                  </form>

                  {playgroundNotice && (
                    <div className="p-3 bg-zinc-950 border border-zinc-800 text-zinc-200 text-xs sm:text-sm rounded-xl">
                      {playgroundNotice}
                    </div>
                  )}

                  {/* Playground Result Preview Card */}
                  {playgroundResult && (
                    <div className="p-4 bg-zinc-950 border border-zinc-800 rounded-xl space-y-3 animate-in fade-in duration-200">
                      <div className="flex items-center justify-between text-xs sm:text-sm">
                        <span className={`font-semibold flex items-center gap-1.5 ${playgroundResult.found ? "text-emerald-400" : "text-amber-400"}`}>
                          {playgroundResult.found ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
                          {playgroundResult.found ? `Telegram Bot Replied (${playgroundResult.duration_ms}ms)` : "No Response"}
                        </span>
                        <span className="px-2 py-0.5 bg-zinc-800 text-zinc-300 rounded-md text-xs font-mono">
                          {playgroundResult.bot}
                        </span>
                      </div>

                      {playgroundResult.error && (
                        <div className="p-3 bg-rose-950/40 border border-rose-800/40 text-rose-300 text-xs rounded-xl">
                          {playgroundResult.error}
                        </div>
                      )}

                      {playgroundResult.replyText && (
                        <div className="p-3 bg-zinc-900 rounded-xl text-xs sm:text-sm font-mono text-zinc-300 whitespace-pre-wrap max-h-48 overflow-y-auto border border-zinc-800 leading-relaxed">
                          {playgroundResult.replyText}
                        </div>
                      )}

                      {/* If the bot returned release buttons (e.g. 1080p, 720p, 4K) */}
                      {playgroundResult.buttons && playgroundResult.buttons.length > 0 && (
                        <div className="space-y-2 pt-1">
                          <p className="text-xs text-zinc-300 font-semibold flex items-center gap-1.5">
                            <DownloadCloud className="w-4 h-4 text-red-500" /> Releases Found &mdash; Click to Forward to Vault:
                          </p>
                          <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                            {playgroundResult.buttons.map((btn: any, idx: number) => (
                              <button
                                key={idx}
                                onClick={() => handleForwardPlaygroundResult(btn.row, btn.col, idx)}
                                disabled={playgroundForwarding}
                                className="w-full text-left p-3 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 hover:border-zinc-700 rounded-xl text-xs sm:text-sm transition flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 group disabled:opacity-50"
                              >
                                <span className="font-mono text-zinc-200 truncate">
                                  {btn.text}
                                </span>
                                <span className="shrink-0 px-3 py-1.5 bg-red-600 hover:bg-red-500 text-white rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition">
                                  {playgroundForwarding && forwardingButtonIdx === idx ? (
                                    <>
                                      <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Forwarding...
                                    </>
                                  ) : (
                                    <>
                                      <ArrowRight className="w-3.5 h-3.5" /> Forward to Vault
                                    </>
                                  )}
                                </span>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* If the reply itself has direct media or no buttons */}
                      {(!playgroundResult.buttons || playgroundResult.buttons.length === 0) && playgroundResult.hasDirectMedia && (
                        <button
                          onClick={() => handleForwardPlaygroundResult()}
                          disabled={playgroundForwarding}
                          className="w-full py-2.5 bg-red-600 hover:bg-red-500 text-white text-xs sm:text-sm font-semibold rounded-xl transition flex items-center justify-center gap-2 disabled:opacity-50"
                        >
                          <ArrowRight className="w-4 h-4" />
                          {playgroundForwarding ? "Forwarding to Vault..." : "Forward Video to Vault Now"}
                        </button>
                      )}
                    </div>
                  )}
                </div>

              </div>

            </div>

            {/* ================= CSV BATCH CRON PIPELINE & DEDUPLICATION CONSOLE ================= */}
            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 sm:p-6 space-y-6">
              
              {/* Header & Status Bar */}
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-zinc-800 pb-5">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="px-2.5 py-0.5 rounded-md text-xs font-semibold uppercase bg-zinc-800 text-zinc-300">
                      Scheduled Crawler
                    </span>
                    <h3 className="text-lg sm:text-xl font-bold text-white flex items-center gap-2">
                      <Clock className="w-5 h-5 text-red-500" />
                      Batch Cron Indexer & Deduplication Engine
                    </h3>
                  </div>
                  <p className="text-xs sm:text-sm text-zinc-400 mt-1 max-w-2xl">
                    Import lists of 1,000+ movies via <strong className="text-zinc-200">CSV, PDF, Markdown (.md), or TXT</strong>. Missing release years are automatically resolved. The crawler normalizes titles, checks Vault duplicates, and crawls external bots in safe, paced batches.
                  </p>
                </div>

                {/* Hidden native file input triggered by upload buttons */}
                <input
                  type="file"
                  ref={fileInputRef}
                  accept=".csv,.txt,.md,.markdown,.pdf,.tsv,text/plain,text/csv,application/pdf"
                  onChange={e => {
                    if (e.target.files && e.target.files[0]) {
                      handleFileSelected(e.target.files[0]);
                    }
                  }}
                  className="hidden"
                />

                {/* Primary Action Buttons - Stack on mobile, inline on desktop */}
                <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={csvUploading}
                    className="flex-1 sm:flex-none px-4 py-2.5 bg-red-600 hover:bg-red-500 text-white text-xs sm:text-sm font-semibold rounded-xl transition flex items-center justify-center gap-2 shadow-sm disabled:opacity-50"
                  >
                    {csvUploading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <UploadCloud className="w-4 h-4" />}
                    {csvUploading ? "Ingesting List..." : "+ Upload File (CSV / PDF / MD)"}
                  </button>

                  <button
                    onClick={() => setShowCsvModal(!showCsvModal)}
                    className="flex-1 sm:flex-none px-4 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs sm:text-sm font-semibold rounded-xl transition flex items-center justify-center gap-2 border border-zinc-700"
                  >
                    <FileText className="w-4 h-4" />
                    {showCsvModal ? "Hide Panel" : "Paste / Settings"}
                  </button>

                  <button
                    onClick={() => handleToggleCron(!cronStatus?.config?.isEnabled)}
                    className={`flex-1 sm:flex-none px-4 py-2.5 rounded-xl text-xs sm:text-sm font-semibold transition flex items-center justify-center gap-2 ${
                      cronStatus?.config?.isEnabled
                        ? "bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/30"
                        : "bg-emerald-600 hover:bg-emerald-500 text-white font-bold shadow-sm"
                    }`}
                  >
                    {cronStatus?.config?.isEnabled ? <PauseCircle className="w-4 h-4" /> : <PlayCircle className="w-4 h-4" />}
                    {cronStatus?.config?.isEnabled ? "Pause Cron" : "Start Cron Job"}
                  </button>

                  <button
                    onClick={handleRunBatchNow}
                    disabled={runningBatchNow || !cronStatus?.counts?.pending}
                    className="flex-1 sm:flex-none px-4 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs sm:text-sm font-semibold rounded-xl transition flex items-center justify-center gap-2 disabled:opacity-50 border border-zinc-700"
                    title="Process 1 batch of pending movies immediately"
                  >
                    <Zap className={`w-4 h-4 ${runningBatchNow ? "animate-spin text-red-500" : "text-red-500"}`} />
                    {runningBatchNow ? "Running..." : "Run Batch Now"}
                  </button>

                  <button
                    onClick={() => handleRequeueBatch("all")}
                    className="flex-1 sm:flex-none px-3.5 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-amber-300 text-xs font-semibold rounded-xl transition flex items-center justify-center gap-1.5 border border-amber-500/30"
                    title="Re-queue skipped and failed items back to pending without uploading again"
                  >
                    <RotateCw className="w-3.5 h-3.5 text-amber-400" />
                    Re-queue Items
                  </button>

                  <button
                    onClick={() => handleClearQueue("completed")}
                    className="flex-1 sm:flex-none px-3.5 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-semibold rounded-xl transition flex items-center justify-center gap-1.5 border border-zinc-700"
                    title="Clear completed and duplicate items from queue list"
                  >
                    <Trash2 className="w-3.5 h-3.5 text-zinc-400" />
                    Clear Completed
                  </button>

                  <button
                    onClick={handleEmergencyStop}
                    className="flex-1 sm:flex-none px-3.5 py-2.5 bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 text-xs font-semibold rounded-xl transition flex items-center justify-center gap-1.5 border border-rose-800/50"
                    title="Force stop all running cron jobs and active background crawls immediately"
                  >
                    <X className="w-3.5 h-3.5 text-rose-400" />
                    Emergency Stop
                  </button>
                </div>
              </div>

              {/* Notification Banner */}
              {cronNotice && (
                <div className={`p-3.5 rounded-xl text-xs sm:text-sm flex items-center justify-between animate-in fade-in duration-200 ${
                  cronNotice.type === "success" 
                    ? "bg-emerald-500/10 border border-emerald-500/20 text-emerald-300" 
                    : "bg-rose-500/10 border border-rose-500/20 text-rose-300"
                }`}>
                  <span className="flex items-center gap-2">
                    {cronNotice.type === "success" ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> : <AlertTriangle className="w-4 h-4 text-rose-400" />}
                    {cronNotice.text}
                  </span>
                  <button onClick={() => setCronNotice(null)} className="text-xs underline ml-2">Dismiss</button>
                </div>
              )}

              {/* Status & Progress KPIs - Responsive Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 sm:gap-3">
                <div className="bg-zinc-950 border border-zinc-800 p-3.5 sm:p-4 rounded-xl">
                  <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wide">Cron Status</span>
                  <div className="flex items-center gap-1.5 mt-1.5">
                    <span className={`w-2.5 h-2.5 rounded-full ${cronStatus?.config?.isEnabled ? "bg-emerald-400 animate-pulse" : "bg-zinc-600"}`} />
                    <span className="text-sm font-bold text-white">
                      {cronStatus?.config?.isEnabled ? `Active (${cronStatus.config.intervalMinutes}m)` : "Paused"}
                    </span>
                  </div>
                  <span className="text-xs text-zinc-500 mt-1 block">
                    {cronStatus?.config?.nextRunAt ? `Next: ${new Date(cronStatus.config.nextRunAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : "Standby"}
                  </span>
                </div>

                <div className="bg-zinc-950 border border-zinc-800 p-3.5 sm:p-4 rounded-xl">
                  <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wide">Total Ingested</span>
                  <p className="text-2xl font-bold text-white mt-1 tabular-nums">{cronStatus?.counts?.total || 0}</p>
                  <span className="text-xs text-zinc-500 mt-1 block">Titles parsed</span>
                </div>

                <div className="bg-zinc-950 border border-zinc-800 p-3.5 sm:p-4 rounded-xl">
                  <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wide">Pending Queue</span>
                  <p className="text-2xl font-bold text-amber-400 mt-1 tabular-nums">{cronStatus?.counts?.pending || 0}</p>
                  <span className="text-xs text-zinc-500 mt-1 block">Awaiting cron</span>
                </div>

                <div className="bg-zinc-950 border border-zinc-800 p-3.5 sm:p-4 rounded-xl">
                  <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wide">Completed</span>
                  <p className="text-2xl font-bold text-emerald-400 mt-1 tabular-nums">{cronStatus?.counts?.completed || 0}</p>
                  <span className="text-xs text-zinc-500 mt-1 block">Added to Vault</span>
                </div>

                <div className="bg-zinc-950 border border-zinc-800 p-3.5 sm:p-4 rounded-xl">
                  <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wide">Duplicates Filtered</span>
                  <p className="text-2xl font-bold text-zinc-200 mt-1 tabular-nums">{cronStatus?.counts?.duplicate_skipped || 0}</p>
                  <span className="text-xs text-zinc-500 mt-1 block">Saved crawl limits</span>
                </div>

                <div className="bg-zinc-950 border border-zinc-800 p-3.5 sm:p-4 rounded-xl">
                  <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wide">Failed / Retrying</span>
                  <p className="text-2xl font-bold text-rose-400 mt-1 tabular-nums">{cronStatus?.counts?.failed || 0}</p>
                  <span className="text-xs text-zinc-500 mt-1 block">Max 3 retries</span>
                </div>
              </div>

              {/* Ingestion & Settings Panel (Toggleable) */}
              {showCsvModal && (
                <div className="bg-zinc-950 border border-zinc-800 p-4 sm:p-6 rounded-2xl space-y-5 animate-in fade-in duration-200">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-zinc-800 pb-3">
                    <div>
                      <h4 className="text-sm sm:text-base font-bold text-white flex items-center gap-2">
                        <FileText className="w-4 h-4 text-red-500" />
                        Ingest Movie List (CSV, PDF, Markdown, TXT)
                      </h4>
                      <p className="text-xs text-zinc-400 mt-0.5">
                        Accepts numbered lists (1. Movie), Markdown tables/bullets, CSV/TSV, or plain titles. Missing release years are automatically looked up!
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="px-2 py-0.5 bg-zinc-900 border border-zinc-800 text-[10px] font-mono text-zinc-400 rounded">.CSV</span>
                      <span className="px-2 py-0.5 bg-zinc-900 border border-zinc-800 text-[10px] font-mono text-zinc-400 rounded">.PDF</span>
                      <span className="px-2 py-0.5 bg-zinc-900 border border-zinc-800 text-[10px] font-mono text-zinc-400 rounded">.MD</span>
                      <span className="px-2 py-0.5 bg-zinc-900 border border-zinc-800 text-[10px] font-mono text-zinc-400 rounded">.TXT</span>
                    </div>
                  </div>

                  {/* Drag and Drop Zone */}
                  <div
                    onDragOver={e => { e.preventDefault(); e.stopPropagation(); }}
                    onDrop={e => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                        handleFileSelected(e.dataTransfer.files[0]);
                      }
                    }}
                    onClick={() => fileInputRef.current?.click()}
                    className="border-2 border-dashed border-zinc-800 hover:border-red-500/60 bg-zinc-900/50 hover:bg-zinc-900 rounded-2xl p-6 text-center cursor-pointer transition space-y-2"
                  >
                    <UploadCloud className="w-8 h-8 text-zinc-400 mx-auto" />
                    <p className="text-sm font-semibold text-white">Click to browse or drag & drop CSV, PDF, Markdown (.md), or TXT file here</p>
                    <p className="text-xs text-zinc-500">Automatically parses titles, resolves missing release years, filters duplicates, and queues movies for scheduled crawling.</p>
                  </div>

                  <form onSubmit={handleUploadCsv} className="space-y-4 pt-2">
                    <div className="sm:col-span-2">
                      <label className="block text-xs text-zinc-300 font-medium mb-1">CSV File Source Tag</label>
                      <input
                        type="text"
                        value={csvSourceName}
                        onChange={e => setCsvSourceName(e.target.value)}
                        placeholder="e.g. movies_1000_batch_1.csv"
                        className="w-full px-3.5 py-2.5 bg-zinc-900 border border-zinc-800 rounded-xl text-sm text-white outline-none focus:border-zinc-500"
                      />
                    </div>

                    <div>
                      <label className="block text-xs text-zinc-300 font-medium mb-1">
                        Or Paste CSV Rows / Movie Titles directly
                      </label>
                      <textarea
                        rows={6}
                        value={csvInputText}
                        onChange={e => setCsvInputText(e.target.value)}
                        placeholder={`Inception, 1080p, 2010\nInterstellar [1080p] [YTS.MX]\nDune: Part Two (2024) 4K UHD\nThe Dark Knight\nOppenheimer (2023)`}
                        className="w-full p-3.5 bg-zinc-900 border border-zinc-800 rounded-xl text-xs sm:text-sm font-mono text-zinc-200 outline-none focus:border-zinc-500 leading-relaxed"
                      />
                    </div>

                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
                      <span className="text-xs text-zinc-400">
                        {csvInputText ? `${csvInputText.split(/\r?\n/).filter(l => l.trim()).length} lines detected` : "Paste movie titles or drop CSV file above"}
                      </span>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => { setCsvInputText(""); setCsvReport(null); }}
                          className="px-3.5 py-2 text-xs sm:text-sm text-zinc-400 hover:text-white"
                        >
                          Clear Input
                        </button>
                        <button
                          type="submit"
                          disabled={csvUploading || !csvInputText.trim()}
                          className="px-5 py-2.5 bg-red-600 hover:bg-red-500 text-white text-xs sm:text-sm font-semibold rounded-xl transition flex items-center gap-2 disabled:opacity-50"
                        >
                          {csvUploading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <UploadCloud className="w-4 h-4" />}
                          {csvUploading ? "Deduplicating & Queuing..." : "Deduplicate & Queue Movies"}
                        </button>
                      </div>
                    </div>
                  </form>

                  {/* Summary of Last Upload */}
                  {csvReport && (
                    <div className="p-4 bg-zinc-900 border border-zinc-800 rounded-xl space-y-2 text-xs sm:text-sm">
                      <div className="flex items-center justify-between font-semibold">
                        <span className="text-white">Batch Parsing & Deduplication Summary</span>
                        <span className="text-emerald-400 flex items-center gap-1"><CheckCircle2 className="w-4 h-4" /> Ready</span>
                      </div>
                      <div className="grid grid-cols-3 gap-2.5 text-xs pt-1">
                        <div className="bg-zinc-950 p-2.5 rounded-lg border border-zinc-800">
                          <span className="text-zinc-500 block">Parsed:</span> <strong className="text-white text-base">{csvReport.totalParsed}</strong>
                        </div>
                        <div className="bg-zinc-950 p-2.5 rounded-lg border border-zinc-800">
                          <span className="text-emerald-400 block">Queued:</span> <strong className="text-emerald-400 text-base">{csvReport.queued}</strong>
                        </div>
                        <div className="bg-zinc-950 p-2.5 rounded-lg border border-zinc-800">
                          <span className="text-zinc-400 block">Duplicates Filtered:</span> <strong className="text-zinc-200 text-base">{csvReport.duplicatesSkipped}</strong>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Cron Scheduler Config Form */}
                  <form onSubmit={handleSaveCronConfig} className="border-t border-zinc-800 pt-4 space-y-3">
                    <h5 className="text-xs sm:text-sm font-bold text-white flex items-center gap-2">
                      <Sliders className="w-4 h-4 text-red-500" />
                      Cron Scheduler Tuning & Pacing Settings
                    </h5>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                      <div>
                        <label className="block text-xs text-zinc-300 mb-1 font-medium">Batch Size (Per Run)</label>
                        <select
                          value={cronBatchSize}
                          onChange={e => setCronBatchSize(e.target.value)}
                          className="w-full px-3 py-2 bg-zinc-900 border border-zinc-800 rounded-xl text-xs sm:text-sm text-white outline-none focus:border-zinc-500"
                        >
                          <option value="3">3 movies</option>
                          <option value="5">5 movies (Recommended)</option>
                          <option value="10">10 movies</option>
                          <option value="20">20 movies</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-xs text-zinc-300 mb-1 font-medium">Frequency / Interval</label>
                        <select
                          value={cronIntervalMins}
                          onChange={e => setCronIntervalMins(e.target.value)}
                          className="w-full px-3 py-2 bg-zinc-900 border border-zinc-800 rounded-xl text-xs sm:text-sm text-white outline-none focus:border-zinc-500"
                        >
                          <option value="5">Every 5 minutes</option>
                          <option value="15">Every 15 minutes (Balanced)</option>
                          <option value="30">Every 30 minutes</option>
                          <option value="60">Every 1 hour</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-xs text-zinc-300 mb-1 font-medium">Pacing Delay Between Queries</label>
                        <select
                          value={cronDelayMs}
                          onChange={e => setCronDelayMs(e.target.value)}
                          className="w-full px-3 py-2 bg-zinc-900 border border-zinc-800 rounded-xl text-xs sm:text-sm text-white outline-none focus:border-zinc-500"
                        >
                          <option value="5000">5 seconds</option>
                          <option value="7000">7 seconds (FloodSafe)</option>
                          <option value="10000">10 seconds (Ultra Safe)</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-xs text-zinc-300 mb-1 font-medium">Max Retries per Movie</label>
                        <select
                          value={cronMaxRetries}
                          onChange={e => setCronMaxRetries(e.target.value)}
                          className="w-full px-3 py-2 bg-zinc-900 border border-zinc-800 rounded-xl text-xs sm:text-sm text-white outline-none focus:border-zinc-500"
                        >
                          <option value="1">1 try</option>
                          <option value="2">2 tries</option>
                          <option value="3">3 tries (Recommended)</option>
                          <option value="5">5 tries</option>
                        </select>
                      </div>
                    </div>

                    <div className="flex justify-end pt-1">
                      <button
                        type="submit"
                        className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-white text-xs sm:text-sm font-semibold rounded-xl transition border border-zinc-700"
                      >
                        Save Scheduler Settings
                      </button>
                    </div>
                  </form>
                </div>
              )}

              {/* Batch Queue Table & Filter Toolbar */}
              <div className="space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-1 sm:pb-0">
                    <span className="text-xs text-zinc-400 font-semibold mr-1 flex items-center gap-1 shrink-0">
                      <ListFilter className="w-3.5 h-3.5" /> Filter:
                    </span>
                    {[
                      { id: "all", label: "All Items" },
                      { id: "pending", label: "Pending" },
                      { id: "completed", label: "Completed" },
                      { id: "duplicate_skipped", label: "Duplicates Filtered" },
                      { id: "failed", label: "Failed" }
                    ].map(tab => (
                      <button
                        key={tab.id}
                        onClick={() => { setCronFilter(tab.id); }}
                        className={`px-3 py-1.5 rounded-xl text-xs sm:text-sm font-semibold whitespace-nowrap transition ${
                          cronFilter === tab.id
                            ? "bg-zinc-100 text-zinc-950 font-bold"
                            : "bg-zinc-950 text-zinc-400 hover:text-white border border-zinc-800"
                        }`}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>

                  <div className="flex items-center gap-3 text-xs sm:text-sm justify-end">
                    <button
                      onClick={() => handleClearQueue("completed")}
                      className="text-zinc-400 hover:text-white transition"
                      title="Remove finished and duplicate entries from the list"
                    >
                      Clear Completed
                    </button>
                    <span className="text-zinc-700">•</span>
                    <button
                      onClick={() => handleClearQueue("all")}
                      className="text-rose-400 hover:text-rose-300 transition"
                    >
                      Clear All Queue
                    </button>
                  </div>
                </div>

                {/* Mobile View: High-contrast Card List (Nothing cut off on phones) */}
                <div className="block md:hidden space-y-3">
                  {cronQueue.map((item: any) => (
                    <div key={item.id} className="p-4 bg-zinc-950 border border-zinc-800 rounded-xl space-y-2.5">
                      <div className="flex items-start justify-between gap-2">
                        <div className="space-y-0.5 flex-1 min-w-0">
                          <h5 className="font-bold text-white text-sm break-words">{item.clean_title}</h5>
                          {item.raw_title !== item.clean_title && (
                            <p className="text-xs text-zinc-500 font-mono break-all">{item.raw_title}</p>
                          )}
                        </div>
                        <span className="px-2 py-0.5 rounded text-xs font-mono bg-zinc-900 border border-zinc-800 text-zinc-300 uppercase shrink-0">
                          {item.requested_quality || "1080p"}
                        </span>
                      </div>

                      <div className="flex items-center justify-between gap-2 pt-1 border-t border-zinc-900 text-xs">
                        <span className={`px-2 py-0.5 rounded-md font-semibold uppercase inline-flex items-center gap-1 ${
                          item.status === "completed"
                            ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30"
                            : item.status === "processing"
                            ? "bg-zinc-800 text-white animate-pulse"
                            : item.status === "duplicate_skipped"
                            ? "bg-zinc-800 text-zinc-400"
                            : item.status === "failed"
                            ? "bg-rose-500/10 text-rose-400 border border-rose-500/30"
                            : "bg-amber-500/10 text-amber-400 border border-amber-500/30"
                        }`}>
                          {item.status === "completed" && <CheckCircle2 className="w-3 h-3" />}
                          {item.status === "failed" && <AlertTriangle className="w-3 h-3" />}
                          {item.status.replace("_", " ")}
                        </span>

                        <span className="text-zinc-400 font-mono">
                          Attempts: {item.attempts || 0} / {cronStatus?.config?.maxRetries || 3}
                        </span>
                      </div>

                      {(item.bot_used || item.last_error) && (
                        <div className="text-xs pt-1 border-t border-zinc-900">
                          {item.bot_used ? (
                            <span className="text-emerald-400 font-mono">Indexed via {item.bot_used}</span>
                          ) : (
                            <span className="text-rose-400 font-mono break-words">{item.last_error}</span>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                  {cronQueue.length === 0 && (
                    <div className="p-8 text-center text-zinc-500 text-sm border border-zinc-800 rounded-xl bg-zinc-950">
                      Queue is currently empty. Click "+ Ingest CSV Movies" above to queue movies.
                    </div>
                  )}
                </div>

                {/* Desktop View: Full Table */}
                <div className="hidden md:block bg-zinc-950 rounded-xl border border-zinc-800 overflow-hidden">
                  <div className="overflow-x-auto max-h-96 overflow-y-auto">
                    <table className="w-full text-left text-xs sm:text-sm">
                      <thead className="bg-zinc-900 text-zinc-400 text-xs uppercase font-semibold border-b border-zinc-800 sticky top-0">
                        <tr>
                          <th className="p-3.5">Movie Title (Cleaned)</th>
                          <th className="p-3.5">Quality</th>
                          <th className="p-3.5">Status</th>
                          <th className="p-3.5">Bot Used / Details</th>
                          <th className="p-3.5">Attempts</th>
                          <th className="p-3.5">Source CSV</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-900">
                        {cronQueue.map((item: any) => (
                          <tr key={item.id} className="hover:bg-zinc-900/40 transition">
                            <td className="p-3.5">
                              <span className="font-semibold text-white block">{item.clean_title}</span>
                              {item.raw_title !== item.clean_title && (
                                <span className="text-xs text-zinc-500 font-mono truncate block max-w-xs">{item.raw_title}</span>
                              )}
                            </td>
                            <td className="p-3.5">
                              <span className="px-2 py-0.5 rounded text-xs font-mono bg-zinc-900 border border-zinc-800 text-zinc-300 uppercase">
                                {item.requested_quality || "1080p"}
                              </span>
                            </td>
                            <td className="p-3.5">
                              <span className={`px-2.5 py-1 rounded-md text-xs font-bold uppercase inline-flex items-center gap-1 ${
                                item.status === "completed"
                                  ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                                  : item.status === "processing"
                                  ? "bg-zinc-800 text-white animate-pulse"
                                  : item.status === "duplicate_skipped"
                                  ? "bg-zinc-800 text-zinc-400"
                                  : item.status === "failed"
                                  ? "bg-rose-500/10 text-rose-400 border border-rose-500/20"
                                  : "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                              }`}>
                                {item.status === "completed" && <CheckCircle2 className="w-3 h-3" />}
                                {item.status === "failed" && <AlertTriangle className="w-3 h-3" />}
                                {item.status.replace("_", " ")}
                              </span>
                            </td>
                            <td className="p-3.5 text-zinc-300">
                              {item.bot_used ? (
                                <span className="text-emerald-400 font-mono text-xs">Indexed via {item.bot_used}</span>
                              ) : item.last_error ? (
                                <span className="text-zinc-400 text-xs truncate block max-w-xs" title={item.last_error}>
                                  {item.last_error}
                                </span>
                              ) : (
                                <span className="text-zinc-500 text-xs">Pending crawl</span>
                              )}
                            </td>
                            <td className="p-3.5 text-zinc-400 font-mono text-xs">
                              {item.attempts || 0} / {cronStatus?.config?.maxRetries || 3}
                            </td>
                            <td className="p-3.5 text-zinc-500 text-xs font-mono">
                              {item.source_csv || "batch_upload.csv"}
                            </td>
                          </tr>
                        ))}
                        {cronQueue.length === 0 && (
                          <tr>
                            <td colSpan={6} className="p-8 text-center text-zinc-500 text-sm">
                              Queue is currently empty. Click "+ Ingest CSV Movies" above to queue movies.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

            </div>
            <div className="bg-zinc-900 border border-zinc-800 p-4 sm:p-6 rounded-2xl space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm sm:text-base font-bold text-white flex items-center gap-2">
                  <Terminal className="w-4 h-4 text-emerald-400" /> Real-Time Crawler & Execution Feed
                </h3>
                <span className="text-xs text-zinc-500 font-mono">Auto-refreshes every 10s</span>
              </div>
              <div className="bg-zinc-950 p-3.5 sm:p-4 rounded-xl border border-zinc-800 font-mono text-xs sm:text-sm space-y-2 max-h-64 overflow-y-auto">
                {logs.map(log => (
                  <div key={log.id} className="flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-3 border-b border-zinc-900 pb-2 last:border-0">
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-zinc-500 text-xs">{log.timestamp}</span>
                      <span className={`px-1.5 py-0.5 rounded text-xs uppercase font-bold ${
                        log.status === "success" 
                          ? "text-emerald-400 bg-emerald-500/10" 
                          : log.status === "filtered"
                          ? "text-zinc-300 bg-zinc-800"
                          : "text-rose-400 bg-rose-500/10"
                      }`}>
                        {log.type}
                      </span>
                      <span className="text-zinc-400 font-semibold">[{log.source}]</span>
                    </div>
                    <span className="text-zinc-200">{log.title}: <span className="text-zinc-400">{log.details}</span></span>
                  </div>
                ))}
                {logs.length === 0 && <div className="text-zinc-500">No crawler events logged yet.</div>}
              </div>
            </div>

          </div>
        )}

        {/* ================= USER REQUESTS TAB ================= */}
        {activeTab === "requests" && (
          <div className="space-y-6 animate-in fade-in duration-300">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-bold text-white flex items-center gap-2">
                  <Bell className="w-5 h-5 text-red-500" /> Pending User Requests
                </h2>
                <p className="text-xs sm:text-sm text-zinc-400 mt-0.5">Requests can be fulfilled manually or automatically fetched via external bots.</p>
              </div>
              <span className="text-xs font-semibold px-3 py-1 bg-zinc-800 text-zinc-200 border border-zinc-700 rounded-full w-fit">
                {pendingRequests.length} Waiting
              </span>
            </div>

            {autoFetchNotice && (
              <div className="p-4 bg-zinc-900 border border-zinc-800 text-zinc-200 rounded-xl text-xs sm:text-sm flex items-center justify-between">
                <span>{autoFetchNotice}</span>
                <button onClick={() => setAutoFetchNotice(null)} className="text-xs underline ml-2">Dismiss</button>
              </div>
            )}

            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
              {pendingRequests.length > 0 ? (
                <div className="divide-y divide-zinc-800">
                  {pendingRequests.map(req => (
                    <div key={req.id} className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-zinc-850 transition">
                      <div className="space-y-0.5">
                        <h4 className="text-sm sm:text-base font-bold text-white">{req.title}</h4>
                        <p className="text-xs text-zinc-400">Requested by Telegram user: <span className="font-mono text-zinc-300">{req.telegram_id}</span></p>
                      </div>
                      <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
                        <button
                          onClick={() => handleAutoFetchRequest(req.id)}
                          disabled={autoFetchingId === req.id}
                          className="flex-1 sm:flex-none px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded-xl text-xs sm:text-sm font-semibold transition flex items-center justify-center gap-1.5 shadow-sm disabled:opacity-50"
                        >
                          <Zap className="w-3.5 h-3.5" />
                          {autoFetchingId === req.id ? "Fetching via Bots..." : "Auto-Fetch via Bots"}
                        </button>
                        <button 
                          onClick={() => handleFulfillRequest(req.id)}
                          className="flex-1 sm:flex-none px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 rounded-xl text-xs sm:text-sm font-semibold transition"
                        >
                          Mark Ready & Notify
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-12 text-center text-zinc-500 text-sm">No pending requests.</div>
              )}
            </div>

            <h2 className="text-lg sm:text-xl font-bold text-white mt-8">Request History</h2>
            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
               <div className="overflow-x-auto">
                 <table className="w-full text-left text-xs sm:text-sm text-zinc-300">
                   <thead className="bg-zinc-950 text-xs uppercase font-semibold text-zinc-400 border-b border-zinc-800">
                     <tr><th className="px-4 sm:px-5 py-3.5">Title</th><th className="px-4 sm:px-5 py-3.5">User</th><th className="px-4 sm:px-5 py-3.5">Status</th></tr>
                   </thead>
                   <tbody className="divide-y divide-zinc-800">
                     {allRequests.slice(0, 15).map(req => (
                       <tr key={req.id} className="hover:bg-zinc-850">
                         <td className="px-4 sm:px-5 py-3.5 font-medium text-white">{req.title}</td>
                         <td className="px-4 sm:px-5 py-3.5 font-mono text-xs text-zinc-400">{req.telegram_id}</td>
                         <td className="px-4 sm:px-5 py-3.5">
                           <span className={`px-2 py-0.5 rounded text-xs font-semibold uppercase ${req.status === 'pending' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/30' : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'}`}>
                             {req.status}
                           </span>
                         </td>
                       </tr>
                     ))}
                   </tbody>
                 </table>
               </div>
            </div>
          </div>
        )}

        {/* ================= VAULT INVENTORY TAB ================= */}
        {activeTab === "library" && (
          <div className="space-y-6 animate-in fade-in duration-300">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h2 className="text-xl font-bold text-white flex items-center gap-2">
                  <HardDrive className="w-5 h-5 text-red-500" /> Vault Inventory
                </h2>
                <p className="text-xs sm:text-sm text-zinc-400 mt-0.5">{libraryFiles.length} media files archived in private vault channel and Firestore.</p>
              </div>
              <div className="flex items-center gap-3">
                <div className="relative flex-1 sm:flex-none">
                  <Search className="w-4 h-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={librarySearch}
                    onChange={(e) => setLibrarySearch(e.target.value)}
                    placeholder="Search vault movies..."
                    className="pl-9 pr-7 py-2 bg-zinc-900 border border-zinc-800 rounded-xl text-xs sm:text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-zinc-500 w-full sm:w-64 transition"
                  />
                  {librarySearch && (
                    <button
                      onClick={() => setLibrarySearch("")}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-white text-xs"
                    >
                      ×
                    </button>
                  )}
                </div>
                <button 
                  onClick={() => window.open("/api/library/export", "_blank")}
                  className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-white border border-zinc-700 rounded-xl text-xs sm:text-sm font-semibold transition flex items-center gap-2 shrink-0"
                >
                  <DownloadCloud className="w-4 h-4" /> Export Backup
                </button>
              </div>
            </div>
            
            {(() => {
              const filtered = libraryFiles.filter(f => {
                if (!librarySearch.trim()) return true;
                const clean = librarySearch.trim().toLowerCase();
                const qNorm = clean.replace(/[^a-z0-9]/g, '');
                const t = (f.movie_title || "").toLowerCase();
                const fn = (f.file_name || "").toLowerCase();
                const tNorm = t.replace(/[^a-z0-9]/g, '');
                const fnNorm = fn.replace(/[^a-z0-9]/g, '');
                return t.includes(clean) || fn.includes(clean) || (qNorm.length >= 2 && (tNorm.includes(qNorm) || fnNorm.includes(qNorm)));
              });

              return (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    {filtered.map(file => (
                      <div key={file.id} className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden group hover:border-zinc-700 transition">
                        <div className="h-44 bg-zinc-800 relative">
                          {file.poster_url && (
                             <img src={file.poster_url.startsWith("http") ? file.poster_url : `https://image.tmdb.org/t/p/w500${file.poster_url}`} alt={file.movie_title} className="absolute inset-0 w-full h-full object-cover" />
                          )}
                          <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-transparent" />
                          <div className="absolute bottom-3 left-3 right-3 text-white">
                            <p className="font-bold text-sm sm:text-base leading-tight line-clamp-1">{file.movie_title}</p>
                            <p className="text-xs text-zinc-300 font-medium mt-0.5">
                              {file.season && file.episode ? `S${file.season}E${file.episode} • ` : ""}
                              {file.year ? `${file.year} • ` : ""}
                              <span className="uppercase">{file.quality || "HD"}</span>
                            </p>
                          </div>
                        </div>
                        <div className="p-3 bg-zinc-950 flex items-center justify-between text-xs">
                           <span className="text-zinc-500 font-mono truncate max-w-[140px]" title={file.file_name || file.telegram_file_id}>
                             {file.file_name || `${file.telegram_file_id.substring(0, 15)}...`}
                           </span>
                           <span className="font-semibold text-zinc-400">{formatBytes(file.file_size)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                  {filtered.length === 0 && (
                    <div className="p-12 text-center text-zinc-500 text-sm bg-zinc-900 rounded-2xl border border-zinc-800">
                      {libraryFiles.length === 0 ? "No files indexed yet." : `No movies matching "${librarySearch}".`}
                    </div>
                  )}
                </>
              );
            })()}
          </div>
        )}

        {/* ================= COMMUNICATIONS TAB ================= */}
        {activeTab === "comms" && (
          <div className="space-y-6 animate-in fade-in duration-300">
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              <Megaphone className="w-5 h-5 text-red-500" /> Telegram Messaging & Engagement
            </h2>
            
            <div className="bg-zinc-900 border border-zinc-800 p-6 sm:p-8 rounded-2xl space-y-4">
               <div>
                 <h3 className="text-base font-semibold text-white">Broadcast Announcement</h3>
                 <p className="text-xs sm:text-sm text-zinc-400 mt-0.5">Send a message to all users active on the Telegram bot.</p>
               </div>
               <textarea
                 value={broadcastMsg}
                 onChange={e => setBroadcastMsg(e.target.value)}
                 placeholder="Hello everyone, we just uploaded..."
                 className="w-full h-32 bg-zinc-950 border border-zinc-800 rounded-xl p-4 text-sm text-white outline-none focus:border-zinc-500 transition resize-none"
               />
               <div className="flex items-center justify-between">
                 {broadcastStatus ? <span className="text-xs font-medium text-emerald-400">{broadcastStatus}</span> : <div/>}
                 <button
                   onClick={handleSendBroadcast}
                   disabled={broadcastSending || !broadcastMsg.trim()}
                   className="px-6 py-2.5 bg-red-600 hover:bg-red-500 text-white rounded-xl text-sm font-semibold transition disabled:opacity-50"
                 >
                   {broadcastSending ? "Sending..." : "Send Global Broadcast"}
                 </button>
               </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
