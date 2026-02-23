import { app, BrowserWindow, dialog, ipcMain, protocol } from 'electron';
import type { OpenDialogOptions } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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
}

app.whenReady().then(async () => {
  protocol.handle('dataset', async (request) => {
    try {
      const requestUrl = new URL(request.url);
      const decodedPath = requestUrl.searchParams.get('path') ?? '';

      if (!path.isAbsolute(decodedPath)) {
        return new Response('Invalid dataset path', { status: 400 });
      }

      const buffer = await fs.readFile(decodedPath);
      const extension = path.extname(decodedPath).toLowerCase();
      const contentType = extension === '.webp' ? 'image/webp' : 'application/octet-stream';

      return new Response(buffer, {
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
