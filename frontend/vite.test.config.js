import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

// 仅供 jsdom 冒烟测试使用：打包为单文件 IIFE
export default defineConfig({
  plugins: [vue()],
  define: { 'process.env.NODE_ENV': '"production"', 'process.env': '{}' },
  build: {
    lib: { entry: 'src/main.js', name: 'GridRepairApp', formats: ['iife'] },
    outDir: '/tmp/dist-test',
    emptyOutDir: true,
  },
});
