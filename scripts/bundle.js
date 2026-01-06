import esbuild from 'esbuild';
import { copyAssets } from './copy-assets.js';
import fs from 'fs';
import path from 'path';

async function build() {
  try {
    // Copy assets first
    copyAssets();

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

    console.log('Build completed successfully');
  } catch (error) {
    console.error('Build failed:', error);
    process.exit(1);
  }
}

build();
