export type ScanMode = 'recursive' | 'top-level';
export type AppFlow = 'dataset-editor' | 'image-convert';

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

export type ImageScanMode = 'recursive';

export interface ImageItem {
  id: string;
  sourcePath: string;
  sourceUrl: string;
  relDir: string;
  baseName: string;
  ext: string;
}

export interface CropRectNormalized {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ScanImagesRequest {
  folder: string;
  mode: ImageScanMode;
}

export interface ConvertImagesRequest {
  folder: string;
  maxSize: number;
  crops: Record<string, CropRectNormalized | null>;
}

export interface ConvertFailure {
  sourcePath: string;
  message: string;
}

export interface ConvertImagesResult {
  total: number;
  succeeded: number;
  failed: number;
  outputRoot: string;
  failures: ConvertFailure[];
  warnings: string[];
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
