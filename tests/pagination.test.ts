import { describe, expect, it } from 'vitest';
import { clampIndex, parseOneBasedJump } from '../src/lib/pagination';

describe('clampIndex', () => {
  it('clamps an index to the valid range', () => {
    expect(clampIndex(-2, 5)).toBe(0);
    expect(clampIndex(2, 5)).toBe(2);
    expect(clampIndex(12, 5)).toBe(4);
  });
});

describe('parseOneBasedJump', () => {
  it('parses one-based input and clamps to range', () => {
    expect(parseOneBasedJump('1', 5)).toBe(0);
    expect(parseOneBasedJump('3', 5)).toBe(2);
    expect(parseOneBasedJump('100', 5)).toBe(4);
    expect(parseOneBasedJump('0', 5)).toBe(0);
  });
});
