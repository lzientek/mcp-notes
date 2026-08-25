import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts', 'lib/**/*.ts'],
      // A ratchet, not a target: set just under what the suite covers today so
      // coverage cannot slide back. Raise them as tests are added.
      thresholds: {
        statements: 60,
        branches: 50,
        functions: 55,
        lines: 60,
      },
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
