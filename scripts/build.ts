// Builds the standalone bundle: dist/rental-app.js, dist/rental-app.css, dist/index.html, dist/assets.

import { build } from 'esbuild';
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';

const root = new URL('..', import.meta.url);
const dist = new URL('dist/', root);
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

await build({
  entryPoints: { 'rental-app': new URL('src/ui/main.tsx', root).pathname },
  outdir: dist.pathname,
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  jsx: 'automatic',
  minify: true,
  legalComments: 'none',
  define: { 'process.env.NODE_ENV': '"production"' },
  loader: { '.json': 'json' },
  logLevel: 'info',
});

cpSync(new URL('assets/', root), new URL('assets/', dist), { recursive: true });

writeFileSync(
  new URL('index.html', dist),
  `<!DOCTYPE html>
<html lang="pl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>SKY BIKE: pokaz systemu rezerwacji (Faza 1B)</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Jost:wght@400;500;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="rental-app.css">
<style>body{margin:0}</style>
</head>
<body>
<div data-rental-app data-assets="assets/"></div>
<script src="rental-app.js"></script>
</body>
</html>
`,
);
console.log('Built dist/');
