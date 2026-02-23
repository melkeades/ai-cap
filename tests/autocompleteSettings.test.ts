import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  DEFAULT_AUTOCOMPLETE_SETTINGS,
  loadAutocompleteSettings,
  mergeAutocompleteSettings,
  saveAutocompleteSettings
} from '../electron/autocompleteSettings';

const tempRoots: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dataset-editor-settings-test-'));
  tempRoots.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((entry) => rm(entry, { recursive: true, force: true })));
});

describe('mergeAutocompleteSettings', () => {
  it('clamps invalid numeric ranges', () => {
    const merged = mergeAutocompleteSettings(DEFAULT_AUTOCOMPLETE_SETTINGS, {
      topP: 99,
      numCtx: -10,
      debounceMs: -1,
      repeatLastN: 99999,
      presencePenalty: -99,
      frequencyPenalty: 99
    });

    expect(merged.topP).toBe(1);
    expect(merged.numCtx).toBe(256);
    expect(merged.debounceMs).toBe(0);
    expect(merged.repeatLastN).toBe(1024);
    expect(merged.presencePenalty).toBe(-2);
    expect(merged.frequencyPenalty).toBe(2);
  });

  it('migrates legacy prompt template to defaults', () => {
    const merged = mergeAutocompleteSettings(DEFAULT_AUTOCOMPLETE_SETTINGS, {
      promptTemplate: [
        'Task: autocomplete only the current word.',
        'Rules:',
        '- Return ONLY missing characters to finish the current partial word.',
        'Current partial word: {{partial}}',
        'Continuation:'
      ].join('\n')
    });

    expect(merged.promptTemplate).toBe(DEFAULT_AUTOCOMPLETE_SETTINGS.promptTemplate);
  });
});

describe('load/saveAutocompleteSettings', () => {
  it('persists settings payload', async () => {
    const root = await makeTempDir();
    const settingsPath = path.join(root, 'autocomplete-settings.json');
    const payload = mergeAutocompleteSettings(DEFAULT_AUTOCOMPLETE_SETTINGS, {
      model: 'qwen3:4b',
      temperature: 0.2
    });

    await saveAutocompleteSettings(settingsPath, payload);

    const content = await readFile(settingsPath, 'utf8');
    expect(content).toContain('qwen3:4b');

    const loaded = await loadAutocompleteSettings(settingsPath);
    expect(loaded.model).toBe('qwen3:4b');
    expect(loaded.temperature).toBe(0.2);
  });
});
