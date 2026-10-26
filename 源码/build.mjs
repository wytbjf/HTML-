import { build } from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.dirname(fileURLToPath(import.meta.url));
const result = await build({
  entryPoints: [path.join(root, 'src/app.js')], bundle: true, write: false,
  platform: 'browser', format: 'iife', target: 'es2020', minify: true,
  legalComments: 'inline', define: { 'process.env.NODE_ENV': '"production"' }
});
const bundle = result.outputFiles[0].text;
if (/<\/script/i.test(bundle)) throw new Error('Bundle contains unsafe inline script terminator');
const shell = await fs.readFile(path.join(root, 'src/shell.html'), 'utf8');
const output = path.join(root, 'dist');
await fs.mkdir(output, { recursive: true });
await fs.writeFile(path.join(output, 'HTML_代码格式化工具.html'), shell.replace('/*__APP_BUNDLE__*/', () => bundle));
console.log('Built: dist/HTML_代码格式化工具.html');
