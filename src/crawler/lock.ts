/**
 * One conversation at a time per external bot, with a ceiling so a hung task can never freeze the queue.
 */
const tails = new Map<string, Promise<void>>();

export async function withBotLock<T>(botHandle: string, task: () => Promise<T>, maxHoldMs = 5 * 60_000): Promise<T> {
  const key = botHandle.toLowerCase().trim();
  const prev = tails.get(key) ?? Promise.resolve();
  let release!: () => void;
  const mine = new Promise<void>((r) => (release = r));
  const tail = prev.then(() => mine);
  tails.set(key, tail);
  await prev;
  const timer = setTimeout(release, maxHoldMs); // give the line back even if the task hangs
  try {
    return await task();
  } finally {
    clearTimeout(timer);
    release();
    if (tails.get(key) === tail) tails.delete(key);
  }
}

export class DeadlineError extends Error {
  constructor(public what: string, public ms: number) { super(`${what} took longer than ${Math.round(ms / 1000)}s and was stopped`); }
}

/**
 * Race a task against a clock. When the clock wins, `onTimeout` runs (to close connections) and the task is abandoned:
 * whatever it was waiting on is cut off, so a stalled Telegram call can never hold the queue.
 */
export async function withDeadline<T>(what: string, ms: number, task: () => Promise<T>, onTimeout?: () => void | Promise<void>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const clock = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new DeadlineError(what, ms)), ms);
  });
  const run = task();
  run.catch(() => undefined); // an abandoned task must not surface as an unhandled rejection later
  try {
    return await Promise.race([run, clock]);
  } catch (e) {
    if (e instanceof DeadlineError) { try { await onTimeout?.(); } catch { /* best effort */ } }
    throw e;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
