import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// GitHub Pages 项目页部署在子路径下（/<仓库名>/）。
// CI 通过 VITE_BASE 注入实际仓库名；本地 dev/preview 默认根路径。
const base = process.env.VITE_BASE ?? '/';

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: '多模型辩论',
        short_name: '多模型辩论',
        description: '多个大模型作为平等专家多轮辩论、互相参考并收敛，汇总最佳答案。',
        theme_color: '#1677ff',
        background_color: '#f0f2f5',
        display: 'standalone',
        lang: 'zh-CN',
        icons: [
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
        ],
      },
      workbox: {
        navigateFallback: `${base}index.html`,
        globPatterns: ['**/*.{js,css,html,svg,woff2}'],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  server: {
    port: 5173,
  },
});
