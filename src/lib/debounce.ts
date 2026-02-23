export function createDebouncedPerKeySaver(
  delayMs: number,
  saver: (key: string, text: string) => Promise<void>
): {
  scheduleSave: (key: string, text: string) => void;
  cancelSave: (key: string) => void;
  flushSave: (key: string, text: string) => Promise<void>;
} {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  const cancelSave = (key: string) => {
    const timer = timers.get(key);
    if (timer) {
      clearTimeout(timer);
      timers.delete(key);
    }
  };

  const scheduleSave = (key: string, text: string) => {
    cancelSave(key);
    const timer = setTimeout(async () => {
      timers.delete(key);
      await saver(key, text);
    }, delayMs);
    timers.set(key, timer);
  };

  const flushSave = async (key: string, text: string) => {
    cancelSave(key);
    await saver(key, text);
  };

  return { scheduleSave, cancelSave, flushSave };
}
