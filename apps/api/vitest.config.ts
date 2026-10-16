import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    setupFiles: ['./tests/setup.ts'],
    // Testes de integração usam o mesmo banco: rodam um arquivo por vez
    fileParallelism: false,
  },
});
