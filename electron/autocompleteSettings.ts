import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { AutocompleteSettings } from '../src/types';

export const DEFAULT_PROMPT_TEMPLATE = [
  'Task: complete the current English word at the cursor.',
  'Rules:',
  '- Return ONLY the full completed word (including the partial letters).',
  '- Return one word only: letters, apostrophe, or hyphen.',
  '- If no partial word exists, return empty output.',
  '- Never explain.',
  'Examples:',
  'Left context: Man went too f',
  'Current partial word: f',
  'Right context:  to go too far',
  'Completed word: far',
  'Left context: She lives in New Yo',
  'Current partial word: Yo',
  'Right context:',
  'Completed word: York',
  'Now solve this input:',
  'Left context: {{left}}',
  'Current partial word: {{partial}}',
  'Right context: {{right}}',
  'Completed word:'
].join('\n');

export const DEFAULT_AUTOCOMPLETE_SETTINGS: AutocompleteSettings = {
  enabled: true,
  model: process.env.OLLAMA_MODEL ?? 'qwen2.5:0.5b-instruct',
  temperature: 0.15,
  topP: 0.9,
  topK: 20,
  repeatPenalty: 1.05,
  repeatLastN: 96,
  presencePenalty: 0.2,
  frequencyPenalty: 0.2,
  numPredict: 24,
  numCtx: 2048,
  firstTokenTimeoutMs: 900,
  debounceMs: 90,
  keepAlive: '30m',
  promptTemplate: DEFAULT_PROMPT_TEMPLATE,
  useSuffixContext: true,
  mode: 'word'
};

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  return Math.max(min, Math.min(max, numeric));
}

function clampInteger(value: unknown, fallback: number, min: number, max: number): number {
  return Math.round(clampNumber(value, fallback, min, max));
}

function normalizeKeepAlive(value: unknown, fallback: string): string {
  if (typeof value !== 'string') {
    return fallback;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return fallback;
  }

  return trimmed;
}

function normalizeMode(value: unknown, fallback: AutocompleteSettings['mode']): AutocompleteSettings['mode'] {
  return value === 'word' || value === 'phrase' ? value : fallback;
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function normalizeString(value: unknown, fallback: string): string {
  if (typeof value !== 'string') {
    return fallback;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : fallback;
}

function normalizePromptTemplate(value: unknown, fallback: string): string {
  const normalized = normalizeString(value, fallback);
  if (normalized.includes('Return ONLY missing characters to finish the current partial word.')) {
    return fallback;
  }

  if (normalized.includes('Continuation:') && normalized.includes('Current partial word:')) {
    return fallback;
  }

  return normalized;
}

export function normalizeAutocompleteSettings(raw: Partial<AutocompleteSettings>): AutocompleteSettings {
  const defaults = DEFAULT_AUTOCOMPLETE_SETTINGS;

  return {
    enabled: normalizeBoolean(raw.enabled, defaults.enabled),
    model: normalizeString(raw.model, defaults.model),
    temperature: clampNumber(raw.temperature, defaults.temperature, 0, 2),
    topP: clampNumber(raw.topP, defaults.topP, 0, 1),
    topK: clampInteger(raw.topK, defaults.topK, 1, 200),
    repeatPenalty: clampNumber(raw.repeatPenalty, defaults.repeatPenalty, 0.5, 2),
    repeatLastN: clampInteger(raw.repeatLastN, defaults.repeatLastN, 0, 1024),
    presencePenalty: clampNumber(raw.presencePenalty, defaults.presencePenalty, -2, 2),
    frequencyPenalty: clampNumber(raw.frequencyPenalty, defaults.frequencyPenalty, -2, 2),
    numPredict: clampInteger(raw.numPredict, defaults.numPredict, 1, 128),
    numCtx: clampInteger(raw.numCtx, defaults.numCtx, 256, 8192),
    firstTokenTimeoutMs: clampInteger(raw.firstTokenTimeoutMs, defaults.firstTokenTimeoutMs, 200, 20000),
    debounceMs: clampInteger(raw.debounceMs, defaults.debounceMs, 0, 2000),
    keepAlive: normalizeKeepAlive(raw.keepAlive, defaults.keepAlive),
    promptTemplate: normalizePromptTemplate(raw.promptTemplate, defaults.promptTemplate),
    useSuffixContext: normalizeBoolean(raw.useSuffixContext, defaults.useSuffixContext),
    mode: normalizeMode(raw.mode, defaults.mode)
  };
}

export function mergeAutocompleteSettings(
  base: AutocompleteSettings,
  updates: Partial<AutocompleteSettings>
): AutocompleteSettings {
  return normalizeAutocompleteSettings({ ...base, ...updates });
}

export async function loadAutocompleteSettings(settingsPath: string): Promise<AutocompleteSettings> {
  try {
    const content = await fs.readFile(settingsPath, 'utf8');
    const parsed = JSON.parse(content) as Partial<AutocompleteSettings>;
    return normalizeAutocompleteSettings(parsed);
  } catch {
    return DEFAULT_AUTOCOMPLETE_SETTINGS;
  }
}

export async function saveAutocompleteSettings(settingsPath: string, settings: AutocompleteSettings): Promise<void> {
  await fs.mkdir(path.dirname(settingsPath), { recursive: true });
  const tempPath = `${settingsPath}.tmp`;
  const payload = `${JSON.stringify(settings, null, 2)}\n`;
  await fs.writeFile(tempPath, payload, 'utf8');
  await fs.rename(tempPath, settingsPath);
}
