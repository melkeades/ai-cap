import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildDatasetSourceUrl, scanImageFolder } from '../electron/imageScanner';

const tempRoots: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dataset-image-scan-test-'));
  tempRoots.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((entry) => rm(entry, { recursive: true, force: true })));
});

describe('buildDatasetSourceUrl', () => {
  it('supports first-frame query flag', () => {
    const url = buildDatasetSourceUrl('/tmp/demo.gif', true);
    expect(url).toContain('firstFrame=1');
  });
});

describe('scanImageFolder', () => {
  it('scans recursively and keeps only supported extensions', async () => {
    const root = await makeTempDir();
    const nested = path.join(root, 'nested');
    await mkdir(nested);

    await writeFile(path.join(root, 'a.png'), 'x', 'utf8');
    await writeFile(path.join(root, 'b.webp'), 'x', 'utf8');
    await writeFile(path.join(root, 'c.txt'), 'x', 'utf8');
    await writeFile(path.join(nested, 'd.jpg'), 'x', 'utf8');

    const items = await scanImageFolder(root, 'recursive');
    expect(items.map((item) => item.ext)).toEqual(['.png', '.webp', '.jpg']);
  });

  it('skips img output directory during scan', async () => {
    const root = await makeTempDir();
    const outputDir = path.join(root, 'img');
    await mkdir(outputDir);

    await writeFile(path.join(root, 'a.png'), 'x', 'utf8');
    await writeFile(path.join(outputDir, 'b.png'), 'x', 'utf8');

    const items = await scanImageFolder(root, 'recursive');
    expect(items).toHaveLength(1);
    expect(items[0]?.baseName).toBe('a');
  });

  it('sorts naturally by directory and basename', async () => {
    const root = await makeTempDir();

    await writeFile(path.join(root, 'img10.png'), 'x', 'utf8');
    await writeFile(path.join(root, 'img2.png'), 'x', 'utf8');
    await writeFile(path.join(root, 'img1.png'), 'x', 'utf8');

    const items = await scanImageFolder(root, 'recursive');
    expect(items.map((item) => item.baseName)).toEqual(['img1', 'img2', 'img10']);
  });
});
