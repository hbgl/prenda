import { fileURLToPath, URL } from 'node:url';
import { resolve } from 'path';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./vue', import.meta.url)),
    },
  },
  build: {
    lib: {
      entry: resolve(__dirname, 'vue/index.js'),
      name: 'Vue',
      fileName: 'index',
      formats: ['iife'],
    },
    outDir: resolve(__dirname, 'static/vue'),
  },
  define: {
    'process.env': {},
  },
});
