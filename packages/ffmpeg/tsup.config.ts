import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { index: 'src/index.ts', worker: 'src/worker.ts' },
  format: ['esm'],
  dts: { entry: { index: 'src/index.ts' } },
  sourcemap: true,
  clean: true,
  platform: 'neutral',
  target: 'es2022',
  external: ['node:worker_threads', 'node:url'],
});
