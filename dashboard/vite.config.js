import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: true, // Listens on all addresses (0.0.0.0) inside the Docker container
    port: 5173,
    proxy: {
      '/api': {
        // Point this to your API gateway container name and port in docker-compose
        target: 'http://api-gateway:8080',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
})