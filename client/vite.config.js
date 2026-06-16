import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// El dashboard llama a /api/* y Vite lo redirige al backend Express en :3001
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
})
