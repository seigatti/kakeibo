import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// base './' 相対パスにすることで GitHub Pages のリポジトリ名に依存しない
export default defineConfig({
  base: './',
  build: {
    rollupOptions: {
      output: {
        // React と chart.js はアプリ本体と違って滅多に変わらないので別ファイルにする。
        // こうするとアプリを更新しても、再ダウンロードされるのはアプリ側のチャンクだけで済む
        // （以前は1本のバンドルだったので、毎回200KB弱をまるごと取り直していた）。
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-dom/client'],
          charts: ['chart.js', 'react-chartjs-2', 'chartjs-plugin-datalabels'],
        },
      },
    },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: '家計簿 - 資産・収支管理',
        short_name: '家計簿',
        description: '資産スナップショットと収支を記録・グラフ化する自分専用家計簿',
        lang: 'ja',
        start_url: './',
        scope: './',
        display: 'standalone',
        background_color: '#0f172a',
        theme_color: '#0f172a',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // アプリ本体はキャッシュしてオフラインでも起動できるようにする
        globPatterns: ['**/*.{js,css,html,svg,png}'],
        // GAS APIはネットワーク必須（キャッシュしない）
        navigateFallback: 'index.html',
      },
    }),
  ],
})
