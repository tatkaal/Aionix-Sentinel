import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { dropBundledOrtWasm, extensionFilesPlugin } from './scripts/vite-extension-files';

// Cross-origin isolation unlocks performance.measureUserAgentSpecificMemory() for the memory governor.
// `credentialless` keeps CORS fetches to the Hugging Face Hub (Path B weights) working.
const isolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'credentialless',
};

export default defineConfig({
  plugins: [react(), tailwindcss(), extensionFilesPlugin(), dropBundledOrtWasm()],
  worker: { format: 'es', plugins: () => [dropBundledOrtWasm()] },
  publicDir: 'assets',
  server: { headers: isolationHeaders },
  preview: { headers: isolationHeaders },
  build: {
    outDir: 'dist',
    target: 'es2022',
    chunkSizeWarningLimit: 2048,
  },
  optimizeDeps: {
    exclude: ['onnxruntime-web', '@huggingface/transformers'],
  },
});
