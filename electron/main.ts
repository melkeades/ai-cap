import { app, BrowserWindow, dialog, ipcMain, Menu, protocol } from 'electron';
import type { MenuItemConstructorOptions, OpenDialogOptions } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
import type { AutocompleteSettings, ConvertImagesRequest, ScanImagesRequest } from '../src/types';
import {
  getAutocompleteConfig,
  getAutocompleteHealth,
  listAutocompleteModels,
  setAutocompleteSettings,
  suggestAutocomplete
} from './autocomplete';
import {
  DEFAULT_AUTOCOMPLETE_SETTINGS,
  loadAutocompleteSettings,
  mergeAutocompleteSettings,
  saveAutocompleteSettings
} from './autocompleteSettings';
import { convertImagesInFolder } from './imageConverter';
import { scanImageFolder } from './imageScanner';
import { scanDatasetFolder, type ScanMode } from './datasetScanner';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'dataset',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true
    }
  }
]);

let mainWindow: BrowserWindow | null = null;
let initialFolder: string | null = null;
let autocompleteSettingsPath: string | null = null;
let autocompleteSettings = DEFAULT_AUTOCOMPLETE_SETTINGS;
const autocompleteControllers = new Map<number, AbortController>();

function parseCandidateFolder(argv: string[]): string | null {
  const args = app.isPackaged ? argv.slice(1) : argv.slice(2);

  for (const arg of args) {
    if (!arg || arg.startsWith('-')) {
      continue;
    }

    return path.resolve(arg);
  }

  return null;
}

async function resolveInitialFolder(argv: string[]): Promise<string | null> {
  const candidate = parseCandidateFolder(argv);
  if (!candidate) {
    return null;
  }

  try {
    const stat = await fs.stat(candidate);
    return stat.isDirectory() ? candidate : null;
  } catch {
    return null;
  }
}

function getContentTypeForExtension(extension: string): string {
  switch (extension) {
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.gif':
      return 'image/gif';
    case '.webp':
      return 'image/webp';
    default:
      return 'application/octet-stream';
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 980,
    minHeight: 700,
    backgroundColor: '#121417',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: true,
      devTools: true,
      preload: path.join(__dirname, 'preload.mjs')
    }
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    mainWindow.loadURL(devServerUrl);
  } else {
    const indexHtml = path.join(app.getAppPath(), 'dist', 'index.html');
    mainWindow.loadFile(indexHtml);
  }

  mainWindow.webContents.on('before-input-event', (event, input) => {
    const key = input.key.toLowerCase();
    const isToggleShortcut = key === 'f12' || ((input.control || input.meta) && input.shift && key === 'i');

    if (input.type === 'keyDown' && isToggleShortcut) {
      event.preventDefault();
      mainWindow?.webContents.toggleDevTools();
    }
  });

  mainWindow.webContents.on('context-menu', (_event, params) => {
    const template: MenuItemConstructorOptions[] = [];
    const hasSuggestions = params.misspelledWord && params.dictionarySuggestions.length > 0;

    if (hasSuggestions) {
      for (const suggestion of params.dictionarySuggestions.slice(0, 8)) {
        template.push({
          label: suggestion,
          click: () => {
            mainWindow?.webContents.replaceMisspelling(suggestion);
          }
        });
      }
    } else if (params.misspelledWord) {
      template.push({
        label: 'No spelling suggestions',
        enabled: false
      });
    }

    if (params.misspelledWord) {
      template.push({
        label: 'Add to Dictionary',
        click: () => {
          mainWindow?.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord);
        }
      });
      template.push({ type: 'separator' });
    }

    if (params.isEditable) {
      template.push(
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      );
    } else {
      template.push({ role: 'copy' }, { role: 'selectAll' });
    }

    if (template.length === 0) {
      return;
    }

    const menu = Menu.buildFromTemplate(template);
    menu.popup({ window: mainWindow ?? undefined });
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function registerIpcHandlers(): void {
  ipcMain.handle('app:get-initial-folder', () => initialFolder);

  ipcMain.handle('dialog:select-folder', async () => {
    const window = BrowserWindow.getFocusedWindow() ?? mainWindow;
    const options: OpenDialogOptions = {
      title: 'Select dataset folder',
      properties: ['openDirectory', 'dontAddToRecent']
    };

    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options);

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    return result.filePaths[0];
  });

  ipcMain.handle('dataset:scan', async (_event, req: { folder: string; mode: ScanMode }) => {
    if (!req?.folder) {
      throw new Error('No folder provided for scan.');
    }

    return scanDatasetFolder(req.folder, req.mode);
  });

  ipcMain.handle('dataset:save-text', async (_event, req: { txtPath: string; text: string }) => {
    if (!req?.txtPath) {
      throw new Error('No target text path provided for save.');
    }

    await fs.writeFile(req.txtPath, req.text ?? '', 'utf8');
  });

  ipcMain.handle('images:scan', async (_event, req: ScanImagesRequest) => {
    if (!req?.folder) {
      throw new Error('No folder provided for image scan.');
    }

    return scanImageFolder(req.folder, req.mode ?? 'recursive');
  });

  ipcMain.handle('images:convert', async (_event, req: ConvertImagesRequest) => {
    if (!req?.folder) {
      throw new Error('No folder provided for image conversion.');
    }

    return convertImagesInFolder(req);
  });

  ipcMain.handle('autocomplete:config', () => {
    return getAutocompleteConfig();
  });

  ipcMain.handle('autocomplete:get-settings', () => {
    return autocompleteSettings;
  });

  ipcMain.handle('autocomplete:update-settings', async (_event, updates: Partial<AutocompleteSettings>) => {
    autocompleteSettings = mergeAutocompleteSettings(autocompleteSettings, updates);
    setAutocompleteSettings(autocompleteSettings);

    if (autocompleteSettingsPath) {
      await saveAutocompleteSettings(autocompleteSettingsPath, autocompleteSettings);
    }

    return autocompleteSettings;
  });

  ipcMain.handle('autocomplete:reset-settings', async () => {
    autocompleteSettings = DEFAULT_AUTOCOMPLETE_SETTINGS;
    setAutocompleteSettings(autocompleteSettings);

    if (autocompleteSettingsPath) {
      await saveAutocompleteSettings(autocompleteSettingsPath, autocompleteSettings);
    }

    return autocompleteSettings;
  });

  ipcMain.handle('autocomplete:health', async () => {
    return getAutocompleteHealth();
  });

  ipcMain.handle('autocomplete:list-models', async () => {
    return listAutocompleteModels();
  });

  ipcMain.handle(
    'autocomplete:suggest',
    async (
      event,
      req: {
        text: string;
        cursorIndex: number;
        language: 'en';
        maxTokens?: number;
      }
    ) => {
      const senderId = event.sender.id;
      const previous = autocompleteControllers.get(senderId);
      previous?.abort();

      const controller = new AbortController();
      autocompleteControllers.set(senderId, controller);

      try {
        return await suggestAutocomplete(req, controller.signal);
      } finally {
        if (autocompleteControllers.get(senderId) === controller) {
          autocompleteControllers.delete(senderId);
        }
      }
    }
  );
}

app.whenReady().then(async () => {
  protocol.handle('dataset', async (request) => {
    try {
      const requestUrl = new URL(request.url);
      const decodedPath = requestUrl.searchParams.get('path') ?? '';
      const firstFrame = requestUrl.searchParams.get('firstFrame') === '1';

      if (!path.isAbsolute(decodedPath)) {
        return new Response('Invalid dataset path', { status: 400 });
      }

      const extension = path.extname(decodedPath).toLowerCase();
      if (firstFrame && extension === '.gif') {
        const firstFrameBuffer = await sharp(decodedPath, {
          animated: true,
          pages: 1,
          page: 0
        })
          .png()
          .toBuffer();

        return new Response(new Uint8Array(firstFrameBuffer), {
          status: 200,
          headers: {
            'content-type': 'image/png',
            'cache-control': 'no-cache'
          }
        });
      }

      const buffer = await fs.readFile(decodedPath);
      const contentType = getContentTypeForExtension(extension);

      return new Response(new Uint8Array(buffer), {
        status: 200,
        headers: {
          'content-type': contentType,
          'cache-control': 'no-cache'
        }
      });
    } catch {
      return new Response('Unable to read dataset image', { status: 400 });
    }
  });

  autocompleteSettingsPath = path.join(app.getPath('userData'), 'autocomplete-settings.json');
  autocompleteSettings = await loadAutocompleteSettings(autocompleteSettingsPath);
  setAutocompleteSettings(autocompleteSettings);

  initialFolder = await resolveInitialFolder(process.argv);
  registerIpcHandlers();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});




