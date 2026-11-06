/// <reference types="vitest/config" />
import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  base: '/',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  server: {
    // Same-origin through the proxy, so the session cookie works in development.
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: false,
      },
    },
  },
  build: {
    outDir: 'dist',
    rolldownOptions: {
      output: {
        // Vendor code in its own chunks: better caching, and no chunk near the size warning.
        codeSplitting: {
          groups: [
            { name: 'framework', test: /node_modules\/(react|react-dom|scheduler|react-router|@tanstack\/[^/]+)\// },
            { name: 'markdown', test: /node_modules\/(react-markdown|remark-[^/]+|micromark[^/]*|mdast-[^/]+|hast-[^/]+|unified|unist-[^/]+|vfile[^/]*)\// },
            { name: 'ui', test: /node_modules\/(radix-ui|@radix-ui\/[^/]+|@floating-ui\/[^/]+|react-remove-scroll[^/]*|aria-hidden|sonner|lucide-react|cn)\// },
            { name: 'vendor', test: /node_modules\// },
          ],
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
