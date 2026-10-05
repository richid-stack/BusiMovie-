import React, { useEffect, useState } from "react";
import { 
  Play, 
  Search, 
  Bell, 
  Plus, 
  DownloadCloud, 
  Info, 
  Check, 
  X, 
  Bot, 
  Zap, 
  RefreshCw, 
  Film, 
  Tv, 
  Layers, 
  ChevronRight, 
  Sparkles,
  SkipForward,
  SkipBack,
  SlidersHorizontal
} from "lucide-react";
import { MediaFile, SearchResult } from "../types";

export default function UserStorefront() {
  const [library, setLibrary] = useState<MediaFile[]>([]);
  const [heroMovie, setHeroMovie] = useState<SearchResult | null>(null);
  const [scrolled, setScrolled] = useState(false);
  const [playingMedia, setPlayingMedia] = useState<MediaFile | null>(null);
  const [streamInfo, setStreamInfo] = useState<{ streamUrl?: string; tgDirectLink?: string; loading: boolean } | null>(null);
  
  // Navigation & Filtering
  const [activeTab, setActiveTab] = useState<"home" | "series" | "films" | "popular">("home");
  const [searchQuery, setSearchQuery] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [selectedMovie, setSelectedMovie] = useState<MediaFile | null>(null);
  const [selectedSeason, setSelectedSeason] = useState<number>(1);

  // Auto-Fetch & User Request State
  const [requestSubmitting, setRequestSubmitting] = useState(false);
  const [requestNotice, setRequestNotice] = useState<string | null>(null);

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 50);
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const libRes = await fetch("/api/library");
      if (libRes.ok) {
        const l = await libRes.json();
        const files: MediaFile[] = l.files || [];
        setLibrary(files);
        if (files.length > 0) {
          fetchHeroMovie(files[0].movie_title);
        }
      }
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

  const handlePlayMedia = async (file: MediaFile, parentShow?: MediaFile) => {
    setPlayingMedia(file);
    if (parentShow) {
      setSelectedMovie(parentShow);
    }
    setStreamInfo({ loading: true });
    try {
      const res = await fetch(`/api/media/${file.id}/stream`);
      if (res.ok) {
        const data = await res.json();
        setStreamInfo({ streamUrl: data.streamUrl, tgDirectLink: data.tgDirectLink, loading: false });
      } else {
        setStreamInfo({ loading: false });
      }
    } catch (err) { 
      setStreamInfo({ loading: false }); 
    }
  };

  const handleOpenDetails = (item: MediaFile) => {
    setSelectedMovie(item);
    if (item.is_series && item.seasons && item.seasons.length > 0) {
      setSelectedSeason(item.seasons[0]);
    } else if (item.season) {
      setSelectedSeason(item.season);
    } else {
      setSelectedSeason(1);
    }
  };

  const handleRequestAndFetch = async () => {
    if (!searchQuery.trim()) return;
    setRequestSubmitting(true);
    setRequestNotice(null);
    try {
      const res = await fetch("/api/requests/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: searchQuery.trim(),
          auto_fetch: true
        })
      });
      const data = await res.json();
      if (res.ok) {
        setRequestNotice(data.message || `Dispatched bot search for "${searchQuery}"!`);
        await fetchData();
      } else {
        setRequestNotice(data.error || "Could not dispatch request");
      }
    } catch (e: any) {
      setRequestNotice("Error: " + e.message);
    } finally {
      setRequestSubmitting(false);
    }
  };

  const getGradient = (title: string) => {
    const colors = ["from-red-900 to-black", "from-zinc-800 to-black", "from-blue-950 to-black", "from-purple-950 to-black"];
    return colors[title.length % colors.length];
  };

  // Filter library items based on activeTab & search query
  const filteredLibrary = library.filter(m => {
    // Tab filter
    if (activeTab === "series" && !m.is_series) return false;
    if (activeTab === "films" && m.is_series) return false;

    // Search filter
    if (!searchQuery.trim()) return true;
    const cleanQ = searchQuery.toLowerCase().trim();
    const qNorm = cleanQ.replace(/[^a-z0-9]/g, '');
    const title = (m.movie_title || '').toLowerCase();
    const fileName = (m.file_name || '').toLowerCase();
    const tNorm = title.replace(/[^a-z0-9]/g, '');
    const fnNorm = fileName.replace(/[^a-z0-9]/g, '');
    
    return title.includes(cleanQ) || 
           fileName.includes(cleanQ) || 
           (qNorm.length >= 2 && (tNorm.includes(qNorm) || fnNorm.includes(qNorm)));
  });

  const seriesItems = filteredLibrary.filter(m => m.is_series);
  const movieItems = filteredLibrary.filter(m => !m.is_series);

  // Series Next / Prev episode helpers for player
  const currentShowEpisodes = selectedMovie?.episodes || [];
  const currentPlayingIndex = currentShowEpisodes.findIndex(e => e.id === playingMedia?.id);
  const prevEpisode = currentPlayingIndex > 0 ? currentShowEpisodes[currentPlayingIndex - 1] : null;
  const nextEpisode = currentPlayingIndex >= 0 && currentPlayingIndex < currentShowEpisodes.length - 1 ? currentShowEpisodes[currentPlayingIndex + 1] : null;

  return (
    <div className="min-h-screen bg-[#141414] text-white font-sans overflow-x-hidden pb-16 selection:bg-red-600/30">
      
      {/* Streaming Modal */}
      {playingMedia && streamInfo && (
        <div className="fixed inset-0 z-[100] bg-black flex flex-col animate-in fade-in duration-300">
          <div className="flex items-center justify-between p-6 absolute top-0 w-full z-10 bg-gradient-to-b from-black/90 via-black/50 to-transparent">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                {playingMedia.season ? (
                  <span className="px-2 py-0.5 bg-red-600 text-white rounded text-xs font-bold uppercase tracking-wider">
                    S{playingMedia.season} : E{playingMedia.episode || 1}
                  </span>
                ) : (
                  <span className="px-2 py-0.5 bg-zinc-800 text-zinc-300 rounded text-xs font-bold uppercase tracking-wider">
                    {playingMedia.quality || "HD"}
                  </span>
                )}
                <h2 className="text-xl md:text-2xl font-bold tracking-tight text-white">{playingMedia.movie_title}</h2>
              </div>
              {playingMedia.file_name && (
                <p className="text-xs text-zinc-400 font-mono truncate max-w-xl">{playingMedia.file_name}</p>
              )}
            </div>
            
            <div className="flex items-center gap-3">
              {/* Next/Prev Episode Controls */}
              {prevEpisode && (
                <button 
                  onClick={() => handlePlayMedia(prevEpisode, selectedMovie || undefined)}
                  className="px-3 py-1.5 bg-zinc-800/80 hover:bg-zinc-700 text-zinc-200 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition backdrop-blur"
                  title={`Prev: S${prevEpisode.season} E${prevEpisode.episode}`}
                >
                  <SkipBack className="w-4 h-4" /> Previous Ep
                </button>
              )}
              {nextEpisode && (
                <button 
                  onClick={() => handlePlayMedia(nextEpisode, selectedMovie || undefined)}
                  className="px-3 py-1.5 bg-red-600 hover:bg-red-500 text-white rounded-lg text-xs font-bold flex items-center gap-1.5 transition backdrop-blur shadow-lg shadow-red-600/20"
                  title={`Next: S${nextEpisode.season} E${nextEpisode.episode}`}
                >
                  Next Ep <SkipForward className="w-4 h-4" />
                </button>
              )}
              <button 
                onClick={() => { setPlayingMedia(null); setStreamInfo(null); }} 
                className="p-2 bg-white/10 hover:bg-white/20 rounded-full backdrop-blur transition"
              >
                <X className="w-6 h-6" />
              </button>
            </div>
          </div>

          <div className="flex-1 flex items-center justify-center relative">
            {streamInfo.loading ? (
              <div className="flex flex-col items-center gap-4 text-zinc-400">
                <div className="w-12 h-12 border-4 border-red-600 border-t-transparent rounded-full animate-spin" />
                <p className="font-medium animate-pulse">Connecting Stream...</p>
              </div>
            ) : streamInfo.streamUrl ? (
              <video 
                src={streamInfo.streamUrl} 
                controls 
                autoPlay 
                className="w-full h-full max-h-[100vh] object-contain shadow-2xl"
                controlsList="nodownload"
              />
            ) : (
              <div className="text-zinc-400">Stream currently unavailable.</div>
            )}
          </div>

          {streamInfo.streamUrl && !streamInfo.loading && (
             <div className="absolute bottom-10 right-10 z-10 flex gap-3">
                <a 
                  href={streamInfo.streamUrl} 
                  download={`${playingMedia.movie_title}${playingMedia.season ? `_S${playingMedia.season}E${playingMedia.episode}` : ''}.mp4`}
                  className="px-6 py-3 bg-zinc-800/80 hover:bg-white hover:text-black border border-white/20 text-white rounded-lg font-bold flex items-center gap-2 transition backdrop-blur-md"
                >
                  <DownloadCloud className="w-5 h-5" /> Download Offline
                </a>
             </div>
          )}
        </div>
      )}

      {/* Navbar */}
      <nav className={`fixed top-0 w-full z-50 transition-all duration-500 ${scrolled ? "bg-[#141414] shadow-xl" : "bg-gradient-to-b from-black/90 via-black/50 to-transparent"}`}>
        <div className="px-4 md:px-14 py-4 flex items-center justify-between">
          <div className="flex items-center gap-10">
            <h1 
              onClick={() => { setActiveTab("home"); setSearchQuery(""); }}
              className="text-red-600 font-black text-3xl tracking-tighter cursor-pointer select-none"
            >
              BUSIMOVIE
            </h1>
            <div className="hidden lg:flex gap-6 text-sm font-medium">
              <button 
                onClick={() => setActiveTab("home")} 
                className={`transition ${activeTab === "home" ? "text-white font-bold" : "text-zinc-400 hover:text-zinc-200"}`}
              >
                Home
              </button>
              <button 
                onClick={() => setActiveTab("series")} 
                className={`flex items-center gap-1.5 transition ${activeTab === "series" ? "text-white font-bold" : "text-zinc-400 hover:text-zinc-200"}`}
              >
                <Tv className="w-4 h-4" /> Series
              </button>
              <button 
                onClick={() => setActiveTab("films")} 
                className={`flex items-center gap-1.5 transition ${activeTab === "films" ? "text-white font-bold" : "text-zinc-400 hover:text-zinc-200"}`}
              >
                <Film className="w-4 h-4" /> Films
              </button>
              <button 
                onClick={() => setActiveTab("popular")} 
                className={`transition ${activeTab === "popular" ? "text-white font-bold" : "text-zinc-400 hover:text-zinc-200"}`}
              >
                New & Popular
              </button>
            </div>
          </div>
          <div className="flex items-center gap-6 text-white">
            <div className="relative flex items-center">
              <Search 
                className={`w-5 h-5 cursor-pointer transition ${showSearch ? 'text-white' : 'hover:text-zinc-400'}`} 
                onClick={() => setShowSearch(!showSearch)} 
              />
              {showSearch && (
                <input 
                  autoFocus
                  type="text"
                  placeholder="Titles, series, episodes..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="absolute right-0 top-1/2 -translate-y-1/2 w-[260px] bg-black/90 border border-white/80 rounded outline-none text-sm px-10 py-1.5 transition-all animate-in fade-in slide-in-from-right-4 shadow-xl"
                />
              )}
              {showSearch && <Search className="w-4 h-4 absolute left-2 top-1/2 -translate-y-1/2 text-white/50 pointer-events-none animate-in fade-in" />}
            </div>
            <span className="hidden sm:block text-sm font-medium hover:text-zinc-400 cursor-pointer transition">Cinema Library</span>
            <Bell className="w-5 h-5 cursor-pointer hover:text-zinc-400 transition" />
            <div className="w-8 h-8 rounded bg-red-600 flex items-center justify-center cursor-pointer border border-zinc-800 font-bold text-xs">
              U
            </div>
          </div>
        </div>
      </nav>

      {/* Netflix-style Hero Section */}
      <div className="relative h-[85vh] w-full bg-[#141414] overflow-hidden">
        {heroMovie?.poster_path ? (
          <img src={heroMovie.poster_path} alt="Hero" className="absolute inset-0 w-full h-full object-cover opacity-80" />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-tr from-[#141414] to-red-900/20" />
        )}
        
        {/* Soft vignette gradients */}
        <div className="absolute inset-0 bg-gradient-to-t from-[#141414] via-[#141414]/40 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-r from-[#141414] via-[#141414]/60 to-transparent w-[65%]" />

        <div className="relative z-10 h-full flex flex-col justify-end px-4 md:px-14 pb-32 max-w-2xl space-y-4">
          {heroMovie ? (
            <>
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 bg-red-600 text-white text-[11px] font-black tracking-wider uppercase rounded">
                  FEATURED
                </span>
                <span className="text-zinc-400 text-xs font-semibold">BusiMovie Cinema Master</span>
              </div>
              <h1 className="text-4xl md:text-6xl font-black tracking-tight text-white drop-shadow-2xl">{heroMovie.title}</h1>
              <p className="text-base md:text-lg text-zinc-200 font-medium line-clamp-3 drop-shadow-lg leading-relaxed">{heroMovie.overview}</p>
            </>
          ) : (
            <>
              <h1 className="text-5xl md:text-7xl font-black tracking-tight text-white drop-shadow-2xl">BusiMovie</h1>
              <p className="text-lg md:text-xl text-zinc-300 font-medium drop-shadow-lg leading-relaxed">
                Stream full TV Series by Season & Episode or Blockbuster Movies directly in high definition on BusiMovie.
              </p>
            </>
          )}

          <div className="flex gap-4 pt-2">
            <button 
              onClick={() => {
                if (filteredLibrary.length > 0) {
                  const first = filteredLibrary[0];
                  if (first.is_series && first.episodes && first.episodes.length > 0) {
                    handlePlayMedia(first.episodes[0], first);
                  } else {
                    handlePlayMedia(first);
                  }
                }
              }} 
              className="flex items-center justify-center gap-2.5 bg-white hover:bg-white/80 text-black px-7 py-3 rounded font-bold text-[1.05rem] transition shadow-xl"
            >
              <Play className="w-5 h-5 fill-black" /> Play
            </button>
            <button 
              onClick={() => filteredLibrary.length > 0 && handleOpenDetails(filteredLibrary[0])} 
              className="flex items-center justify-center gap-2.5 bg-zinc-500/40 hover:bg-zinc-500/60 text-white px-7 py-3 rounded font-bold text-[1.05rem] backdrop-blur transition"
            >
              <Info className="w-5 h-5" /> More Info
            </button>
          </div>
        </div>
      </div>

      {/* Details & Series Episodes Modal */}
      {selectedMovie && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 sm:p-6 animate-in fade-in duration-300">
          <div className="absolute inset-0 bg-black/80 backdrop-blur-md" onClick={() => setSelectedMovie(null)} />
          <div className="relative w-full max-w-4xl bg-[#181818] rounded-2xl overflow-hidden shadow-2xl z-10 animate-in zoom-in-95 duration-300 max-h-[90vh] flex flex-col border border-zinc-800">
            
            {/* Modal Header / Banner */}
            <div className="relative h-[36vh] w-full bg-[#141414] shrink-0">
              {selectedMovie.poster_url && (
                <img 
                  src={selectedMovie.poster_url.startsWith("http") ? selectedMovie.poster_url : `https://image.tmdb.org/t/p/w500${selectedMovie.poster_url}`} 
                  alt={selectedMovie.movie_title} 
                  className="w-full h-full object-cover" 
                />
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-[#181818] via-[#181818]/60 to-transparent" />
              <button 
                onClick={() => setSelectedMovie(null)} 
                className="absolute top-4 right-4 p-2.5 bg-black/60 hover:bg-black/90 rounded-full text-white transition backdrop-blur z-20"
              >
                <X className="w-5 h-5" />
              </button>
              
              <div className="absolute bottom-6 left-6 md:left-10 right-6 text-white space-y-3 z-10">
                <div className="flex items-center gap-2">
                  {selectedMovie.is_series ? (
                    <span className="px-2.5 py-0.5 bg-red-600 text-white text-[11px] font-black uppercase tracking-wider rounded-md flex items-center gap-1.5 shadow-lg shadow-red-600/30">
                      <Tv className="w-3.5 h-3.5" /> TV SERIES • {selectedMovie.seasons?.length || 1} {((selectedMovie.seasons?.length || 1) > 1) ? "SEASONS" : "SEASON"}
                    </span>
                  ) : (
                    <span className="px-2.5 py-0.5 bg-zinc-800 text-zinc-200 border border-zinc-700 text-[11px] font-black uppercase tracking-wider rounded-md flex items-center gap-1.5">
                      <Film className="w-3.5 h-3.5" /> MOVIE
                    </span>
                  )}
                  {selectedMovie.quality && (
                    <span className="px-2 py-0.5 bg-amber-500/20 text-amber-300 border border-amber-500/40 text-[11px] font-bold rounded">
                      {selectedMovie.quality}
                    </span>
                  )}
                </div>

                <h2 className="text-3xl md:text-5xl font-black drop-shadow-xl tracking-tight">{selectedMovie.movie_title}</h2>
                
                <div className="flex gap-3 pt-1">
                  <button 
                    onClick={() => {
                      if (selectedMovie.is_series && selectedMovie.episodes && selectedMovie.episodes.length > 0) {
                        const seasonEps = selectedMovie.episodes.filter(e => (e.season || 1) === selectedSeason);
                        const epToPlay = seasonEps.length > 0 ? seasonEps[0] : selectedMovie.episodes[0];
                        handlePlayMedia(epToPlay, selectedMovie);
                      } else {
                        handlePlayMedia(selectedMovie);
                      }
                    }} 
                    className="flex items-center justify-center gap-2 bg-white hover:bg-white/80 text-black px-6 py-2.5 rounded-lg font-bold transition shadow-xl"
                  >
                    <Play className="w-5 h-5 fill-black" /> {selectedMovie.is_series ? `Play Season ${selectedSeason} Ep 1` : "Play Movie"}
                  </button>
                  <button className="w-10 h-10 rounded-full border border-zinc-600 bg-zinc-900/60 flex items-center justify-center text-white hover:border-white transition backdrop-blur">
                    <Plus className="w-5 h-5" />
                  </button>
                </div>
              </div>
            </div>
            
            {/* Modal Body & Episodes Viewer */}
            <div className="p-6 md:p-8 text-white space-y-6 overflow-y-auto flex-1 custom-scrollbar">
              <div className="flex flex-col md:flex-row gap-6 justify-between items-start">
                <div className="space-y-2 max-w-xl">
                  <div className="flex items-center gap-3 text-sm font-bold">
                    <span className="text-green-400 font-extrabold">98% Match</span>
                    <span className="text-zinc-300">{selectedMovie.year || "2024"}</span>
                    {selectedMovie.is_series ? (
                      <span className="text-zinc-400">{selectedMovie.total_episodes} Total Episodes</span>
                    ) : (
                      <span className="text-zinc-400">{((selectedMovie.file_size || 0) / (1024*1024*1024)).toFixed(2)} GB</span>
                    )}
                  </div>
                  <p className="text-zinc-300 text-sm leading-relaxed">
                    {selectedMovie.is_series 
                      ? `Enjoy full high-speed streaming for all seasons and episodes of ${selectedMovie.movie_title} on BusiMovie.`
                      : "Directly accessible with instant streaming, multithreaded buffering, and offline downloads."}
                  </p>
                </div>

                {/* Metadata Card */}
                <div className="text-xs space-y-2 bg-zinc-900/80 p-4 rounded-xl border border-zinc-800 w-full md:w-64 shrink-0">
                  <div className="flex justify-between">
                    <span className="text-zinc-500">Media Format:</span>
                    <span className="text-zinc-300 font-semibold">{selectedMovie.is_series ? "TV Series (Multi-Ep)" : "Single Movie"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-500">Video Master:</span>
                    <span className="text-zinc-300 font-semibold">{selectedMovie.quality || "1080p"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-500">Telegram File:</span>
                    <span className="text-zinc-400 font-mono text-[10px] truncate max-w-[120px]">{selectedMovie.telegram_file_id}</span>
                  </div>
                </div>
              </div>

              {/* TV Series Episode Explorer */}
              {selectedMovie.is_series && selectedMovie.episodes && selectedMovie.episodes.length > 0 && (
                <div className="border-t border-zinc-800 pt-6 space-y-5">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <h3 className="text-lg font-bold text-white flex items-center gap-2">
                        <Layers className="w-5 h-5 text-red-500" />
                        Episodes ({selectedMovie.episodes.filter(e => (e.season || 1) === selectedSeason).length})
                      </h3>
                    </div>

                    {/* Season Selector Dropdown / Tabs */}
                    {selectedMovie.seasons && selectedMovie.seasons.length > 1 && (
                      <div className="flex items-center gap-2 overflow-x-auto pb-1">
                        <span className="text-xs font-semibold text-zinc-400">Season:</span>
                        <div className="flex gap-1.5 bg-zinc-900 p-1 rounded-xl border border-zinc-800">
                          {selectedMovie.seasons.map((s) => (
                            <button
                              key={s}
                              onClick={() => setSelectedSeason(s)}
                              className={`px-3 py-1 rounded-lg text-xs font-bold transition ${
                                selectedSeason === s
                                  ? "bg-red-600 text-white shadow-md shadow-red-600/30"
                                  : "text-zinc-400 hover:text-white hover:bg-zinc-800"
                              }`}
                            >
                              S{s}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Season Episodes List */}
                  <div className="space-y-2.5 max-h-80 overflow-y-auto pr-1">
                    {selectedMovie.episodes
                      .filter(e => (e.season || 1) === selectedSeason)
                      .map((ep) => (
                        <div 
                          key={ep.id}
                          onClick={() => handlePlayMedia(ep, selectedMovie)}
                          className={`p-3.5 rounded-xl border transition flex items-center justify-between cursor-pointer group ${
                            playingMedia?.id === ep.id 
                              ? 'bg-red-950/40 border-red-600/50 text-white' 
                              : 'bg-zinc-900/60 hover:bg-zinc-800/80 border-zinc-800 text-zinc-300'
                          }`}
                        >
                          <div className="flex items-center gap-3.5 truncate">
                            <div className="w-9 h-9 rounded-full bg-zinc-800 group-hover:bg-red-600 flex items-center justify-center shrink-0 transition">
                              <Play className="w-4 h-4 fill-white text-white ml-0.5" />
                            </div>
                            <div className="truncate">
                              <div className="flex items-center gap-2">
                                <p className="text-xs font-bold text-white truncate">
                                  Episode {ep.episode || ep.id}
                                </p>
                                <span className="text-[10px] px-1.5 py-0.5 bg-zinc-800 text-zinc-300 rounded border border-zinc-700 font-semibold">
                                  {ep.quality || "1080p"}
                                </span>
                              </div>
                              <p className="text-[11px] text-zinc-400 font-mono truncate max-w-md mt-0.5">
                                {ep.file_name || `${ep.movie_title} S${ep.season}E${ep.episode}`}
                              </p>
                            </div>
                          </div>
                          
                          <div className="flex items-center gap-3 shrink-0">
                            <span className="text-[11px] text-zinc-400 font-mono hidden sm:inline">
                              {((ep.file_size || 0) / (1024*1024)).toFixed(0)} MB
                            </span>
                            <button 
                              onClick={(e) => { e.stopPropagation(); handlePlayMedia(ep, selectedMovie); }}
                              className="px-3.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-red-600 text-white text-xs font-bold transition flex items-center gap-1.5"
                            >
                              <Play className="w-3 h-3 fill-white" /> Play
                            </button>
                          </div>
                        </div>
                      ))}
                  </div>
                </div>
              )}

              {/* Movie Multiple Qualities Selector if available */}
              {!selectedMovie.is_series && selectedMovie.all_qualities && selectedMovie.all_qualities.length > 1 && (
                <div className="border-t border-zinc-800 pt-6 space-y-3">
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <SlidersHorizontal className="w-4 h-4 text-amber-400" />
                    Available Releases & Qualities
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {selectedMovie.all_qualities.map((q) => (
                      <div 
                        key={q.id}
                        onClick={() => handlePlayMedia({ ...selectedMovie, id: q.id, quality: q.quality, file_size: q.file_size })}
                        className="p-3 rounded-xl bg-zinc-900 border border-zinc-800 hover:border-zinc-700 flex items-center justify-between cursor-pointer transition"
                      >
                        <div className="flex items-center gap-2.5">
                          <span className="px-2 py-0.5 bg-amber-500/20 text-amber-300 border border-amber-500/40 rounded text-xs font-bold">
                            {q.quality}
                          </span>
                          <span className="text-xs text-zinc-300">{(q.file_size / (1024*1024*1024)).toFixed(2)} GB</span>
                        </div>
                        <span className="text-xs text-zinc-400 hover:text-white font-semibold">Play Resolution</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Catalog & Feed Rows */}
      <div className="relative z-20 -mt-16 space-y-12 pb-24">
        
        {/* Row 1: TV Series (Unified Shows) */}
        {seriesItems.length > 0 && (activeTab === "home" || activeTab === "series") && (
          <div className="space-y-3 px-4 md:px-14">
            <div className="flex items-center justify-between">
              <h2 className="text-xl md:text-2xl font-bold text-zinc-100 flex items-center gap-2.5">
                <Tv className="w-6 h-6 text-red-500" />
                TV Series & Binge-Worthy Shows
              </h2>
              <span className="text-xs text-zinc-400 font-semibold">{seriesItems.length} Shows Grouped</span>
            </div>
            
            <div className="flex overflow-x-auto gap-3 pb-4 pt-2 scrollbar-hide snap-x">
              {seriesItems.map((show) => (
                <div 
                  key={`series_${show.id}`} 
                  onClick={() => handleOpenDetails(show)}
                  className={`snap-start shrink-0 w-[170px] md:w-[230px] aspect-[2/3] rounded-xl relative overflow-hidden group bg-gradient-to-b ${getGradient(show.movie_title)} cursor-pointer transition-all duration-300 hover:z-30 hover:scale-105 hover:shadow-2xl hover:shadow-black/70 border border-zinc-800/80`}
                >
                  {show.poster_url && (
                    <img 
                      src={show.poster_url.startsWith("http") ? show.poster_url : `https://image.tmdb.org/t/p/w500${show.poster_url}`} 
                      alt={show.movie_title}
                      className="absolute inset-0 w-full h-full object-cover transition-transform duration-500"
                      onError={(e) => { (e.currentTarget as HTMLElement).style.display = 'none'; }}
                    />
                  )}

                  {/* Top Badge: Series Info */}
                  <div className="absolute top-2.5 left-2.5 z-10">
                    <span className="px-2 py-0.5 bg-black/80 text-red-400 border border-red-500/40 rounded-md text-[10px] font-black uppercase tracking-wider backdrop-blur">
                      {show.seasons?.length || 1} {((show.seasons?.length || 1) > 1) ? "Seasons" : "Season"}
                    </span>
                  </div>

                  {/* Hover Overlay Card */}
                  <div className="absolute inset-0 bg-black/85 opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex flex-col p-4 z-20">
                    <div className="flex-1" />
                    <div className="flex gap-2 mb-3">
                      <button 
                        onClick={(e) => { 
                          e.stopPropagation(); 
                          if (show.episodes && show.episodes.length > 0) {
                            handlePlayMedia(show.episodes[0], show);
                          } else {
                            handlePlayMedia(show);
                          }
                        }} 
                        className="w-9 h-9 rounded-full bg-white flex items-center justify-center text-black hover:bg-zinc-200 transition shadow-lg"
                      >
                        <Play className="w-4 h-4 ml-0.5 fill-black" />
                      </button>
                      <button 
                        onClick={(e) => { e.stopPropagation(); handleOpenDetails(show); }} 
                        className="w-9 h-9 rounded-full border border-zinc-400 bg-zinc-900/60 flex items-center justify-center text-white hover:border-white transition backdrop-blur"
                      >
                        <Layers className="w-4 h-4" />
                      </button>
                    </div>
                    <h3 className="font-bold text-sm leading-tight text-white mb-1 line-clamp-1">{show.movie_title}</h3>
                    <div className="flex items-center gap-2 text-[10px] font-bold text-zinc-300">
                      <span className="text-green-400">{show.total_episodes} Episodes</span>
                      <span>•</span>
                      <span>{show.year || "2024"}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Row 2: Blockbuster Movies */}
        {movieItems.length > 0 && (activeTab === "home" || activeTab === "films") && (
          <div className="space-y-3 px-4 md:px-14">
            <div className="flex items-center justify-between">
              <h2 className="text-xl md:text-2xl font-bold text-zinc-100 flex items-center gap-2.5">
                <Film className="w-6 h-6 text-red-500" />
                Featured Movies
              </h2>
              <span className="text-xs text-zinc-400 font-semibold">{movieItems.length} Titles</span>
            </div>
            
            <div className="flex overflow-x-auto gap-3 pb-4 pt-2 scrollbar-hide snap-x">
              {movieItems.map((movie) => (
                <div 
                  key={`movie_${movie.id}`} 
                  onClick={() => handleOpenDetails(movie)}
                  className={`snap-start shrink-0 w-[170px] md:w-[230px] aspect-[2/3] rounded-xl relative overflow-hidden group bg-gradient-to-b ${getGradient(movie.movie_title)} cursor-pointer transition-all duration-300 hover:z-30 hover:scale-105 hover:shadow-2xl hover:shadow-black/70 border border-zinc-800/80`}
                >
                  {movie.poster_url && (
                    <img 
                      src={movie.poster_url.startsWith("http") ? movie.poster_url : `https://image.tmdb.org/t/p/w500${movie.poster_url}`} 
                      alt={movie.movie_title}
                      className="absolute inset-0 w-full h-full object-cover transition-transform duration-500"
                      onError={(e) => { (e.currentTarget as HTMLElement).style.display = 'none'; }}
                    />
                  )}
                  {/* Hover Overlay Card */}
                  <div className="absolute inset-0 bg-black/85 opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex flex-col p-4 z-20">
                    <div className="flex-1" />
                    <div className="flex gap-2 mb-3">
                      <button 
                        onClick={(e) => { e.stopPropagation(); handlePlayMedia(movie); }} 
                        className="w-9 h-9 rounded-full bg-white flex items-center justify-center text-black hover:bg-zinc-200 transition shadow-lg"
                      >
                        <Play className="w-4 h-4 ml-0.5 fill-black" />
                      </button>
                      <button 
                        onClick={(e) => { e.stopPropagation(); handleOpenDetails(movie); }} 
                        className="w-9 h-9 rounded-full border border-zinc-400 bg-zinc-900/60 flex items-center justify-center text-white hover:border-white transition backdrop-blur"
                      >
                        <Info className="w-4 h-4" />
                      </button>
                    </div>
                    <h3 className="font-bold text-sm leading-tight text-white mb-1 line-clamp-1">{movie.movie_title}</h3>
                    <div className="flex items-center gap-2 text-[10px] font-bold">
                      <span className="text-green-400">98% Match</span>
                      <span className="text-zinc-300">{movie.year}</span>
                      <span className="px-1 border border-zinc-500 rounded text-zinc-300">{movie.quality || "1080p"}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Search Request Notice if No Results */}
        {filteredLibrary.length === 0 && searchQuery && (
          <div className="px-4 md:px-14">
            <div className="p-8 bg-zinc-900/80 border border-zinc-800 rounded-2xl max-w-xl my-6 space-y-4 animate-in fade-in">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-red-600/10 text-red-500 rounded-xl">
                  <Bot className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-white">"{searchQuery}" is not in the catalog yet</h3>
                  <p className="text-xs text-zinc-400 mt-0.5">We can search our distribution network and acquire it automatically.</p>
                </div>
              </div>

              {requestNotice && (
                <div className="p-3 bg-zinc-950 border border-purple-500/30 text-purple-300 text-xs rounded-lg animate-in fade-in">
                  {requestNotice}
                </div>
              )}

              <button
                onClick={handleRequestAndFetch}
                disabled={requestSubmitting}
                className="w-full sm:w-auto px-6 py-2.5 bg-red-600 hover:bg-red-500 text-white rounded-lg text-sm font-bold flex items-center justify-center gap-2 transition shadow-lg shadow-red-600/20 disabled:opacity-50"
              >
                {requestSubmitting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                {requestSubmitting ? "Searching Distribution Channels..." : "Request Title on BusiMovie"}
              </button>
            </div>
          </div>
        )}

      </div>
      
    </div>
  );
}
