import crypto from 'crypto';

const TOKEN_BYTES = 24;

export function generateOpaqueSecret(bytes: number = TOKEN_BYTES): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function hashSecret(secret: string): string {
  return crypto.createHash('sha256').update(secret).digest('hex');
}

export function maskSecret(secret: string): string {
  if (secret.length <= 8) return secret;
  return `${secret.slice(0, 4)}...${secret.slice(-4)}`;
}

export function secretEquals(secret: string, expectedHash: string): boolean {
  const actual = Buffer.from(hashSecret(secret), 'utf8');
  const expected = Buffer.from(expectedHash, 'utf8');
  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(actual, expected);
}
