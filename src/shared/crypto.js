/**
 * Client-Side End-to-End Cryptography Engine (Web Crypto API)
 * Uses PBKDF2 (SHA-256, 100k iterations) + AES-256-GCM
 */

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
export async function deriveKey(passphrase, saltBytes) {
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
      iterations: 100000,
      hash: 'SHA-256'
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypt a JavaScript object with a passphrase
 * Returns an envelope containing salt, IV, and ciphertext
 */
export async function encryptPayload(data, passphrase) {
  if (!passphrase) throw new Error('Encryption passphrase is required');

  const salt = cryptoObj.getRandomValues(new Uint8Array(16));
  const iv = cryptoObj.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt);

  const plaintext = encoder.encode(JSON.stringify(data));
  const ciphertextBuffer = await cryptoObj.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    plaintext
  );

  return {
    version: 1,
    format: 'tabroost-e2ee-aes-gcm',
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
  if (envelope.format !== 'tabroost-e2ee-aes-gcm') {
    throw new Error(`Unsupported encryption format: ${envelope.format}`);
  }
  if (!passphrase) {
    throw new Error('Decryption passphrase is required');
  }

  const salt = base64ToBytes(envelope.salt);
  const iv = base64ToBytes(envelope.iv);
  const ciphertext = base64ToBytes(envelope.ciphertext);

  const key = await deriveKey(passphrase, salt);

  try {
    const decryptedBuffer = await cryptoObj.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      ciphertext
    );
    const jsonString = decoder.decode(decryptedBuffer);
    return JSON.parse(jsonString);
  } catch (err) {
    throw new Error('Decryption failed: incorrect passphrase or corrupted payload');
  }
}
