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
import {
  crxManifest,
  resolvePublicKey,
  webStoreManifest,
} from './manifest-key.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceManifest = JSON.parse(readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const version = sourceManifest.version;
const keyPathInput =
  process.env.CRX_KEY_PATH ||
  process.argv.find((argument) => argument.startsWith('--key='))?.slice(6) ||
  '';
const keyPath = keyPathInput ? path.resolve(keyPathInput) : '';

if (!keyPath || !existsSync(keyPath)) {
  throw new Error('CRX private key not found. Set CRX_KEY_PATH or pass --key=<path>.');
}

const configuredPublicKey =
  process.env.CRX_PUBLIC_KEY_BASE64 ||
  process.argv.find((argument) => argument.startsWith('--public-key='))?.slice(13) ||
  '';
const publicKey = resolvePublicKey(readFileSync(keyPath, 'utf8'), configuredPublicKey);

const buildDir = path.join(root, 'build');
const stagingDir = path.join(buildDir, 'extension');
const baseName = `abm-browser-extension-${version}`;
const zipPath = path.join(buildDir, `${baseName}.zip`);
const crxPath = path.join(buildDir, `${baseName}.crx`);
const shaPath = path.join(buildDir, `${baseName}.sha256`);
const temporaryCrxPath = path.join(buildDir, '.webstore-signing.crx');
const shouldMinify = !process.argv.includes('--no-minify');

rmSync(stagingDir, { recursive: true, force: true });
mkdirSync(stagingDir, { recursive: true });

for (const entry of ['manifest.json', 'src', 'popup', 'inject-scripts', 'icons', '_locales']) {
  cpSync(path.join(root, entry), path.join(stagingDir, entry), {
    recursive: true,
  });
}

function writeStagedManifest(value) {
  writeFileSync(
    path.join(stagingDir, 'manifest.json'),
    `${JSON.stringify(value, null, 2)}\n`,
    'utf8',
  );
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

// The Web Store ZIP must not contain the CRX public key. crx3 also emits the
// ZIP, so build it from a keyless manifest with a throwaway CRX, then inject the
// CRX public key and build the signed CRX with the same private key.
writeStagedManifest(webStoreManifest(sourceManifest));
try {
  await crx3([path.join(stagingDir, 'manifest.json')], {
    keyPath,
    crxPath: temporaryCrxPath,
    zipPath,
  });
} finally {
  rmSync(temporaryCrxPath, { force: true });
}

writeStagedManifest(crxManifest(sourceManifest, publicKey));
await crx3([path.join(stagingDir, 'manifest.json')], {
  keyPath,
  crxPath,
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
console.log(`public_key_source=${configuredPublicKey ? 'configured' : 'derived'}`);
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

