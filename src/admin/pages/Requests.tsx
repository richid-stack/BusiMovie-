import React, { useState } from "react";
import { Check, Inbox, Sparkles } from "lucide-react";
import { api, timeAgo, useAct, useGet } from "../lib";
import { Badge, Button, Card, Empty, PageHeader, Segmented, Skeleton, TD, TH, THead, TR, Table, type Tone } from "../ui/kit";
import { useToast } from "../ui/overlay";

interface Req { id: number; telegram_id: string; title: string; status: string; created_at?: string }

const STATUS: Record<string, { label: string; tone: Tone }> = {
  pending: { label: "Waiting", tone: "warn" },
  searching: { label: "Fetching", tone: "info" },
  waiting: { label: "Fetching", tone: "info" },
  fulfilled: { label: "Ready", tone: "ok" },
};

export default function Requests() {
  const q = useGet<{ pending: Req[]; all: Req[] }>(["requests"], "/api/requests", { every: 15000 });
  const toast = useToast();
  const [tab, setTab] = useState<"pending" | "all">("pending");
  const [busy, setBusy] = useState<number | null>(null);

  const fulfill = useAct((id: number) => api(`/api/requests/${id}/fulfill`, { method: "POST", body: {} }), [["requests"], ["status"]], () =>
    toast.ok("Marked ready and the viewer was notified.")
  );
  const fetchIt = useAct((id: number) => api<{ success: boolean; message: string }>(`/api/requests/${id}/auto-fetch`, { method: "POST", body: {} }), [["requests"], ["status"], ["jobs"], ["library-raw"]]);

  const run = async (r: Req) => {
    setBusy(r.id);
    try {
      const res = await fetchIt.mutateAsync(r.id);
      if (res.success) toast.ok(`${r.title}: ${res.message}`);
      else toast.info(`${r.title}: ${res.message}`);
    } catch (e: any) {
      toast.err(e.message);
    } finally {
      setBusy(null);
    }
  };

  const rows = (tab === "pending" ? q.data?.pending : q.data?.all) || [];
  const pendingCount = q.data?.pending?.length || 0;

  return (
    <div>
      <PageHeader title="Requests" description="Titles viewers asked for that weren't in the library. Fetch them automatically, or mark them ready if you added the file yourself." />
      <div className="mb-4">
        <Segmented<"pending" | "all"> value={tab} onChange={setTab} options={[{ value: "pending", label: "Waiting", count: pendingCount }, { value: "all", label: "History" }]} />
      </div>
      <Card flush>
        {q.isLoading ? (
          <div className="space-y-2 p-4">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-12" />)}</div>
        ) : rows.length === 0 ? (
          <Empty icon={<Inbox className="h-5 w-5" />} title={tab === "pending" ? "Nothing waiting" : "No requests yet"} body={tab === "pending" ? "You're all caught up." : "Requests from viewers will be listed here."} />
        ) : (
          <Table>
            <THead>
              <TH>Title</TH>
              <TH className="hidden md:table-cell">Viewer</TH>
              <TH className="hidden md:table-cell">Asked</TH>
              <TH>Status</TH>
              {tab === "pending" && <TH className="text-right">Actions</TH>}
            </THead>
            <tbody>
              {rows.map((r) => {
                const st = STATUS[r.status] || { label: r.status, tone: "neutral" as Tone };
                return (
                  <TR key={r.id}>
                    <TD className="max-w-[16rem]"><div className="truncate font-medium text-white">{r.title}</div></TD>
                    <TD className="hidden md:table-cell font-mono text-xs text-zinc-500">{r.telegram_id}</TD>
                    <TD className="hidden md:table-cell whitespace-nowrap text-zinc-500">{timeAgo(r.created_at)}</TD>
                    <TD><Badge tone={st.tone} dot>{st.label}</Badge></TD>
                    {tab === "pending" && (
                      <TD>
                        <div className="flex flex-wrap justify-end gap-2">
                          <Button size="sm" icon={<Sparkles className="h-3.5 w-3.5" />} loading={busy === r.id} onClick={() => run(r)}>Fetch now</Button>
                          <Button size="sm" variant="ghost" icon={<Check className="h-3.5 w-3.5" />} disabled={busy === r.id} onClick={() => fulfill.mutate(r.id, { onError: (e) => toast.err(e.message) })}>Mark ready</Button>
                        </div>
                      </TD>
                    )}
                  </TR>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
