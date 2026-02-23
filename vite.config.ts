import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron/simple';

const ELECTRON_MAIN_EXTERNALS = ['sharp', '@img/sharp-win32-x64', '@img/sharp-wasm32'];

export default defineConfig({
  plugins: [
    react(),
    electron({
      main: {
        entry: 'electron/main.ts',
        vite: {
          build: {
            rollupOptions: {
              external: ELECTRON_MAIN_EXTERNALS
            }
          }
        }
      },
      preload: {
        input: 'electron/preload.ts'
      }
    })
  ]
});
