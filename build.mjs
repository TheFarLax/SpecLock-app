import { build } from 'esbuild';
import { cp, mkdir } from 'node:fs/promises';
await mkdir('dist', { recursive: true });
await Promise.all(['index.html', 'styles.css', 'icon.svg'].map(file => cp('src/' + file, 'dist/' + file)));
await build({ entryPoints: ['src/app.js'], outfile: 'dist/app.js', bundle: true, minify: true, format: 'esm', target: ['es2022'], legalComments: 'eof' });
