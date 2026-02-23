import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { ImageItem, ImageScanMode } from '../src/types';

const collator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'base'
});

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);

export function isSupportedImageExtension(extension: string): boolean {
  return IMAGE_EXTENSIONS.has(extension.toLowerCase());
}

export function buildDatasetSourceUrl(sourcePath: string, firstFrame = false): string {
  const base = `dataset://image?path=${encodeURIComponent(sourcePath)}`;
  return firstFrame ? `${base}&firstFrame=1` : base;
}

export function naturalImageSort(a: ImageItem, b: ImageItem): number {
  const byDir = collator.compare(a.relDir, b.relDir);
  if (byDir !== 0) {
    return byDir;
  }

  const byName = collator.compare(a.baseName, b.baseName);
  if (byName !== 0) {
    return byName;
  }

  return collator.compare(a.ext, b.ext);
}

async function collectImageFilesRecursive(root: string, directory: string): Promise<string[]> {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      // Skip conversion output directory to avoid recursive self-processing.
      if (entry.name.toLowerCase() === 'img' && path.resolve(fullPath).startsWith(path.resolve(root))) {
        continue;
      }

      const nested = await collectImageFilesRecursive(root, fullPath);
      files.push(...nested);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    if (isSupportedImageExtension(path.extname(entry.name))) {
      files.push(fullPath);
    }
  }

  return files;
}

export async function listImageFiles(folder: string, _mode: ImageScanMode): Promise<string[]> {
  return collectImageFilesRecursive(folder, folder);
}

export async function scanImageFolder(folder: string, mode: ImageScanMode): Promise<ImageItem[]> {
  const files = await listImageFiles(folder, mode);

  const items = files.map((sourcePath) => {
    const ext = path.extname(sourcePath).toLowerCase();
    const relPath = path.relative(folder, sourcePath);
    const relDirRaw = path.dirname(relPath);
    const relDir = relDirRaw === '.' ? '' : relDirRaw;
    const baseName = path.basename(sourcePath, ext);

    return {
      id: sourcePath,
      sourcePath,
      sourceUrl: buildDatasetSourceUrl(sourcePath, ext === '.gif'),
      relDir,
      baseName,
      ext
    } satisfies ImageItem;
  });

  items.sort(naturalImageSort);
  return items;
}
