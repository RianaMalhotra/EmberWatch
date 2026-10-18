import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Proxy API requests through Vite, including GitHub Codespaces previews.
// This avoids browser CORS and forwarded-port authentication redirects.
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:5000',
        changeOrigin: true,
      },
    },
  },
})
