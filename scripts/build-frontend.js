import { build } from 'esbuild';
import { cpSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

// Build TypeScript/React
await build({
  entryPoints: [join(root, 'src/frontend/main.tsx')],
  bundle: true,
  outdir: join(root, 'dist/frontend'),
  format: 'esm',
  minify: true,
  sourcemap: true,
  loader: { '.tsx': 'tsx', '.ts': 'ts' },
  jsx: 'automatic',
});

// Copy static assets
mkdirSync(join(root, 'dist/frontend'), { recursive: true });
cpSync(
  join(root, 'src/frontend/index.html'),
  join(root, 'dist/frontend/index.html'),
);

// Copy static assets (logos)
cpSync(
  join(root, 'src/frontend/static'),
  join(root, 'dist/frontend/static'),
  { recursive: true },
);

console.log('✅ Frontend build complete → dist/frontend/');
