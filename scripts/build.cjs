'use strict';
const fs = require('node:fs'), path = require('node:path'), { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const manifest = require('../extension.json'), product = require('../package.json');
if (manifest.version !== product.version) throw Error('Version mismatch');
const output = path.join(root, 'out', 'Applet.ChatCodex.at365');
fs.mkdirSync(output, { recursive: true });
for (const folder of ['src', 'web']) {
  fs.mkdirSync(path.join(output, folder), { recursive: true });
  for (const file of fs.readdirSync(path.join(root, folder))) {
    const input = path.join(root, folder, file);
    if (/\.(cjs|js)$/.test(file)) execFileSync(process.execPath, ['--check', input], { windowsHide: true });
    fs.copyFileSync(input, path.join(output, folder, file));
  }
}
fs.copyFileSync(path.join(root, 'extension.json'), path.join(output, 'extension.json'));
// The installed guide is standalone; repository-only document links stay in the source guide.
const guide = fs.readFileSync(path.join(root, 'docs', 'usage.md'), 'utf8').replace(/\[([^\]]+)\]\((?!https?:\/\/)[^)]+\)/g, '$1');
fs.writeFileSync(path.join(output, 'USAGE.md'), guide);
console.log(JSON.stringify({ version: manifest.version, output }));
