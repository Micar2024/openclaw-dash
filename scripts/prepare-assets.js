const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const source = path.join(root, 'node_modules', 'html2canvas', 'dist', 'html2canvas.min.js');
const targetDir = path.join(root, 'public', 'vendor');
const target = path.join(targetDir, 'html2canvas.min.js');

if (!fs.existsSync(source)) {
  throw new Error('html2canvas dependency is missing. Run npm install first.');
}

fs.mkdirSync(targetDir, { recursive: true });
fs.copyFileSync(source, target);
console.log(`Copied ${path.relative(root, target)}`);
