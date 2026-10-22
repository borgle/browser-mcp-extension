/**
 * Manifest key handling tests for release packaging.
 * Run: node test/manifest-key.test.mjs
 */
import { generateKeyPairSync } from 'node:crypto';
import {
  crxManifest,
  normalizePublicKey,
  resolvePublicKey,
  webStoreManifest,
} from '../scripts/manifest-key.mjs';

let failures = 0;
function check(name, condition, detail) {
  if (condition) {
    console.log(`  OK ${name}`);
  } else {
    failures += 1;
    console.error(`  FAIL ${name}${detail ? `: ${detail}` : ''}`);
  }
}

function throws(fn) {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
}

const source = {
  manifest_version: 3,
  name: 'ABM test',
  version: '2.0.0',
  key: 'old-public-key',
};

console.log('Web Store manifest');
const webStore = webStoreManifest(source);
check('removes key', !('key' in webStore));
check('keeps other fields', webStore.name === source.name && webStore.version === source.version);
check('does not mutate source', source.key === 'old-public-key');

console.log('\nCRX manifest');
const crx = crxManifest(source, 'crx-public-key');
check('injects CRX key', crx.key === 'crx-public-key');
check('does not mutate source', source.key === 'old-public-key');

const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
const privatePem = pair.privateKey.export({ type: 'pkcs8', format: 'pem' });
const publicBase64 = pair.publicKey
  .export({ type: 'spki', format: 'der' })
  .toString('base64');
const publicPem = pair.publicKey.export({ type: 'spki', format: 'pem' });
const otherPair = generateKeyPairSync('rsa', { modulusLength: 2048 });
const otherPublicBase64 = otherPair.publicKey
  .export({ type: 'spki', format: 'der' })
  .toString('base64');

console.log('\nPublic key resolution');
check('derives public key from private key', resolvePublicKey(privatePem) === publicBase64);
check('accepts manifest key', resolvePublicKey(privatePem, publicBase64) === publicBase64);
check('accepts PEM public key', normalizePublicKey(publicPem) === publicBase64);
check(
  'accepts base64 PEM public key',
  normalizePublicKey(Buffer.from(publicPem).toString('base64')) === publicBase64,
);
check(
  'rejects mismatched public key',
  throws(() => resolvePublicKey(privatePem, otherPublicBase64)),
);
check('rejects invalid public key', throws(() => normalizePublicKey('not-a-key')));

if (failures > 0) {
  console.error(`\n${failures} manifest key test(s) failed.`);
  process.exit(1);
}
console.log('\nManifest key tests passed.');
