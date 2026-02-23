import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildDatasetImageUrl, pairFiles, scanDatasetFolder } from '../electron/datasetScanner';

const tempRoots: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dataset-editor-test-'));
  tempRoots.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((entry) => rm(entry, { recursive: true, force: true })));
});

describe('pairFiles', () => {
  it('keeps only entries with both txt and webp in the same directory', () => {
    const pairs = pairFiles([
      '/a/item1.txt',
      '/a/item1.webp',
      '/a/item2.txt',
      '/a/item3.webp',
      '/b/item1.txt',
      '/b/item1.webp'
    ]);

    expect(pairs).toHaveLength(2);
    expect(pairs.map((entry) => `${entry.dir}/${entry.baseName}`)).toEqual(['/a/item1', '/b/item1']);
  });
});

describe('buildDatasetImageUrl', () => {
  it('encodes absolute paths for the dataset protocol', () => {
    const value = buildDatasetImageUrl('/tmp/path with spaces/image.webp');
    expect(value).toBe('dataset://image?path=%2Ftmp%2Fpath%20with%20spaces%2Fimage.webp');
  });
});

describe('scanDatasetFolder', () => {
  it('supports top-level scan mode', async () => {
    const root = await makeTempDir();
    const nested = path.join(root, 'nested');
    await mkdir(nested);

    await writeFile(path.join(root, 'one.txt'), 'first', 'utf8');
    await writeFile(path.join(root, 'one.webp'), 'binary', 'utf8');
    await writeFile(path.join(nested, 'two.txt'), 'second', 'utf8');
    await writeFile(path.join(nested, 'two.webp'), 'binary', 'utf8');

    const items = await scanDatasetFolder(root, 'top-level');
    expect(items).toHaveLength(1);
    expect(items[0]?.baseName).toBe('one');
  });

  it('supports recursive scan mode', async () => {
    const root = await makeTempDir();
    const nested = path.join(root, 'nested');
    await mkdir(nested);

    await writeFile(path.join(root, 'one.txt'), 'first', 'utf8');
    await writeFile(path.join(root, 'one.webp'), 'binary', 'utf8');
    await writeFile(path.join(nested, 'two.txt'), 'second', 'utf8');
    await writeFile(path.join(nested, 'two.webp'), 'binary', 'utf8');

    const items = await scanDatasetFolder(root, 'recursive');
    expect(items).toHaveLength(2);
    expect(items.map((item) => item.baseName)).toEqual(['one', 'two']);
  });

  it('applies natural filename sorting', async () => {
    const root = await makeTempDir();

    await writeFile(path.join(root, 'item2.txt'), '2', 'utf8');
    await writeFile(path.join(root, 'item2.webp'), 'binary', 'utf8');
    await writeFile(path.join(root, 'item10.txt'), '10', 'utf8');
    await writeFile(path.join(root, 'item10.webp'), 'binary', 'utf8');
    await writeFile(path.join(root, 'item1.txt'), '1', 'utf8');
    await writeFile(path.join(root, 'item1.webp'), 'binary', 'utf8');

    const items = await scanDatasetFolder(root, 'top-level');
    expect(items.map((entry) => entry.baseName)).toEqual(['item1', 'item2', 'item10']);
  });
});
