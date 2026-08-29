import express from 'express';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { authenticate } from './auth.js';
import { query } from './db.js';
import { config } from './config.js';

const mediaRoot = process.env.MEDIA_ROOT || '/data/media';
const ok = (res, data, status = 200) => res.status(status).json({ data, error: null });
const fail = (res, status, code, message) => res.status(status).json({ data: null, error: { code, message, details: null } });
const allowedTypes = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
]);

function publicBase() {
  return (config.publicApiBaseUrl || 'https://api.traffiq.tukutuku.org').replace(/\/$/, '');
}

function incidentDto(row) {
  return {
    id: row.id,
    client_incident_id: row.client_id,
    user_id: row.user_id,
    journey_id: row.journey_id,
    type: row.type,
    lat: row.lat,
    lng: row.lng,
    road_impact: row.metadata?.roadImpact || null,
    severity: row.severity,
    confidence: Math.min(1, 0.45 + Number(row.confirmations || 0) * 0.1),
    note: row.description,
    photo_url: row.photo_url || null,
    public_photo_url: row.photo_url || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    expires_at: row.expires_at,
    status: row.status,
    confirmation_count: Number(row.confirmations || 0),
    rejection_count: Number(row.disputes || 0),
    is_public: row.status === 'active',
  };
}

async function incidentOwnedBy(userId, incidentId) {
  const result = await query('SELECT id,user_id FROM incidents WHERE id=$1 AND user_id=$2', [incidentId, userId]);
  return result.rows[0] || null;
}

export function registerMobileMedia(app) {
  app.get('/v1/incidents', authenticate, async (req, res, next) => {
    try {
      const result = await query(`
        SELECT i.*, (
          SELECT media_url FROM incident_evidence e
          WHERE e.incident_id=i.id AND e.media_type='image'
          ORDER BY e.created_at DESC LIMIT 1
        ) photo_url
        FROM incidents i
        WHERE i.status='active' AND (i.expires_at IS NULL OR i.expires_at > now())
        ORDER BY i.occurred_at DESC
        LIMIT 250
      `);
      ok(res, result.rows.map(incidentDto));
    } catch (error) { next(error); }
  });

  app.post('/v1/incidents/:id/photo-upload', authenticate, async (req, res, next) => {
    try {
      const incident = await incidentOwnedBy(req.user.id, req.params.id);
      if (!incident) return fail(res, 404, 'not_found', 'Incident not found');
      const uploadUrl = `${publicBase()}/mobile/v1/incidents/${encodeURIComponent(req.params.id)}/photo`;
      ok(res, {
        upload_url: uploadUrl,
        path: `incidents/${req.user.id}/${req.params.id}`,
        public_url: null,
      });
    } catch (error) { next(error); }
  });

  app.put(
    '/v1/incidents/:id/photo',
    authenticate,
    express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: '8mb' }),
    async (req, res, next) => {
      try {
        const incident = await incidentOwnedBy(req.user.id, req.params.id);
        if (!incident) return fail(res, 404, 'not_found', 'Incident not found');
        const contentType = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
        const extension = allowedTypes.get(contentType);
        if (!extension || !Buffer.isBuffer(req.body) || req.body.length === 0) {
          return fail(res, 415, 'unsupported_media_type', 'Use JPEG, PNG or WebP image data');
        }

        const dir = path.join(mediaRoot, 'incidents', req.user.id, req.params.id);
        await mkdir(dir, { recursive: true });
        const filename = `${Date.now()}-${randomUUID()}.${extension}`;
        const storageKey = path.join('incidents', req.user.id, req.params.id, filename);
        const filePath = path.join(mediaRoot, storageKey);
        await writeFile(filePath, req.body, { mode: 0o640 });
        const digest = createHash('sha256').update(req.body).digest('hex');
        const mediaUrl = `${publicBase()}/mobile/media/${storageKey.split(path.sep).map(encodeURIComponent).join('/')}`;
        await query(
          `INSERT INTO incident_evidence(incident_id,media_type,storage_key,media_url,sha256,captured_at)
           VALUES($1,'image',$2,$3,$4,now())`,
          [req.params.id, storageKey, mediaUrl, digest],
        );
        ok(res, { public_url: mediaUrl, path: storageKey }, 201);
      } catch (error) { next(error); }
    },
  );

  app.delete('/v1/incidents/:id', authenticate, async (req, res, next) => {
    try {
      const incident = await incidentOwnedBy(req.user.id, req.params.id);
      if (!incident) return fail(res, 404, 'not_found', 'Incident not found');
      const evidence = await query('SELECT storage_key FROM incident_evidence WHERE incident_id=$1', [req.params.id]);
      await query('DELETE FROM incidents WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
      for (const row of evidence.rows) {
        if (!row.storage_key) continue;
        const absolute = path.resolve(mediaRoot, row.storage_key);
        if (absolute.startsWith(path.resolve(mediaRoot) + path.sep)) await rm(absolute, { force: true }).catch(() => undefined);
      }
      ok(res, { deleted: true });
    } catch (error) { next(error); }
  });

  app.get('/media/incidents/:userId/:incidentId/:filename', async (req, res, next) => {
    try {
      const { userId, incidentId, filename } = req.params;
      if (![userId, incidentId, filename].every(value => /^[A-Za-z0-9._-]+$/.test(value))) {
        return fail(res, 400, 'invalid_path', 'Invalid media path');
      }
      const filePath = path.resolve(mediaRoot, 'incidents', userId, incidentId, filename);
      if (!filePath.startsWith(path.resolve(mediaRoot) + path.sep)) return fail(res, 400, 'invalid_path', 'Invalid media path');
      const bytes = await readFile(filePath);
      const extension = path.extname(filename).toLowerCase();
      const contentType = extension === '.png' ? 'image/png' : extension === '.webp' ? 'image/webp' : 'image/jpeg';
      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.send(bytes);
    } catch (error) {
      if (error?.code === 'ENOENT') return fail(res, 404, 'not_found', 'Media not found');
      next(error);
    }
  });
}
