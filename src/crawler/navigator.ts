/**
 * Navigator: walks an external bot's screens toward a file, one verified step at a time.
 *
 * Principles (each one exists because the old crawler broke on it):
 *  - Decisions are made from the screen the bot is showing NOW, never from a remembered layout.
 *  - Every click is confidence-gated; "no confident match" is an answer, "click the first one" is not.
 *  - Loops, dead ends, throttling and join-gates are detected and reported, not retried forever.
 *  - Transport (Telegram) is an interface, so the whole engine is testable with scripted bots.
 */
import { Button, Screen } from "./screen.js";
import { classifyScreen, ScreenKind, episodeNumberOf, seasonNumberOf, isEpisodeButton } from "./classify.js";
import { isBackOrNavButton, selectBestMatchingButton } from "./buttons.js";
import { verifyDownloadedFile } from "./verify.js";

export interface Observation {
  /** every screen seen during the settle window, in arrival order */
  screens: Screen[];
  /** the little pop-up the bot answered a click with (callback answer), if any */
  answer?: string;
}

export interface Transport {
  send(text: string): Promise<Observation>;
  click(screen: Screen, button: Button): Promise<Observation>;
  /** wait for `after` to be edited or for a new message to follow it */
  settle(after: Screen | null, timeoutMs: number): Promise<Observation>;
  /** join a channel/group from an invite link or @name; returns true if we are now a member */
  join(target: string): Promise<boolean>;
}

export interface Goal {
  kind: "movie" | "episode" | "season" | "seasons" | "episodes";
  title: string;
  year?: string;
  season?: number;
  episode?: number;
  quality?: string;
}

export interface AdvisorDecision {
  action: "click" | "next_page" | "give_up";
  buttonIndex?: number; // index into screen.buttons
  why: string;
}
export interface Advisor {
  decide(screen: Screen, goal: Goal, history: TraceStep[]): Promise<AdvisorDecision | null>;
}

export interface TraceStep {
  n: number;
  at: number;
  kind: ScreenKind | "START";
  why: string;
  fingerprint?: string;
  text?: string;
  buttons?: string[];
  action: string;
}

export type NavOutcome =
  | { status: "media"; media: Screen; verified: boolean; trace: TraceStep[] }
  | { status: "delivering"; screen: Screen; expected?: number; trace: TraceStep[] } // "send all" pressed; caller collects the files
  | { status: "reached"; screen: Screen; trace: TraceStep[] } // browse goals: arrived at the season/episode list
  | { status: "not_found"; reason: string; trace: TraceStep[] }
  | { status: "wrong_file"; reason: string; media: Screen; trace: TraceStep[] }
  | { status: "blocked"; reason: "rate_limit" | "gate"; waitSec?: number; detail?: string; trace: TraceStep[] }
  | { status: "failed"; reason: string; trace: TraceStep[] };

export interface NavOptions {
  command: string;
  maxSteps?: number;
  /** hard wall-clock budget for the whole walk */
  budgetMs?: number;
  settleMs?: number;
  maxPages?: number;
  maxJoins?: number;
  advisor?: Advisor;
  now?: () => number;
}

const QUALITY_ORDER = ["1080p", "720p", "4k", "2160p", "480p", "360p"];
const SEND_ALL = /\b(send\s*all|all\s*episodes?|get\s*all|download\s*all|full\s*season|whole\s*season)\b/i;
const NEXT_PAGE = /^[\W_]*(?:next|more|›|»|>>|>|➡️?|▶️?)[\W_]*(?:page)?[\W_]*$/i;

export function chooseQuality(buttons: Button[], preferred?: string): Button | null {
  const usable = buttons.filter((b) => !isBackOrNavButton(b.text) && !(b.url && !/t\.me\//i.test(b.url)) && !/\b(sample|trailer|preview|cam|hdcam|telesync)\b/i.test(b.text));
  if (!usable.length) return null;
  const order = [preferred?.toLowerCase(), ...QUALITY_ORDER].filter(Boolean) as string[];
  for (const q of order) {
    const hit = usable.find((b) => b.text.toLowerCase().includes(q));
    if (hit) return hit;
  }
  // bare size buttons ("2.1 GB"): take the first; every option is the same title
  return usable[0];
}

export function findNextPage(buttons: Button[]): Button | null {
  return buttons.find((b) => NEXT_PAGE.test(b.text.trim()) || /^(next|page_?\d+|pg_?next|nxt)/i.test(b.data ?? "")) ?? null;
}

export function findSendAll(buttons: Button[]): Button | null {
  return buttons.find((b) => /^sa_/.test(b.data ?? "") || SEND_ALL.test(b.text)) ?? null;
}

const short = (s: string, n = 300) => (s.length > n ? s.slice(0, n) + "…" : s);

export async function navigate(t: Transport, goal: Goal, opts: NavOptions): Promise<NavOutcome> {
  const now = opts.now ?? Date.now;
  const started = now();
  const maxSteps = opts.maxSteps ?? 7;
  const budgetMs = opts.budgetMs ?? 90_000;
  const settleMs = opts.settleMs ?? 8_000;
  const maxPages = opts.maxPages ?? 3;
  const maxJoins = opts.maxJoins ?? 5;
  const trace: TraceStep[] = [];
  const visited = new Set<string>();
  let n = 0, waits = 0, pages = 0, joins = 0, gateRounds = 0, advisorCalls = 0;

  const log = (kind: TraceStep["kind"], why: string, action: string, s?: Screen) =>
    trace.push({ n: ++n, at: now() - started, kind, why, action, fingerprint: s?.fingerprint, text: s ? short(s.text) : undefined, buttons: s?.buttons.map((b) => b.text).slice(0, 40) });

  const fail = (reason: string): NavOutcome => ({ status: "failed", reason, trace });
  const notFound = (reason: string): NavOutcome => ({ status: "not_found", reason, trace });

  log("START", "send search", `send: ${opts.command}`);
  let obs = await t.send(opts.command);
  let steps = 0;

  while (true) {
    if (now() - started > budgetMs) return fail("time budget exhausted");

    // 1. Media anywhere in what we saw wins.
    const media = obs.screens.find((s) => s.media);
    if (media) {
      const v = verifyDownloadedFile(
        { title: goal.title, year: goal.year, season: goal.season, episode: goal.kind === "season" ? undefined : goal.episode },
        media.media?.fileName || "",
        media.text
      );
      log("MEDIA", v.ok ? (v.verified ? "file matches request" : "file name not comparable; accepted") : v.reason || "mismatch", v.ok ? "accept file" : "reject file", media);
      if (!v.ok) return { status: "wrong_file", reason: v.reason || "file does not match", media, trace };
      return { status: "media", media, verified: v.verified, trace };
    }

    // 2. Nothing came back at all.
    if (obs.screens.length === 0) {
      if (obs.answer && /not found|no (results|files?)|unavailable/i.test(obs.answer)) { log("EMPTY", `bot popup: ${obs.answer}`, "stop"); return notFound(obs.answer); }
      if (waits++ >= 2) { log("TEXT", "bot is silent", "stop"); return fail("the bot did not reply"); }
      log("PLACEHOLDER", "no reply yet", "wait");
      obs = await t.settle(null, settleMs);
      continue;
    }

    const cur = obs.screens[obs.screens.length - 1];
    const cls = classifyScreen(cur);

    // 3. Loop protection: we've been on exactly this screen before (placeholders are allowed to repeat).
    if (cls.kind !== "PLACEHOLDER" && cls.kind !== "GATE") {
      if (visited.has(cur.fingerprint)) { log(cls.kind, "screen repeated", "stop (loop)", cur); return fail("the bot kept showing the same screen"); }
      visited.add(cur.fingerprint);
    }

    // 4. Step budget (waiting/joining do not consume steps).
    const consumesStep = !["PLACEHOLDER", "GATE", "TEXT"].includes(cls.kind);
    if (consumesStep && ++steps > maxSteps) { log(cls.kind, "too many steps", "stop", cur); return fail("too many screens without a file"); }

    const clickAndContinue = async (b: Button, why: string) => {
      log(cls.kind, `${cls.why}; ${why}`, `click "${b.text}"`, cur);
      obs = await t.click(cur, b);
    };

    switch (cls.kind) {
      case "PLACEHOLDER":
      case "TEXT": {
        if (waits++ >= 3) { log(cls.kind, cls.why, "stop (still waiting)", cur); return fail(cls.kind === "PLACEHOLDER" ? "the bot never finished searching" : "the bot offered nothing to press"); }
        log(cls.kind, cls.why, "wait for edit", cur);
        obs = await t.settle(cur, settleMs);
        continue;
      }

      case "RATE_LIMIT":
        log(cls.kind, cls.why, "stop (throttled)", cur);
        return { status: "blocked", reason: "rate_limit", waitSec: cls.waitSec, trace };

      case "EMPTY":
        log(cls.kind, cls.why, "stop (not found)", cur);
        return notFound("the bot has no results for this title");

      case "GATE": {
        if (gateRounds++ >= 2) { log(cls.kind, "still gated after joining", "stop", cur); return { status: "blocked", reason: "gate", detail: "still asking to join after we joined", trace }; }
        const links = cur.buttons.filter((b) => b.url && /t\.me\/|telegram\.(me|dog)\//i.test(b.url));
        let joined = 0;
        for (const l of links) {
          if (joins >= maxJoins) break;
          joins++;
          try { if (await t.join(l.url!)) joined++; } catch { /* reported via trace below */ }
        }
        // also @mentions in the text
        for (const m of Array.from(cur.text.matchAll(/@([A-Za-z][\w]{4,31})/g)).map((x) => "@" + x[1]).slice(0, 3)) {
          if (joins >= maxJoins) break;
          joins++;
          try { if (await t.join(m)) joined++; } catch { /* ignore */ }
        }
        const verify = cur.buttons.find((b) => !b.url && /\b(joined|done|check|verify|try again|continue)\b/i.test(b.text));
        if (joined === 0 && !verify) { log(cls.kind, "could not join the required channels", "stop (needs admin)", cur); return { status: "blocked", reason: "gate", detail: "required channels could not be joined", trace }; }
        if (verify) { log(cls.kind, `joined ${joined}`, `click "${verify.text}"`, cur); obs = await t.click(cur, verify); }
        else { log(cls.kind, `joined ${joined}`, "search again", cur); visited.clear(); obs = await t.send(opts.command); }
        continue;
      }

      case "QUALITY": {
        const b = chooseQuality(cur.buttons, goal.quality);
        if (!b) return notFound("no usable version on the bot's screen");
        await clickAndContinue(b, `quality ${goal.quality ?? "best available"}`);
        continue;
      }

      case "SEASONS": {
        if (goal.kind === "seasons") { log(cls.kind, "browse: season list reached", "stop (reached)", cur); return { status: "reached", screen: cur, trace }; }
        if (goal.season === undefined) return fail("reached a season list but no season was requested");
        const b = cur.buttons.find((x) => seasonNumberOf(x) === goal.season);
        if (!b) {
          const next = pages < maxPages ? findNextPage(cur.buttons) : null;
          if (next) { pages++; await clickAndContinue(next, "season not on this page"); continue; }
          log(cls.kind, `season ${goal.season} missing`, "stop", cur);
          return notFound(`season ${goal.season} is not offered`);
        }
        await clickAndContinue(b, `season ${goal.season}`);
        continue;
      }

      case "EPISODES": {
        if (goal.kind === "episodes") { log(cls.kind, "browse: episode list reached", "stop (reached)", cur); return { status: "reached", screen: cur, trace }; }
        if (goal.kind === "season") {
          const all = findSendAll(cur.buttons);
          if (all) {
            log(cls.kind, "season requested", `click "${all.text}" (send all)`, cur);
            await t.click(cur, all);
            const hasMore = Boolean(findNextPage(cur.buttons));
            return { status: "delivering", screen: cur, expected: hasMore ? undefined : cur.buttons.filter(isEpisodeButton).length || undefined, trace };
          }
          log(cls.kind, "no send-all button", "stop", cur);
          return notFound("the bot has no whole-season option");
        }
        if (goal.episode === undefined) return fail("reached an episode list but no episode was requested");
        const b = cur.buttons.find((x) => episodeNumberOf(x) === goal.episode);
        if (!b) {
          const next = pages < maxPages ? findNextPage(cur.buttons) : null;
          if (next) { pages++; await clickAndContinue(next, "episode not on this page"); continue; }
          log(cls.kind, `episode ${goal.episode} missing`, "stop", cur);
          return notFound(`episode ${goal.episode} is not offered`);
        }
        await clickAndContinue(b, `episode ${goal.episode}`);
        continue;
      }

      case "LIST":
      case "UNKNOWN":
      default: {
        const pick = selectBestMatchingButton(cur.buttons, goal.title, goal.year, goal.quality);
        if (pick) { await clickAndContinue(pick, "confident title match"); continue; }
        const next = pages < maxPages ? findNextPage(cur.buttons) : null;
        if (next) { pages++; await clickAndContinue(next, "no match on this page"); continue; }
        if (opts.advisor && advisorCalls++ < 2) {
          const d = await opts.advisor.decide(cur, goal, trace).catch(() => null);
          if (d?.action === "click" && d.buttonIndex !== undefined) {
            const b = cur.buttons[d.buttonIndex];
            if (b && !isBackOrNavButton(b.text) && !(b.url && !/t\.me\//i.test(b.url))) { await clickAndContinue(b, `advisor: ${d.why}`); continue; }
          }
          if (d?.action === "next_page") {
            const np = findNextPage(cur.buttons);
            if (np && pages < maxPages) { pages++; await clickAndContinue(np, `advisor: ${d.why}`); continue; }
          }
        }
        log(cls.kind, "no button matched the requested title confidently", "stop", cur);
        return notFound("no confident match for this title");
      }
    }
  }
}
