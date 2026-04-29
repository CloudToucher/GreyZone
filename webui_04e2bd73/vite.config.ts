import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'
import { filesMiddleware } from './server/files'

// Workspace root = parent of webui/  (i.e. D:\Gray Zone)
const WORKSPACE_ROOT = fileURLToPath(new URL('..', import.meta.url))

export default defineConfig({
  plugins: [
    vue(),
    {
      name: 'gray-zone-files-api',
      configureServer(server) {
        server.middlewares.use('/api', filesMiddleware(WORKSPACE_ROOT))
      },
      configurePreviewServer(server) {
        server.middlewares.use('/api', filesMiddleware(WORKSPACE_ROOT))
      },
    },
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    strictPort: false,
    host: '127.0.0.1',
  },
})
