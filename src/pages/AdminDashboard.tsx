import React, { useEffect, useState, FormEvent } from "react";
import { 
  Database, Users, Search, Bell, HardDrive, ShieldCheck, 
  RefreshCw, Webhook, Sparkles, Megaphone, Layers, FileVideo, 
  DownloadCloud, Bot, Cpu, PlayCircle, PauseCircle, CheckCircle2, 
  AlertTriangle, Radio, Terminal, PlusCircle, Trash2, Zap, 
  ArrowRight, FastForward, ExternalLink, Play, Phone, KeyRound, 
  Lock, LogOut, Check, ChevronDown, ChevronUp
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
  const [botType, setBotType] = useState<"inline" | "command">("inline");
  const [botCommandTemplate, setBotCommandTemplate] = useState("/search {query}");
  const [botPriority, setBotPriority] = useState("1");

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
    if (!confirm("Remove this target channel from crawler?")) return;
    try {
      await fetch(`/api/crawler/targets/${id}`, { method: "DELETE" });
      fetchCrawlerData();
    } catch (err) {
      console.error(err);
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

  const handleDeleteBot = async (id: number) => {
    if (!confirm("Remove this search bot from the registry?")) return;
    try {
      await fetch(`/api/crawler/bots/${id}`, { method: "DELETE" });
      fetchCrawlerData();
    } catch (err) {
      console.error(err);
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
    <div className="min-h-screen bg-[#0A0A0A] text-zinc-300 font-sans p-6 md:p-12">
      <div className="max-w-7xl mx-auto space-y-10">
        
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 pb-6 border-b border-zinc-800/50">
          <div>
            <h1 className="text-3xl font-bold text-zinc-100 flex items-center gap-3 tracking-tight">
              <Database className="w-8 h-8 text-blue-500" />
              Infrastructure Console
            </h1>
            <p className="text-sm text-zinc-500 mt-2 max-w-2xl">
              Enterprise-grade dashboard for BusiMovie. Manage cloud synchronization, autonomous MTProto channel crawlers, search bots, and retention workflows.
            </p>
          </div>
          <div className="flex gap-3">
             <button onClick={() => setShowAddForm(!showAddForm)} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg flex items-center gap-2 text-sm font-medium transition shadow-lg shadow-blue-500/20">
               <FileVideo className="w-4 h-4" /> Index Media
             </button>
             <button onClick={() => setActiveTab("automation")} className="px-4 py-2 bg-purple-600/20 hover:bg-purple-600/30 text-purple-300 border border-purple-500/30 rounded-lg flex items-center gap-2 text-sm font-medium transition">
               <Bot className="w-4 h-4 text-purple-400" /> Userbot Engine
             </button>
          </div>
        </div>

        {/* Index Form */}
        {showAddForm && (
          <form onSubmit={handleManualAdd} className="p-6 bg-zinc-900/50 border border-zinc-800 rounded-2xl space-y-4 animate-in fade-in slide-in-from-top-4">
            <h3 className="text-sm font-semibold text-zinc-300">Index Media File Reference</h3>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
              <div className="sm:col-span-2">
                <label className="block text-xs text-zinc-500 mb-1.5 font-medium">Movie Title</label>
                <input type="text" value={newFileTitle} onChange={e => setNewFileTitle(e.target.value)} required className="w-full px-4 py-2.5 bg-zinc-950 border border-zinc-800/80 rounded-lg outline-none focus:border-blue-500 text-sm transition" />
              </div>
              <div>
                <label className="block text-xs text-zinc-500 mb-1.5 font-medium">Year</label>
                <input type="text" value={newFileYear} onChange={e => setNewFileYear(e.target.value)} placeholder="e.g. 2024" className="w-full px-4 py-2.5 bg-zinc-950 border border-zinc-800/80 rounded-lg outline-none focus:border-blue-500 text-sm transition" />
              </div>
              <div>
                <label className="block text-xs text-zinc-500 mb-1.5 font-medium">Quality</label>
                <select value={newFileQuality} onChange={e => setNewFileQuality(e.target.value)} className="w-full px-4 py-2.5 bg-zinc-950 border border-zinc-800/80 rounded-lg outline-none focus:border-blue-500 text-sm transition appearance-none">
                  <option value="1080p">1080p</option><option value="720p">720p</option><option value="4K">4K</option>
                </select>
              </div>
              <div className="sm:col-span-4">
                <label className="block text-xs text-zinc-500 mb-1.5 font-medium">Telegram File ID</label>
                <input type="text" value={newFileId} onChange={e => setNewFileId(e.target.value)} required className="w-full px-4 py-2.5 bg-zinc-950 border border-zinc-800/80 rounded-lg outline-none focus:border-blue-500 text-sm transition" />
              </div>
            </div>
            <div className="flex justify-end gap-3 pt-4">
              <button type="button" onClick={() => setShowAddForm(false)} className="px-5 py-2.5 text-sm font-medium text-zinc-400 hover:text-white transition">Cancel</button>
              <button type="submit" className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg shadow-lg shadow-blue-500/20 transition">Save Reference</button>
            </div>
          </form>
        )}

        {/* Tab Navigation */}
        <div className="flex items-center gap-2 border-b border-zinc-800/50 pb-px overflow-x-auto">
          {[
            { id: "overview", label: "Overview", icon: Database },
            { id: "automation", label: "Automation & Crawlers", icon: Bot },
            { id: "requests", label: "User Requests", icon: Bell },
            { id: "library", label: "Vault Library", icon: HardDrive },
            { id: "comms", label: "Engagement", icon: Megaphone }
          ].map(tab => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`px-4 py-2.5 text-sm font-semibold flex items-center gap-2 border-b-2 whitespace-nowrap transition-all ${
                  activeTab === tab.id 
                    ? "border-blue-500 text-white" 
                    : "border-transparent text-zinc-500 hover:text-zinc-300 hover:border-zinc-700"
                }`}
              >
                <Icon className={`w-4 h-4 ${activeTab === tab.id ? "text-blue-400" : "text-zinc-500"}`} />
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
          <div className="space-y-8 animate-in fade-in duration-300">
            
            {/* Top KPI Metrics Bar */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <div className="bg-zinc-900/40 border border-zinc-800/60 p-4 rounded-xl">
                <span className="text-[11px] font-semibold text-zinc-500 uppercase">Target Channels</span>
                <p className="text-2xl font-bold text-zinc-100 mt-1">{crawlerStatus?.activeTargets || 0} <span className="text-xs font-normal text-zinc-500">/ {targets.length}</span></p>
                <span className="text-[10px] text-emerald-400 font-medium flex items-center gap-1 mt-1">
                  <Radio className="w-3 h-3 animate-pulse" /> Real-time Listening
                </span>
              </div>
              <div className="bg-zinc-900/40 border border-zinc-800/60 p-4 rounded-xl">
                <span className="text-[11px] font-semibold text-zinc-500 uppercase">Search Bots</span>
                <p className="text-2xl font-bold text-zinc-100 mt-1">{crawlerStatus?.activeBots || 0} <span className="text-xs font-normal text-zinc-500">Registered</span></p>
                <span className="text-[10px] text-blue-400 font-medium mt-1 block">Inline & Command</span>
              </div>
              <div className="bg-zinc-900/40 border border-zinc-800/60 p-4 rounded-xl">
                <span className="text-[11px] font-semibold text-zinc-500 uppercase">Search Queue</span>
                <p className="text-2xl font-bold text-zinc-100 mt-1">{crawlerStatus?.pendingJobsCount || 0} <span className="text-xs font-normal text-zinc-500">Pending</span></p>
                <span className="text-[10px] text-amber-400 font-medium mt-1 block">Auto-fulfillment on</span>
              </div>
              <div className="bg-zinc-900/40 border border-zinc-800/60 p-4 rounded-xl">
                <span className="text-[11px] font-semibold text-zinc-500 uppercase">Fulfilled by Bots</span>
                <p className="text-2xl font-bold text-zinc-100 mt-1">{crawlerStatus?.fulfilledJobsCount || 0}</p>
                <span className="text-[10px] text-emerald-400 font-medium mt-1 block">Auto-added to Vault</span>
              </div>
              <div className="bg-zinc-900/40 border border-zinc-800/60 p-4 rounded-xl col-span-2 md:col-span-1">
                <span className="text-[11px] font-semibold text-zinc-500 uppercase">FloodWait Safety</span>
                <p className="text-sm font-bold text-emerald-400 mt-2 flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4" />
                  {crawlerStatus?.floodWaitActive ? `Cooldown: ${crawlerStatus.floodWaitCooldownSeconds}s` : "Optimal (No Limits)"}
                </p>
                <span className="text-[10px] text-zinc-500 mt-1 block">Adaptive backoff active</span>
              </div>
            </div>

            {/* Notification alert if backfill or action performed */}
            {backfillNotice && (
              <div className="p-4 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-xl text-sm flex items-center justify-between">
                <span>{backfillNotice}</span>
                <button onClick={() => setBackfillNotice(null)} className="text-xs hover:underline">Dismiss</button>
              </div>
            )}

            {/* Auxiliary Userbot & Private Storage Vault Card */}
            <div className="bg-gradient-to-r from-purple-950/30 via-zinc-900/60 to-zinc-900/30 border border-purple-500/20 rounded-2xl p-6 shadow-xl">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-zinc-800/80 pb-5">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold tracking-wider uppercase bg-purple-500/20 text-purple-300 border border-purple-500/30">
                      MTProto Auxiliary Engine
                    </span>
                    <h3 className="text-lg font-bold text-zinc-100 flex items-center gap-2">
                      Telegram Userbot & Vault Storage Setup
                    </h3>
                  </div>
                  <p className="text-xs text-zinc-400 mt-1">
                    Connect your auxiliary Telegram account directly in your browser. Powers autonomous background channel crawling, file scraping, and on-demand search bot querying.
                  </p>
                </div>
                <div className="flex items-center gap-2 text-xs flex-wrap">
                  <span className={`px-2.5 py-1 rounded-md font-semibold flex items-center gap-1.5 ${
                    crawlerStatus?.auxiliarySession?.apiIdConfigured 
                      ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" 
                      : "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                  }`}>
                    <KeyRound className="w-3.5 h-3.5" />
                    API ID & Hash: {crawlerStatus?.auxiliarySession?.apiIdConfigured ? "Active" : "Missing"}
                  </span>
                  <span className={`px-2.5 py-1 rounded-md font-semibold flex items-center gap-1.5 ${
                    crawlerStatus?.auxiliarySession?.connected 
                      ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" 
                      : "bg-zinc-800 text-zinc-400"
                  }`}>
                    <Bot className="w-3.5 h-3.5" />
                    Userbot: {crawlerStatus?.auxiliarySession?.connected ? `@${crawlerStatus.auxiliarySession.username || "Connected"}` : "Standby"}
                  </span>
                </div>
              </div>

              {auxNotice && (
                <div className={`mt-4 p-3 rounded-xl text-xs flex items-center justify-between ${
                  auxNotice.type === "success" 
                    ? "bg-emerald-500/10 border border-emerald-500/20 text-emerald-300" 
                    : "bg-red-500/10 border border-red-500/20 text-red-300"
                }`}>
                  <span>{auxNotice.text}</span>
                  <button onClick={() => setAuxNotice(null)} className="hover:underline ml-2">Dismiss</button>
                </div>
              )}

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
                
                {/* 1. Auxiliary Telegram Account Authentication */}
                <div className="bg-zinc-950/50 border border-zinc-800/80 rounded-xl p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-bold text-zinc-200 flex items-center gap-2">
                      <Phone className="w-4 h-4 text-purple-400" /> 1. Auxiliary Telegram Account
                    </h4>
                    {crawlerStatus?.auxiliarySession?.connected && (
                      <button
                        onClick={handleDisconnectAux}
                        disabled={auxLoading}
                        className="px-2.5 py-1 text-[11px] bg-red-950/40 hover:bg-red-900/50 text-red-400 border border-red-800/40 rounded flex items-center gap-1 transition"
                      >
                        <LogOut className="w-3 h-3" /> Disconnect
                      </button>
                    )}
                  </div>

                  {crawlerStatus?.auxiliarySession?.connected ? (
                    <div className="p-4 bg-emerald-950/20 border border-emerald-800/30 rounded-xl space-y-2">
                      <div className="flex items-center gap-2 text-emerald-400 font-semibold text-xs">
                        <CheckCircle2 className="w-4 h-4" /> Live Auxiliary Session Active
                      </div>
                      <p className="text-xs text-zinc-300">
                        Logged in as <strong className="text-white">@{crawlerStatus.auxiliarySession.username || crawlerStatus.auxiliarySession.firstName}</strong>
                        {crawlerStatus.auxiliarySession.phone && <span> ({crawlerStatus.auxiliarySession.phone})</span>}.
                      </p>
                      <p className="text-[11px] text-zinc-500">
                        Autonomous channel crawler & bot search engine are using this account session with flood-protection.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <p className="text-xs text-zinc-400">
                        Log in with your auxiliary phone number. Telegram will send a verification code directly to your Telegram app.
                      </p>

                      {!auxCodeSent ? (
                        <form onSubmit={handleRequestAuxCode} className="space-y-3">
                          <div>
                            <label className="block text-[11px] text-zinc-400 mb-1">Auxiliary Phone Number (with Country Code)</label>
                            <input
                              type="tel"
                              placeholder="+1234567890"
                              value={auxPhone}
                              onChange={e => setAuxPhone(e.target.value)}
                              required
                              className="w-full px-3.5 py-2 bg-zinc-900 border border-zinc-700/80 rounded-lg text-sm text-white placeholder-zinc-500 outline-none focus:border-purple-500"
                            />
                          </div>
                          <button
                            type="submit"
                            disabled={auxLoading || !auxPhone.trim()}
                            className="w-full py-2 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white rounded-lg text-xs font-semibold flex items-center justify-center gap-2 transition"
                          >
                            {auxLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Phone className="w-3.5 h-3.5" />}
                            {auxLoading ? "Connecting to Telegram..." : "Send Telegram Login Code"}
                          </button>
                        </form>
                      ) : (
                        <form onSubmit={handleVerifyAuxCode} className="space-y-3 animate-in fade-in duration-200">
                          <div className="p-3 bg-purple-950/30 border border-purple-800/40 rounded-lg text-[11px] text-purple-300">
                            Code sent! Open Telegram on your auxiliary account and check the official chat from <strong>Telegram</strong> for the code.
                          </div>
                          <div>
                            <label className="block text-[11px] text-zinc-400 mb-1">5-Digit Verification Code</label>
                            <input
                              type="text"
                              placeholder="e.g. 58291"
                              value={auxCode}
                              onChange={e => setAuxCode(e.target.value)}
                              required
                              className="w-full px-3.5 py-2 bg-zinc-900 border border-zinc-700/80 rounded-lg text-sm text-white placeholder-zinc-500 outline-none focus:border-purple-500 tracking-widest font-mono"
                            />
                          </div>
                          <div>
                            <label className="block text-[11px] text-zinc-400 mb-1">2FA Password (Only if enabled on account)</label>
                            <input
                              type="password"
                              placeholder="Optional 2-Step Password"
                              value={auxPassword}
                              onChange={e => setAuxPassword(e.target.value)}
                              className="w-full px-3.5 py-2 bg-zinc-900 border border-zinc-700/80 rounded-lg text-sm text-white placeholder-zinc-500 outline-none focus:border-purple-500"
                            />
                          </div>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => setAuxCodeSent(false)}
                              className="px-3 py-2 text-xs text-zinc-400 hover:text-white"
                            >
                              Back
                            </button>
                            <button
                              type="submit"
                              disabled={auxLoading || !auxCode.trim()}
                              className="flex-1 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-lg text-xs font-semibold flex items-center justify-center gap-2 transition"
                            >
                              {auxLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                              {auxLoading ? "Verifying..." : "Verify & Save Session"}
                            </button>
                          </div>
                        </form>
                      )}

                      {/* Manual Session String Expander */}
                      <div className="pt-2 border-t border-zinc-800/60">
                        <button
                          type="button"
                          onClick={() => setShowManualSession(!showManualSession)}
                          className="text-[11px] text-zinc-500 hover:text-zinc-300 flex items-center gap-1"
                        >
                          {showManualSession ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                          Or paste pre-generated StringSession
                        </button>

                        {showManualSession && (
                          <form onSubmit={handleSaveManualSession} className="mt-3 space-y-2">
                            <textarea
                              rows={2}
                              placeholder="Paste Telethon or GramJS 1BVts..."
                              value={manualSessionInput}
                              onChange={e => setManualSessionInput(e.target.value)}
                              className="w-full p-2 bg-zinc-900 border border-zinc-800 rounded text-xs text-white font-mono"
                            />
                            <button
                              type="submit"
                              disabled={auxLoading || !manualSessionInput.trim()}
                              className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-white rounded text-xs"
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
                <div className="bg-zinc-950/50 border border-zinc-800/80 rounded-xl p-5 space-y-4">
                  <h4 className="text-sm font-bold text-zinc-200 flex items-center gap-2">
                    <Database className="w-4 h-4 text-purple-400" /> 2. Private Storage Vault Channel
                  </h4>
                  <p className="text-xs text-zinc-400">
                    Your private Telegram channel where movies are archived. The bot must be added as an Administrator.
                  </p>

                  <div className="p-3 bg-zinc-900/60 border border-zinc-800 rounded-lg text-xs space-y-1">
                    <div className="text-[11px] text-zinc-500 uppercase font-semibold flex items-center justify-between">
                      <span>Active Storage Channel</span>
                      {crawlerStatus?.auxiliarySession?.vaultChannelId && (
                        <span className="text-[10px] text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded font-mono">
                          Linked & Active
                        </span>
                      )}
                    </div>
                    <div className="font-mono text-purple-400 font-bold">
                      {crawlerStatus?.auxiliarySession?.vaultChannelId || "Not configured yet"}
                    </div>
                  </div>

                  {vaultChannelNotice && (
                    <div className="p-2.5 bg-purple-500/10 border border-purple-500/20 text-purple-300 rounded text-xs">
                      {vaultChannelNotice}
                    </div>
                  )}

                  <form onSubmit={handleSaveVaultChannel} className="space-y-3">
                    <div>
                      <label className="block text-[11px] text-zinc-400 mb-1">Change / Update Storage Channel ID</label>
                      <input
                        type="text"
                        placeholder="e.g. -1004314551318"
                        value={vaultChannelInput}
                        onChange={e => setVaultChannelInput(e.target.value)}
                        className="w-full px-3.5 py-2 bg-zinc-900 border border-zinc-700/80 rounded-lg text-sm text-white placeholder-zinc-500 outline-none focus:border-purple-500 font-mono"
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={vaultChannelSaving || !vaultChannelInput.trim()}
                      className="w-full py-2 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-white rounded-lg text-xs font-semibold flex items-center justify-center gap-2 transition"
                    >
                      {vaultChannelSaving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                      {vaultChannelSaving ? "Saving..." : "Update Vault Channel ID"}
                    </button>
                  </form>

                  <div className="text-[11px] text-zinc-500 leading-relaxed bg-zinc-900/30 p-2.5 rounded border border-zinc-800/40">
                    💡 <strong>Single Channel Architecture:</strong> All manual uploads and autonomous crawler discoveries share your main private channel (<code>{crawlerStatus?.auxiliarySession?.vaultChannelId || "-1004314551318"}</code>). Both your primary bot and auxiliary userbot store files here.
                  </div>
                </div>

              </div>
            </div>

            {/* Grid: Channels Crawler & External Bot Registry */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
              
              {/* Left Column: Target Channels Crawler (7 cols) */}
              <div className="lg:col-span-7 space-y-6">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-xl font-bold text-zinc-100 flex items-center gap-2">
                      <Radio className="w-5 h-5 text-purple-500" /> Monitored Channels & Vault Forwarder
                    </h2>
                    <p className="text-xs text-zinc-500 mt-1">Autonomous crawler monitors these channels and forwards movies to your private vault.</p>
                  </div>
                  <button 
                    onClick={() => setShowAddTargetModal(!showAddTargetModal)}
                    className="px-3.5 py-1.5 bg-purple-600 hover:bg-purple-500 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition shadow"
                  >
                    <PlusCircle className="w-3.5 h-3.5" /> Add Channel
                  </button>
                </div>

                {/* Add Target Modal Form */}
                {showAddTargetModal && (
                  <form onSubmit={handleAddTarget} className="p-5 bg-zinc-900/70 border border-purple-500/30 rounded-2xl space-y-4 animate-in fade-in duration-200">
                    <h4 className="text-sm font-bold text-purple-300">Add Target Channel to Monitor</h4>
                    
                    {joinedDialogs.length > 0 && (
                      <div className="p-3 bg-purple-950/30 border border-purple-800/40 rounded-xl space-y-1.5">
                        <label className="block text-[11px] text-purple-300 font-semibold">
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
                          className="w-full px-3 py-2 bg-zinc-900 border border-purple-700/60 rounded-lg text-xs text-white outline-none focus:border-purple-400"
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
                        <label className="block text-[11px] text-zinc-400 mb-1">Channel Username or Link</label>
                        <input 
                          type="text" 
                          placeholder="@MoviesChannel or https://t.me/..." 
                          value={targetIdentifier} 
                          onChange={e => setTargetIdentifier(e.target.value)} 
                          required 
                          className="w-full px-3.5 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-sm outline-none focus:border-purple-500 text-white" 
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] text-zinc-400 mb-1">Friendly Display Name</label>
                        <input 
                          type="text" 
                          placeholder="Cinema 1080p Releases" 
                          value={targetTitle} 
                          onChange={e => setTargetTitle(e.target.value)} 
                          className="w-full px-3.5 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-sm outline-none focus:border-purple-500 text-white" 
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] text-zinc-400 mb-1">Min File Size (MB)</label>
                        <input 
                          type="number" 
                          value={targetMinSize} 
                          onChange={e => setTargetMinSize(e.target.value)} 
                          className="w-full px-3.5 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-sm outline-none focus:border-purple-500 text-white" 
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] text-zinc-400 mb-1">Quality Filter</label>
                        <select 
                          value={targetQuality} 
                          onChange={e => setTargetQuality(e.target.value)} 
                          className="w-full px-3.5 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-sm outline-none focus:border-purple-500 text-white"
                        >
                          <option value="all">All Qualities (720p+)</option>
                          <option value="1080p">1080p Only</option>
                          <option value="4k">4K Only</option>
                        </select>
                      </div>
                    </div>
                    <div className="flex justify-end gap-2 pt-2">
                      <button type="button" onClick={() => setShowAddTargetModal(false)} className="px-4 py-1.5 text-xs text-zinc-400 hover:text-white">Cancel</button>
                      <button type="submit" className="px-4 py-1.5 bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold rounded-lg">Save Channel</button>
                    </div>
                  </form>
                )}

                {/* Target Channels Cards */}
                <div className="space-y-3">
                  {targets.map(target => (
                    <div key={target.id} className="p-4 bg-zinc-900/40 border border-zinc-800/70 rounded-xl hover:bg-zinc-900/60 transition flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                      <div>
                        <div className="flex items-center gap-2">
                          <h4 className="font-bold text-zinc-100 text-sm">{target.title}</h4>
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                            target.status === "active" 
                              ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" 
                              : target.status === "syncing"
                              ? "bg-purple-500/10 text-purple-400 border border-purple-500/20 animate-pulse"
                              : "bg-zinc-800 text-zinc-400"
                          }`}>
                            {target.status}
                          </span>
                        </div>
                        <p className="text-xs text-zinc-400 mt-1 font-mono">{target.channel_identifier}</p>
                        <div className="flex items-center gap-3 mt-2 text-[11px] text-zinc-500">
                          <span>Min: <strong className="text-zinc-400">{target.min_file_size_mb}MB</strong></span>
                          <span>•</span>
                          <span>Filter: <strong className="text-zinc-400 uppercase">{target.quality_filter}</strong></span>
                          <span>•</span>
                          <span>Discovered: <strong className="text-purple-400">{target.total_files_found || 0} files</strong></span>
                        </div>
                      </div>

                      {/* Channel Actions */}
                      <div className="flex items-center gap-2">
                        <div className="flex items-center bg-zinc-950 border border-zinc-800 rounded-lg p-0.5">
                          <select 
                            value={backfillDepth} 
                            onChange={e => setBackfillDepth(parseInt(e.target.value, 10))}
                            className="bg-transparent text-[11px] px-2 py-1 text-zinc-400 outline-none"
                          >
                            <option value={20}>20 msgs</option>
                            <option value={50}>50 msgs</option>
                            <option value={100}>100 msgs</option>
                          </select>
                          <button
                            onClick={() => handleRunBackfill(target.id)}
                            disabled={backfillingId === target.id}
                            className="px-2.5 py-1 bg-purple-600 hover:bg-purple-500 text-white rounded text-[11px] font-semibold transition flex items-center gap-1 disabled:opacity-50"
                          >
                            <FastForward className="w-3 h-3" />
                            {backfillingId === target.id ? "Crawling..." : "Crawl"}
                          </button>
                        </div>
                        <button
                          onClick={() => handleToggleTargetStatus(target)}
                          className="p-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg transition"
                          title={target.status === "active" ? "Pause Crawler" : "Activate Crawler"}
                        >
                          {target.status === "active" ? <PauseCircle className="w-4 h-4 text-amber-400" /> : <PlayCircle className="w-4 h-4 text-emerald-400" />}
                        </button>
                        <button
                          onClick={() => handleDeleteTarget(target.id)}
                          className="p-1.5 bg-zinc-800 hover:bg-rose-900/30 text-zinc-400 hover:text-rose-400 rounded-lg transition"
                          title="Delete Channel"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                  {targets.length === 0 && (
                    <div className="p-8 text-center text-zinc-500 text-sm border border-zinc-800/60 rounded-xl">
                      No channels added yet. Click "+ Add Channel" to start autonomous crawling.
                    </div>
                  )}
                </div>
              </div>

              {/* Right Column: External Bot Query Registry & Interactive Playground (5 cols) */}
              <div className="lg:col-span-5 space-y-6">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-xl font-bold text-zinc-100 flex items-center gap-2">
                      <Cpu className="w-5 h-5 text-blue-500" /> External Search Bots
                    </h2>
                    <p className="text-xs text-zinc-500 mt-1">Queried on demand via MTProto client.</p>
                  </div>
                  <button 
                    onClick={() => setShowAddBotModal(!showAddBotModal)}
                    className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition shadow"
                  >
                    <PlusCircle className="w-3.5 h-3.5" /> Register Bot
                  </button>
                </div>

                {/* Add Bot Modal Form */}
                {showAddBotModal && (
                  <form onSubmit={handleAddBot} className="p-5 bg-zinc-900/70 border border-blue-500/30 rounded-2xl space-y-3 animate-in fade-in duration-200">
                    <h4 className="text-sm font-bold text-blue-300">Register Telegram Search Bot</h4>
                    <div>
                      <label className="block text-[11px] text-zinc-400 mb-1">Bot Username</label>
                      <input 
                        type="text" 
                        placeholder="@TGMovieSearchBot" 
                        value={botUsername} 
                        onChange={e => setBotUsername(e.target.value)} 
                        required 
                        className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-sm text-white outline-none focus:border-blue-500" 
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[11px] text-zinc-400 mb-1">Query Type</label>
                        <select 
                          value={botType} 
                          onChange={e => setBotType(e.target.value as any)} 
                          className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-xs text-white"
                        >
                          <option value="inline">Inline (@bot query)</option>
                          <option value="command">Command (/search query)</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-[11px] text-zinc-400 mb-1">Priority</label>
                        <input 
                          type="number" 
                          min={1} 
                          max={10} 
                          value={botPriority} 
                          onChange={e => setBotPriority(e.target.value)} 
                          className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-xs text-white" 
                        />
                      </div>
                    </div>
                    <div className="flex justify-end gap-2 pt-2">
                      <button type="button" onClick={() => setShowAddBotModal(false)} className="px-3 py-1 text-xs text-zinc-400">Cancel</button>
                      <button type="submit" className="px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-lg">Save</button>
                    </div>
                  </form>
                )}

                {/* Bot Registry Table */}
                <div className="bg-zinc-900/40 border border-zinc-800/60 rounded-xl overflow-hidden divide-y divide-zinc-800/50">
                  {bots.map(b => (
                    <div key={b.id} className="p-3.5 flex items-center justify-between text-xs hover:bg-zinc-900/60 transition">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-zinc-200">{b.bot_username}</span>
                          <span className="px-1.5 py-0.5 bg-blue-500/10 text-blue-400 rounded text-[10px] font-mono uppercase">{b.bot_type}</span>
                          <span className="text-[10px] text-zinc-500 font-medium">P{b.priority}</span>
                        </div>
                        <p className="text-[11px] text-zinc-500 mt-0.5 font-mono">{b.command_template}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] text-emerald-400 font-semibold">{b.success_count || 0} hits</span>
                        <button onClick={() => handleDeleteBot(b.id)} className="p-1 text-zinc-500 hover:text-rose-400">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Interactive Search Bot Playground */}
                <div className="bg-zinc-900/60 border border-zinc-800/90 p-5 rounded-2xl space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-zinc-100 flex items-center gap-2">
                      <Zap className="w-4 h-4 text-amber-400" /> Bot Query Playground
                    </h3>
                    <span className="text-[10px] text-zinc-500 uppercase font-mono">Live MTProto Test</span>
                  </div>
                  
                  <form onSubmit={handleTestPlayground} className="space-y-3">
                    <div className="flex gap-2">
                      <input 
                        type="text" 
                        value={playgroundQuery} 
                        onChange={e => setPlaygroundQuery(e.target.value)} 
                        placeholder="Movie name (e.g. Oppenheimer)" 
                        className="flex-1 px-3.5 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-xs text-white outline-none focus:border-amber-500" 
                      />
                      <select 
                        value={playgroundBot} 
                        onChange={e => setPlaygroundBot(e.target.value)} 
                        className="bg-zinc-950 border border-zinc-800 rounded-lg text-xs text-zinc-300 px-2.5 outline-none"
                      >
                        {bots.map(b => (
                          <option key={b.id} value={b.bot_username}>{b.bot_username}</option>
                        ))}
                      </select>
                      <button 
                        type="submit" 
                        disabled={playgroundLoading || !playgroundQuery.trim()} 
                        className="px-3.5 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-lg text-xs font-semibold transition disabled:opacity-50 flex items-center gap-1.5"
                      >
                        {playgroundLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
                        {playgroundLoading ? "Querying..." : "Test"}
                      </button>
                    </div>
                  </form>

                  {playgroundNotice && (
                    <div className="p-3 bg-zinc-950 border border-zinc-800 text-zinc-300 text-xs rounded-lg">
                      {playgroundNotice}
                    </div>
                  )}

                  {/* Playground Result Preview Card */}
                  {playgroundResult && (
                    <div className="p-4 bg-zinc-950/80 border border-amber-500/30 rounded-xl space-y-3 animate-in fade-in duration-200">
                      <div className="flex items-center justify-between text-xs">
                        <span className={`font-bold flex items-center gap-1 ${playgroundResult.found ? "text-emerald-400" : "text-amber-400"}`}>
                          {playgroundResult.found ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertTriangle className="w-3.5 h-3.5" />}
                          {playgroundResult.found ? `Telegram Bot Replied (${playgroundResult.duration_ms}ms)` : "No Response"}
                        </span>
                        <span className="px-2 py-0.5 bg-zinc-800 text-zinc-300 rounded text-[10px] font-mono">
                          {playgroundResult.bot}
                        </span>
                      </div>

                      {playgroundResult.error && (
                        <div className="p-3 bg-red-950/30 border border-red-800/40 text-red-300 text-xs rounded-lg">
                          {playgroundResult.error}
                        </div>
                      )}

                      {playgroundResult.replyText && (
                        <div className="p-3 bg-zinc-900/80 rounded-lg text-xs font-mono text-zinc-300 whitespace-pre-wrap max-h-48 overflow-y-auto border border-zinc-800 leading-relaxed">
                          {playgroundResult.replyText}
                        </div>
                      )}

                      {/* If the bot returned release buttons (e.g. 1080p, 720p, 4K) */}
                      {playgroundResult.buttons && playgroundResult.buttons.length > 0 && (
                        <div className="space-y-1.5 pt-1">
                          <p className="text-[11px] text-zinc-400 font-semibold flex items-center gap-1">
                            <DownloadCloud className="w-3.5 h-3.5 text-amber-400" /> Releases Found &mdash; Click to Forward to Vault:
                          </p>
                          <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
                            {playgroundResult.buttons.map((btn: any, idx: number) => (
                              <button
                                key={idx}
                                onClick={() => handleForwardPlaygroundResult(btn.row, btn.col, idx)}
                                disabled={playgroundForwarding}
                                className="w-full text-left p-2.5 bg-zinc-900 hover:bg-zinc-850 hover:border-emerald-500/50 border border-zinc-800 rounded-lg text-xs transition flex items-center justify-between gap-2 group disabled:opacity-50"
                              >
                                <span className="font-mono text-zinc-200 truncate group-hover:text-emerald-300">
                                  {btn.text}
                                </span>
                                <span className="shrink-0 px-2 py-1 bg-emerald-600/20 group-hover:bg-emerald-600 text-emerald-400 group-hover:text-white rounded text-[11px] font-semibold flex items-center gap-1 transition">
                                  {playgroundForwarding && forwardingButtonIdx === idx ? (
                                    <>
                                      <RefreshCw className="w-3 h-3 animate-spin" /> Forwarding...
                                    </>
                                  ) : (
                                    <>
                                      <ArrowRight className="w-3 h-3" /> Forward to Vault
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
                          className="w-full py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-lg transition flex items-center justify-center gap-1.5 disabled:opacity-50"
                        >
                          <ArrowRight className="w-3.5 h-3.5" />
                          {playgroundForwarding ? "Forwarding to Vault..." : "Forward Video to Vault Now"}
                        </button>
                      )}
                    </div>
                  )}
                </div>

              </div>

            </div>

            {/* Bottom Row: Live Automation Activity Logs Feed */}
            <div className="bg-zinc-900/40 border border-zinc-800/60 p-6 rounded-2xl space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-zinc-100 flex items-center gap-2">
                  <Terminal className="w-4 h-4 text-emerald-400" /> Real-Time Crawler & Userbot Execution Feed
                </h3>
                <span className="text-[10px] text-zinc-500 font-mono">Auto-refreshes every 10s</span>
              </div>
              <div className="bg-zinc-950 p-4 rounded-xl border border-zinc-800/80 font-mono text-xs space-y-2 max-h-64 overflow-y-auto">
                {logs.map(log => (
                  <div key={log.id} className="flex items-start gap-3 border-b border-zinc-900 pb-1.5 last:border-0">
                    <span className="text-zinc-600 shrink-0 text-[10px]">{log.timestamp}</span>
                    <span className={`px-1.5 py-0.2 rounded text-[10px] uppercase font-bold shrink-0 ${
                      log.status === "success" 
                        ? "text-emerald-400 bg-emerald-500/10" 
                        : log.status === "filtered"
                        ? "text-amber-400 bg-amber-500/10"
                        : "text-rose-400 bg-rose-500/10"
                    }`}>
                      {log.type}
                    </span>
                    <span className="text-zinc-400 font-semibold shrink-0">[{log.source}]</span>
                    <span className="text-zinc-200">{log.title}: <span className="text-zinc-500">{log.details}</span></span>
                  </div>
                ))}
                {logs.length === 0 && <div className="text-zinc-600">No crawler events logged yet.</div>}
              </div>
            </div>

          </div>
        )}

        {/* ================= USER REQUESTS TAB ================= */}
        {activeTab === "requests" && (
          <div className="space-y-6 animate-in fade-in duration-300">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold text-zinc-100 flex items-center gap-2">
                  <Bell className="w-5 h-5 text-rose-500" /> Pending User Requests
                </h2>
                <p className="text-xs text-zinc-500 mt-1">Requests can be fulfilled manually or automatically fetched via external bots.</p>
              </div>
              <span className="text-xs font-semibold px-3 py-1 bg-rose-500/10 text-rose-400 border border-rose-500/20 rounded-full">
                {pendingRequests.length} Waiting
              </span>
            </div>

            {autoFetchNotice && (
              <div className="p-4 bg-purple-500/10 border border-purple-500/20 text-purple-300 rounded-xl text-xs flex items-center justify-between">
                <span>{autoFetchNotice}</span>
                <button onClick={() => setAutoFetchNotice(null)} className="text-xs hover:underline">Dismiss</button>
              </div>
            )}

            <div className="bg-zinc-900/40 border border-zinc-800/60 rounded-2xl overflow-hidden">
              {pendingRequests.length > 0 ? (
                <div className="divide-y divide-zinc-800/50">
                  {pendingRequests.map(req => (
                    <div key={req.id} className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-zinc-900/60 transition">
                      <div>
                        <h4 className="text-sm font-bold text-zinc-100">{req.title}</h4>
                        <p className="text-xs text-zinc-500 mt-1">Requested by user: <span className="font-mono text-zinc-400">{req.telegram_id}</span></p>
                      </div>
                      <div className="flex items-center gap-2">
                        {/* 1-Click Auto-Fetch via Search Bots */}
                        <button
                          onClick={() => handleAutoFetchRequest(req.id)}
                          disabled={autoFetchingId === req.id}
                          className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-lg text-xs font-semibold transition flex items-center gap-1.5 shadow-md shadow-purple-500/20 disabled:opacity-50"
                        >
                          <Zap className="w-3.5 h-3.5 text-amber-300" />
                          {autoFetchingId === req.id ? "Fetching via Bots..." : "Auto-Fetch via Bots"}
                        </button>
                        <button 
                          onClick={() => handleFulfillRequest(req.id)}
                          className="px-4 py-2 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/20 rounded-lg text-xs font-semibold transition"
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

            <h2 className="text-xl font-bold text-zinc-100 mt-10">Request History</h2>
            <div className="bg-zinc-900/40 border border-zinc-800/60 rounded-2xl overflow-hidden">
               <table className="w-full text-left text-sm text-zinc-400">
                 <thead className="bg-zinc-900/80 text-xs uppercase font-semibold text-zinc-500">
                   <tr><th className="px-5 py-4">Title</th><th className="px-5 py-4">User</th><th className="px-5 py-4">Status</th></tr>
                 </thead>
                 <tbody className="divide-y divide-zinc-800/50">
                   {allRequests.slice(0, 15).map(req => (
                     <tr key={req.id} className="hover:bg-zinc-900/60">
                       <td className="px-5 py-4 font-medium text-zinc-300">{req.title}</td>
                       <td className="px-5 py-4 font-mono text-xs text-zinc-500">{req.telegram_id}</td>
                       <td className="px-5 py-4">
                         <span className={`px-2 py-1 rounded text-[10px] font-bold uppercase ${req.status === 'pending' ? 'bg-amber-500/10 text-amber-500' : 'bg-emerald-500/10 text-emerald-500'}`}>
                           {req.status}
                         </span>
                       </td>
                     </tr>
                   ))}
                 </tbody>
               </table>
            </div>
          </div>
        )}

        {/* ================= VAULT INVENTORY TAB ================= */}
        {activeTab === "library" && (
          <div className="space-y-6 animate-in fade-in duration-300">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h2 className="text-xl font-bold text-zinc-100 flex items-center gap-2">
                  <HardDrive className="w-5 h-5 text-purple-500" /> Vault Inventory
                </h2>
                <p className="text-xs text-zinc-500 mt-1">{libraryFiles.length} media files stored in private vault channel and Firestore.</p>
              </div>
              <div className="flex items-center gap-3">
                <div className="relative">
                  <Search className="w-4 h-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={librarySearch}
                    onChange={(e) => setLibrarySearch(e.target.value)}
                    placeholder="Search vault movies..."
                    className="pl-9 pr-4 py-2 bg-zinc-900 border border-zinc-800 rounded-lg text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-purple-500 w-48 sm:w-64 transition"
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
                  className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-white border border-zinc-700 rounded-lg text-xs font-semibold transition flex items-center gap-2"
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
                      <div key={file.id} className="bg-zinc-900/40 border border-zinc-800/60 rounded-xl overflow-hidden group hover:border-zinc-700 transition">
                        <div className="h-40 bg-zinc-800 relative">
                          {file.poster_url && (
                             <img src={file.poster_url.startsWith("http") ? file.poster_url : `https://image.tmdb.org/t/p/w500${file.poster_url}`} alt={file.movie_title} className="absolute inset-0 w-full h-full object-cover" />
                          )}
                          <div className="absolute inset-0 bg-gradient-to-t from-black/90 to-transparent" />
                          <div className="absolute bottom-3 left-3 right-3 text-white">
                            <p className="font-bold text-sm leading-tight line-clamp-1">{file.movie_title}</p>
                            <p className="text-xs text-zinc-400 font-medium">
                              {file.season && file.episode ? `S${file.season}E${file.episode} • ` : ""}
                              {file.year ? `${file.year} • ` : ""}
                              {file.quality || "HD"}
                            </p>
                          </div>
                        </div>
                        <div className="p-3 bg-zinc-950 flex items-center justify-between">
                           <span className="text-[10px] text-zinc-500 font-mono truncate max-w-[140px]" title={file.file_name || file.telegram_file_id}>
                             {file.file_name || `${file.telegram_file_id.substring(0, 15)}...`}
                           </span>
                           <span className="text-xs font-semibold text-zinc-400">{formatBytes(file.file_size)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                  {filtered.length === 0 && (
                    <div className="p-12 text-center text-zinc-500 text-sm bg-zinc-900/40 rounded-2xl border border-zinc-800/60">
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
            <h2 className="text-xl font-bold text-zinc-100 flex items-center gap-2">
              <Megaphone className="w-5 h-5 text-blue-500" /> Global Messaging & Engagement
            </h2>
            
            <div className="bg-zinc-900/40 border border-zinc-800/60 p-8 rounded-3xl">
               <h3 className="text-sm font-semibold text-zinc-300 mb-2">Broadcast Announcement</h3>
               <p className="text-xs text-zinc-500 mb-4">Send a message to all users active on the Telegram bot.</p>
               <textarea
                 value={broadcastMsg}
                 onChange={e => setBroadcastMsg(e.target.value)}
                 placeholder="Hello everyone, we just uploaded..."
                 className="w-full h-32 bg-zinc-950 border border-zinc-800/80 rounded-xl p-4 text-sm outline-none focus:border-blue-500 transition mb-4 resize-none"
               />
               <div className="flex items-center justify-between">
                 {broadcastStatus ? <span className="text-xs font-medium text-emerald-400">{broadcastStatus}</span> : <div/>}
                 <button
                   onClick={handleSendBroadcast}
                   disabled={broadcastSending || !broadcastMsg.trim()}
                   className="px-6 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-sm font-semibold shadow-lg shadow-blue-500/20 transition disabled:opacity-50"
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
