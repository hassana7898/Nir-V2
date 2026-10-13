// Stamps a build output directory with the environment it was built for.
//
//   npm run build:deploy / build:weighbridge  -> dist\BUILD-TARGET.txt     = prod
//   npm run build:dev                        -> dist-dev\BUILD-TARGET.txt = dev
//
// psremoting\wb-prod-deploy.ps1 refuses a build stamped anything but "prod", and
// psremoting\wb-dev-deploy.ps1 refuses anything but "dev", so a bundle built while
// experimenting can never be shipped to the main app by accident.
//
// Usage: node scripts/stamp-build.mjs <prod|dev> [distDir]
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { basename, join, resolve } from 'node:path';

const target = String(process.argv[2] || '').toLowerCase();
if (target !== 'prod' && target !== 'dev') {
  console.error('[stamp-build] usage: node scripts/stamp-build.mjs <prod|dev> [distDir]');
  process.exit(1);
}

const distDir = resolve(process.argv[3] || (target === 'dev' ? 'dist-dev' : 'dist'));
if (!existsSync(distDir)) {
  console.error(`[stamp-build] build output not found: ${distDir}`);
  process.exit(1);
}

const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
const describe = (rel) => {
  const abs = join(distDir, rel);
  if (!existsSync(abs)) return null;
  const bytes = readFileSync(abs).length;
  return { sha256: sha256(abs), bytes };
};

const artifacts = {};
for (const rel of ['server.cjs', 'server.cjs.map', 'weighbridge-worker.cjs', 'index.html']) {
  const info = describe(rel);
  if (info) artifacts[rel] = info;
  else console.warn(`[stamp-build] WARNING: ${rel} missing in ${distDir}`);
}

// The bundle referenced by index.html is what the browser/server actually executes; record it
// so a stale index.html / asset pair is visible in the stamp.
const indexAbs = join(distDir, 'index.html');
let bundle = null;
if (existsSync(indexAbs)) {
  const html = readFileSync(indexAbs, 'utf8');
  const m = html.match(/assets\/index-[A-Za-z0-9_-]+\.js/);
  if (m) {
    bundle = m[0];
    const info = describe(m[0]);
    if (info) artifacts[m[0]] = info;
    else console.warn(`[stamp-build] WARNING: index.html references ${m[0]} but the file is missing`);
  }
}

let gitCommit = null;
let gitDirty = null;
try {
  gitCommit = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  gitDirty = execSync('git status --porcelain', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim().length > 0;
} catch {
  // not a git checkout (e.g. a copied tree) - the stamp still records hashes
}

const info = {
  target,
  distDir: basename(distDir),
  builtAt: new Date().toISOString(),
  gitCommit,
  gitDirty,
  node: process.version,
  bundle,
  artifacts,
};

writeFileSync(join(distDir, 'BUILD-TARGET.txt'), target);            // asserted by the deploy scripts
writeFileSync(join(distDir, 'build-info.json'), JSON.stringify(info, null, 2) + '\n');
console.log(`[stamp-build] ${distDir} stamped ${target}  commit=${gitCommit ?? 'n/a'}${gitDirty ? ' (dirty)' : ''}  bundle=${bundle ?? 'n/a'}`);
