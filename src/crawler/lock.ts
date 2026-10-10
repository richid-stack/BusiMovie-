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
