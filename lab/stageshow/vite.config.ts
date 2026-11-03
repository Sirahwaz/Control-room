import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const repositoryRoot = resolve(process.cwd(), '../..')

export default defineConfig({
  root: repositoryRoot,
  base: './',
  publicDir: false,
  plugins: [react()],
  build: {
    outDir: repositoryRoot,
    emptyOutDir: false,
    assetsDir: '.',
    cssCodeSplit: false,
    rollupOptions: {
      input: resolve(repositoryRoot, 'stageshow-preview.html'),
      output: {
        entryFileNames: 'stageshow-preview.js',
        chunkFileNames: 'stageshow-preview-[hash].js',
        assetFileNames: 'stageshow-preview.[ext]',
      },
    },
  },
  server: { host: '0.0.0.0', port: 4173, strictPort: true },
})
