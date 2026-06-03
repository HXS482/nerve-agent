import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  test: {
    // 测试环境
    environment: 'node',

    // 测试文件匹配模式
    include: ['src/**/*.{test,spec}.{js,ts}'],

    // 排除目录
    exclude: ['node_modules', 'dist', 'out'],

    // 全局设置
    globals: true,

    // 覆盖率配置
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'src/main/index.ts', // Electron 入口
        'src/preload/',
        'src/renderer/',
        '**/*.d.ts',
        '**/*.test.ts',
        '**/*.spec.ts',
      ],
    },

    // 超时设置
    testTimeout: 10_000,
    hookTimeout: 10_000,

    // Mock 配置
    mockReset: true,
    restoreMocks: true,
  },

  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
})
