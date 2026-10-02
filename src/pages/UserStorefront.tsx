import React, { useEffect, useState } from "react";
import { Play, Search, Bell, Plus, DownloadCloud, UploadCloud, FolderPlus, Info, Check, X, Bot, Zap, RefreshCw } from "lucide-react";
import { MediaFile, SearchResult } from "../types";

export default function UserStorefront() {
  const [library, setLibrary] = useState<MediaFile[]>([]);
  const [heroMovie, setHeroMovie] = useState<SearchResult | null>(null);
  const [scrolled, setScrolled] = useState(false);
  const [playingMedia, setPlayingMedia] = useState<MediaFile | null>(null);
  const [streamInfo, setStreamInfo] = useState<{ streamUrl?: string; tgDirectLink?: string; loading: boolean } | null>(null);
  
  // New State for Search and Modals
  const [searchQuery, setSearchQuery] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [selectedMovie, setSelectedMovie] = useState<MediaFile | null>(null);

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
        setLibrary(l.files || []);
        if (l.files && l.files.length > 0) {
          fetchHeroMovie(l.files[0].movie_title);
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

  const filteredLibrary = library.filter(m => {
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

  return (
    <div className="min-h-screen bg-[#141414] text-white font-sans overflow-x-hidden pb-12 selection:bg-red-600/30">
      
      {/* Streaming Modal */}
      {playingMedia && streamInfo && (
        <div className="fixed inset-0 z-[100] bg-black flex flex-col animate-in fade-in duration-300">
          <div className="flex items-center justify-between p-6 absolute top-0 w-full z-10 bg-gradient-to-b from-black/80 to-transparent">
            <h2 className="text-2xl font-bold tracking-tight">{playingMedia.movie_title}</h2>
            <button onClick={() => { setPlayingMedia(null); setStreamInfo(null); }} className="p-2 bg-white/10 hover:bg-white/20 rounded-full backdrop-blur transition">
              <X className="w-6 h-6" />
            </button>
          </div>
          <div className="flex-1 flex items-center justify-center relative">
            {streamInfo.loading ? (
              <div className="flex flex-col items-center gap-4 text-zinc-400">
                <div className="w-12 h-12 border-4 border-red-600 border-t-transparent rounded-full animate-spin" />
                <p className="font-medium animate-pulse">Decrypting Vault Stream...</p>
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
             <div className="absolute bottom-10 right-10 z-10">
                <a 
                  href={streamInfo.streamUrl} 
                  download={`${playingMedia.movie_title}.mp4`}
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
            <h1 className="text-red-600 font-black text-3xl tracking-tighter cursor-pointer">BUSIMOVIE</h1>
            <div className="hidden lg:flex gap-6 text-sm font-medium text-zinc-300">
              <span className="text-white cursor-pointer font-bold">Home</span>
              <span className="hover:text-zinc-400 cursor-pointer transition">Series</span>
              <span className="hover:text-zinc-400 cursor-pointer transition">Films</span>
              <span className="hover:text-zinc-400 cursor-pointer transition">New & Popular</span>
              <span className="hover:text-zinc-400 cursor-pointer transition">My List</span>
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
                  placeholder="Titles, people, genres"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="absolute right-0 top-1/2 -translate-y-1/2 w-[240px] bg-black/80 border border-white/80 outline-none text-sm px-10 py-1.5 transition-all animate-in fade-in slide-in-from-right-4"
                />
              )}
              {showSearch && <Search className="w-4 h-4 absolute left-2 top-1/2 -translate-y-1/2 text-white/50 pointer-events-none animate-in fade-in" />}
            </div>
            <span className="hidden sm:block text-sm font-medium hover:text-zinc-400 cursor-pointer transition">Kids</span>
            <Bell className="w-5 h-5 cursor-pointer hover:text-zinc-400 transition" />
            <div className="w-8 h-8 rounded bg-red-600 flex items-center justify-center cursor-pointer border border-zinc-800">
              <span className="font-bold text-xs">U</span>
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
        <div className="absolute inset-0 bg-gradient-to-t from-[#141414] via-[#141414]/30 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-r from-[#141414] via-[#141414]/50 to-transparent w-[60%]" />

        <div className="relative z-10 h-full flex flex-col justify-end px-4 md:px-14 pb-32 max-w-2xl">
          {heroMovie ? (
            <>
              <h1 className="text-5xl md:text-7xl font-black tracking-tight mb-4 text-white drop-shadow-2xl">{heroMovie.title}</h1>
              <p className="text-lg md:text-xl text-white font-medium mb-8 line-clamp-3 drop-shadow-lg leading-relaxed">{heroMovie.overview}</p>
            </>
          ) : (
            <>
              <h1 className="text-5xl md:text-7xl font-black tracking-tight mb-4 text-white drop-shadow-2xl">Telegram Vault</h1>
              <p className="text-lg md:text-xl text-white font-medium mb-8 drop-shadow-lg leading-relaxed">Search, request, and stream any movie or TV show directly through your private Telegram bot.</p>
            </>
          )}

          <div className="flex gap-4">
            <button onClick={() => filteredLibrary.length > 0 && handlePlayMedia(filteredLibrary[0])} className="flex items-center justify-center gap-2.5 bg-white hover:bg-white/80 text-black px-7 py-3 rounded font-bold text-[1.1rem] transition shadow">
              <Play className="w-6 h-6 fill-black" /> Play
            </button>
            <button onClick={() => filteredLibrary.length > 0 && setSelectedMovie(filteredLibrary[0])} className="flex items-center justify-center gap-2.5 bg-zinc-500/40 hover:bg-zinc-500/60 text-white px-7 py-3 rounded font-bold text-[1.1rem] backdrop-blur transition">
              <Info className="w-6 h-6" /> More Info
            </button>
          </div>
        </div>
      </div>

      {/* Details Modal */}
      {selectedMovie && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 sm:p-6 animate-in fade-in duration-300">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setSelectedMovie(null)} />
          <div className="relative w-full max-w-3xl bg-[#181818] rounded-xl overflow-hidden shadow-2xl z-10 animate-in zoom-in-95 duration-300">
            {/* Modal Header/Backdrop */}
            <div className="relative h-[40vh] w-full bg-[#141414]">
              {selectedMovie.poster_url && (
                <img src={selectedMovie.poster_url.startsWith("http") ? selectedMovie.poster_url : `https://image.tmdb.org/t/p/w500${selectedMovie.poster_url}`} alt={selectedMovie.movie_title} className="w-full h-full object-cover" />
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-[#181818] via-transparent to-transparent" />
              <button onClick={() => setSelectedMovie(null)} className="absolute top-4 right-4 p-2 bg-[#181818]/50 hover:bg-[#181818] rounded-full text-white transition">
                <X className="w-6 h-6" />
              </button>
              
              <div className="absolute bottom-6 left-10 text-white space-y-4">
                 <h2 className="text-4xl font-black drop-shadow-lg">{selectedMovie.movie_title}</h2>
                 <div className="flex gap-3">
                    <button onClick={() => handlePlayMedia(selectedMovie)} className="flex items-center justify-center gap-2 bg-white hover:bg-white/80 text-black px-6 py-2 rounded font-bold transition shadow">
                      <Play className="w-5 h-5 fill-black" /> Play
                    </button>
                    <button className="w-10 h-10 rounded-full border border-zinc-400 bg-zinc-900/50 flex items-center justify-center text-white hover:border-white transition backdrop-blur">
                      <Plus className="w-5 h-5" />
                    </button>
                 </div>
              </div>
            </div>
            
            <div className="p-6 md:p-10 text-white space-y-6">
               <div className="flex flex-col md:flex-row gap-6 md:gap-10">
                 <div className="flex-1 space-y-4">
                    <div className="flex items-center gap-3 text-sm font-bold">
                      <span className="text-green-500">98% Match</span>
                      <span>{selectedMovie.year}</span>
                      <span className="px-1.5 py-px border border-zinc-500 rounded text-zinc-400">{selectedMovie.quality || "HD"}</span>
                      {selectedMovie.season && (
                        <span className="px-2 py-0.5 bg-red-600/30 text-red-400 border border-red-500/30 rounded text-xs font-semibold">
                          Season {selectedMovie.season} {selectedMovie.episode ? `• Ep ${selectedMovie.episode}` : ''}
                        </span>
                      )}
                    </div>
                    <p className="text-zinc-300 text-sm leading-relaxed">
                      {selectedMovie.season 
                        ? `Stream all episodes of ${selectedMovie.movie_title} directly from your Telegram Cloud Vault.`
                        : "This title is directly accessible from your Telegram Cloud Vault. Enjoy instant streaming and high-speed offline downloads."}
                    </p>
                 </div>
                 <div className="md:w-1/3 text-sm space-y-3 bg-zinc-900/60 p-4 rounded-xl border border-zinc-800">
                   <div>
                     <span className="text-zinc-500 text-xs uppercase tracking-wider block">Telegram File ID</span> 
                     <span className="text-zinc-300 font-mono text-xs break-all">{selectedMovie.telegram_file_id}</span>
                   </div>
                   <div>
                     <span className="text-zinc-500 text-xs uppercase tracking-wider block">Quality & Size</span> 
                     <span className="text-zinc-300 text-xs">{selectedMovie.quality || "HD"} • {(selectedMovie.file_size / (1024*1024)).toFixed(2)} MB</span>
                   </div>
                 </div>
               </div>

               {/* TV Series Season & Episodes Grid */}
               {(() => {
                 const relatedEps = library.filter(
                   item => item.movie_title.toLowerCase().trim() === selectedMovie.movie_title.toLowerCase().trim() && item.season !== undefined && item.season !== null
                 ).sort((a, b) => ((a.season || 0) * 1000 + (a.episode || 0)) - ((b.season || 0) * 1000 + (b.episode || 0)));

                 if (relatedEps.length <= 1) return null;

                 return (
                   <div className="border-t border-zinc-800 pt-6 space-y-4">
                     <div className="flex items-center justify-between">
                       <h3 className="text-lg font-bold text-white flex items-center gap-2">
                         <Film className="w-5 h-5 text-red-500" />
                         Episodes in Vault ({relatedEps.length})
                       </h3>
                     </div>

                     <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-60 overflow-y-auto pr-1">
                       {relatedEps.map((ep) => (
                         <div 
                           key={ep.id}
                           onClick={() => handlePlayMedia(ep)}
                           className={`p-3 rounded-lg border transition flex items-center justify-between cursor-pointer ${
                             selectedMovie.id === ep.id 
                               ? 'bg-red-950/40 border-red-600/50 text-white' 
                               : 'bg-zinc-900/80 hover:bg-zinc-800 border-zinc-800 text-zinc-300'
                           }`}
                         >
                           <div className="flex items-center gap-3 truncate">
                             <div className="w-8 h-8 rounded-full bg-zinc-800 flex items-center justify-center shrink-0">
                               <Play className="w-3.5 h-3.5 fill-white text-white ml-0.5" />
                             </div>
                             <div className="truncate">
                               <p className="text-xs font-bold text-white truncate">
                                 Season {ep.season}, Episode {ep.episode || ep.id}
                               </p>
                               <p className="text-[10px] text-zinc-400">
                                 {ep.quality || "HD"} • {(ep.file_size / (1024*1024)).toFixed(0)} MB
                               </p>
                             </div>
                           </div>
                           <span className="text-[10px] px-2 py-1 rounded bg-zinc-800 font-semibold shrink-0">
                             Play
                           </span>
                         </div>
                       ))}
                     </div>
                   </div>
                 );
               })()}
            </div>
          </div>
        </div>
      )}

      {/* Media Rows */}
      <div className="relative z-20 -mt-16 space-y-12 pb-24">
        
        {/* Vault Row - Recently Added */}
        <div className="space-y-3 px-4 md:px-14">
          <h2 className="text-xl md:text-2xl font-bold text-zinc-100 flex items-center gap-3">
            Recently Added to Vault
          </h2>
          
          {filteredLibrary.length > 0 ? (
            <div className="flex overflow-x-auto gap-2 pb-4 pt-2 scrollbar-hide snap-x">
              {filteredLibrary.map((file) => (
                <div 
                  key={file.id} 
                  onClick={() => setSelectedMovie(file)}
                  className={`snap-start shrink-0 w-[160px] md:w-[220px] aspect-[2/3] rounded relative overflow-hidden group bg-gradient-to-b ${getGradient(file.movie_title)} cursor-pointer transition-all duration-300 hover:z-30 hover:scale-105 hover:shadow-2xl hover:shadow-black/50`}
                >
                  {file.poster_url && (
                    <img 
                      src={file.poster_url.startsWith("http") ? file.poster_url : `https://image.tmdb.org/t/p/w500${file.poster_url}`} 
                      alt={file.movie_title}
                      className="absolute inset-0 w-full h-full object-cover transition-transform duration-500"
                      onError={(e) => { (e.currentTarget as HTMLElement).style.display = 'none'; }}
                    />
                  )}
                  {/* Hover Overlay Card */}
                  <div className="absolute inset-0 bg-black/80 opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex flex-col p-4 z-20">
                    <div className="flex-1" />
                    <div className="flex gap-2 mb-3">
                      <button 
                        onClick={(e) => { e.stopPropagation(); handlePlayMedia(file); }} 
                        className="w-8 h-8 rounded-full bg-white flex items-center justify-center text-black hover:bg-zinc-200 transition"
                      >
                        <Play className="w-4 h-4 ml-0.5 fill-black" />
                      </button>
                      <button 
                        onClick={(e) => e.stopPropagation()} 
                        className="w-8 h-8 rounded-full border border-zinc-400 bg-zinc-900/50 flex items-center justify-center text-white hover:border-white transition"
                      >
                        <Plus className="w-4 h-4" />
                      </button>
                    </div>
                    <h3 className="font-bold text-sm leading-tight text-white mb-1 line-clamp-1">{file.movie_title}</h3>
                    <div className="flex items-center gap-2 text-[10px] font-bold">
                      <span className="text-green-500">98% Match</span>
                      <span className="text-zinc-300">{file.year}</span>
                      <span className="px-1 border border-zinc-500 rounded text-zinc-400">{file.quality || "HD"}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : searchQuery ? (
            <div className="p-8 bg-zinc-900/60 border border-zinc-800 rounded-2xl max-w-xl my-6 space-y-4 animate-in fade-in">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-red-600/10 text-red-500 rounded-xl">
                  <Bot className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-white">"{searchQuery}" is not in the Vault yet</h3>
                  <p className="text-xs text-zinc-400 mt-0.5">Our autonomous MTProto userbot can search external Telegram networks and fetch it directly.</p>
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
                {requestSubmitting ? "Querying External Bots..." : "Auto-Fetch Title via Bot Crawler"}
              </button>
            </div>
          ) : (
            <div className="text-zinc-500 text-sm py-10">Your vault is currently empty. Head to Telegram to request a movie!</div>
          )}
        </div>

        {/* Mock Row 2 - Top Picks for You */}
        {filteredLibrary.length > 2 && (
          <div className="space-y-3 px-4 md:px-14">
            <h2 className="text-xl md:text-2xl font-bold text-zinc-100 flex items-center gap-3">
              Top Picks for You
            </h2>
            <div className="flex overflow-x-auto gap-2 pb-4 pt-2 scrollbar-hide snap-x">
              {[...filteredLibrary].reverse().map((file) => (
                <div 
                  key={`top_${file.id}`} 
                  onClick={() => setSelectedMovie(file)}
                  className={`snap-start shrink-0 w-[160px] md:w-[220px] aspect-[2/3] rounded relative overflow-hidden group bg-gradient-to-b ${getGradient(file.movie_title)} cursor-pointer transition-all duration-300 hover:z-30 hover:scale-105 hover:shadow-2xl hover:shadow-black/50`}
                >
                  {file.poster_url && (
                    <img 
                      src={file.poster_url.startsWith("http") ? file.poster_url : `https://image.tmdb.org/t/p/w500${file.poster_url}`} 
                      alt={file.movie_title}
                      className="absolute inset-0 w-full h-full object-cover transition-transform duration-500"
                      onError={(e) => { (e.currentTarget as HTMLElement).style.display = 'none'; }}
                    />
                  )}
                  <div className="absolute inset-0 bg-black/80 opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex flex-col p-4 z-20">
                    <div className="flex-1" />
                    <div className="flex gap-2 mb-3">
                      <button 
                        onClick={(e) => { e.stopPropagation(); handlePlayMedia(file); }} 
                        className="w-8 h-8 rounded-full bg-white flex items-center justify-center text-black hover:bg-zinc-200 transition"
                      >
                        <Play className="w-4 h-4 ml-0.5 fill-black" />
                      </button>
                      <button 
                        onClick={(e) => e.stopPropagation()} 
                        className="w-8 h-8 rounded-full border border-zinc-400 bg-zinc-900/50 flex items-center justify-center text-white hover:border-white transition"
                      >
                        <Plus className="w-4 h-4" />
                      </button>
                    </div>
                    <h3 className="font-bold text-sm leading-tight text-white mb-1 line-clamp-1">{file.movie_title}</h3>
                    <div className="flex items-center gap-2 text-[10px] font-bold">
                      <span className="text-green-500">New</span>
                      <span className="text-zinc-300">{file.year}</span>
                      <span className="px-1 border border-zinc-500 rounded text-zinc-400">{file.quality || "HD"}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Mock Row 3 - 4K UHD Vault */}
        {filteredLibrary.filter(f => f.quality?.includes("4K") || f.quality?.includes("1080p")).length > 0 && (
          <div className="space-y-3 px-4 md:px-14">
            <h2 className="text-xl md:text-2xl font-bold text-zinc-100 flex items-center gap-3">
              High Definition Vault
            </h2>
            <div className="flex overflow-x-auto gap-2 pb-4 pt-2 scrollbar-hide snap-x">
              {filteredLibrary.filter(f => f.quality?.includes("4K") || f.quality?.includes("1080p")).map((file) => (
                <div 
                  key={`hd_${file.id}`} 
                  onClick={() => setSelectedMovie(file)}
                  className={`snap-start shrink-0 w-[160px] md:w-[220px] aspect-[2/3] rounded relative overflow-hidden group bg-gradient-to-b ${getGradient(file.movie_title)} cursor-pointer transition-all duration-300 hover:z-30 hover:scale-105 hover:shadow-2xl hover:shadow-black/50`}
                >
                  {file.poster_url && (
                    <img 
                      src={file.poster_url.startsWith("http") ? file.poster_url : `https://image.tmdb.org/t/p/w500${file.poster_url}`} 
                      alt={file.movie_title}
                      className="absolute inset-0 w-full h-full object-cover transition-transform duration-500"
                      onError={(e) => { (e.currentTarget as HTMLElement).style.display = 'none'; }}
                    />
                  )}
                  <div className="absolute inset-0 bg-black/80 opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex flex-col p-4 z-20">
                    <div className="flex-1" />
                    <div className="flex gap-2 mb-3">
                      <button 
                        onClick={(e) => { e.stopPropagation(); handlePlayMedia(file); }} 
                        className="w-8 h-8 rounded-full bg-white flex items-center justify-center text-black hover:bg-zinc-200 transition"
                      >
                        <Play className="w-4 h-4 ml-0.5 fill-black" />
                      </button>
                      <button 
                        onClick={(e) => e.stopPropagation()} 
                        className="w-8 h-8 rounded-full border border-zinc-400 bg-zinc-900/50 flex items-center justify-center text-white hover:border-white transition"
                      >
                        <Plus className="w-4 h-4" />
                      </button>
                    </div>
                    <h3 className="font-bold text-sm leading-tight text-white mb-1 line-clamp-1">{file.movie_title}</h3>
                    <div className="flex items-center gap-2 text-[10px] font-bold">
                      <span className="text-green-500">Premium</span>
                      <span className="text-zinc-300">{file.year}</span>
                      <span className="px-1 border border-amber-500/50 bg-amber-500/10 rounded text-amber-400">{file.quality || "HD"}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      
    </div>
  );
}
