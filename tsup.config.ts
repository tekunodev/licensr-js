import {defineConfig} from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  // tsup <= 8.5.1 unconditionally injects a fallback `baseUrl: "."` into the
  // dts build's compiler options; TypeScript 6 deprecated `baseUrl` and
  // treats that injection as a hard error. Remove once tsup stops injecting
  // it (https://github.com/egoist/tsup/issues/1388).
  dts: {compilerOptions: {ignoreDeprecations: '6.0'}},
  sourcemap: true,
  clean: true,
  splitting: false,
  treeshake: true,
  // Node 18+ (per package.json engines) and evergreen browsers — both
  // already ship the ES2020 features we rely on (optional chaining,
  // BigInt, globalThis), so there's no need to transpile further down.
  target: 'es2020',
});
