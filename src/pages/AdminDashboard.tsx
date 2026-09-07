import React, { useEffect, useState, FormEvent, ChangeEvent } from "react";
import { 
  Database, Users, Search, Bell, HardDrive, ShieldCheck, 
  RefreshCw, Webhook, Link as LinkIcon, Sparkles, FolderPlus,
  Megaphone, Layers, FileVideo, DownloadCloud, UploadCloud
} from "lucide-react";
import { Status, ChannelLog, MediaFile } from "../types";

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
  const [activeTab, setActiveTab] = useState<"overview" | "requests" | "library" | "comms">("overview");

  // Requests Data
  const [pendingRequests, setPendingRequests] = useState<any[]>([]);
  const [allRequests, setAllRequests] = useState<any[]>([]);
  
  // Library Data
  const [libraryFiles, setLibraryFiles] = useState<MediaFile[]>([]);
  
  // Index File Form
  const [newFileTitle, setNewFileTitle] = useState("");
  const [newFileYear, setNewFileYear] = useState("");
  const [newFileQuality, setNewFileQuality] = useState("1080p");
  const [newFileId, setNewFileId] = useState("");

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
              Enterprise-grade dashboard for BusiMovie. Manage cloud synchronization, Telegram integrations, and autonomous AI retention flows.
            </p>
          </div>
          <div className="flex gap-3">
             <button onClick={() => setShowAddForm(!showAddForm)} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg flex items-center gap-2 text-sm font-medium transition shadow-lg shadow-blue-500/20">
               <FileVideo className="w-4 h-4" /> Index Media
             </button>
             <button className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-white rounded-lg flex items-center gap-2 text-sm font-medium transition">
               <Layers className="w-4 h-4" /> Collections
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
                <label className="block text-xs text-zinc-500 mb-1.5 font-medium">Release Year</label>
                <input type="text" value={newFileYear} onChange={e => setNewFileYear(e.target.value)} className="w-full px-4 py-2.5 bg-zinc-950 border border-zinc-800/80 rounded-lg outline-none focus:border-blue-500 text-sm transition" />
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

        {/* Tabs */}
        <div className="flex items-center gap-2 border-b border-zinc-800/50 pb-px">
          {(["overview", "requests", "library", "comms"] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2.5 text-sm font-semibold capitalize border-b-2 transition-all ${
                activeTab === tab 
                  ? "border-blue-500 text-white" 
                  : "border-transparent text-zinc-500 hover:text-zinc-300 hover:border-zinc-700"
              }`}
            >
              {tab === "comms" ? "Engagement" : tab}
            </button>
          ))}
        </div>

        {/* Overview Tab */}
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
               <p className="text-xs text-zinc-500 mt-2 font-medium">Awaiting auto-sync</p>
             </div>
          </div>
        </div>

        {/* Infrastructure Control Panel */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          
          {/* Firebase Persistence Card */}
          <div className="bg-zinc-900/50 border border-zinc-800/80 p-8 rounded-3xl flex flex-col relative overflow-hidden">
            <div className="absolute top-0 right-0 p-8 opacity-10 pointer-events-none">
              <Database className="w-48 h-48 text-amber-500" />
            </div>
            
            <div className="relative z-10 flex-1">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-xl bg-amber-500/10 text-amber-500 border border-amber-500/20">
                    <ShieldCheck className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-zinc-100">Cloud Persistence</h3>
                    <p className="text-xs text-zinc-400 font-medium">Google Cloud Firestore Integration</p>
                  </div>
                </div>
                <span className="px-3 py-1 text-[11px] font-bold uppercase tracking-wider rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> Active
                </span>
              </div>
              
              <p className="text-sm text-zinc-400 leading-relaxed mb-8">
                Data is written securely to Firestore. System guarantees zero-data-loss cross-reboot synchronization, rehydrating the local SQLite vault instantly upon container boot.
              </p>
            </div>

            <div className="relative z-10 flex items-center justify-between mt-auto pt-6 border-t border-zinc-800/60">
              <button
                onClick={handleTriggerCloudSync}
                disabled={cloudSyncLoading}
                className="px-5 py-2.5 bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/30 rounded-xl text-sm font-semibold flex items-center gap-2 transition disabled:opacity-50"
              >
                <RefreshCw className={`w-4 h-4 ${cloudSyncLoading ? "animate-spin" : ""}`} />
                {cloudSyncLoading ? "Synchronizing State..." : "Force Cloud Sync"}
              </button>
              {cloudSyncMsg && <span className="text-xs font-medium text-amber-400">{cloudSyncMsg}</span>}
            </div>
          </div>

          {/* AI Retention & Follow-ups Card */}
          <div className="bg-zinc-900/50 border border-zinc-800/80 p-8 rounded-3xl flex flex-col relative overflow-hidden">
            <div className="absolute top-0 right-0 p-8 opacity-10 pointer-events-none">
              <Sparkles className="w-48 h-48 text-purple-500" />
            </div>
            
            <div className="relative z-10 flex-1">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-xl bg-purple-500/10 text-purple-400 border border-purple-500/20">
                    <Sparkles className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-zinc-100">AI Retention Engine</h3>
                    <p className="text-xs text-zinc-400 font-medium">Smart Follow-ups & Spotlights</p>
                  </div>
                </div>
                <span className="px-3 py-1 text-[11px] font-bold uppercase tracking-wider rounded-full bg-purple-500/10 text-purple-400 border border-purple-500/20">
                  Automated
                </span>
              </div>
              
              <p className="text-sm text-zinc-400 leading-relaxed mb-8">
                Autonomous agent drives user re-engagement via post-watch trivia, personalized cinema recommendations, and 6-hour interval spotlight broadcasts to active users.
              </p>
            </div>

            <div className="relative z-10 flex items-center justify-between mt-auto pt-6 border-t border-zinc-800/60">
              <button
                onClick={handleTriggerReEngagement}
                disabled={engagementLoading}
                className="px-5 py-2.5 bg-purple-500/10 hover:bg-purple-500/20 text-purple-400 border border-purple-500/30 rounded-xl text-sm font-semibold flex items-center gap-2 transition disabled:opacity-50"
              >
                <Megaphone className={`w-4 h-4 ${engagementLoading ? "animate-bounce" : ""}`} />
                {engagementLoading ? "Broadcasting..." : "Broadcast AI Spotlight"}
              </button>
              {engagementMsg && <span className="text-xs font-medium text-purple-400">{engagementMsg}</span>}
            </div>
          </div>
        </div>

        {/* Telegram Webhook Infrastructure */}
        <div className="bg-zinc-900/40 border border-zinc-800/60 rounded-3xl overflow-hidden">
          <div className="p-8 border-b border-zinc-800/60 bg-gradient-to-r from-zinc-900/80 to-transparent">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="p-3 rounded-2xl bg-blue-500/10 text-blue-500 border border-blue-500/20 shadow-inner">
                  <Webhook className="w-8 h-8" />
                </div>
                <div>
                  <h3 className="text-xl font-bold text-zinc-100">Telegram Edge Routing</h3>
                  <p className="text-sm text-zinc-400 mt-1 font-medium">Configure Long Polling or 24/7 Webhook delivery for Cloud Run.</p>
                </div>
              </div>
              <div className="hidden md:flex flex-col items-end">
                <span className={`px-4 py-1.5 text-xs font-bold uppercase tracking-wider rounded-full flex items-center gap-2 ${
                  webhookMode === "webhook" 
                    ? "bg-blue-500/10 text-blue-400 border border-blue-500/30 shadow-[0_0_15px_rgba(59,130,246,0.15)]" 
                    : "bg-zinc-800 text-zinc-400 border border-zinc-700"
                }`}>
                  {webhookMode === "webhook" ? <><span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" /> Webhook Active</> : "Long Polling"}
                </span>
              </div>
            </div>
          </div>
          
          <div className="p-8 grid grid-cols-1 lg:grid-cols-2 gap-10">
            <div className="space-y-6">
              <div className="space-y-3">
                <label className="text-sm font-semibold text-zinc-300 flex items-center gap-2">
                  <LinkIcon className="w-4 h-4 text-zinc-500" /> Target HTTPS URL
                </label>
                <div className="flex gap-3">
                  <input
                    type="text"
                    value={customWebhookUrl}
                    onChange={(e) => setCustomWebhookUrl(e.target.value)}
                    placeholder="https://your-cloud-run-url.run.app"
                    className="flex-1 bg-zinc-950 border border-zinc-800/80 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-blue-500 transition"
                  />
                  <button
                    onClick={() => handleSetWebhook()}
                    disabled={webhookLoading}
                    className="px-6 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-sm font-semibold transition disabled:opacity-50 shadow-lg shadow-blue-500/20"
                  >
                    Set Webhook
                  </button>
                </div>
                <p className="text-xs text-zinc-500 leading-relaxed font-medium">
                  Enter your production Cloud Run domain to receive instant, 24/7 push updates. 
                  (Do not use AI Studio preview URLs here).
                </p>
              </div>
              
              {detectedUrl && !detectedUrl.includes("localhost") && (
                <div className="p-4 rounded-xl bg-blue-500/5 border border-blue-500/10 flex items-center justify-between">
                  <div>
                    <p className="text-xs text-zinc-400 font-medium">Detected Environment URL</p>
                    <p className="text-sm text-blue-400 font-mono mt-1">{detectedUrl}</p>
                  </div>
                  <button 
                    onClick={() => handleSetWebhook(detectedUrl)}
                    className="px-4 py-2 bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 border border-blue-500/20 rounded-lg text-xs font-semibold transition"
                  >
                    Use This
                  </button>
                </div>
              )}
            </div>

            <div className="p-6 rounded-2xl bg-zinc-950 border border-zinc-800/50 space-y-4">
              <div className="flex items-center justify-between pb-4 border-b border-zinc-900">
                <span className="text-sm font-semibold text-zinc-300">Connection Status</span>
                {webhookMode === "webhook" ? (
                  <span className="text-sm font-bold text-blue-400">Stable</span>
                ) : (
                  <span className="text-sm font-bold text-emerald-400">Polling</span>
                )}
              </div>
              
              <div className="space-y-2">
                <div className="flex justify-between text-xs">
                  <span className="text-zinc-500">Pending Updates</span>
                  <span className="text-zinc-300 font-mono">{webhookInfo?.pending_update_count || 0}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-zinc-500">Max Connections</span>
                  <span className="text-zinc-300 font-mono">{webhookInfo?.max_connections || 40}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-zinc-500">Endpoint IP</span>
                  <span className="text-zinc-300 font-mono">{webhookInfo?.ip_address || "N/A"}</span>
                </div>
              </div>

              {webhookMode === "webhook" && (
                <div className="pt-4 mt-2 border-t border-zinc-900 flex justify-end">
                  <button
                    onClick={handleDeleteWebhook}
                    disabled={webhookLoading}
                    className="px-4 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 rounded-lg text-xs font-semibold transition disabled:opacity-50"
                  >
                    Revert to Long Polling
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
        </div>
        )}

        {/* User Requests Tab */}
        {activeTab === "requests" && (
          <div className="space-y-6 animate-in fade-in duration-300">
            <h2 className="text-xl font-bold text-zinc-100 flex items-center gap-2">
              <Bell className="w-5 h-5 text-rose-500" /> Pending Requests
            </h2>
            <div className="bg-zinc-900/40 border border-zinc-800/60 rounded-2xl overflow-hidden">
              {pendingRequests.length > 0 ? (
                <div className="divide-y divide-zinc-800/50">
                  {pendingRequests.map(req => (
                    <div key={req.id} className="p-5 flex items-center justify-between hover:bg-zinc-900/60 transition">
                      <div>
                        <h4 className="text-sm font-bold text-zinc-100">{req.title}</h4>
                        <p className="text-xs text-zinc-500 mt-1">Requested by user: <span className="font-mono text-zinc-400">{req.telegram_id}</span></p>
                      </div>
                      <button 
                        onClick={() => handleFulfillRequest(req.id)}
                        className="px-4 py-2 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/20 rounded-lg text-xs font-semibold transition"
                      >
                        Mark Fulfilled & Notify
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-12 text-center text-zinc-500 text-sm">No pending requests.</div>
              )}
            </div>

            <h2 className="text-xl font-bold text-zinc-100 mt-10">Recent History</h2>
            <div className="bg-zinc-900/40 border border-zinc-800/60 rounded-2xl overflow-hidden">
               <table className="w-full text-left text-sm text-zinc-400">
                 <thead className="bg-zinc-900/80 text-xs uppercase font-semibold text-zinc-500">
                   <tr><th className="px-5 py-4">Title</th><th className="px-5 py-4">Status</th></tr>
                 </thead>
                 <tbody className="divide-y divide-zinc-800/50">
                   {allRequests.slice(0, 15).map(req => (
                     <tr key={req.id} className="hover:bg-zinc-900/60">
                       <td className="px-5 py-4 font-medium text-zinc-300">{req.title}</td>
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

        {/* Content Vault / Library Tab */}
        {activeTab === "library" && (
          <div className="space-y-6 animate-in fade-in duration-300">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-bold text-zinc-100 flex items-center gap-2">
                <HardDrive className="w-5 h-5 text-purple-500" /> Vault Inventory
              </h2>
              <button 
                onClick={() => window.open("/api/library/export", "_blank")}
                className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-white border border-zinc-700 rounded-lg text-xs font-semibold transition flex items-center gap-2"
              >
                <DownloadCloud className="w-4 h-4" /> Export Backup JSON
              </button>
            </div>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {libraryFiles.map(file => (
                <div key={file.id} className="bg-zinc-900/40 border border-zinc-800/60 rounded-xl overflow-hidden group">
                  <div className="h-40 bg-zinc-800 relative">
                    {file.poster_url && (
                       <img src={file.poster_url.startsWith("http") ? file.poster_url : `https://image.tmdb.org/t/p/w500${file.poster_url}`} alt={file.movie_title} className="absolute inset-0 w-full h-full object-cover" />
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/90 to-transparent" />
                    <div className="absolute bottom-3 left-3 text-white">
                      <p className="font-bold text-sm leading-tight line-clamp-1">{file.movie_title}</p>
                      <p className="text-xs text-zinc-400 font-medium">{file.year} • {file.quality || "HD"}</p>
                    </div>
                  </div>
                  <div className="p-3 bg-zinc-950 flex items-center justify-between">
                     <span className="text-[10px] text-zinc-500 font-mono truncate">{file.telegram_file_id.substring(0, 15)}...</span>
                     <span className="text-xs font-semibold text-zinc-400">{formatBytes(file.file_size)}</span>
                  </div>
                </div>
              ))}
            </div>
            {libraryFiles.length === 0 && <div className="p-12 text-center text-zinc-500 text-sm bg-zinc-900/40 rounded-2xl border border-zinc-800/60">No files indexed yet.</div>}
          </div>
        )}

        {/* Communications / Engagement Tab */}
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
