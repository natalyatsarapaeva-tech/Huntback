import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  // GitHub Pages отдаёт проектный сайт из подпути (/huntback/), и без base
  // ссылки на /assets/... ведут в корень домена и дают 404. Локально и на
  // своём домене base остаётся '/'.
  base: process.env.VITE_BASE || '/',
  plugins: [react()],
  resolve: {
    alias: {
      // Ядро импортируется и воркером, и SPA: счётчик слов на экране и проверка
      // длины на сервере обязаны быть одной функцией (критерий приёмки 12).
      '@huntback/core': fileURLToPath(new URL('../core/src/index.ts', import.meta.url)),
    },
  },
  server: {
    // В разработке фронт и воркер живут на одном домене (§4.1) — прокси это имитирует.
    proxy: { '/api': { target: 'http://127.0.0.1:8787', changeOrigin: true } },
  },
});
