import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'
import { filesMiddleware } from './server/files'

// Workspace root = parent of webui/  (i.e. D:\Gray Zone)
const WORKSPACE_ROOT = fileURLToPath(new URL('..', import.meta.url))
const WEBUI_ROOT = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, WEBUI_ROOT, '')
  for (const [key, value] of Object.entries(env)) {
    if (process.env[key] == null) process.env[key] = value
  }

  return {
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
      port: Number(process.env.GZ_WEB_PORT || 5173),
      strictPort: false,
      host: process.env.GZ_WEB_HOST || '127.0.0.1',
    },
    preview: {
      port: Number(process.env.GZ_WEB_PORT || 5173),
      strictPort: false,
      host: process.env.GZ_WEB_HOST || '127.0.0.1',
    },
  }
})
