import {defineConfig} from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    testTimeout: 15000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      // `all: true` + explicit `include` so untouched files (e.g. a type-only
      // module no test imports) still count against the floor below, instead
      // of v8 silently reporting on only the files a test happened to import.
      all: true,
      include: ['src/**'],
      exclude: ['test/**', 'tsup.config.ts', 'vitest.config.ts', 'eslint.config.js', 'dist/**'],
      // Floor, not a goal — raise as the SDK surface grows. Mirrors the
      // pattern established by frontend/vite.config.ts.
      thresholds: {
        lines: 80,
        functions: 80,
        statements: 80,
      },
    },
  },
});
