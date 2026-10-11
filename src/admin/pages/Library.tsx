import React, { useMemo, useState } from "react";
import { ChevronDown, Download, Film, Plus, RefreshCw, Search, Trash2, Tv } from "lucide-react";
import { api, errMsg, formatBytes, normalize, timeAgo, useAct, useGet } from "../lib";
import { Badge, Button, Card, Empty, Field, IconButton, Input, PageHeader, Segmented, Select, Skeleton, Table, TD, TH, THead, TR, cx } from "../ui/kit";
import { Drawer, useConfirm, useToast } from "../ui/overlay";

interface FileRow {
  id: number; movie_title: string; year?: string; quality?: string; file_name?: string; file_size?: number; telegram_file_id: string;
  poster_url?: string; season?: number; episode?: number; is_series?: boolean; created_at?: string;
}
interface Group { key: string; title: string; poster?: string; isSeries: boolean; files: FileRow[]; seasons: number[]; bytes: number; latest?: string }

const poster = (p?: string) => (!p ? "" : p.startsWith("http") ? p : `https://image.tmdb.org/t/p/w185${p}`);
const ep = (f: FileRow) => `S${String(f.season ?? 1).padStart(2, "0")}E${String(f.episode ?? 0).padStart(2, "0")}`;

export default function Library() {
  const q = useGet<{ files: FileRow[] }>(["library-raw"], "/api/library?raw=true");
  const toast = useToast();
  const confirm = useConfirm();
  const [view, setView] = useState<"all" | "movies" | "series">("all");
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const groups = useMemo<Group[]>(() => {
    const map = new Map<string, Group>();
    for (const f of q.data?.files || []) {
      const isSeries = !!(f.is_series || f.season);
      const key = `${isSeries ? "s" : "m"}:${normalize(f.movie_title || "untitled")}${isSeries ? "" : `:${f.year || ""}`}`;
      let g = map.get(key);
      if (!g) map.set(key, (g = { key, title: f.movie_title || "Untitled", poster: f.poster_url, isSeries, files: [], seasons: [], bytes: 0, latest: f.created_at }));
      g.files.push(f);
      g.bytes += Number(f.file_size) || 0;
      if (!g.poster && f.poster_url) g.poster = f.poster_url;
      if (f.season && !g.seasons.includes(f.season)) g.seasons.push(f.season);
      if (f.created_at && (!g.latest || f.created_at > g.latest)) g.latest = f.created_at;
    }
    return [...map.values()].sort((a, b) => (b.latest || "").localeCompare(a.latest || ""));
  }, [q.data]);

  const shown = useMemo(() => {
    const n = normalize(search);
    return groups.filter((g) => {
      if (view === "movies" && g.isSeries) return false;
      if (view === "series" && !g.isSeries) return false;
      if (!n) return true;
      return normalize(g.title).includes(n) || g.files.some((f) => normalize(f.file_name || "").includes(n));
    });
  }, [groups, view, search]);

  const counts = { all: groups.length, movies: groups.filter((g) => !g.isSeries).length, series: groups.filter((g) => g.isSeries).length };

  const rescan = useAct(() => api("/api/series/rescan", { method: "POST", body: {} }), [["library-raw"]], (r: any) =>
    toast.ok(`Series re-checked${r?.fixed !== undefined ? `: ${r.fixed} entries tidied` : ""}.`)
  );
  const del = useAct((id: number) => api(`/api/library/${id}`, { method: "DELETE" }), [["library-raw"], ["status"]], () => toast.ok("File removed from the library."));

  const exportCsv = async () => {
    try {
      const res = await fetch("/api/library/export");
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "busimovie-library.csv";
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      toast.err(errMsg(e));
    }
  };

  const removeFile = async (f: FileRow) => {
    const ok = await confirm({
      title: "Remove this file?",
      body: <>"{f.file_name || f.movie_title}" will stop appearing for viewers. The message in your vault channel is not deleted.</>,
      confirmLabel: "Remove",
      danger: true,
    });
    if (ok) del.mutate(f.id, { onError: (e) => toast.err(e.message) });
  };

  return (
    <div>
      <PageHeader
        title="Library"
        description="Everything viewers can watch. Files land here when the crawler or a source channel saves them to your vault."
        actions={
          <>
            <Button icon={<RefreshCw className="h-3.5 w-3.5" />} loading={rescan.isPending} onClick={() => rescan.mutate(undefined as never, { onError: (e) => toast.err(e.message) })}>Re-check series</Button>
            <Button icon={<Download className="h-3.5 w-3.5" />} onClick={exportCsv}>Export</Button>
            <Button variant="primary" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setAdding(true)}>Add file</Button>
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative min-w-[14rem] flex-1 sm:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-600" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search titles or file names" className="pl-9" />
        </div>
        <Segmented<"all" | "movies" | "series">
          value={view}
          onChange={setView}
          options={[
            { value: "all", label: "All", count: counts.all },
            { value: "movies", label: "Movies", count: counts.movies },
            { value: "series", label: "Series", count: counts.series },
          ]}
        />
        <span className="ml-auto hidden text-xs tabular-nums text-zinc-500 sm:block">
          {q.data ? `${q.data.files.length.toLocaleString()} files · ${formatBytes(groups.reduce((a, g) => a + g.bytes, 0))}` : ""}
        </span>
      </div>

      <Card flush>
        {q.isLoading ? (
          <div className="space-y-2 p-4">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-14" />)}</div>
        ) : shown.length === 0 ? (
          <Empty icon={<Film className="h-5 w-5" />} title={search ? "Nothing matches that search" : "Your library is empty"} body={search ? "Try a shorter title." : "Add a source channel or request a title and files will appear here."} />
        ) : (
          <ul className="divide-y divide-line/70">
            {shown.map((g) => {
              const isOpen = open === g.key;
              const sorted = [...g.files].sort((a, b) => (a.season ?? 0) * 1000 + (a.episode ?? 0) - ((b.season ?? 0) * 1000 + (b.episode ?? 0)));
              return (
                <li key={g.key}>
                  <button onClick={() => setOpen(isOpen ? null : g.key)} className="flex w-full items-center gap-3.5 px-4 py-3 text-left transition hover:bg-surface-2/60" aria-expanded={isOpen}>
                    <div className="h-14 w-10 shrink-0 overflow-hidden rounded-md bg-surface-3">
                      {g.poster ? <img src={poster(g.poster)} alt="" loading="lazy" className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-zinc-600">{g.isSeries ? <Tv className="h-4 w-4" /> : <Film className="h-4 w-4" />}</div>}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-white">{g.title}{!g.isSeries && g.files[0]?.year ? <span className="ml-1.5 font-normal text-zinc-500">{g.files[0].year}</span> : null}</div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-500">
                        <Badge tone={g.isSeries ? "info" : "neutral"}>{g.isSeries ? "Series" : "Movie"}</Badge>
                        {g.isSeries ? <span>{g.seasons.length || 1} season{g.seasons.length === 1 ? "" : "s"} · {g.files.length} episodes</span> : <span>{[...new Set(g.files.map((f) => f.quality).filter(Boolean))].join(" · ") || "HD"}</span>}
                        <span>{formatBytes(g.bytes)}</span>
                        <span className="hidden sm:inline">· added {timeAgo(g.latest)}</span>
                      </div>
                    </div>
                    <ChevronDown className={cx("h-4 w-4 shrink-0 text-zinc-600 transition", isOpen && "rotate-180")} />
                  </button>
                  {isOpen && (
                    <div className="border-t border-line/70 bg-ink/40">
                      <Table className="max-h-80 overflow-y-auto">
                        <THead>
                          <TH>{g.isSeries ? "Episode" : "Quality"}</TH>
                          <TH className="hidden md:table-cell">File</TH>
                          <TH className="text-right">Size</TH>
                          <TH className="w-10" />
                        </THead>
                        <tbody>
                          {sorted.map((f) => (
                            <TR key={f.id}>
                              <TD className="whitespace-nowrap text-zinc-100">{g.isSeries ? ep(f) : f.quality || "HD"}{g.isSeries && f.quality ? <span className="ml-2 text-xs text-zinc-500">{f.quality}</span> : null}</TD>
                              <TD className="hidden md:table-cell max-w-[18rem]"><div className="truncate font-mono text-xs text-zinc-500" title={f.file_name || f.telegram_file_id}>{f.file_name || f.telegram_file_id}</div></TD>
                              <TD className="whitespace-nowrap text-right tabular-nums text-zinc-400">{formatBytes(f.file_size)}</TD>
                              <TD><IconButton label="Remove file" onClick={() => removeFile(f)}><Trash2 className="h-3.5 w-3.5" /></IconButton></TD>
                            </TR>
                          ))}
                        </tbody>
                      </Table>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <AddFile open={adding} onClose={() => setAdding(false)} />
    </div>
  );
}

function AddFile({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const empty = { movie_title: "", year: "", quality: "1080p", telegram_file_id: "", file_size: "" };
  const [f, setF] = useState(empty);
  const set = (k: keyof typeof empty) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((p) => ({ ...p, [k]: e.target.value }));
  const add = useAct(
    () => api("/api/library/add", { body: { ...f, movie_id: `manual_${Date.now()}`, file_size: Number(f.file_size) * 1024 * 1024 || undefined } }),
    [["library-raw"], ["status"]],
    () => { toast.ok("Added to the library."); setF(empty); onClose(); }
  );
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Add a file by hand"
      subtitle="For a file already sitting in Telegram. Most files arrive automatically."
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={!f.movie_title.trim() || !f.telegram_file_id.trim()} loading={add.isPending} onClick={() => add.mutate(undefined as never, { onError: (e) => toast.err(e.message) })}>Add to library</Button>
      </>}
    >
      <div className="space-y-4">
        <Field label="Title"><Input value={f.movie_title} onChange={set("movie_title")} placeholder="Inception" autoFocus /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Year"><Input value={f.year} onChange={set("year")} placeholder="2010" inputMode="numeric" /></Field>
          <Field label="Quality">
            <Select value={f.quality} onChange={set("quality")}>
              {["480p", "720p", "1080p", "4K"].map((x) => <option key={x}>{x}</option>)}
            </Select>
          </Field>
        </div>
        <Field label="Telegram file ID" hint="The file_id the bot received when the file was uploaded.">
          <Input value={f.telegram_file_id} onChange={set("telegram_file_id")} className="font-mono" />
        </Field>
        <Field label="Size (MB)" hint="Optional."><Input value={f.file_size} onChange={set("file_size")} inputMode="numeric" /></Field>
      </div>
    </Drawer>
  );
}
