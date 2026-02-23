import { performance } from 'node:perf_hooks';
import type {
  AutocompleteHealth,
  AutocompleteRequest,
  AutocompleteResponse,
  AutocompleteRuntimeConfig,
  AutocompleteSettings
} from '../src/types';
import { DEFAULT_AUTOCOMPLETE_SETTINGS } from './autocompleteSettings';

const OLLAMA_BASE_URL = 'http://127.0.0.1:11434';
const OVERALL_TIMEOUT_FLOOR_MS = 6000;
const MAX_LEFT_CONTEXT = 200;
const MAX_RIGHT_CONTEXT = 120;
const LATENCY_WINDOW_SIZE = 60;

interface OllamaTagResponse {
  models?: Array<{ name?: string }>;
}

interface OllamaPsResponse {
  models?: Array<{ size_vram?: number }>;
}

interface OllamaChatResponse {
  message?: {
    content?: string;
  };
}

interface OllamaChatChunk {
  message?: {
    content?: string;
  };
}

interface WordContext {
  leftContext: string;
  rightContext: string;
  partialWord: string;
  rightWordRemainder: string;
  previousWord: string;
}

interface RuntimeStats {
  requestCount: number;
  timeoutCount: number;
  latencies: number[];
  lastLatencyMs?: number;
}

let runtimeSettings: AutocompleteSettings = DEFAULT_AUTOCOMPLETE_SETTINGS;
const runtimeStats: RuntimeStats = {
  requestCount: 0,
  timeoutCount: 0,
  latencies: [],
  lastLatencyMs: undefined
};

export function setAutocompleteSettings(settings: AutocompleteSettings): void {
  runtimeSettings = settings;
}

export function getAutocompleteSettings(): AutocompleteSettings {
  return runtimeSettings;
}

function pushLatency(latencyMs: number): void {
  runtimeStats.lastLatencyMs = latencyMs;
  runtimeStats.latencies.push(latencyMs);
  if (runtimeStats.latencies.length > LATENCY_WINDOW_SIZE) {
    runtimeStats.latencies.splice(0, runtimeStats.latencies.length - LATENCY_WINDOW_SIZE);
  }
}

function median(values: number[]): number | undefined {
  if (values.length === 0) {
    return undefined;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return Math.round((sorted[mid - 1] + sorted[mid]) / 2);
  }

  return sorted[mid];
}

function isWordChar(char: string): boolean {
  return /[A-Za-z'-]/.test(char);
}

function extractPreviousWord(text: string): string {
  const tokens = text.match(/[A-Za-z][A-Za-z'-]*/g) ?? [];
  return (tokens.at(-1) ?? '').toLowerCase();
}

export function extractWordContext(text: string, cursorIndex: number): WordContext {
  const safeCursor = Number.isFinite(cursorIndex) ? Math.max(0, Math.min(text.length, Math.trunc(cursorIndex))) : text.length;

  let wordStart = safeCursor;
  while (wordStart > 0 && isWordChar(text[wordStart - 1] ?? '')) {
    wordStart -= 1;
  }

  let wordEnd = safeCursor;
  while (wordEnd < text.length && isWordChar(text[wordEnd] ?? '')) {
    wordEnd += 1;
  }

  const leftContext = text.slice(Math.max(0, safeCursor - MAX_LEFT_CONTEXT), safeCursor);
  const rightContext = text.slice(safeCursor, Math.min(text.length, safeCursor + MAX_RIGHT_CONTEXT));

  return {
    leftContext,
    rightContext,
    partialWord: text.slice(wordStart, safeCursor),
    rightWordRemainder: text.slice(safeCursor, wordEnd),
    previousWord: extractPreviousWord(text.slice(0, wordStart))
  };
}

function renderPrompt(template: string, fields: { left: string; partial: string; right: string; mode: string }): string {
  return template
    .replaceAll('{{left}}', fields.left)
    .replaceAll('{{partial}}', fields.partial)
    .replaceAll('{{right}}', fields.right)
    .replaceAll('{{mode}}', fields.mode);
}

export function buildAutocompletePrompt(text: string, cursorIndex: number): string {
  const context = extractWordContext(text, cursorIndex);
  const settings = getAutocompleteSettings();

  return renderPrompt(settings.promptTemplate, {
    left: context.leftContext,
    partial: context.partialWord,
    right: settings.useSuffixContext ? context.rightContext : '',
    mode: settings.mode
  });
}

function sanitizeBase(raw: string): string {
  const normalizedEscapes = raw.replace(/\\r\\n|\\n|\\t/g, ' ');
  const withoutThinkBlocks = normalizedEscapes.replace(/<think>[\s\S]*?<\/think>/gi, ' ');
  const afterThink = withoutThinkBlocks.includes('</think>')
    ? (withoutThinkBlocks.split('</think>').at(-1) ?? withoutThinkBlocks)
    : withoutThinkBlocks.replace(/<think>/gi, ' ');
  const firstLine = afterThink.split(/\r?\n/, 1)[0] ?? '';
  const withoutControls = firstLine.replace(/[\u0000-\u001f]+/g, ' ');
  return withoutControls.replace(/\s+/g, ' ').trim();
}

export function sanitizeCompletion(raw: string): string {
  return sanitizeBase(raw).replace(/^["'`]+|["'`]+$/g, '').trim();
}

function sanitizeWordCompletion(raw: string, partialWord: string): string {
  if (!partialWord) {
    return '';
  }

  const cleaned = sanitizeCompletion(raw);
  const tokens = cleaned.match(/[A-Za-z][A-Za-z'-]*/g) ?? [];
  if (tokens.length === 0) {
    return '';
  }

  let token = '';
  const normalizedPartial = partialWord.toLowerCase();
  for (const candidate of tokens) {
    if (candidate.toLowerCase().startsWith(normalizedPartial) && candidate.length > partialWord.length) {
      token = candidate;
      break;
    }
  }

  if (!token) {
    return '';
  }

  const remainder = token.slice(partialWord.length);
  return remainder;
}

export function sanitizeAndValidateCompletion(
  raw: string,
  context: WordContext,
  mode: AutocompleteSettings['mode']
): string {
  if (mode === 'word') {
    const completion = sanitizeWordCompletion(raw, context.partialWord);
    if (!completion) {
      return '';
    }

    if (context.rightWordRemainder && completion.toLowerCase() === context.rightWordRemainder.toLowerCase()) {
      return '';
    }

    if (/[^A-Za-z'-]/.test(completion)) {
      return '';
    }

    const completedWord = `${context.partialWord}${completion}`.toLowerCase();
    if (context.previousWord && completedWord === context.previousWord) {
      return '';
    }

    return completion;
  }

  const phrase = sanitizeCompletion(raw).slice(0, 64);
  if (!phrase || phrase.length > 64) {
    return '';
  }

  return phrase;
}

function createSignal(
  firstTokenTimeoutMs: number,
  externalSignal?: AbortSignal
): {
  signal: AbortSignal;
  clear: () => void;
  markFirstTokenReceived: () => void;
  timedOut: () => boolean;
} {
  const controller = new AbortController();
  let firstTokenSeen = false;
  let firstTokenTimedOut = false;

  const overallTimeoutMs = Math.max(OVERALL_TIMEOUT_FLOOR_MS, firstTokenTimeoutMs + 5000);
  const overallTimeout = setTimeout(() => controller.abort(), overallTimeoutMs);
  const firstTokenTimeout = setTimeout(() => {
    if (!firstTokenSeen) {
      firstTokenTimedOut = true;
      controller.abort();
    }
  }, firstTokenTimeoutMs);

  externalSignal?.addEventListener(
    'abort',
    () => {
      controller.abort();
    },
    { once: true }
  );

  const clear = () => {
    clearTimeout(overallTimeout);
    clearTimeout(firstTokenTimeout);
  };

  const markFirstTokenReceived = () => {
    firstTokenSeen = true;
    clearTimeout(firstTokenTimeout);
  };

  return {
    signal: controller.signal,
    clear,
    markFirstTokenReceived,
    timedOut: () => firstTokenTimedOut
  };
}

function parseChatCompletion(content: string, context: WordContext, mode: AutocompleteSettings['mode']): string {
  const trimmed = content.trim();

  try {
    const parsed = JSON.parse(trimmed) as { completion?: string };
    return sanitizeAndValidateCompletion(parsed.completion ?? '', context, mode);
  } catch {
    return sanitizeAndValidateCompletion(trimmed, context, mode);
  }
}

function parseStreamedJsonCompletion(content: string, context: WordContext, mode: AutocompleteSettings['mode']): string {
  const parsedFromFullBody = parseChatCompletion(content, context, mode);
  if (parsedFromFullBody) {
    return parsedFromFullBody;
  }

  const match = content.match(/"completion"\s*:\s*"([^"]*)/);
  if (!match) {
    return '';
  }

  const rawCompletion = match[1].replace(/\\"/g, '"');
  return sanitizeAndValidateCompletion(rawCompletion, context, mode);
}

async function readChatStreamForCompletion(
  response: Response,
  context: WordContext,
  mode: AutocompleteSettings['mode'],
  signalState: { markFirstTokenReceived: () => void }
): Promise<string> {
  if (!response.body) {
    const body = (await response.json()) as OllamaChatResponse;
    signalState.markFirstTokenReceived();
    return parseChatCompletion(body.message?.content ?? '', context, mode);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';

  const consumeLine = (line: string): string => {
    const trimmedLine = line.trim();
    if (!trimmedLine) {
      return '';
    }

    let chunk: OllamaChatChunk;
    try {
      chunk = JSON.parse(trimmedLine) as OllamaChatChunk;
    } catch {
      return '';
    }

    signalState.markFirstTokenReceived();
    const piece = chunk.message?.content ?? '';
    if (!piece) {
      return '';
    }

    content += piece;
    return parseStreamedJsonCompletion(content, context, mode);
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });

    let newlineIndex = buffer.indexOf('\n');
    while (newlineIndex !== -1) {
      const line = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);
      const completion = consumeLine(line);
      if (completion) {
        await reader.cancel();
        return completion;
      }

      newlineIndex = buffer.indexOf('\n');
    }
  }

  const completion = consumeLine(buffer);
  if (completion) {
    return completion;
  }

  return parseStreamedJsonCompletion(content, context, mode);
}

export function getAutocompleteConfig(): AutocompleteRuntimeConfig {
  return {
    enabled: runtimeSettings.enabled,
    model: runtimeSettings.model
  };
}

function extractModelNames(body: OllamaTagResponse): string[] {
  return Array.from(
    new Set((body.models ?? []).map((entry) => entry.name).filter((name): name is string => Boolean(name)))
  ).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

export async function listAutocompleteModels(signal?: AbortSignal): Promise<string[]> {
  try {
    const response = await fetch(`${OLLAMA_BASE_URL}/api/tags`, {
      method: 'GET',
      signal
    });

    if (!response.ok) {
      return [];
    }

    const body = (await response.json()) as OllamaTagResponse;
    return extractModelNames(body);
  } catch {
    return [];
  }
}

export async function getAutocompleteHealth(signal?: AbortSignal): Promise<AutocompleteHealth> {
  const config = getAutocompleteConfig();

  if (!config.enabled) {
    return {
      ok: false,
      reason: 'Autocomplete disabled in settings',
      requestCount: runtimeStats.requestCount,
      timeoutCount: runtimeStats.timeoutCount,
      medianLatencyMs: median(runtimeStats.latencies),
      lastLatencyMs: runtimeStats.lastLatencyMs
    };
  }

  try {
    const response = await fetch(`${OLLAMA_BASE_URL}/api/tags`, {
      method: 'GET',
      signal
    });

    if (!response.ok) {
      return {
        ok: false,
        reason: `Ollama responded with HTTP ${response.status}`,
        requestCount: runtimeStats.requestCount,
        timeoutCount: runtimeStats.timeoutCount,
        medianLatencyMs: median(runtimeStats.latencies),
        lastLatencyMs: runtimeStats.lastLatencyMs
      };
    }

    const body = (await response.json()) as OllamaTagResponse;
    const availableModels = new Set(extractModelNames(body));

    if (!availableModels.has(config.model)) {
      return {
        ok: false,
        reason: `Model "${config.model}" not found. Run: ollama pull ${config.model}`,
        requestCount: runtimeStats.requestCount,
        timeoutCount: runtimeStats.timeoutCount,
        medianLatencyMs: median(runtimeStats.latencies),
        lastLatencyMs: runtimeStats.lastLatencyMs
      };
    }

    let gpuLikely: boolean | undefined;
    try {
      const psResponse = await fetch(`${OLLAMA_BASE_URL}/api/ps`, { method: 'GET', signal });
      if (psResponse.ok) {
        const psBody = (await psResponse.json()) as OllamaPsResponse;
        gpuLikely = (psBody.models ?? []).some((entry) => (entry.size_vram ?? 0) > 0);
      }
    } catch {
      gpuLikely = undefined;
    }

    return {
      ok: true,
      gpuLikely,
      requestCount: runtimeStats.requestCount,
      timeoutCount: runtimeStats.timeoutCount,
      medianLatencyMs: median(runtimeStats.latencies),
      lastLatencyMs: runtimeStats.lastLatencyMs
    };
  } catch {
    return {
      ok: false,
      reason: `Ollama unavailable at ${OLLAMA_BASE_URL}`,
      requestCount: runtimeStats.requestCount,
      timeoutCount: runtimeStats.timeoutCount,
      medianLatencyMs: median(runtimeStats.latencies),
      lastLatencyMs: runtimeStats.lastLatencyMs
    };
  }
}

export async function suggestAutocomplete(
  request: AutocompleteRequest,
  signal?: AbortSignal
): Promise<AutocompleteResponse> {
  const startedAt = performance.now();
  runtimeStats.requestCount += 1;

  if (!runtimeSettings.enabled) {
    const latencyMs = Math.round(performance.now() - startedAt);
    pushLatency(latencyMs);
    return {
      completion: '',
      model: runtimeSettings.model,
      latencyMs,
      source: 'ollama'
    };
  }

  const context = extractWordContext(request.text, request.cursorIndex);
  if (runtimeSettings.mode === 'word' && !context.partialWord) {
    const latencyMs = Math.round(performance.now() - startedAt);
    pushLatency(latencyMs);
    return {
      completion: '',
      model: runtimeSettings.model,
      latencyMs,
      source: 'ollama'
    };
  }

  const prompt = renderPrompt(runtimeSettings.promptTemplate, {
    left: context.leftContext,
    partial: context.partialWord,
    right: runtimeSettings.useSuffixContext ? context.rightContext : '',
    mode: runtimeSettings.mode
  });
  const numPredictBudget =
    runtimeSettings.mode === 'word'
      ? Math.max(12, Math.min(runtimeSettings.numPredict, 64))
      : runtimeSettings.numPredict;

  const signalState = createSignal(runtimeSettings.firstTokenTimeoutMs, signal);

  try {
    const response = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      signal: signalState.signal,
      body: JSON.stringify({
        model: runtimeSettings.model,
        stream: true,
        think: false,
        format: {
          type: 'object',
          properties: {
            completion: { type: 'string' }
          },
          required: ['completion']
        },
        messages: [
          {
            role: 'system',
            content:
              [
                'You are an autocomplete engine.',
                'Return strict JSON only: {"completion":"<single-word>"}',
                'For word mode, completion must be one full English word matching the current partial prefix.',
                'Do not explain and do not add extra keys.'
              ].join(' ')
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        options: {
          temperature: runtimeSettings.temperature,
          num_predict: numPredictBudget,
          num_ctx: runtimeSettings.numCtx,
          top_k: runtimeSettings.topK,
          top_p: runtimeSettings.topP,
          repeat_penalty: runtimeSettings.repeatPenalty,
          repeat_last_n: runtimeSettings.repeatLastN,
          presence_penalty: runtimeSettings.presencePenalty,
          frequency_penalty: runtimeSettings.frequencyPenalty
        },
        keep_alive: runtimeSettings.keepAlive
      })
    });

    if (!response.ok) {
      const latencyMs = Math.round(performance.now() - startedAt);
      pushLatency(latencyMs);
      return {
        completion: '',
        model: runtimeSettings.model,
        latencyMs,
        source: 'ollama'
      };
    }

    const completion = await readChatStreamForCompletion(response, context, runtimeSettings.mode, signalState);
    const latencyMs = Math.round(performance.now() - startedAt);
    pushLatency(latencyMs);

    return {
      completion,
      model: runtimeSettings.model,
      latencyMs,
      source: 'ollama',
      timedOut: false
    };
  } catch {
    const latencyMs = Math.round(performance.now() - startedAt);
    const timedOut = signalState.timedOut();
    if (timedOut) {
      runtimeStats.timeoutCount += 1;
    }

    pushLatency(latencyMs);

    return {
      completion: '',
      model: runtimeSettings.model,
      latencyMs,
      source: 'ollama',
      timedOut
    };
  } finally {
    signalState.clear();
  }
}
