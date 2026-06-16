import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'path'

const nodeMajor = parseInt(process.versions.node.split('.')[0], 10)

export default defineConfig({
  plugins: [
    react(),
    ...(nodeMajor >= 20
      ? [
          VitePWA({
            registerType: 'autoUpdate',
            manifest: {
              name: 'Dionysus',
              short_name: 'Dionysus',
              start_url: '/',
              display: 'standalone',
              background_color: '#ffffff',
              theme_color: '#FF6B35',
              icons: [
                { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
                { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
              ],
            },
            workbox: {
              globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
              runtimeCaching: [
                {
                  urlPattern: /^ws:\/\/.*/i,
                  handler: 'NetworkOnly',
                },
              ],
            },
          }),
        ]
      : []),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: true,
    proxy: {
      '/ws': {
        target: 'ws://127.0.0.1:8765',
        ws: true,
      },
      '/api': {
        target: 'http://127.0.0.1:8765',
        changeOrigin: true,
      },
      '/personas': {
        target: 'http://127.0.0.1:8765',
        changeOrigin: true,
      },
      '/wallpapers': {
        target: 'http://127.0.0.1:8765',
        changeOrigin: true,
      },
    },
  },
})
