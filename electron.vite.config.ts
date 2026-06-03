import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        external: ['better-sqlite3', 'sqlite-vec', 'js-tiktoken', '@tencentdb-agent-memory/tcvdb-text', '@node-rs/jieba', 'node-llama-cpp', 'ws', 'discord.js', 'telegraf'],
      },
    },
    resolve: {
      alias: {
        '@shared': resolve('src/shared'),
        '@vendor': resolve('src/vendor/tencentdb-memory'),
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    },
    plugins: [react(), tailwindcss()]
  }
})
