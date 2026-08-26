import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

const apiProxy = {
  '/api': {
    target: `http://localhost:${process.env.API_PORT || 4000}`,
    changeOrigin: true,
  },
}

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      devOptions: {
        enabled: true,
      },
      manifest: {
        name: 'Futbol 7 Manager',
        short_name: 'Huevos FC',
        theme_color: '#0f6e56',
        background_color: '#0f6e56',
        display: 'standalone',
        icons: [
          {
            src: 'icon-192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'icon-512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: 'icon-512-maskable.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
    }),
  ],
  server: {
    host: true,
    allowedHosts: ['.trycloudflare.com'],
    proxy: apiProxy,
  },
  preview: { proxy: apiProxy },
})