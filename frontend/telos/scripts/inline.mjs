// Inlines dist-demo/ into one self-contained HTML file: dist-demo/telos-demo.html
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
const dir = 'dist-demo';
let html = readFileSync(`${dir}/index.html`, 'utf8');
for (const f of readdirSync(`${dir}/assets`)) {
  const body = readFileSync(`${dir}/assets/${f}`, 'utf8');
  if (f.endsWith('.css')) html = html.replace(new RegExp(`<link[^>]*${f}[^>]*>`), () => `<style>${body}</style>`);
  if (f.endsWith('.js')) {
    html = html.replace(new RegExp(`<script[^>]*${f}[^>]*></script>`), '');
    html = html.replace('</body>', () => `<script type="module">${body.replace(/<\/script/gi, '<\\/script')}</script></body>`);
  }
}
writeFileSync(`${dir}/telos-demo.html`, html);
console.log('Wrote', `${dir}/telos-demo.html`, (html.length / 1024).toFixed(0) + ' KB');
