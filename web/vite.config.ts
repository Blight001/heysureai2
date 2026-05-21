import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

declare const process: {
  env: Record<string, string | undefined>
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [vue()],
  server: {
    host: '0.0.0.0',
    port: 5173,
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
      }
    }
  }
})
