// Railway build script — uses Bun.build API with explicit path aliases
// to work around bun 1.3.2 tsconfig path resolution on Linux.
const result = await Bun.build({
  entrypoints: ['./src/index.ts'],
  outdir: './dist',
  target: 'node',
  external: ['pino', 'pino-pretty'],
  alias: { '@': './src' },
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

console.log(`Build complete: ${result.outputs.length} output(s)`);
