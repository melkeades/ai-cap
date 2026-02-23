import { describe, expect, it } from 'vitest';
import { access, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { buildOutputPath, convertImagesInFolder, toPixelCropRect } from '../electron/imageConverter';
import type { ImageItem } from '../src/types';

async function makeTempDir(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), 'dataset-image-convert-test-'));
}

async function createPng(filePath: string, width: number, height: number): Promise<void> {
  const buffer = await sharp({
    create: {
      width,
      height,
      channels: 4,
      background: '#22aa44'
    }
  })
    .png()
    .toBuffer();

  await writeFile(filePath, buffer);
}

describe('toPixelCropRect', () => {
  it('converts normalized crop to valid pixel rectangle', () => {
    const rect = toPixelCropRect({ x: 0.1, y: 0.2, w: 0.5, h: 0.4 }, 1000, 500);
    expect(rect.left).toBe(100);
    expect(rect.top).toBe(100);
    expect(rect.width).toBe(500);
    expect(rect.height).toBe(200);
  });
});

describe('buildOutputPath', () => {
  it('preserves relative directories under img output root', () => {
    const item: ImageItem = {
      id: '/tmp/src/a.png',
      sourcePath: '/tmp/src/a.png',
      sourceUrl: 'dataset://image?path=a',
      relDir: 'nested/sub',
      baseName: 'a',
      ext: '.png'
    };

    const output = buildOutputPath('/tmp/root', item);
    expect(output.endsWith(path.join('img', 'nested', 'sub', 'a.webp'))).toBe(true);
  });
});

describe('convertImagesInFolder', () => {
  it('converts and downsizes images when dimensions exceed max size', async () => {
    const root = await makeTempDir();
    const filePath = path.join(root, 'big.png');
    await createPng(filePath, 2000, 1000);

    const result = await convertImagesInFolder({
      folder: root,
      maxSize: 500,
      crops: {}
    });

    expect(result.failed).toBe(0);

    const outputPath = path.join(root, 'img', 'big.webp');
    await access(outputPath);

    const metadata = await sharp(outputPath).metadata();
    expect(metadata.width).toBe(500);
    expect(metadata.height).toBe(250);
  });

  it('applies crop before resize', async () => {
    const root = await makeTempDir();
    const filePath = path.join(root, 'cropme.png');
    await createPng(filePath, 1200, 1200);

    const result = await convertImagesInFolder({
      folder: root,
      maxSize: 400,
      crops: {
        [filePath]: { x: 0, y: 0, w: 0.5, h: 0.5 }
      }
    });

    expect(result.failed).toBe(0);

    const outputPath = path.join(root, 'img', 'cropme.webp');
    const metadata = await sharp(outputPath).metadata();
    expect(metadata.width).toBe(400);
    expect(metadata.height).toBe(400);
  });

  it('continues when one file fails and returns failure summary', async () => {
    const root = await makeTempDir();
    await createPng(path.join(root, 'ok.png'), 300, 300);
    await writeFile(path.join(root, 'broken.png'), 'not-an-image', 'utf8');

    const result = await convertImagesInFolder({
      folder: root,
      maxSize: 500,
      crops: {}
    });

    expect(result.total).toBe(2);
    expect(result.succeeded).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.failures[0]?.sourcePath.endsWith('broken.png')).toBe(true);
  });

  it('converts gif first frame to static webp output', async () => {
    const root = await makeTempDir();
    const gifPath = path.join(root, 'tiny.gif');
    const tinyGifBase64 = 'R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
    await writeFile(gifPath, Buffer.from(tinyGifBase64, 'base64'));

    const result = await convertImagesInFolder({
      folder: root,
      maxSize: 100,
      crops: {}
    });

    expect(result.failed).toBe(0);

    const outputPath = path.join(root, 'img', 'tiny.webp');
    const output = await readFile(outputPath);
    expect(output.byteLength).toBeGreaterThan(0);
  });

  it('reports collisions when different sources map to same output path', async () => {
    const root = await makeTempDir();
    await createPng(path.join(root, 'same.png'), 100, 100);
    await createPng(path.join(root, 'same.jpg'), 100, 100);

    const result = await convertImagesInFolder({
      folder: root,
      maxSize: 200,
      crops: {}
    });

    expect(result.warnings.length).toBeGreaterThanOrEqual(1);
  });
});



