import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDebouncedPerKeySaver } from '../src/lib/debounce';

describe('createDebouncedPerKeySaver', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('saves once after burst updates for same key', async () => {
    const saver = vi.fn(async () => undefined);
    const controller = createDebouncedPerKeySaver(250, saver);

    controller.scheduleSave('a', 'hello');
    controller.scheduleSave('a', 'hello world');
    controller.scheduleSave('a', 'final');

    expect(saver).toHaveBeenCalledTimes(0);
    await vi.advanceTimersByTimeAsync(260);
    expect(saver).toHaveBeenCalledTimes(1);
    expect(saver).toHaveBeenCalledWith('a', 'final');
  });

  it('flushes immediately and cancels pending debounce', async () => {
    const saver = vi.fn(async () => undefined);
    const controller = createDebouncedPerKeySaver(250, saver);

    controller.scheduleSave('a', 'pending');
    await controller.flushSave('a', 'restored');
    await vi.advanceTimersByTimeAsync(260);

    expect(saver).toHaveBeenCalledTimes(1);
    expect(saver).toHaveBeenCalledWith('a', 'restored');
  });
});
