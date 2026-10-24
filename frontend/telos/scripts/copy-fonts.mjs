import { cp, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';

// public/ is normally copied by Vite, but the webfonts are brand-critical and
// a silent omission changes the whole page to a fallback face. Copy them
// explicitly and fail the build if the source files are gone.
const fonts = [
  'comfortaa-latin.woff2',
  'amaticsc-400.woff2',
  'amaticsc-700.woff2'
];
const sourceDir = path.resolve('public/fonts');
const targetDir = path.resolve('dist/fonts');

await mkdir(targetDir, { recursive: true });
for (const name of fonts) {
  const source = path.join(sourceDir, name);
  const target = path.join(targetDir, name);
  const info = await stat(source).catch(() => null);
  if (!info || !info.isFile() || info.size === 0) {
    throw new Error(`Missing webfont source: ${source}`);
  }
  await cp(source, target);
  const copied = await stat(target);
  if (!copied.isFile() || copied.size !== info.size) {
    throw new Error(`Webfont was not copied correctly: ${target}`);
  }
}
console.log(`[fonts] copied ${fonts.length} webfonts into dist/fonts`);
