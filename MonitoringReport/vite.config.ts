import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
        proxy: {
          // In local dev, forward /api/* calls to Express server on port 8080
          '/api': {
            target: 'http://localhost:8080',
            changeOrigin: true,
          },
        },
      },
      build: {
        target: 'es2022',
        outDir: 'dist',
        modulePreload: {
          polyfill: false
        }
      },
      optimizeDeps: {
        esbuildOptions: {
          target: 'es2022'
        }
      },
      plugins: [react(), tailwindcss()],
      resolve: {
        alias: {
          '@': path.resolve(__dirname, './src'),
        }
      }
    };
});
