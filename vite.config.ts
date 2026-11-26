import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { rmSync } from 'node:fs'
import { resolve } from 'node:path'

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'exclude-local-account-uploads',
      apply: 'build',
      closeBundle() {
        rmSync(resolve(process.cwd(), 'dist', 'avatars'), { recursive: true, force: true })
      },
    },
  ],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:3001',
    },
  },
})
