import { defineConfig } from 'vite';
import react, { reactCompilerPreset } from '@vitejs/plugin-react';
import babel from '@rolldown/plugin-babel';
import tailwindcss from '@tailwindcss/vite';
import { URL, fileURLToPath } from 'node:url';

export default defineConfig(({ command }) => ({
  base: './',
  define: { __DEV__: command === 'serve' },
  clearScreen: false,
  build: {
    // 单页应用无路由级 code-split 收益。
    chunkSizeWarningLimit: 1024,
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('src', import.meta.url)),
    },
  },
  plugins: [tailwindcss(), react(), babel({ presets: [reactCompilerPreset()] })],
}));
