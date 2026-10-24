/**
 * Client-Side End-to-End Cryptography Engine (Web Crypto API)
 * Uses PBKDF2 (SHA-256) + AES-256-GCM.
 *
 * Envelope v2 records its own PBKDF2 iteration count (so the cost can be raised later
 * without breaking old data) and binds format + version as AES-GCM additional data.
 * Envelope v1 (100k iterations, no additional data) is still readable.
 */

export const FORMAT = 'tabroost-e2ee-aes-gcm';
export const CURRENT_VERSION = 2;
export const DEFAULT_ITERATIONS = 600000;
const LEGACY_ITERATIONS = 100000;
const MAX_ITERATIONS = 10000000;

/* global Buffer */
const cryptoObj = globalThis.crypto;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Convert Uint8Array to Base64 string */
export function bytesToBase64(bytes) {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/** Convert Base64 string to Uint8Array */
export function base64ToBytes(base64) {
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(base64, 'base64'));
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Derive an AES-GCM 256-bit CryptoKey from a passphrase and salt using PBKDF2
 */
export async function deriveKey(passphrase, saltBytes, iterations = DEFAULT_ITERATIONS) {
  if (!passphrase || typeof passphrase !== 'string') {
    throw new Error('Passphrase must be a non-empty string');
  }

  const keyMaterial = await cryptoObj.subtle.importKey(
    'raw',
    encoder.encode(passphrase),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );

  return cryptoObj.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: saltBytes,
      iterations,
      hash: 'SHA-256'
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Additional authenticated data: ties the ciphertext to its format and version
 */
function aadFor(version) {
  return encoder.encode(`${FORMAT}:v${version}`);
}

/**
 * Encrypt a JavaScript object with a passphrase
 * Returns an envelope containing salt, IV, KDF parameters and ciphertext
 */
export async function encryptPayload(data, passphrase) {
  if (!passphrase) throw new Error('Encryption passphrase is required');

  const salt = cryptoObj.getRandomValues(new Uint8Array(16));
  const iv = cryptoObj.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt, DEFAULT_ITERATIONS);

  const plaintext = encoder.encode(JSON.stringify(data));
  const ciphertextBuffer = await cryptoObj.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: aadFor(CURRENT_VERSION) },
    key,
    plaintext
  );

  return {
    version: CURRENT_VERSION,
    format: FORMAT,
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: DEFAULT_ITERATIONS },
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertextBuffer)),
    timestamp: Date.now()
  };
}

/**
 * Decrypt an encrypted envelope using the passphrase
 * Returns the parsed JavaScript object
 */
export async function decryptPayload(envelope, passphrase) {
  if (!envelope || typeof envelope !== 'object') {
    throw new Error('Invalid envelope: expected JSON object');
  }
  if (envelope.format !== FORMAT) {
    throw new Error(`Unsupported encryption format: ${envelope.format}`);
  }
  if (!passphrase) {
    throw new Error('Decryption passphrase is required');
  }

  const version = envelope.version ?? 1;
  if (version !== 1 && version !== 2) {
    throw new Error(`Unsupported envelope version: ${version}`);
  }

  let iterations = LEGACY_ITERATIONS;
  if (version >= 2) {
    iterations = envelope.kdf?.iterations;
    if (envelope.kdf?.name !== 'PBKDF2' || !Number.isInteger(iterations) || iterations < LEGACY_ITERATIONS || iterations > MAX_ITERATIONS) {
      throw new Error('Invalid key derivation parameters in envelope');
    }
  }

  const salt = base64ToBytes(envelope.salt);
  const iv = base64ToBytes(envelope.iv);
  const ciphertext = base64ToBytes(envelope.ciphertext);

  const key = await deriveKey(passphrase, salt, iterations);

  const params = { name: 'AES-GCM', iv };
  if (version >= 2) params.additionalData = aadFor(version);

  try {
    const decryptedBuffer = await cryptoObj.subtle.decrypt(
      params,
      key,
      ciphertext
    );
    const jsonString = decoder.decode(decryptedBuffer);
    return JSON.parse(jsonString);
  } catch (err) {
    throw new Error('Decryption failed: incorrect passphrase or corrupted payload');
  }
}
