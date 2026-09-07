import { useEffect, useState, FormEvent, ChangeEvent } from "react";
import { Play, Search, Bell, User, Plus, X, Bot, Send, MonitorPlay, Check, DownloadCloud, Sparkles, HardDrive, Users, CheckCircle2, Megaphone, Layers, Dices, Terminal, Radio, ShieldCheck, FileVideo, Tv, Share2, Database, AlertCircle, FolderPlus, UploadCloud, Film, Wifi, Globe, RefreshCw } from "lucide-react";

// Interfaces
interface MediaFile {
  id: number;
  movie_id: string;
  movie_title: string;
  year?: string;
  telegram_file_id: string;
  file_name?: string;
  file_size?: number;
  quality?: string;
  poster_url?: string;
  trailer_url?: string;
}

interface RequestItem {
  id: number;
  telegram_id: string;
  title: string;
  status: string;
}

interface SearchResult {
  id: string;
  title: string;
  year?: string;
  overview: string;
  poster_path: string | null;
}

interface ChannelLog {
  id: number;
  channel_id: string;
  channel_title: string;
  message_id: string;
  parsed_title: string;
  quality?: string;
  file_size?: number;
  created_at: string;
}

interface TelegramUpdateLog {
  id: string;
  time: string;
  updateType: string;
  chatTitle?: string;
  text?: string;
  chatType?: string;
  chatId?: string;
}

interface Status {
  botRunning: boolean;
  stats: {
    users: number;
    searches: number;
    requests: number;
    pendingRequests: number;
    libraryFiles: number;
    totalVaultBytes: number;
  };
  recentUpdates: TelegramUpdateLog[];
}

function formatBytes(bytes?: number): string {
  if (!bytes || bytes === 0) return "0 MB";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

export default function App() {
  // Consumer State
  const [library, setLibrary] = useState<MediaFile[]>([]);
  const [requestsList, setRequestsList] = useState<RequestItem[]>([]);
  const [heroMovie, setHeroMovie] = useState<SearchResult | null>(null);
  const [scrolled, setScrolled] = useState(false);
  const [botRunning, setBotRunning] = useState(false);

  // Admin State
  const [status, setStatus] = useState<Status | null>(null);
  const [channelLogs, setChannelLogs] = useState<ChannelLog[]>([]);
  const [botUsersCount, setBotUsersCount] = useState(0);

  // AI Concierge state
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiResult, setAiResult] = useState<any>(null);

  // Feature Modals & Forms
  const [playingMedia, setPlayingMedia] = useState<MediaFile | null>(null);
  const [streamInfo, setStreamInfo] = useState<{ streamUrl?: string; tgDirectLink?: string; loading: boolean } | null>(null);
  
  const [showBroadcastModal, setShowBroadcastModal] = useState(false);
  const [broadcastMsg, setBroadcastMsg] = useState("");
  const [broadcastSending, setBroadcastSending] = useState(false);
  const [broadcastStatus, setBroadcastStatus] = useState<string | null>(null);

  const [showCollectionsModal, setShowCollectionsModal] = useState(false);
  const [collections, setCollections] = useState<any[]>([]);
  const [newCollectionName, setNewCollectionName] = useState("");
  const [selectedCollection, setSelectedCollection] = useState<any | null>(null);
  const [collectionItems, setCollectionItems] = useState<MediaFile[]>([]);
  const [fileToAddToCollection, setFileToAddToCollection] = useState<MediaFile | null>(null);

  const [showAddForm, setShowAddForm] = useState(false);
  const [newFileTitle, setNewFileTitle] = useState("");
  const [newFileYear, setNewFileYear] = useState("");
  const [newFileQuality, setNewFileQuality] = useState("1080p");
  const [newFileId, setNewFileId] = useState("");

  // Batch Indexing & Vault Backup state
  const [showBatchModal, setShowBatchModal] = useState(false);
  const [batchTitles, setBatchTitles] = useState("");
  const [batchLoading, setBatchLoading] = useState(false);
  const [batchResultMsg, setBatchResultMsg] = useState<string | null>(null);

  // 24/7 Webhook & Cloud Persistence State
  const [webhookInfo, setWebhookInfo] = useState<any>(null);
  const [webhookMode, setWebhookMode] = useState<string>("polling");
  const [detectedUrl, setDetectedUrl] = useState<string>("");
  const [customWebhookUrl, setCustomWebhookUrl] = useState<string>("");
  const [webhookLoading, setWebhookLoading] = useState(false);
  const [cloudSyncLoading, setCloudSyncLoading] = useState(false);
  const [cloudSyncMsg, setCloudSyncMsg] = useState<string | null>(null);

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

  const handleSetWebhook = async (urlToUse?: string) => {
    const target = (urlToUse || customWebhookUrl || "").trim();
    if (!target) {
      alert("Please enter a public HTTPS URL (for example, your deployed Cloud Run app URL).");
      return;
    }
    if (target.includes("ais-dev-")) {
      alert("AI Studio preview URLs ('ais-dev-*.run.app') require Google login and block Telegram with a 302 redirect. Please use Long Polling mode while in the development preview, or provide your deployed Cloud Run URL.");
      return;
    }
    setWebhookLoading(true);
    try {
      const res = await fetch("/api/telegram/set-webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: target })
      });
      const data = await res.json();
      if (res.ok) {
        alert("24/7 Webhook enabled! Telegram will push updates directly to: " + data.url);
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
      const data = await res.json();
      if (res.ok) {
        alert("Switched to Long Polling mode.");
        fetchWebhookStatus();
      } else {
        alert("Failed to delete webhook: " + (data.error || "Unknown error"));
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
        setCloudSyncMsg(`Cloud sync successful! ${data.count} movies verified in Firestore.`);
        fetchData();
      } else {
        setCloudSyncMsg("Sync failed: " + (data.error || "Error"));
      }
    } catch (err: any) {
      setCloudSyncMsg("Sync error: " + err.message);
    } finally {
      setCloudSyncLoading(false);
    }
  };

  const handleExportBackup = () => {
    window.open("/api/library/export", "_blank");
  };

  const handleImportBackup = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const json = JSON.parse(event.target?.result as string);
        const res = await fetch("/api/library/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(json)
        });
        const data = await res.json();
        alert(`Successfully imported ${data.count || 0} movies into Vault!`);
        fetchData();
      } catch (err: any) {
        alert("Failed to import JSON backup: " + err.message);
      }
    };
    reader.readAsText(file);
  };

  const handleBatchIndex = async () => {
    if (!batchTitles.trim()) return;
    setBatchLoading(true);
    setBatchResultMsg(null);
    try {
      const titles = batchTitles
        .split(/[\n,]+/)
        .map(t => t.trim())
        .filter(Boolean);

      const res = await fetch("/api/library/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ titles })
      });
      const data = await res.json();
      setBatchResultMsg(`Successfully indexed ${data.count || 0} movies with posters!`);
      setBatchTitles("");
      fetchData();
    } catch (err: any) {
      setBatchResultMsg(`Error indexing: ${err.message}`);
    } finally {
      setBatchLoading(false);
    }
  };

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 50);
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const fetchData = async () => {
    try {
      const [statusRes, libRes, reqRes, logsRes, usersRes, colRes] = await Promise.all([
        fetch("/api/status"),
        fetch("/api/library"),
        fetch("/api/requests"),
        fetch("/api/channel/logs?limit=15"),
        fetch("/api/users"),
        fetch("/api/collections")
      ]);

      if (statusRes.ok) {
        const s = await statusRes.json();
        setStatus(s);
        setBotRunning(s.botRunning);
      }
      if (libRes.ok) {
        const l = await libRes.json();
        setLibrary(l.files || []);
        if (l.files && l.files.length > 0 && !heroMovie) {
          fetchHeroMovie(l.files[0].movie_title);
        }
      }
      if (reqRes.ok) {
        const r = await reqRes.json();
        setRequestsList(r.all || []);
      }
      if (logsRes.ok) {
        const cl = await logsRes.json();
        setChannelLogs(cl.logs || []);
      }
      if (usersRes.ok) {
        const u = await usersRes.json();
        setBotUsersCount(u.count || 0);
      }
      if (colRes.ok) {
        setCollections(await colRes.json());
      }
      fetchWebhookStatus();
    } catch (e) {
      console.error(e);
    }
  };

  const fetchHeroMovie = async (title: string) => {
    try {
      const res = await fetch(`/api/search-test?q=${encodeURIComponent(title)}`);
      if (res.ok) {
        const data = await res.json();
        if (data.results && data.results.length > 0) {
          setHeroMovie(data.results[0]);
        }
      }
    } catch (e) {}
  };

  useEffect(() => {
    fetchData();
    const int = setInterval(fetchData, 10000);
    return () => clearInterval(int);
  }, []);

  const handleAskAI = async () => {
    if (!aiPrompt.trim()) return;
    setAiLoading(true);
    setAiResult(null);
    try {
      const res = await fetch("/api/ai/recommend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: aiPrompt })
      });
      if (res.ok) setAiResult(await res.json());
    } catch (err) {} finally {
      setAiLoading(false);
    }
  };

  const handlePlayMedia = async (file: MediaFile) => {
    setPlayingMedia(file);
    setStreamInfo({ loading: true });
    try {
      const res = await fetch(`/api/media/${file.id}/stream`);
      if (res.ok) {
        const data = await res.json();
        setStreamInfo({ streamUrl: data.streamUrl, tgDirectLink: data.tgDirectLink, loading: false });
      } else {
        setStreamInfo({ loading: false });
      }
    } catch (err) { setStreamInfo({ loading: false }); }
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
        setBroadcastStatus(`Delivered to ${data.sent} of ${data.total} users!`);
        setBroadcastMsg("");
        setTimeout(() => { setShowBroadcastModal(false); setBroadcastStatus(null); }, 2500);
      } else {
        setBroadcastStatus(data.error || "Failed");
      }
    } catch (err: any) { setBroadcastStatus("Error: " + err.message); } finally { setBroadcastSending(false); }
  };

  const createCollection = async () => {
    if (!newCollectionName.trim()) return;
    try {
      await fetch("/api/collections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newCollectionName })
      });
      setNewCollectionName("");
      fetchData();
    } catch (e) {}
  };

  const viewCollection = async (c: any) => {
    setSelectedCollection(c);
    try {
      const res = await fetch(`/api/collections/${c.id}/items`);
      if (res.ok) setCollectionItems(await res.json());
    } catch (e) {}
  };

  const addFileToCollection = async (collectionId: number) => {
    if (!fileToAddToCollection) return;
    try {
      await fetch(`/api/collections/${collectionId}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mediaFileId: fileToAddToCollection.id })
      });
      setFileToAddToCollection(null);
      fetchData();
    } catch (e) {}
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

  const getGradient = (title: string) => {
    const colors = ["from-red-900 to-black", "from-zinc-800 to-black", "from-blue-950 to-black", "from-purple-950 to-black"];
    return colors[title.length % colors.length];
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-white font-sans overflow-x-hidden pb-12">
      {/* Navbar */}
      <nav className={`fixed top-0 w-full z-50 transition-all duration-300 ${scrolled ? "bg-zinc-950/95 backdrop-blur-md shadow-lg" : "bg-gradient-to-b from-black/80 to-transparent"}`}>
        <div className="px-4 md:px-12 py-4 flex items-center justify-between">
          <div className="flex items-center gap-8">
            <h1 className="text-red-600 font-black text-2xl tracking-tighter cursor-pointer">BUSIMOVIE</h1>
            <div className="hidden md:flex gap-5 text-sm font-medium text-zinc-300">
              <span className="text-white cursor-pointer transition">Home</span>
              <span className="hover:text-white cursor-pointer transition" onClick={() => window.scrollTo({top: 800, behavior: 'smooth'})}>Vault</span>
              <span className="hover:text-white cursor-pointer transition" onClick={() => window.scrollTo({top: 2000, behavior: 'smooth'})}>Admin</span>
            </div>
          </div>
          <div className="flex items-center gap-3 md:gap-5 text-zinc-300">
            <span className="flex items-center text-xs font-medium text-amber-400 bg-amber-950/40 px-2 py-1 rounded border border-amber-800/50" title="Firebase Firestore Cloud Database Connected">
              <Database className="w-3 h-3 mr-1 text-amber-400" /> Firebase Cloud
            </span>
            {botRunning ? (
              <span className="flex items-center text-xs font-medium text-green-400 bg-green-950/40 px-2 py-1 rounded border border-green-800/50">
                <CheckCircle2 className="w-3 h-3 mr-1" /> Online
              </span>
            ) : (
              <span className="flex items-center text-xs font-medium text-amber-400 bg-amber-950/40 px-2 py-1 rounded border border-amber-800/50">
                <Bot className="w-3 h-3 mr-1" /> Offline
              </span>
            )}
            <Bell className="w-5 h-5 cursor-pointer hover:text-white transition" />
            <div className="w-8 h-8 rounded bg-red-600 flex items-center justify-center font-bold text-white cursor-pointer">
              <User className="w-4 h-4" />
            </div>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <div className="relative h-[85vh] w-full bg-zinc-900 overflow-hidden">
        {heroMovie?.poster_path ? (
          <img src={heroMovie.poster_path} alt="Hero" className="absolute inset-0 w-full h-full object-cover opacity-60 mix-blend-screen" />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-tr from-zinc-900 to-red-900/40 opacity-70" />
        )}
        
        <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-zinc-950/20 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-r from-zinc-950/90 via-zinc-950/40 to-transparent" />

        <div className="relative z-10 h-full flex flex-col justify-end px-4 md:px-12 pb-24 max-w-3xl">
          {heroMovie ? (
            <>
              <h1 className="text-5xl md:text-7xl font-bold tracking-tight mb-4 drop-shadow-xl">{heroMovie.title}</h1>
              <p className="text-lg md:text-xl text-zinc-300 mb-8 line-clamp-3 drop-shadow-md">{heroMovie.overview}</p>
            </>
          ) : (
            <>
              <h1 className="text-5xl md:text-7xl font-bold tracking-tight mb-4 drop-shadow-xl">Telegram Movie Vault</h1>
              <p className="text-lg md:text-xl text-zinc-300 mb-8 drop-shadow-md">Search, request, and download any movie or TV show directly through your private Telegram bot.</p>
            </>
          )}

          <div className="flex gap-4">
            <button onClick={() => library.length > 0 && handlePlayMedia(library[0])} className="flex items-center justify-center gap-2 bg-white hover:bg-zinc-200 text-black px-6 md:px-8 py-3 rounded-md font-bold text-lg transition">
              <Play className="w-6 h-6 fill-black" /> Play in Vault
            </button>
            <a href="https://t.me/EaziMovie_bot" target="_blank" rel="noreferrer" className="flex items-center justify-center gap-2 bg-zinc-500/40 hover:bg-zinc-500/60 text-white px-6 md:px-8 py-3 rounded-md font-bold text-lg backdrop-blur-md transition">
              <Bot className="w-6 h-6" /> Open Bot
            </a>
          </div>
        </div>
      </div>

      <div className="relative z-20 px-4 md:px-12 -mt-10 space-y-12">
        
        {/* Row 1: My Vault */}
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <h2 className="text-2xl font-semibold text-zinc-100 flex items-center gap-2">
              My Vault <span className="text-sm font-normal text-zinc-400 bg-zinc-800/80 px-2 py-0.5 rounded">{library.length} Titles</span>
            </h2>
            <div className="flex flex-wrap items-center gap-2">
              <button 
                onClick={() => setShowBatchModal(true)} 
                className="px-3 py-1.5 bg-red-600/20 hover:bg-red-600/30 text-red-400 border border-red-800/50 rounded-md text-xs font-semibold flex items-center gap-1.5 transition"
              >
                <FolderPlus className="w-3.5 h-3.5" /> Batch Index Movies
              </button>
              <button 
                onClick={handleExportBackup} 
                title="Download JSON backup of all movies in Vault" 
                className="px-3 py-1.5 bg-zinc-850 hover:bg-zinc-800 text-zinc-300 border border-zinc-800 rounded-md text-xs font-semibold flex items-center gap-1.5 transition"
              >
                <DownloadCloud className="w-3.5 h-3.5" /> Backup JSON
              </button>
              <label 
                title="Restore Vault from a JSON backup file" 
                className="px-3 py-1.5 bg-zinc-850 hover:bg-zinc-800 text-zinc-300 border border-zinc-800 rounded-md text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer"
              >
                <UploadCloud className="w-3.5 h-3.5" /> Restore JSON
                <input type="file" accept=".json" onChange={handleImportBackup} className="hidden" />
              </label>
            </div>
          </div>
          {library.length > 0 ? (
            <div className="flex overflow-x-auto gap-4 pb-4 scrollbar-hide snap-x">
              {library.map((file) => (
                <div key={file.id} className={`snap-center shrink-0 w-[200px] md:w-[240px] aspect-[2/3] rounded-md relative overflow-hidden group bg-gradient-to-b ${getGradient(file.movie_title)} cursor-pointer transition-transform hover:scale-105 duration-300 shadow-lg border border-zinc-800/80`}>
                  {file.poster_url && (
                    <img 
                      src={file.poster_url.startsWith("http") ? file.poster_url : `https://image.tmdb.org/t/p/w500${file.poster_url}`} 
                      alt={file.movie_title}
                      className="absolute inset-0 w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
                      onError={(e) => { (e.currentTarget as HTMLElement).style.display = 'none'; }}
                    />
                  )}
                  <div className="absolute inset-0 flex flex-col justify-end p-4 bg-gradient-to-t from-black/95 via-black/40 to-transparent opacity-85 group-hover:opacity-100 transition-opacity">
                    <h3 className="text-lg font-bold truncate text-white drop-shadow-md">{file.movie_title}</h3>
                    <p className="text-xs text-zinc-300 font-medium drop-shadow">{file.quality || "HD"} • {file.year || "N/A"}</p>
                    <div className="mt-3 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div onClick={() => handlePlayMedia(file)} title="Stream Video" className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center backdrop-blur-md hover:bg-white text-white hover:text-black transition shadow cursor-pointer">
                          <Play className="w-4 h-4 ml-0.5 fill-current" />
                        </div>
                        {file.trailer_url && (
                          <a 
                            href={file.trailer_url} 
                            target="_blank" 
                            rel="noreferrer" 
                            onClick={(e) => e.stopPropagation()} 
                            title="🎬 Watch Official Trailer" 
                            className="px-2 py-1 rounded bg-red-600/80 hover:bg-red-600 text-white text-[10px] font-bold flex items-center gap-1 backdrop-blur-md shadow transition"
                          >
                            <Film className="w-3 h-3" /> Trailer
                          </a>
                        )}
                      </div>
                      <button onClick={(e) => { e.stopPropagation(); setFileToAddToCollection(file); }} className="p-2 text-white/70 hover:text-white transition">
                        <Plus className="w-5 h-5" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="w-full h-40 rounded-lg border border-zinc-800 flex flex-col items-center justify-center text-zinc-500">
              <MonitorPlay className="w-8 h-8 mb-2 opacity-50" />
              <p>Your vault is empty. Request a movie via Telegram!</p>
            </div>
          )}
        </div>

        {/* Row 2: AI Concierge */}
        <div className="relative rounded-xl overflow-hidden bg-zinc-900 border border-zinc-800 p-6 md:p-10 shadow-2xl">
          <div className="absolute top-0 right-0 p-32 bg-red-900/10 rounded-full blur-[100px] pointer-events-none" />
          <div className="flex flex-col md:flex-row gap-8 items-center relative z-10">
            <div className="flex-1 space-y-4">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-red-500/10 text-red-500 text-xs font-bold uppercase tracking-widest border border-red-500/20">
                <Sparkles className="w-3.5 h-3.5" /> AI Concierge
              </div>
              <h2 className="text-3xl md:text-4xl font-bold">Not sure what to watch?</h2>
              <p className="text-zinc-400">Ask the Gemini AI assistant to analyze your mood, cross-reference your vault, and recommend the perfect movie.</p>
              <div className="flex items-center gap-2 mt-4 bg-zinc-950 p-1.5 rounded-full border border-zinc-800 focus-within:border-zinc-600 transition">
                <input
                  type="text"
                  placeholder="E.g. A psychological thriller with a plot twist..."
                  value={aiPrompt}
                  onChange={(e) => setAiPrompt(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAskAI()}
                  className="flex-1 bg-transparent px-4 py-2 outline-none text-sm"
                />
                <button onClick={handleAskAI} disabled={aiLoading || !aiPrompt} className="bg-zinc-800 hover:bg-zinc-700 text-white p-2.5 rounded-full transition disabled:opacity-50">
                  <Send className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div className="flex-1 w-full">
              {aiResult ? (
                <div className="bg-zinc-950 p-6 rounded-xl border border-zinc-800 shadow-xl">
                  <p className="text-zinc-300 text-sm leading-relaxed mb-4">{aiResult.recommendation}</p>
                  <div className="flex flex-wrap gap-2">
                    {aiResult.suggestedTitles?.map((t: string) => (
                      <span key={t} className="px-3 py-1 rounded bg-zinc-800 text-xs font-medium border border-zinc-700 text-zinc-300">{t}</span>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="bg-zinc-950/50 p-6 rounded-xl border border-zinc-800/50 flex flex-col items-center justify-center text-center h-full min-h-[160px] text-zinc-500">
                  <Bot className="w-8 h-8 mb-2 opacity-30" />
                  <p className="text-sm">I'm ready when you are.</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Row 3: Active Requests */}
        <div className="space-y-4">
          <h2 className="text-2xl font-semibold text-zinc-100 flex items-center gap-2">
            Active Requests <span className="text-sm font-normal text-zinc-400 bg-zinc-800/80 px-2 py-0.5 rounded">{requestsList.length} Pending</span>
          </h2>
          {requestsList.length > 0 ? (
             <div className="flex overflow-x-auto gap-4 pb-4 scrollbar-hide snap-x">
             {requestsList.map((req) => (
               <div key={req.id} className="snap-center shrink-0 w-[240px] p-4 bg-zinc-900 border border-zinc-800 rounded-md flex flex-col justify-between">
                 <div>
                   <div className="flex items-center justify-between mb-2">
                     <span className="text-xs font-bold uppercase tracking-wider text-amber-500 flex items-center gap-1"><DownloadCloud className="w-3.5 h-3.5" /> Downloading</span>
                   </div>
                   <h3 className="font-bold text-lg line-clamp-2">{req.title}</h3>
                 </div>
                 <div className="mt-4 pt-4 border-t border-zinc-800 flex justify-between items-center text-xs text-zinc-500">
                   <span>Req ID: {req.id}</span>
                   <span>Auto-Sync Active</span>
                 </div>
               </div>
             ))}
           </div>
          ) : (
            <p className="text-zinc-500 text-sm">No pending downloads. Everything is fulfilled!</p>
          )}
        </div>

        {/* =====================================================================
            ADMIN CONSOLE (Phase 1-6 Features Merged seamlessly into Dark Theme)
            ===================================================================== */}
        <div className="pt-16 pb-8 border-t border-zinc-800/60 mt-16 space-y-8">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div>
              <h2 className="text-3xl font-bold text-zinc-100 flex items-center gap-3">
                <Database className="w-8 h-8 text-red-600" /> BusiMovie Admin Console
              </h2>
              <p className="text-zinc-400 mt-2">Manage users, broadcast messages, monitor channel syncs, and curate collections.</p>
            </div>
            <div className="flex gap-3">
               <button onClick={() => setShowBroadcastModal(true)} className="px-4 py-2 bg-red-600/10 hover:bg-red-600/20 text-red-500 border border-red-900/50 rounded-md flex items-center gap-2 text-sm font-semibold transition">
                 <Megaphone className="w-4 h-4" /> Broadcast
               </button>
               <button onClick={() => setShowCollectionsModal(true)} className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-white rounded-md flex items-center gap-2 text-sm font-semibold transition">
                 <Layers className="w-4 h-4" /> Manage Collections
               </button>
               <button onClick={() => setShowAddForm(!showAddForm)} className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-white rounded-md flex items-center gap-2 text-sm font-semibold transition">
                 <FileVideo className="w-4 h-4" /> Index File
               </button>
            </div>
          </div>

          {/* Admin Manual Index Form */}
          {showAddForm && (
            <form onSubmit={handleManualAdd} className="p-6 bg-zinc-900 border border-zinc-800 rounded-xl space-y-4 animate-in fade-in slide-in-from-top-2">
              <h3 className="text-sm font-semibold text-zinc-300">Index Media File Reference into SQLite</h3>
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                <div className="sm:col-span-2">
                  <label className="block text-xs text-zinc-500 mb-1">Movie Title</label>
                  <input type="text" value={newFileTitle} onChange={e => setNewFileTitle(e.target.value)} required className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded outline-none focus:border-red-500 text-sm" />
                </div>
                <div>
                  <label className="block text-xs text-zinc-500 mb-1">Release Year</label>
                  <input type="text" value={newFileYear} onChange={e => setNewFileYear(e.target.value)} className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded outline-none focus:border-red-500 text-sm" />
                </div>
                <div>
                  <label className="block text-xs text-zinc-500 mb-1">Quality</label>
                  <select value={newFileQuality} onChange={e => setNewFileQuality(e.target.value)} className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded outline-none focus:border-red-500 text-sm">
                    <option value="1080p">1080p</option><option value="720p">720p</option><option value="4K">4K</option>
                  </select>
                </div>
                <div className="sm:col-span-4">
                  <label className="block text-xs text-zinc-500 mb-1">Telegram File ID (from /id command)</label>
                  <input type="text" value={newFileId} onChange={e => setNewFileId(e.target.value)} required className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded outline-none focus:border-red-500 text-sm" />
                </div>
              </div>
              <div className="flex justify-end gap-2 mt-4">
                <button type="button" onClick={() => setShowAddForm(false)} className="px-4 py-2 text-sm text-zinc-400 hover:text-white">Cancel</button>
                <button type="submit" className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-semibold rounded shadow transition">Save File</button>
              </div>
            </form>
          )}

          {/* Stats Grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-zinc-900 border border-zinc-800 p-5 rounded-xl">
               <div className="flex items-center justify-between text-zinc-400 mb-2"><span className="text-xs font-bold uppercase tracking-wider">Vault Files</span><HardDrive className="w-4 h-4"/></div>
               <p className="text-3xl font-bold text-white">{status?.stats.libraryFiles || library.length}</p>
               <p className="text-xs text-zinc-500 mt-1">{formatBytes(status?.stats.totalVaultBytes)}</p>
            </div>
            <div className="bg-zinc-900 border border-zinc-800 p-5 rounded-xl">
               <div className="flex items-center justify-between text-zinc-400 mb-2"><span className="text-xs font-bold uppercase tracking-wider">Bot Users</span><Users className="w-4 h-4"/></div>
               <p className="text-3xl font-bold text-white">{botUsersCount}</p>
               <p className="text-xs text-zinc-500 mt-1">Saved in database</p>
            </div>
            <div className="bg-zinc-900 border border-zinc-800 p-5 rounded-xl">
               <div className="flex items-center justify-between text-zinc-400 mb-2"><span className="text-xs font-bold uppercase tracking-wider">Total Searches</span><Search className="w-4 h-4"/></div>
               <p className="text-3xl font-bold text-white">{status?.stats.searches || 0}</p>
               <p className="text-xs text-zinc-500 mt-1">Logged queries</p>
            </div>
            <div className="bg-zinc-900 border border-zinc-800 p-5 rounded-xl">
               <div className="flex items-center justify-between text-zinc-400 mb-2"><span className="text-xs font-bold uppercase tracking-wider">Active Requests</span><Bell className="w-4 h-4"/></div>
               <p className="text-3xl font-bold text-white">{status?.stats.pendingRequests || 0}</p>
               <p className="text-xs text-zinc-500 mt-1">Awaiting auto-sync</p>
            </div>
          </div>

          {/* 24/7 Bot Uptime & Cloud Persistence (Firebase Firestore) Dashboard Card */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 p-6 bg-zinc-900/80 border border-zinc-800 rounded-2xl">
            {/* Left Col: Firebase Cloud Persistence */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                    <ShieldCheck className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-white text-base">Firebase Cloud Persistence</h3>
                    <p className="text-xs text-zinc-400">Zero-data-loss cross-reboot synchronization</p>
                  </div>
                </div>
                <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" /> Active & Verified
                </span>
              </div>

              <p className="text-xs text-zinc-300 leading-relaxed">
                Indexed movies, user requests, and channels are written directly to <strong>Google Cloud Firestore</strong>. Whenever the app container boots or restarts, your complete movie vault is rehydrated automatically.
              </p>

              <div className="flex items-center gap-3 pt-2">
                <button
                  onClick={handleTriggerCloudSync}
                  disabled={cloudSyncLoading}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold flex items-center gap-2 transition disabled:opacity-50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${cloudSyncLoading ? "animate-spin" : ""}`} />
                  {cloudSyncLoading ? "Syncing..." : "Sync Vault with Cloud Now"}
                </button>
                {cloudSyncMsg && (
                  <span className="text-xs text-emerald-400">{cloudSyncMsg}</span>
                )}
              </div>
            </div>

            {/* Right Col: 24/7 Webhook & Uptime Management */}
            <div className="space-y-4 border-t lg:border-t-0 lg:border-l border-zinc-800/80 pt-4 lg:pt-0 lg:pl-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 rounded-lg bg-blue-500/10 text-blue-400 border border-blue-500/20">
                    <Wifi className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-white text-base">Telegram Connection Mode</h3>
                    <p className="text-xs text-zinc-400">Long Polling (Dev) vs Webhook (Cloud Run)</p>
                  </div>
                </div>
                <span className={`px-2.5 py-1 text-xs font-semibold rounded-full border flex items-center gap-1.5 ${
                  webhookMode === "webhook" 
                    ? "bg-blue-500/10 text-blue-400 border-blue-500/30" 
                    : "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                }`}>
                  <span className={`w-2 h-2 rounded-full ${webhookMode === "webhook" ? "bg-blue-400 animate-pulse" : "bg-emerald-400 animate-pulse"}`} />
                  {webhookMode === "webhook" ? "24/7 Webhook Active" : "Long Polling (Active & Working)"}
                </span>
              </div>

              {webhookInfo?.last_error_message && webhookMode === "webhook" && (
                <div className="p-3 bg-red-950/50 border border-red-800/60 rounded-lg text-xs text-red-300 space-y-1">
                  <div className="font-semibold flex items-center gap-1.5 text-red-200">
                    <AlertCircle className="w-4 h-4 text-red-400 shrink-0" /> Telegram Webhook Delivery Failed
                  </div>
                  <p className="font-mono text-[11px] text-red-300">
                    {webhookInfo.last_error_message}
                  </p>
                  <p className="text-[11px] text-zinc-400">
                    AI Studio dev URLs (ais-dev-*.run.app) require Google login and reject Telegram with 302 redirects. Switch to Long Polling below to resume receiving messages.
                  </p>
                </div>
              )}

              <p className="text-xs text-zinc-300 leading-relaxed">
                {webhookMode === "webhook"
                  ? "Telegram pushes updates directly to your public URL via HTTP POST. When deployed on Cloud Run, this wakes the service up 24/7 on incoming messages."
                  : "Currently running in Long Polling mode. The bot connects outbound directly to Telegram, allowing it to reply instantly inside AI Studio without requiring a public IP or custom domain."}
              </p>

              <div className="space-y-2">
                <label className="block text-[11px] text-zinc-400 font-medium">
                  Deployed App URL (for 24/7 Webhook on Cloud Run)
                </label>
                <div className="flex gap-2">
                  <input
                    type="url"
                    value={customWebhookUrl}
                    onChange={(e) => setCustomWebhookUrl(e.target.value)}
                    placeholder="https://your-deployed-service.run.app"
                    className="flex-1 px-3 py-1.5 bg-zinc-950 border border-zinc-800 rounded text-xs text-zinc-200 outline-none focus:border-blue-500"
                  />
                  {webhookMode === "webhook" ? (
                    <button
                      onClick={handleDeleteWebhook}
                      disabled={webhookLoading}
                      className="px-3 py-1.5 bg-emerald-700 hover:bg-emerald-600 text-white rounded text-xs font-semibold transition disabled:opacity-50 flex items-center gap-1.5 shrink-0"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${webhookLoading ? "animate-spin" : ""}`} /> Switch to Long Polling
                    </button>
                  ) : (
                    <button
                      onClick={() => handleSetWebhook()}
                      disabled={webhookLoading}
                      className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded text-xs font-semibold flex items-center gap-1.5 transition disabled:opacity-50 shrink-0"
                    >
                      <Globe className="w-3.5 h-3.5" /> Enable Webhook
                    </button>
                  )}
                </div>

                {webhookInfo?.url ? (
                  <p className="text-[11px] text-zinc-500 truncate">
                    Registered Webhook: <span className="text-blue-400 font-mono">{webhookInfo.url}</span>
                  </p>
                ) : (
                  <p className="text-[11px] text-emerald-400 flex items-center gap-1">
                    <Check className="w-3.5 h-3.5" /> Outbound Long Polling active — ready to receive messages and stream movies.
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Logs & Diagnostics */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            
            {/* Telegram Inbound Console */}
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden flex flex-col h-[400px]">
              <div className="p-4 border-b border-zinc-800 bg-zinc-950 flex items-center gap-2">
                <Terminal className="w-4 h-4 text-zinc-400" />
                <h3 className="font-semibold text-sm text-zinc-200">Live Telegram Inbound Event Tracker</h3>
              </div>
              <div className="flex-1 overflow-y-auto divide-y divide-zinc-800/50 p-2 font-mono text-xs">
                {status?.recentUpdates && status.recentUpdates.length > 0 ? (
                  status.recentUpdates.map((update) => (
                    <div key={update.id} className="p-3 hover:bg-zinc-800/50 transition rounded-md">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex gap-3">
                          <span className="px-1.5 py-0.5 text-[9px] font-bold rounded bg-zinc-800 text-zinc-400 mt-0.5">{update.updateType}</span>
                          <div>
                            <span className="font-bold text-zinc-200">{update.chatTitle || `Chat ${update.chatId}`}</span>
                            {update.text && <p className="text-zinc-500 mt-1 truncate max-w-xs">{update.text}</p>}
                          </div>
                        </div>
                        <span className="text-[10px] text-zinc-600 shrink-0">{update.time}</span>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="p-8 text-center text-zinc-600 flex flex-col items-center">
                    <AlertCircle className="w-6 h-6 mb-2 opacity-50" />
                    <p>No inbound events tracked yet.</p>
                  </div>
                )}
              </div>
            </div>

            {/* Channel Auto-Sync Feed */}
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden flex flex-col h-[400px]">
              <div className="p-4 border-b border-zinc-800 bg-zinc-950 flex items-center gap-2">
                <Radio className="w-4 h-4 text-zinc-400" />
                <h3 className="font-semibold text-sm text-zinc-200">Channel Auto-Sync Interception Feed</h3>
              </div>
              <div className="flex-1 overflow-y-auto divide-y divide-zinc-800/50 p-2">
                {channelLogs.length > 0 ? (
                  channelLogs.map((log) => (
                    <div key={log.id} className="p-3 hover:bg-zinc-800/50 transition rounded-md flex items-center gap-3">
                      <div className="p-2 bg-green-500/10 text-green-500 rounded"><CheckCircle2 className="w-4 h-4" /></div>
                      <div className="flex-1 min-w-0">
                        <p className="font-bold text-sm text-zinc-200 truncate">{log.parsed_title}</p>
                        <p className="text-xs text-zinc-500 truncate">Channel: {log.channel_title} • {formatBytes(log.file_size)}</p>
                      </div>
                      {log.quality && <span className="px-2 py-1 text-[10px] font-bold bg-zinc-800 rounded text-zinc-300">{log.quality}</span>}
                    </div>
                  ))
                ) : (
                  <div className="p-8 text-center text-zinc-600 flex flex-col items-center">
                    <Radio className="w-6 h-6 mb-2 opacity-50" />
                    <p className="text-sm font-medium">Awaiting First Upload</p>
                    <p className="text-xs mt-1 max-w-xs">Post a movie to your private channel to see the bot auto-detect it here.</p>
                  </div>
                )}
              </div>
            </div>
            
          </div>
        </div>
      </div>

      {/* =====================================================================
          MODALS
          ===================================================================== */}
      
      {/* 1. Video Player Modal */}
      {playingMedia && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/90 backdrop-blur-sm">
          <div className="w-full max-w-4xl bg-zinc-950 rounded-xl overflow-hidden border border-zinc-800 shadow-2xl">
            <div className="flex justify-between items-center p-4 border-b border-zinc-800">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <Play className="w-5 h-5 text-red-500" /> {playingMedia.movie_title}
              </h3>
              <button onClick={() => { setPlayingMedia(null); setStreamInfo(null); }} className="text-zinc-500 hover:text-white transition"><X className="w-6 h-6" /></button>
            </div>
            <div className="aspect-video bg-black flex items-center justify-center relative">
              {streamInfo?.loading ? (
                <div className="flex flex-col items-center text-zinc-500"><div className="w-8 h-8 border-2 border-red-500 border-t-transparent rounded-full animate-spin mb-4"></div><p>Buffering from Telegram Vault...</p></div>
              ) : streamInfo?.streamUrl ? (
                <video src={streamInfo.streamUrl} controls autoPlay className="w-full h-full outline-none" controlsList="nodownload" />
              ) : (
                <p className="text-zinc-500">Video stream unavailable.</p>
              )}
            </div>
            {streamInfo?.tgDirectLink && (
              <div className="p-4 bg-zinc-900 text-center border-t border-zinc-800">
                <a href={streamInfo.tgDirectLink} target="_blank" rel="noreferrer" className="text-red-500 hover:text-red-400 text-sm font-semibold underline underline-offset-2">Open directly in Telegram App</a>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 2. Broadcast Modal */}
      {showBroadcastModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-zinc-900 w-full max-w-md rounded-xl shadow-2xl border border-zinc-800 p-6">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-xl font-bold text-white flex items-center gap-2"><Megaphone className="w-5 h-5 text-red-500" /> Broadcast Message</h3>
              <button onClick={() => setShowBroadcastModal(false)} className="text-zinc-500 hover:text-white"><X className="w-5 h-5" /></button>
            </div>
            <p className="text-sm text-zinc-400 mb-4">Send a direct Telegram message to all {botUsersCount} users interacting with the bot.</p>
            <textarea
              className="w-full h-32 px-4 py-3 bg-zinc-950 border border-zinc-800 rounded-lg text-sm resize-none focus:border-red-500 outline-none mb-4 text-white placeholder-zinc-600"
              placeholder="Type your announcement here... HTML is supported (e.g. <b>bold</b>)."
              value={broadcastMsg} onChange={(e) => setBroadcastMsg(e.target.value)}
            />
            {broadcastStatus && <div className="p-3 bg-zinc-800 text-zinc-300 rounded-lg text-sm text-center mb-4">{broadcastStatus}</div>}
            <div className="flex justify-end gap-3">
              <button onClick={() => setShowBroadcastModal(false)} className="px-4 py-2 text-sm text-zinc-400 hover:text-white">Cancel</button>
              <button onClick={handleSendBroadcast} disabled={broadcastSending || !broadcastMsg.trim()} className="px-6 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-bold rounded-lg flex items-center gap-2">
                {broadcastSending ? "Sending..." : "Send to All"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 3. Add to Collection Modal */}
      {fileToAddToCollection && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-zinc-900 w-full max-w-sm rounded-xl shadow-2xl border border-zinc-800 p-6">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-bold text-white">Save to Collection</h3>
              <button onClick={() => setFileToAddToCollection(null)} className="text-zinc-500 hover:text-white"><X className="w-5 h-5" /></button>
            </div>
            <p className="text-sm text-zinc-400 mb-4">Add <strong>{fileToAddToCollection.movie_title}</strong> to:</p>
            <div className="space-y-2 max-h-48 overflow-y-auto mb-6 pr-2">
              {collections.map(c => (
                <button key={c.id} onClick={() => addFileToCollection(c.id)} className="w-full text-left px-4 py-3 bg-zinc-950 hover:bg-zinc-800 rounded-lg border border-zinc-800 transition">
                  <p className="font-semibold text-sm">{c.name}</p>
                </button>
              ))}
              {collections.length === 0 && <p className="text-xs text-zinc-600 text-center py-4">No collections exist yet.</p>}
            </div>
            <div className="border-t border-zinc-800 pt-4">
              <p className="text-xs font-semibold text-zinc-500 mb-2">Create New Collection</p>
              <div className="flex gap-2">
                <input type="text" placeholder="Collection Name..." className="flex-1 px-3 py-2 text-sm bg-zinc-950 border border-zinc-800 rounded-lg outline-none focus:border-red-500 text-white" value={newCollectionName} onChange={e => setNewCollectionName(e.target.value)} />
                <button onClick={createCollection} disabled={!newCollectionName.trim()} className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-white text-sm font-semibold rounded-lg">Add</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 4. Manage Collections Modal */}
      {showCollectionsModal && (
        <div className="fixed inset-0 z-[100] flex p-4 sm:p-6 bg-black/80 backdrop-blur-sm justify-center items-start">
          <div className="bg-zinc-900 w-full max-w-4xl rounded-xl shadow-2xl border border-zinc-800 overflow-hidden my-auto flex flex-col max-h-[85vh]">
            <div className="flex justify-between items-center p-6 border-b border-zinc-800 bg-zinc-950">
              <h3 className="text-xl font-bold text-white flex items-center gap-2"><Layers className="w-5 h-5 text-red-500" /> Manage Collections</h3>
              <button onClick={() => { setShowCollectionsModal(false); setSelectedCollection(null); }} className="text-zinc-500 hover:text-white"><X className="w-6 h-6" /></button>
            </div>
            <div className="flex flex-col md:flex-row flex-1 overflow-hidden">
              <div className="w-full md:w-1/3 border-r border-zinc-800 p-4 overflow-y-auto bg-zinc-950">
                <p className="text-xs font-semibold text-zinc-600 uppercase tracking-wider mb-4 block">Your Lists</p>
                <div className="space-y-2">
                  {collections.map(c => (
                    <button key={c.id} onClick={() => viewCollection(c)} className={`w-full text-left px-4 py-3 rounded-lg border transition ${selectedCollection?.id === c.id ? 'bg-zinc-800 border-zinc-700' : 'bg-transparent border-transparent hover:bg-zinc-900 hover:border-zinc-800'}`}>
                      <p className={`font-semibold text-sm ${selectedCollection?.id === c.id ? 'text-white' : 'text-zinc-400'}`}>{c.name}</p>
                    </button>
                  ))}
                  {collections.length === 0 && <p className="text-sm text-zinc-600">No collections created.</p>}
                </div>
              </div>
              <div className="w-full md:w-2/3 p-6 overflow-y-auto bg-zinc-900">
                {selectedCollection ? (
                  <div>
                    <h4 className="text-2xl font-bold text-white mb-6">{selectedCollection.name}</h4>
                    <div className="space-y-3">
                      {collectionItems.length > 0 ? collectionItems.map(file => (
                        <div key={file.id} className="flex items-center justify-between p-3 bg-zinc-950 rounded-lg border border-zinc-800">
                          <div>
                            <p className="font-bold text-sm text-zinc-200">{file.movie_title}</p>
                            <p className="text-xs text-zinc-500">{file.quality || 'HD'} • {file.year}</p>
                          </div>
                          <button onClick={() => handlePlayMedia(file)} className="p-2 bg-zinc-800 text-white rounded-full hover:bg-red-600 transition"><Play className="w-4 h-4 ml-0.5"/></button>
                        </div>
                      )) : <p className="text-sm text-zinc-500">No items in this collection.</p>}
                    </div>
                  </div>
                ) : (
                  <div className="h-full flex flex-col items-center justify-center text-zinc-600">
                    <Layers className="w-12 h-12 mb-4 opacity-20" />
                    <p>Select a collection to view its contents.</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 5. Batch Indexing Modal */}
      {showBatchModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm">
          <div className="bg-zinc-900 w-full max-w-lg rounded-xl shadow-2xl border border-zinc-800 p-6">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xl font-bold text-white flex items-center gap-2">
                <FolderPlus className="w-5 h-5 text-red-500" /> Batch Index Movies
              </h3>
              <button onClick={() => { setShowBatchModal(false); setBatchResultMsg(null); }} className="text-zinc-500 hover:text-white transition">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-xs text-zinc-400 mb-4 leading-relaxed">
              Paste or type movie titles below (one per line). The engine will automatically match each title with official movie posters, release years, and index them into your persistent Vault database and backup file.
            </p>
            <textarea
              className="w-full h-44 px-4 py-3 bg-zinc-950 border border-zinc-800 rounded-lg text-sm resize-none focus:border-red-500 outline-none mb-3 text-white placeholder-zinc-600 font-mono"
              placeholder={"The Fall\nThe Bluff\nDune: Part Two\nInterstellar\nGladiator"}
              value={batchTitles}
              onChange={(e) => setBatchTitles(e.target.value)}
            />
            {batchResultMsg && (
              <div className={`p-3 mb-4 rounded-lg text-xs font-semibold text-center ${batchResultMsg.startsWith("✅") || batchResultMsg.startsWith("Successfully") ? "bg-emerald-950/80 border border-emerald-800 text-emerald-300" : "bg-red-950/80 border border-red-800 text-red-300"}`}>
                {batchResultMsg}
              </div>
            )}
            <div className="flex justify-end gap-3">
              <button 
                onClick={() => { setShowBatchModal(false); setBatchResultMsg(null); }} 
                className="px-4 py-2 text-sm text-zinc-400 hover:text-white"
              >
                Close
              </button>
              <button 
                onClick={handleBatchIndex} 
                disabled={batchLoading || !batchTitles.trim()} 
                className="px-6 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-bold rounded-lg flex items-center gap-2 transition shadow-lg"
              >
                {batchLoading ? "Indexing & Fetching Posters..." : "Index All Movies"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
