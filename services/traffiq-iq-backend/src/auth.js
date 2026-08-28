import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { SignJWT, jwtVerify } from 'jose';
import { config } from './config.js';
import { query } from './db.js';

const scrypt = promisify(scryptCallback);
const jwtKey = new TextEncoder().encode(config.jwtSecret);

export const normalizeEmail = (email) => email.trim().toLowerCase();
export const sha256 = (value) => createHash('sha256').update(value).digest('hex');

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString('base64url')}$${Buffer.from(derived).toString('base64url')}`;
}

export async function verifyPassword(password, encoded) {
  const [scheme, saltEncoded, hashEncoded] = String(encoded).split('$');
  if (scheme !== 'scrypt' || !saltEncoded || !hashEncoded) return false;
  const salt = Buffer.from(saltEncoded, 'base64url');
  const expected = Buffer.from(hashEncoded, 'base64url');
  const actual = Buffer.from(await scrypt(password, salt, expected.length));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export async function issueAccessToken(user) {
  return new SignJWT({ email: user.email, name: user.display_name })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(user.id)
    .setIssuer('traffiq-iq')
    .setAudience('traffiq-mobile')
    .setIssuedAt()
    .setExpirationTime(`${config.accessTokenMinutes}m`)
    .sign(jwtKey);
}

export async function issueRefreshToken(userId, deviceId = null) {
  const raw = randomBytes(48).toString('base64url');
  const hash = sha256(raw);
  const expiresAt = new Date(Date.now() + config.refreshTokenDays * 86_400_000);
  await query(
    `INSERT INTO refresh_tokens (user_id, device_id, token_hash, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [userId, deviceId, hash, expiresAt]
  );
  return { token: raw, expiresAt };
}

export async function authenticate(req, res, next) {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'unauthorized', message: 'Missing bearer token' });
  try {
    const { payload } = await jwtVerify(token, jwtKey, { issuer: 'traffiq-iq', audience: 'traffiq-mobile' });
    req.user = { id: payload.sub, email: payload.email, name: payload.name };
    return next();
  } catch {
    return res.status(401).json({ error: 'unauthorized', message: 'Invalid or expired access token' });
  }
}
