import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');

const packageJsonPath = path.join(rootDir, 'package.json');
const manifestFiles = ['manifest.json', 'manifest.firefox.json'];

try {
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

  manifestFiles.forEach((filename) => {
    const manifestPath = path.join(rootDir, filename);
    if (fs.existsSync(manifestPath)) {
      const manifestJson = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

      if (packageJson.version !== manifestJson.version) {
        console.log(`Syncing ${filename}: ${manifestJson.version} -> ${packageJson.version}`);
        manifestJson.version = packageJson.version;
        fs.writeFileSync(manifestPath, JSON.stringify(manifestJson, null, 2) + '\n');
        console.log(`✅ ${filename} updated.`);
      } else {
        console.log(`✅ ${filename} is already in sync.`);
      }
    }
  });
} catch (error) {
  console.error('❌ Error syncing version:', error);
  process.exit(1);
}
