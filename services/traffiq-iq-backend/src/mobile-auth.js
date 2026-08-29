import { randomUUID } from 'node:crypto';
import {
  hashPassword,
  issueAccessToken,
  issueRefreshToken,
  normalizeEmail,
  passwordHashNeedsUpgrade,
  sha256,
  verifyPassword
} from './auth.js';
import { query } from './db.js';
import { config } from './config.js';

const fail = (res, status, code, message) => res.status(status).json({ data: null, error: { code, message, details: null } });

const deviceFrom = (req, device = {}) => ({
  installationId: device.installationId || device.installation_id || req.headers['x-installation-id'] || `web-${randomUUID()}`,
  platform: device.platform || 'android',
  pushToken: device.pushToken || device.push_token || null,
  appVersion: device.appVersion || device.app_version || req.headers['x-traffiq-version'] || null,
  osVersion: device.osVersion || device.os_version || null,
  capabilities: device.capabilities || {}
});

async function upsertDevice(userId, rawDevice, req) {
  const device = deviceFrom(req, rawDevice || {});
  const result = await query(`
    INSERT INTO devices (user_id, installation_id, platform, push_token, app_version, os_version, capabilities)
    VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)
    ON CONFLICT (installation_id) DO UPDATE SET
      user_id=EXCLUDED.user_id,
      platform=EXCLUDED.platform,
      push_token=EXCLUDED.push_token,
      app_version=EXCLUDED.app_version,
      os_version=EXCLUDED.os_version,
      capabilities=EXCLUDED.capabilities,
      last_seen_at=now(),
      updated_at=now()
    RETURNING id,installation_id,platform,app_version,os_version,last_seen_at
  `, [
    userId,
    device.installationId,
    device.platform,
    device.pushToken,
    device.appVersion,
    device.osVersion,
    JSON.stringify(device.capabilities)
  ]);
  return result.rows[0];
}

async function authPayload(user, rawDevice, req) {
  const device = await upsertDevice(user.id, rawDevice, req);
  const accessToken = await issueAccessToken(user);
  const refresh = await issueRefreshToken(user.id, device?.id || null);
  return {
    user: { id: user.id, email: user.email, displayName: user.display_name, phone: user.phone || null },
    device,
    accessToken,
    accessTokenExpiresInSeconds: config.accessTokenMinutes * 60,
    refreshToken: refresh.token,
    refreshTokenExpiresAt: refresh.expiresAt
  };
}

export function registerMobileFirstPartyAuth(app) {
  app.post('/v1/auth/register', async (req, res, next) => {
    try {
      const email = normalizeEmail(String(req.body?.email || ''));
      const password = String(req.body?.password || '');
      const displayName = String(req.body?.displayName || req.body?.display_name || '').trim();
      const phone = req.body?.phone ? String(req.body.phone).trim() : null;
      if (!email || !email.includes('@')) return fail(res, 400, 'validation_error', 'A valid email is required');
      if (password.length < 8) return fail(res, 400, 'weak_password', 'Use at least 8 characters');
      if (displayName.length < 2) return fail(res, 400, 'validation_error', 'Display name is required');
      try {
        const created = await query(`
          INSERT INTO users(email,phone,display_name,password_hash)
          VALUES($1,$2,$3,$4)
          RETURNING *
        `, [email, phone, displayName, await hashPassword(password)]);
        res.status(201).json(await authPayload(created.rows[0], req.body?.device, req));
      } catch (error) {
        if (error.code === '23505') return fail(res, 409, 'account_exists', 'An account already exists for this email');
        throw error;
      }
    } catch (error) { next(error); }
  });

  app.post('/v1/auth/login', async (req, res, next) => {
    try {
      const email = normalizeEmail(String(req.body?.email || ''));
      const password = String(req.body?.password || '');
      const found = await query('SELECT * FROM users WHERE email=$1 AND status=$2 LIMIT 1', [email, 'active']);
      const user = found.rows[0];
      if (!user || !(await verifyPassword(password, user.password_hash))) {
        return fail(res, 401, 'invalid_credentials', 'Email or password is incorrect');
      }
      if (passwordHashNeedsUpgrade(user.password_hash)) {
        await query('UPDATE users SET password_hash=$2,updated_at=now() WHERE id=$1', [user.id, await hashPassword(password)]);
      }
      res.json(await authPayload(user, req.body?.device, req));
    } catch (error) { next(error); }
  });

  app.post('/v1/auth/refresh', async (req, res, next) => {
    try {
      const refreshToken = String(req.body?.refreshToken || req.body?.refresh_token || '');
      if (refreshToken.length < 32) return fail(res, 400, 'validation_error', 'Refresh token is required');
      const found = await query(`
        SELECT rt.id refresh_id,rt.user_id,rt.device_id,u.id,u.email,u.display_name
        FROM refresh_tokens rt
        JOIN users u ON u.id=rt.user_id
        WHERE rt.token_hash=$1 AND rt.revoked_at IS NULL AND rt.expires_at>now() AND u.status='active'
        LIMIT 1
      `, [sha256(refreshToken)]);
      if (!found.rowCount) return fail(res, 401, 'invalid_refresh_token', 'Refresh token is invalid or expired');
      const row = found.rows[0];
      await query('UPDATE refresh_tokens SET revoked_at=now() WHERE id=$1', [row.refresh_id]);
      const accessToken = await issueAccessToken(row);
      const refresh = await issueRefreshToken(row.user_id, row.device_id);
      res.json({
        accessToken,
        accessTokenExpiresInSeconds: config.accessTokenMinutes * 60,
        refreshToken: refresh.token,
        refreshTokenExpiresAt: refresh.expiresAt
      });
    } catch (error) { next(error); }
  });

  app.post('/v1/auth/logout', async (req, res, next) => {
    try {
      const refreshToken = String(req.body?.refreshToken || req.body?.refresh_token || '');
      if (refreshToken) await query('UPDATE refresh_tokens SET revoked_at=now() WHERE token_hash=$1 AND revoked_at IS NULL', [sha256(refreshToken)]);
      res.status(204).end();
    } catch (error) { next(error); }
  });
}
