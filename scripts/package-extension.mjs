import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crx3 from 'crx3';
import { transformSync } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const version = manifest.version;
const keyPath = path.resolve(
  process.env.CRX_KEY_PATH ||
    process.argv.find((argument) => argument.startsWith('--key='))?.slice(6) ||
    '',
);

if (!keyPath || !existsSync(keyPath)) {
  throw new Error('CRX private key not found. Set CRX_KEY_PATH or pass --key=<path>.');
}

const buildDir = path.join(root, 'build');
const stagingDir = path.join(buildDir, 'extension');
const baseName = `abm-browser-extension-${version}`;
const zipPath = path.join(buildDir, `${baseName}.zip`);
const crxPath = path.join(buildDir, `${baseName}.crx`);
const shaPath = path.join(buildDir, `${baseName}.sha256`);
const shouldMinify = !process.argv.includes('--no-minify');

rmSync(stagingDir, { recursive: true, force: true });
mkdirSync(stagingDir, { recursive: true });

for (const entry of ['manifest.json', 'src', 'popup', 'inject-scripts', 'icons']) {
  cpSync(path.join(root, entry), path.join(stagingDir, entry), {
    recursive: true,
  });
}

function listJavaScriptFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory)) {
    const filePath = path.join(directory, entry);
    if (statSync(filePath).isDirectory()) {
      files.push(...listJavaScriptFiles(filePath));
    } else if (entry.endsWith('.js')) {
      files.push(filePath);
    }
  }
  return files;
}

let originalBytes = 0;
let minifiedBytes = 0;
let minifiedFiles = 0;
if (shouldMinify) {
  for (const filePath of listJavaScriptFiles(stagingDir)) {
    const source = readFileSync(filePath, 'utf8');
    const result = transformSync(source, {
      loader: 'js',
      minify: true,
      legalComments: 'none',
      target: 'chrome109',
    });
    originalBytes += Buffer.byteLength(source);
    minifiedBytes += result.code.length;
    minifiedFiles += 1;
    writeFileSync(filePath, result.code, 'utf8');
  }
}

await crx3([path.join(stagingDir, 'manifest.json')], {
  keyPath,
  crxPath,
  zipPath,
});

const checksums = [zipPath, crxPath]
  .map((filePath) => {
    const digest = createHash('sha256').update(readFileSync(filePath)).digest('hex');
    return `${digest}  ${path.basename(filePath)}`;
  })
  .join('\n');
writeFileSync(shaPath, `${checksums}\n`, 'utf8');

console.log(`version=${version}`);
console.log(`zip=${zipPath}`);
console.log(`crx=${crxPath}`);
console.log(`sha256=${shaPath}`);
console.log(`minified=${shouldMinify}`);
if (shouldMinify) {
  console.log(`minified_js_files=${minifiedFiles}`);
  console.log(`js_bytes=${originalBytes}->${minifiedBytes}`);
}

if (process.env.GITHUB_OUTPUT) {
  const lines = [
    `version=${version}`,
    `zip=${zipPath}`,
    `crx=${crxPath}`,
    `sha256=${shaPath}`,
    `minified=${shouldMinify}`,
  ].join('\n');
  writeFileSync(process.env.GITHUB_OUTPUT, `${lines}\n`, { flag: 'a' });
}

