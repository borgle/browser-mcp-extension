import { createPrivateKey, createPublicKey } from 'node:crypto';

export function webStoreManifest(manifest) {
  const copy = { ...manifest };
  delete copy.key;
  return copy;
}

export function crxManifest(manifest, publicKey) {
  return { ...manifest, key: publicKey };
}

export function publicKeyFromPrivateKey(privateKeyPem) {
  const privateKey = createPrivateKey(privateKeyPem);
  return createPublicKey(privateKey)
    .export({ type: 'spki', format: 'der' })
    .toString('base64');
}

export function normalizePublicKey(value) {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error('CRX public key is empty.');
  }

  if (trimmed.includes('BEGIN PUBLIC KEY')) {
    return createPublicKey(trimmed)
      .export({ type: 'spki', format: 'der' })
      .toString('base64');
  }

  const base64 = trimmed.replace(/\s+/g, '');
  const decoded = Buffer.from(base64, 'base64').toString('utf8');
  if (decoded.includes('BEGIN PUBLIC KEY')) {
    return normalizePublicKey(decoded);
  }

  createPublicKey({
    key: Buffer.from(base64, 'base64'),
    format: 'der',
    type: 'spki',
  });
  return base64;
}

export function resolvePublicKey(privateKeyPem, configuredPublicKey = '') {
  const derived = publicKeyFromPrivateKey(privateKeyPem);
  if (!configuredPublicKey) {
    return derived;
  }

  const normalized = normalizePublicKey(configuredPublicKey);
  if (normalized !== derived) {
    throw new Error('CRX public key does not match CRX private key.');
  }
  return normalized;
}
