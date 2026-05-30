import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'

declare const process: {
  env: Record<string, string | undefined>
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 58150,
    proxy: {
      '/api': {
        target: process.env.SERVER_URL || 'http://localhost:3000',
        changeOrigin: true
      },
      '/socket.io': {
        target: process.env.SERVER_URL || 'http://localhost:3000',
        ws: true,
        changeOrigin: true
      },
      '/uploads': {
        target: process.env.SERVER_URL || 'http://localhost:3000',
        changeOrigin: true
      },
      '/avatars': {
        target: process.env.SERVER_URL || 'http://localhost:3000',
        changeOrigin: true
      }
    }
  }
})
