import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import packageJson from './package.json'

export default defineConfig({
  define: {
    '__APP_VERSION__': JSON.stringify(packageJson.version)
  },
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      '/ws': {
        target: 'http://localhost:8080',
        ws: true,
        changeOrigin: true
      },
      '/version': {
        target: 'http://localhost:8080',
        changeOrigin: true
      },
      '/chat': {
        target: 'http://localhost:8080',
        changeOrigin: true
      }
    }
  }
})
