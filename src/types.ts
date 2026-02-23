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

export interface ScanRequest {
  folder: string;
  mode: ScanMode;
}

export interface SaveTextRequest {
  txtPath: string;
  text: string;
}

export interface AutocompleteRequest {
  text: string;
  cursorIndex: number;
  language: 'en';
}

export type AutocompleteMode = 'word' | 'phrase';

export type AutocompleteSource = 'local' | 'ollama';

export interface AutocompleteResponse {
  completion: string;
  model: string;
  latencyMs: number;
  source: AutocompleteSource;
  timedOut?: boolean;
}

export interface AutocompleteHealth {
  ok: boolean;
  reason?: string;
  gpuLikely?: boolean;
  lastLatencyMs?: number;
  requestCount?: number;
  timeoutCount?: number;
  medianLatencyMs?: number;
}

export interface AutocompleteSettings {
  enabled: boolean;
  model: string;
  temperature: number;
  topP: number;
  topK: number;
  repeatPenalty: number;
  repeatLastN: number;
  presencePenalty: number;
  frequencyPenalty: number;
  numPredict: number;
  numCtx: number;
  firstTokenTimeoutMs: number;
  debounceMs: number;
  keepAlive: string;
  promptTemplate: string;
  useSuffixContext: boolean;
  mode: AutocompleteMode;
}

export interface AutocompleteRuntimeConfig {
  enabled: boolean;
  model: string;
}
