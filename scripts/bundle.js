import esbuild from 'esbuild';
import { copyAssets } from './copy-assets.js';
import fs from 'fs';
import path from 'path';

async function build() {
  try {
    // Parse CLI arguments
    const args = process.argv.slice(2);
    const targetArg = args.find((arg) => arg.startsWith('--target='));
    const target = targetArg ? targetArg.split('=')[1] : 'chrome';

    // Validate target
    if (!['chrome', 'firefox'].includes(target)) {
      console.error('Invalid target. Use --target=chrome or --target=firefox');
      process.exit(1);
    }

    console.log(`Building for ${target}...`);

    // Copy assets first
    copyAssets(target);

    // Dynamically find all entry points in src/
    // We want background.ts and content.ts but not types.ts or tests
    const srcDir = './src';
    const entryPoints = fs
      .readdirSync(srcDir)
      .filter(
        (file) => file.endsWith('.ts') && !file.endsWith('.test.ts') && file !== 'types.ts'
      )
      .map((file) => path.join(srcDir, file));

    console.log('Building entry points:', entryPoints);

    await esbuild.build({
      entryPoints,
      bundle: true,
      format: 'esm',
      target: 'es2020',
      outdir: 'dist',
      outExtension: { '.js': '.js' },
      sourcemap: process.env.NODE_ENV === 'development',
      minify: process.env.NODE_ENV === 'production',
      external: ['chrome'],
    });

    console.log(`Build completed successfully for ${target}`);
  } catch (error) {
    console.error('Build failed:', error);
    process.exit(1);
  }
}

build();
