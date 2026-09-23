import { defineConfig } from 'vite';

export default defineConfig({
  root: 'src/client',
  // 相対パスにしておくと GitHub Pages（/margin/）でも LAN サーバー（/）でも同じビルドが動く
  base: './',
  build: {
    outDir: '../../dist',
    emptyOutDir: true,
  },
  server: {
    host: true,
  },
});
