import { randomBytes } from 'node:crypto';
import { hashPassword, normalizeEmail, sha256 } from './auth.js';
import { query, transaction } from './db.js';
import { config } from './config.js';

const fail = (res, status, code, message) => res.status(status).json({ data: null, error: { code, message, details: null } });

async function sendResetEmail(email, token) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.PASSWORD_RESET_FROM || process.env.RESEND_FROM;
  if (!apiKey || !from) return false;
  const resetUrl = `${config.publicWebBaseUrl.replace(/\/$/, '')}/reset-password?token=${encodeURIComponent(token)}`;
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from,
      to: [email],
      subject: 'Reset your TraffIQ password',
      text: `Use this link within 30 minutes to reset your TraffIQ password: ${resetUrl}`,
      html: `<p>Use the link below within 30 minutes to reset your TraffIQ password.</p><p><a href="${resetUrl}">Reset password</a></p><p>If you did not request this, you can ignore this email.</p>`
    })
  });
  return response.ok;
}

export function registerPasswordRecovery(app) {
  app.post('/v1/auth/password-reset', async (req, res, next) => {
    try {
      const email = normalizeEmail(req.body?.email || '');
      const found = await query('SELECT id,email FROM users WHERE email=$1 AND status=$2', [email, 'active']);
      if (found.rowCount) {
        const token = randomBytes(32).toString('base64url');
        const expiresAt = new Date(Date.now() + 30 * 60_000);
        await transaction(async client => {
          await client.query('UPDATE password_reset_tokens SET used_at=now() WHERE user_id=$1 AND used_at IS NULL', [found.rows[0].id]);
          await client.query('INSERT INTO password_reset_tokens(user_id,token_hash,expires_at) VALUES($1,$2,$3)', [found.rows[0].id, sha256(token), expiresAt]);
          await client.query(`INSERT INTO notification_outbox(user_id,event_type,payload) VALUES($1,'auth.password_reset',$2::jsonb)`, [found.rows[0].id, JSON.stringify({ token, expiresAt, webBaseUrl: config.publicWebBaseUrl })]);
        });
        try { await sendResetEmail(found.rows[0].email, token); } catch { /* keep generic response; outbox preserves the event */ }
      }
      res.status(202).json({ ok: true });
    } catch (error) { next(error); }
  });

  app.post('/v1/auth/password-reset/confirm', async (req, res, next) => {
    try {
      const token = String(req.body?.token || '').trim();
      const password = String(req.body?.password || '');
      if (!token) return fail(res, 400, 'validation_error', 'Reset token is required');
      if (password.length < 8) return fail(res, 400, 'weak_password', 'Use at least 8 characters');

      const found = await query(`
        SELECT pr.id, pr.user_id
        FROM password_reset_tokens pr
        JOIN users u ON u.id = pr.user_id
        WHERE pr.token_hash=$1
          AND pr.used_at IS NULL
          AND pr.expires_at > now()
          AND u.status='active'
        LIMIT 1
      `, [sha256(token)]);
      if (!found.rowCount) return fail(res, 400, 'invalid_reset_token', 'This reset link is invalid or has expired');

      const row = found.rows[0];
      const passwordHash = await hashPassword(password);
      await transaction(async client => {
        await client.query('UPDATE users SET password_hash=$2,updated_at=now() WHERE id=$1', [row.user_id, passwordHash]);
        await client.query('UPDATE password_reset_tokens SET used_at=now() WHERE user_id=$1 AND used_at IS NULL', [row.user_id]);
        await client.query('UPDATE refresh_tokens SET revoked_at=COALESCE(revoked_at,now()) WHERE user_id=$1 AND revoked_at IS NULL', [row.user_id]);
      });
      res.status(204).end();
    } catch (error) { next(error); }
  });
}
