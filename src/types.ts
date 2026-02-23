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
