#!/usr/bin/env node
// Bundles the game into a single self-contained HTML file (Three.js inlined).
// Usage: node tools/build.js  → dist/flippin-waffles.html (standalone) and dist/artifact.html (body fragment)
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const html = read('index.html');
const css = read('src/style.css');
const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);
const js = scripts.map((p) => `// ---- ${p} ----\n${read(p)}`).join('\n');
const fontLink = html.match(/<link href="https:\/\/fonts\.googleapis\.com[^>]*>/)[0];
const body = html.match(/<body>([\s\S]*?)<script/)[1];
const inline = `${fontLink}\n<style>\n${css}\n</style>\n${body}<script>\n${js}\n</script>`;
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist/flippin-waffles.html'), `<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>Flippin' Waffles</title>\n${inline}\n</body>\n</html>\n`);
fs.writeFileSync(path.join(root, 'dist/artifact.html'), `<title>Flippin' Waffles</title>\n${inline}\n`);
console.log('built dist/flippin-waffles.html and dist/artifact.html', (fs.statSync(path.join(root, 'dist/flippin-waffles.html')).size / 1024).toFixed(0) + ' KB');
