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
  build: {
    rollupOptions: {
      input: {
        // 主控制台
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        // Agent 进化与实战区域（游戏世界，独立入口，经 iframe 嵌入或直开 /game/）
        game: fileURLToPath(new URL('./game/index.html', import.meta.url)),
      },
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
      },
      '/tmp-images': {
        target: process.env.SERVER_URL || 'http://localhost:3000',
        changeOrigin: true
      }
    }
  }
})
