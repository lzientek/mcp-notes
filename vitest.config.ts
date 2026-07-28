import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts', 'lib/**/*.ts'],
    },
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          environment: 'node',
          include: [
            'tests/cdk/**/*.test.ts',
            'tests/unit/lambda/**/*.test.ts',
            'tests/unit/frontend/services/**/*.test.ts',
            'tests/unit/frontend/validators/**/*.test.ts',
          ],
        },
      },
      {
        extends: true,
        test: {
          name: 'jsdom',
          environment: 'jsdom',
          setupFiles: ['./tests/setup-jsdom.ts'],
          include: [
            'tests/unit/frontend/components/**/*.test.tsx',
            'tests/unit/frontend/hooks/**/*.test.ts',
          ],
        },
      },
    ],
  },
});
