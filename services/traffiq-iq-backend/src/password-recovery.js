import { hashPassword, sha256 } from './auth.js';
import { query, transaction } from './db.js';

const fail = (res, status, code, message) => res.status(status).json({ data: null, error: { code, message, details: null } });

export function registerPasswordRecovery(app) {
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
      await transaction(async client => {
        await client.query('UPDATE users SET password_hash=$2,updated_at=now() WHERE id=$1', [row.user_id, await hashPassword(password)]);
        await client.query('UPDATE password_reset_tokens SET used_at=now() WHERE id=$1', [row.id]);
        await client.query('UPDATE password_reset_tokens SET used_at=now() WHERE user_id=$1 AND used_at IS NULL', [row.user_id]);
        await client.query('UPDATE refresh_tokens SET revoked_at=COALESCE(revoked_at,now()) WHERE user_id=$1 AND revoked_at IS NULL', [row.user_id]);
      });
      res.status(204).end();
    } catch (error) { next(error); }
  });
}
