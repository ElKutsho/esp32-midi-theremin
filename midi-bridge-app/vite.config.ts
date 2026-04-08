import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron';
import electronRenderer from 'vite-plugin-electron-renderer';

export default defineConfig(({ command }) => {
  const isElectron = process.env.ELECTRON === '1';

  return {
    plugins: [
      react(),
      ...(isElectron
        ? [
            electron([
              {
                entry: 'electron/main.ts',
                vite: {
                  build: {
                    outDir: 'dist-electron',
                    rollupOptions: {
                      // Keep native MIDI modules external — they use dynamic require() for .node binaries
                      external: ['jzz', 'jazz-midi'],
                    },
                  },
                },
              },
              {
                entry: 'electron/preload.ts',
                onstart(args) {
                  args.reload();
                },
                vite: {
                  build: {
                    outDir: 'dist-electron',
                  },
                },
              },
            ]),
            electronRenderer(),
          ]
        : []),
    ],
    build: {
      outDir: 'dist',
    },
  };
});
