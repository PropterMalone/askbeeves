import esbuild from 'esbuild';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');

// Get build target from command line args
const args = process.argv.slice(2);
const buildChrome = args.includes('--chrome') || args.length === 0 || args.includes('--all');
const buildFirefox = args.includes('--firefox') || args.includes('--all');

/**
 * Copy static assets to output directory
 */
function copyAssets(outDir, isFirefox = false) {
  // Ensure dist exists
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  // Copy appropriate manifest
  const manifestSrc = isFirefox
    ? path.join(rootDir, 'manifest.firefox.json')
    : path.join(rootDir, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestSrc, 'utf8'));

  // Update content scripts to use bundled file (Chrome only - Firefox manifest already lists polyfill)
  if (!isFirefox && manifest.content_scripts) {
    manifest.content_scripts = manifest.content_scripts.map((script) => ({
      ...script,
      js: ['content.js'],
    }));
  }

  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

  // Copy icons folder
  const iconsDir = path.join(rootDir, 'icons');
  const distIconsDir = path.join(outDir, 'icons');

  if (!fs.existsSync(distIconsDir)) {
    fs.mkdirSync(distIconsDir, { recursive: true });
  }

  if (fs.existsSync(iconsDir)) {
    fs.readdirSync(iconsDir).forEach((file) => {
      if (file.endsWith('.png')) {
        fs.copyFileSync(path.join(iconsDir, file), path.join(distIconsDir, file));
      }
    });
  }

  // Copy options.html
  const optionsHtmlPath = path.join(rootDir, 'src', 'options.html');
  if (fs.existsSync(optionsHtmlPath)) {
    let optionsHtml = fs.readFileSync(optionsHtmlPath, 'utf8');

    // For Firefox, inject polyfill script before options.js
    if (isFirefox) {
      optionsHtml = optionsHtml.replace(
        '<script src="options.js" type="module"></script>',
        '<script src="browser-polyfill.js"></script>\n  <script src="options.js" type="module"></script>'
      );
    }

    fs.writeFileSync(path.join(outDir, 'options.html'), optionsHtml);
  }

  // For Firefox, copy the browser polyfill
  if (isFirefox) {
    const polyfillSrc = path.join(rootDir, 'node_modules', 'webextension-polyfill', 'dist', 'browser-polyfill.js');
    if (fs.existsSync(polyfillSrc)) {
      fs.copyFileSync(polyfillSrc, path.join(outDir, 'browser-polyfill.js'));
    } else {
      console.error('Warning: browser-polyfill.js not found in node_modules');
    }
  }

  console.log(`Assets copied to ${outDir}/`);
}

/**
 * Build extension for a specific browser
 */
async function buildForBrowser(browser) {
  const isFirefox = browser === 'firefox';
  const outDir = isFirefox ? 'dist-firefox' : 'dist';

  console.log(`\n=== Building for ${browser.toUpperCase()} ===`);

  // Copy assets first
  copyAssets(outDir, isFirefox);

  // Dynamically find all entry points in src/
  // We want background.ts, content.ts, options.ts but not types.ts, browser.ts, or tests
  const srcDir = './src';
  const entryPoints = fs
    .readdirSync(srcDir)
    .filter(
      (file) =>
        file.endsWith('.ts') &&
        !file.endsWith('.test.ts') &&
        file !== 'types.ts' &&
        file !== 'browser.ts'
    )
    .map((file) => path.join(srcDir, file));

  console.log('Building entry points:', entryPoints);

  // Build configuration
  const buildConfig = {
    entryPoints,
    bundle: true,
    format: 'esm',
    target: 'es2020',
    outdir: outDir,
    outExtension: { '.js': '.js' },
    sourcemap: process.env.NODE_ENV === 'development',
    minify: process.env.NODE_ENV === 'production',
  };

  // For Chrome, mark chrome as external (it's a global)
  // For Firefox, we use the polyfill which provides a global 'browser' object
  if (!isFirefox) {
    buildConfig.external = ['chrome'];
  }

  await esbuild.build(buildConfig);

  console.log(`${browser} build completed successfully`);
}

async function build() {
  try {
    if (buildChrome) {
      await buildForBrowser('chrome');
    }

    if (buildFirefox) {
      await buildForBrowser('firefox');
    }

    console.log('\nAll builds completed successfully!');
  } catch (error) {
    console.error('Build failed:', error);
    process.exit(1);
  }
}

build();
