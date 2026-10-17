import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@librechat/client': path.resolve(__dirname, 'src/ui'),
      '~': path.resolve(__dirname, 'src'),
    },
  },
});
