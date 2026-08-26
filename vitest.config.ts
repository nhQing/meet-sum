import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts']
  },
  resolve: {
    alias: {
      // Các module main process import electron; test chỉ cần bản giả tối thiểu
      electron: resolve(__dirname, 'test/stubs/electron.ts')
    }
  }
})
