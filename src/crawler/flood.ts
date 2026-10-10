/** Telegram rate-limit handling shared by every call the crawler makes. */
export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function floodSeconds(e: any): number | undefined {
  if (typeof e?.seconds === "number") return e.seconds;
  const m = String(e?.errorMessage || e?.message || "").match(/FLOOD(?:_PREMIUM)?_WAIT_?(\d+)|A wait of (\d+) seconds/i);
  return m ? Number(m[1] || m[2]) : undefined;
}

/** Run a Telegram call; if Telegram says "wait N seconds" and N is small, wait and retry once. */
export async function tg<T>(fn: () => Promise<T>, maxWaitSec = 30): Promise<T> {
  try {
    return await fn();
  } catch (e: any) {
    const s = floodSeconds(e);
    if (s !== undefined && s <= maxWaitSec) {
      await sleep((s + 1) * 1000);
      return await fn();
    }
    throw e;
  }
}

/** Keeps a minimum gap between our outgoing actions so we never look like a flood. */
export class Pacer {
  private last = 0;
  constructor(private minGapMs = 1200) {}
  async wait() {
    const gap = Date.now() - this.last;
    if (gap < this.minGapMs) await sleep(this.minGapMs - gap);
    this.last = Date.now();
  }
}
