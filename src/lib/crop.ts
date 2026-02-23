import type { CropRectNormalized } from '../types';

const MIN_CROP_SIZE = 0.002;

export type ResizeHandle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

export interface FittedImageRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.max(min, Math.min(max, value));
}

export function clampCropRect(crop: CropRectNormalized): CropRectNormalized {
  const x = clamp(crop.x, 0, 1);
  const y = clamp(crop.y, 0, 1);
  const w = clamp(crop.w, MIN_CROP_SIZE, 1 - x);
  const h = clamp(crop.h, MIN_CROP_SIZE, 1 - y);

  return {
    x,
    y,
    w,
    h
  };
}

export function normalizeRectFromDrag(startX: number, startY: number, endX: number, endY: number): CropRectNormalized {
  const x = Math.min(startX, endX);
  const y = Math.min(startY, endY);
  const w = Math.abs(endX - startX);
  const h = Math.abs(endY - startY);

  return clampCropRect({ x, y, w, h });
}

export function moveCropByDelta(crop: CropRectNormalized, dx: number, dy: number): CropRectNormalized {
  const nextX = clamp(crop.x + dx, 0, 1 - crop.w);
  const nextY = clamp(crop.y + dy, 0, 1 - crop.h);

  return {
    x: nextX,
    y: nextY,
    w: crop.w,
    h: crop.h
  };
}

export function resizeCropByDelta(crop: CropRectNormalized, handle: ResizeHandle, dx: number, dy: number): CropRectNormalized {
  let x = crop.x;
  let y = crop.y;
  let w = crop.w;
  let h = crop.h;

  if (handle.includes('e')) {
    w = clamp(crop.w + dx, MIN_CROP_SIZE, 1 - crop.x);
  }

  if (handle.includes('s')) {
    h = clamp(crop.h + dy, MIN_CROP_SIZE, 1 - crop.y);
  }

  if (handle.includes('w')) {
    const nextX = clamp(crop.x + dx, 0, crop.x + crop.w - MIN_CROP_SIZE);
    w = clamp(crop.w - (nextX - crop.x), MIN_CROP_SIZE, 1);
    x = nextX;
  }

  if (handle.includes('n')) {
    const nextY = clamp(crop.y + dy, 0, crop.y + crop.h - MIN_CROP_SIZE);
    h = clamp(crop.h - (nextY - crop.y), MIN_CROP_SIZE, 1);
    y = nextY;
  }

  if (x + w > 1) {
    w = 1 - x;
  }

  if (y + h > 1) {
    h = 1 - y;
  }

  return clampCropRect({ x, y, w, h });
}

export function computeFittedImageRect(
  containerWidth: number,
  containerHeight: number,
  imageWidth: number,
  imageHeight: number
): FittedImageRect {
  if (containerWidth <= 0 || containerHeight <= 0 || imageWidth <= 0 || imageHeight <= 0) {
    return {
      x: 0,
      y: 0,
      width: 0,
      height: 0
    };
  }

  const scale = Math.min(containerWidth / imageWidth, containerHeight / imageHeight);
  const width = imageWidth * scale;
  const height = imageHeight * scale;

  return {
    x: (containerWidth - width) / 2,
    y: (containerHeight - height) / 2,
    width,
    height
  };
}

export function pointToNormalizedInFittedRect(
  pointX: number,
  pointY: number,
  fittedRect: FittedImageRect
): { x: number; y: number } {
  if (fittedRect.width <= 0 || fittedRect.height <= 0) {
    return { x: 0, y: 0 };
  }

  return {
    x: clamp((pointX - fittedRect.x) / fittedRect.width, 0, 1),
    y: clamp((pointY - fittedRect.y) / fittedRect.height, 0, 1)
  };
}

export function normalizedToFittedPixels(crop: CropRectNormalized, fittedRect: FittedImageRect): FittedImageRect {
  return {
    x: fittedRect.x + crop.x * fittedRect.width,
    y: fittedRect.y + crop.y * fittedRect.height,
    width: crop.w * fittedRect.width,
    height: crop.h * fittedRect.height
  };
}

export function isPointInCrop(pointX: number, pointY: number, crop: CropRectNormalized): boolean {
  return pointX >= crop.x && pointX <= crop.x + crop.w && pointY >= crop.y && pointY <= crop.y + crop.h;
}
