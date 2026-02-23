import { promises as fs } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import type { SharpOptions } from 'sharp';
import type {
  ConvertFailure,
  ConvertImagesRequest,
  ConvertImagesResult,
  CropRectNormalized,
  ImageItem
} from '../src/types';
import { scanImageFolder } from './imageScanner';

interface PixelCropRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.max(min, Math.min(max, value));
}

export function normalizeMaxSize(value: number): number {
  const numeric = Number.isFinite(value) ? Math.trunc(value) : 1440;
  return clamp(numeric, 1, 16384);
}

export function buildOutputPath(rootFolder: string, item: ImageItem): string {
  const outputRoot = path.join(rootFolder, 'img');
  const fileName = `${item.baseName}.webp`;
  return item.relDir ? path.join(outputRoot, item.relDir, fileName) : path.join(outputRoot, fileName);
}

export function toPixelCropRect(
  normalized: CropRectNormalized,
  width: number,
  height: number
): PixelCropRect {
  const x = clamp(normalized.x, 0, 1);
  const y = clamp(normalized.y, 0, 1);
  const w = clamp(normalized.w, 0, 1);
  const h = clamp(normalized.h, 0, 1);

  const left = clamp(Math.round(x * width), 0, Math.max(0, width - 1));
  const top = clamp(Math.round(y * height), 0, Math.max(0, height - 1));

  const maxWidth = Math.max(1, width - left);
  const maxHeight = Math.max(1, height - top);

  const cropWidth = clamp(Math.round(w * width), 1, maxWidth);
  const cropHeight = clamp(Math.round(h * height), 1, maxHeight);

  return {
    left,
    top,
    width: cropWidth,
    height: cropHeight
  };
}

function sharpOptionsForItem(item: ImageItem): SharpOptions | undefined {
  if (item.ext === '.gif') {
    return {
      animated: true,
      pages: 1,
      page: 0
    };
  }

  return undefined;
}

export async function convertImagesInFolder(request: ConvertImagesRequest): Promise<ConvertImagesResult> {
  const maxSize = normalizeMaxSize(request.maxSize);
  const items = await scanImageFolder(request.folder, 'recursive');
  const outputRoot = path.join(request.folder, 'img');

  const failures: ConvertFailure[] = [];
  const warnings: string[] = [];
  const seenOutput = new Map<string, string>();

  for (const item of items) {
    const outputPath = buildOutputPath(request.folder, item);
    const existing = seenOutput.get(outputPath);
    if (existing && existing !== item.sourcePath) {
      warnings.push(`Collision: ${item.sourcePath} overwrites output from ${existing}`);
    }
    seenOutput.set(outputPath, item.sourcePath);

    try {
      const image = sharp(item.sourcePath, sharpOptionsForItem(item));
      const metadata = await image.metadata();
      const sourceWidth = metadata.width ?? 0;
      const sourceHeight = metadata.height ?? 0;

      if (sourceWidth <= 0 || sourceHeight <= 0) {
        throw new Error('Unable to read image dimensions.');
      }

      let pipeline = image;
      let width = sourceWidth;
      let height = sourceHeight;

      const crop = request.crops[item.id];
      if (crop) {
        const pixelCrop = toPixelCropRect(crop, sourceWidth, sourceHeight);
        pipeline = pipeline.extract(pixelCrop);
        width = pixelCrop.width;
        height = pixelCrop.height;
      }

      if (width > maxSize || height > maxSize) {
        pipeline = pipeline.resize({
          width: maxSize,
          height: maxSize,
          fit: 'inside',
          withoutEnlargement: true
        });
      }

      await fs.mkdir(path.dirname(outputPath), { recursive: true });
      await pipeline.webp({ lossless: true }).toFile(outputPath);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown image conversion error';
      failures.push({
        sourcePath: item.sourcePath,
        message
      });
    }
  }

  return {
    total: items.length,
    succeeded: items.length - failures.length,
    failed: failures.length,
    outputRoot,
    failures,
    warnings
  };
}




