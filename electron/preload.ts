import { contextBridge, ipcRenderer } from 'electron';
import type {
  AutocompleteHealth,
  AutocompleteRequest,
  AutocompleteResponse,
  AutocompleteRuntimeConfig,
  AutocompleteSettings,
  DatasetItem,
  SaveTextRequest,
  ScanRequest
} from '../src/types';

export interface DatasetBridge {
  getInitialFolder: () => Promise<string | null>;
  selectFolder: () => Promise<string | null>;
  scanDataset: (req: ScanRequest) => Promise<DatasetItem[]>;
  saveText: (req: SaveTextRequest) => Promise<void>;
  autocompleteSuggest: (req: AutocompleteRequest) => Promise<AutocompleteResponse>;
  autocompleteHealth: () => Promise<AutocompleteHealth>;
  autocompleteConfig: () => Promise<AutocompleteRuntimeConfig>;
  autocompleteListModels: () => Promise<string[]>;
  autocompleteGetSettings: () => Promise<AutocompleteSettings>;
  autocompleteUpdateSettings: (updates: Partial<AutocompleteSettings>) => Promise<AutocompleteSettings>;
  autocompleteResetSettings: () => Promise<AutocompleteSettings>;
}

const bridge: DatasetBridge = {
  getInitialFolder: () => ipcRenderer.invoke('app:get-initial-folder'),
  selectFolder: () => ipcRenderer.invoke('dialog:select-folder'),
  scanDataset: (req) => ipcRenderer.invoke('dataset:scan', req),
  saveText: (req) => ipcRenderer.invoke('dataset:save-text', req),
  autocompleteSuggest: (req) => ipcRenderer.invoke('autocomplete:suggest', req),
  autocompleteHealth: () => ipcRenderer.invoke('autocomplete:health'),
  autocompleteConfig: () => ipcRenderer.invoke('autocomplete:config'),
  autocompleteListModels: () => ipcRenderer.invoke('autocomplete:list-models'),
  autocompleteGetSettings: () => ipcRenderer.invoke('autocomplete:get-settings'),
  autocompleteUpdateSettings: (updates) => ipcRenderer.invoke('autocomplete:update-settings', updates),
  autocompleteResetSettings: () => ipcRenderer.invoke('autocomplete:reset-settings')
};

contextBridge.exposeInMainWorld('datasetApi', bridge);

declare global {
  interface Window {
    datasetApi: DatasetBridge;
  }
}
