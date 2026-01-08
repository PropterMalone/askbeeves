import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');

const packageJsonPath = path.join(rootDir, 'package.json');
const manifestJsonPath = path.join(rootDir, 'manifest.json');

try {
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  const manifestJson = JSON.parse(fs.readFileSync(manifestJsonPath, 'utf8'));

  if (packageJson.version !== manifestJson.version) {
    console.log(`Syncing version: ${manifestJson.version} -> ${packageJson.version}`);
    manifestJson.version = packageJson.version;
    fs.writeFileSync(manifestJsonPath, JSON.stringify(manifestJson, null, 2) + '\n');
    console.log('✅ manifest.json updated.');
  } else {
    console.log('✅ Version is already in sync.');
  }
} catch (error) {
  console.error('❌ Error syncing version:', error);
  process.exit(1);
}
