import { describe, expect, it } from 'vitest';
import { insertCompletionAtCursor } from '../src/lib/autocomplete';

describe('insertCompletionAtCursor', () => {
  it('inserts completion at cursor and advances cursor index', () => {
    const result = insertCompletionAtCursor('hello wor', 9, 'ld');
    expect(result.nextText).toBe('hello world');
    expect(result.nextCursorIndex).toBe(11);
  });

  it('clamps cursor bounds', () => {
    const result = insertCompletionAtCursor('abc', 999, 'd');
    expect(result.nextText).toBe('abcd');
    expect(result.nextCursorIndex).toBe(4);
  });
});
