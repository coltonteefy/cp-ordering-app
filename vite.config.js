import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    cors: {
      origin: [
        /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/,
        'https://freedomdiagnosticstesting.com',
        'https://koveralabs.com',
      ],
      methods: ['GET', 'POST', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
    },
    proxy: {
      '/api': 'http://localhost:3031',
    },
  },
})
