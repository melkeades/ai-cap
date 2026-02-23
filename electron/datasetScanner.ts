import { promises as fs } from 'node:fs';
import path from 'node:path';

export type ScanMode = 'recursive' | 'top-level';

export interface DatasetItem {
  id: string;
  baseName: string;
  dir: string;
  webpPath: string;
  webpUrl: string;
  txtPath: string;
  originalText: string;
  currentText: string;
}

export function buildDatasetImageUrl(webpPath: string): string {
  return `dataset://image?path=${encodeURIComponent(webpPath)}`;
}

interface PairCandidate {
  baseName: string;
  dir: string;
  webpPath?: string;
  txtPath?: string;
}

const collator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'base'
});

export function naturalPathSort(a: { baseName: string; dir: string }, b: { baseName: string; dir: string }): number {
  const byBaseName = collator.compare(a.baseName, b.baseName);
  if (byBaseName !== 0) {
    return byBaseName;
  }

  return collator.compare(a.dir, b.dir);
}

async function collectFiles(folder: string, recursive: boolean): Promise<string[]> {
  const entries = await fs.readdir(folder, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(folder, entry.name);

    if (entry.isDirectory()) {
      if (recursive) {
        const nested = await collectFiles(fullPath, recursive);
        files.push(...nested);
      }
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const extension = path.extname(entry.name).toLowerCase();
    if (extension === '.webp' || extension === '.txt') {
      files.push(fullPath);
    }
  }

  return files;
}

export function pairFiles(files: string[]): PairCandidate[] {
  const map = new Map<string, PairCandidate>();

  for (const filePath of files) {
    const extension = path.extname(filePath).toLowerCase();
    if (extension !== '.txt' && extension !== '.webp') {
      continue;
    }

    const dir = path.dirname(filePath);
    const baseName = path.basename(filePath, extension);
    const key = `${dir}::${baseName}`;
    const current = map.get(key) ?? { dir, baseName };

    if (extension === '.txt') {
      current.txtPath = filePath;
    }

    if (extension === '.webp') {
      current.webpPath = filePath;
    }

    map.set(key, current);
  }

  return Array.from(map.values()).filter((entry) => entry.txtPath && entry.webpPath);
}

export async function scanDatasetFolder(folder: string, mode: ScanMode): Promise<DatasetItem[]> {
  const recursive = mode === 'recursive';
  const files = await collectFiles(folder, recursive);
  const pairs = pairFiles(files).sort(naturalPathSort);

  const items = await Promise.all(
    pairs.map(async (pair) => {
      const txtPath = pair.txtPath as string;
      const webpPath = pair.webpPath as string;
      const originalText = await fs.readFile(txtPath, 'utf8');

      return {
        id: txtPath,
        baseName: pair.baseName,
        dir: pair.dir,
        webpPath,
        webpUrl: buildDatasetImageUrl(webpPath),
        txtPath,
        originalText,
        currentText: originalText
      } satisfies DatasetItem;
    })
  );

  return items;
}
