/**
 * @fileoverview Railway-specific build script.
 * @module scripts/railway-build
 *
 * Uses Bun's JavaScript build API with explicit path alias configuration.
 * Railpack pins Bun to the version in `packageManager` (1.3.2), which has
 * a bug where `@/*` tsconfig path aliases are not resolved during bundling
 * on Linux. This script provides the aliases explicitly instead of relying
 * on tsconfig.json path resolution.
 */

const result = await Bun.build({
  entrypoints: ['./src/index.ts'],
  outdir: './dist',
  target: 'node',
  external: ['pino', 'pino-pretty'],
  alias: {
    '@': './src',
  },
});

if (!result.success) {
  for (const log of result.logs) {
    console.error(log);
  }
  process.exit(1);
}

console.log(`Build complete: ${result.outputs.length} output(s)`);
