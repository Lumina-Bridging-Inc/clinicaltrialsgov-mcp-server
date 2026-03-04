// Railway build script — uses a Bun plugin to resolve @/ path aliases.
// Bun 1.3.2's Bun.build `alias` option handles package aliases only,
// not tsconfig path patterns. The onResolve plugin intercepts @/* imports
// and maps them to absolute paths in src/.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const srcDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'src');

const result = await Bun.build({
  entrypoints: ['./src/index.ts'],
  outdir: './dist',
  target: 'node',
  external: ['pino', 'pino-pretty'],
  plugins: [
    {
      name: 'path-alias',
      setup(build) {
        build.onResolve({ filter: /^@\// }, ({ path: importPath }) => {
          let sub = importPath.slice(2); // strip '@/'
          if (sub.endsWith('.js')) sub = sub.slice(0, -3) + '.ts';
          return { path: path.join(srcDir, sub) };
        });
      },
    },
  ],
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

console.log(`Build complete: ${result.outputs.length} output(s)`);
