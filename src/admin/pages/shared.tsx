import React from "react";
import { Badge, type Tone } from "../ui/kit";

export interface Job {
  id: number; kind: string; title: string; year: string | null; season: number | null; episode: number | null;
  status: string; crawl_status?: string; source: string; attempts: number; error: string | null;
  created_at: string; finished_at: string | null; bot_used?: string; requested_by?: string | null;
}

export const jobStatus = (j: Job) => j.crawl_status || j.status;

export const JOB_TONE: Record<string, Tone> = {
  done: "ok", running: "warn", queued: "neutral", not_found: "neutral", needs_admin: "accent", failed: "bad",
};
export const JOB_LABEL: Record<string, string> = {
  done: "Done", running: "Running", queued: "Queued", not_found: "Not found", needs_admin: "Needs you", failed: "Failed",
};

export function JobBadge({ status }: { status: string }) {
  return (
    <Badge tone={JOB_TONE[status] || "neutral"} pulse={status === "running"} dot={status !== "running"}>
      {JOB_LABEL[status] || status}
    </Badge>
  );
}

export const jobLabel = (j: Job) =>
  j.kind === "movie" ? `${j.title}${j.year ? ` (${j.year})` : ""}`
  : j.kind === "season" ? `${j.title} · Season ${j.season}`
  : `${j.title} · S${String(j.season ?? 0).padStart(2, "0")}E${String(j.episode ?? 0).padStart(2, "0")}`;

export const SOURCE_LABEL: Record<string, string> = { user: "Viewer", admin: "Admin", cron: "Batch", web: "Storefront" };
