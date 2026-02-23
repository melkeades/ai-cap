import { describe, expect, it } from 'vitest';
import {
  computeFittedImageRect,
  moveCropByDelta,
  normalizeRectFromDrag,
  pointToNormalizedInFittedRect,
  resizeCropByDelta
} from '../src/lib/crop';

describe('normalizeRectFromDrag', () => {
  it('normalizes inverted drag directions', () => {
    const crop = normalizeRectFromDrag(0.8, 0.7, 0.2, 0.1);
    expect(crop.x).toBeCloseTo(0.2);
    expect(crop.y).toBeCloseTo(0.1);
    expect(crop.w).toBeCloseTo(0.6);
    expect(crop.h).toBeCloseTo(0.6);
  });
});

describe('moveCropByDelta', () => {
  it('clamps moved crop inside bounds', () => {
    const moved = moveCropByDelta({ x: 0.8, y: 0.8, w: 0.2, h: 0.2 }, 0.5, 0.5);
    expect(moved.x).toBeCloseTo(0.8);
    expect(moved.y).toBeCloseTo(0.8);
  });
});

describe('resizeCropByDelta', () => {
  it('resizes from east edge', () => {
    const resized = resizeCropByDelta({ x: 0.1, y: 0.1, w: 0.2, h: 0.2 }, 'e', 0.3, 0);
    expect(resized.w).toBeCloseTo(0.5);
  });

  it('resizes from west edge and adjusts x', () => {
    const resized = resizeCropByDelta({ x: 0.3, y: 0.2, w: 0.3, h: 0.3 }, 'w', -0.2, 0);
    expect(resized.x).toBeCloseTo(0.1);
    expect(resized.w).toBeCloseTo(0.5);
  });
});

describe('fitted image mapping', () => {
  it('maps pointer to normalized coordinates for letterboxed image', () => {
    const fitted = computeFittedImageRect(400, 200, 100, 100);
    const point = pointToNormalizedInFittedRect(fitted.x + fitted.width / 2, fitted.y + fitted.height / 2, fitted);
    expect(point.x).toBeCloseTo(0.5);
    expect(point.y).toBeCloseTo(0.5);
  });
});
