import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, '..', 'dist');

// Ensure dist exists
if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

// Copy and transform manifest.json
const manifestPath = path.join(__dirname, '..', 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

// Update content scripts to use bundled file
if (manifest.content_scripts) {
  manifest.content_scripts = manifest.content_scripts.map((script) => ({
    ...script,
    js: ['content.js'],
  }));
}

fs.writeFileSync(path.join(distDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

// Copy icons folder
const iconsDir = path.join(__dirname, '..', 'icons');
const distIconsDir = path.join(distDir, 'icons');

if (!fs.existsSync(distIconsDir)) {
  fs.mkdirSync(distIconsDir, { recursive: true });
}

if (fs.existsSync(iconsDir)) {
  fs.readdirSync(iconsDir).forEach((file) => {
    if (file.endsWith('.png')) {
      // Use path.basename to prevent path traversal attacks
      const safeFilename = path.basename(file);
      fs.copyFileSync(path.join(iconsDir, file), path.join(distIconsDir, safeFilename));
    }
  });
}

// Copy options.html
const optionsHtmlPath = path.join(__dirname, '..', 'src', 'options.html');
if (fs.existsSync(optionsHtmlPath)) {
  fs.copyFileSync(optionsHtmlPath, path.join(distDir, 'options.html'));
}

console.log('Assets copied to dist/');

export function copyAssets() {
  // Function for importing
}
