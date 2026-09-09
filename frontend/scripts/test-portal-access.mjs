import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
const directory = await mkdtemp(join(tmpdir(), 'beauty-access-tests-'));
try {
  const outfile = join(directory, 'components.test.cjs');
  await build({ entryPoints: ['packages/shared/src/portalAccess.test.jsx'], bundle: true, platform: 'node', format: 'cjs', outfile, define: { 'import.meta.env': '{}' }, banner: { js: "globalThis.window = { location: { search: '', pathname: '/' } }; Object.defineProperty(globalThis, 'localStorage', { value: { getItem: () => null, setItem: () => {}, removeItem: () => {} } });" }, logLevel: 'warning' });
  const result = spawnSync(process.execPath, ['--test', 'packages/shared/src/portalAccessState.test.js', outfile], { stdio: 'inherit' });
  process.exitCode = result.status ?? 1;
} finally { await rm(directory, { recursive: true, force: true }); }
