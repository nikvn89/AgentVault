import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // Same-origin RPC in development, mirroring the vercel.json rewrite used
      // in production. Studio answers a rate-limited request without CORS
      // headers, so a direct cross-origin call surfaces in the browser as an
      // opaque "Failed to fetch" instead of the 429 it actually is.
      '/api/rpc': {
        target: 'https://studio.genlayer.com/api',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/rpc/, ''),
      },
    },
  },
})
