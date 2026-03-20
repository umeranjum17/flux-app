import crypto from 'crypto';

const TOKEN_BYTES = 24;

export function generateOpaqueSecret(bytes: number = TOKEN_BYTES): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function maskSecret(secret: string): string {
  if (secret.length <= 8) return secret;
  return `${secret.slice(0, 4)}...${secret.slice(-4)}`;
}
