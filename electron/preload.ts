import { contextBridge, ipcRenderer } from 'electron';
import type { DatasetItem, SaveTextRequest, ScanRequest } from '../src/types';

export interface DatasetBridge {
  getInitialFolder: () => Promise<string | null>;
  selectFolder: () => Promise<string | null>;
  scanDataset: (req: ScanRequest) => Promise<DatasetItem[]>;
  saveText: (req: SaveTextRequest) => Promise<void>;
}

const bridge: DatasetBridge = {
  getInitialFolder: () => ipcRenderer.invoke('app:get-initial-folder'),
  selectFolder: () => ipcRenderer.invoke('dialog:select-folder'),
  scanDataset: (req) => ipcRenderer.invoke('dataset:scan', req),
  saveText: (req) => ipcRenderer.invoke('dataset:save-text', req)
};

contextBridge.exposeInMainWorld('datasetApi', bridge);

declare global {
  interface Window {
    datasetApi: DatasetBridge;
  }
}
