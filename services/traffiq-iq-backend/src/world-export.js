import { timingSafeEqual } from 'node:crypto';
import { config } from './config.js';
import { query } from './db.js';

import { buildTraffiqWorldBatch, worldIso as iso } from './world-contract.js';

function encodeCursor(row) {
  if (!row) return null;
  return Buffer.from(JSON.stringify({
    at: iso(row.updated_at ?? row.occurred_at),
    id: String(row.id),
  }), 'utf8').toString('base64url');
}

function decodeCursor(value) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (
      typeof parsed?.at !== 'string' ||
      !Number.isFinite(Date.parse(parsed.at)) ||
      typeof parsed?.id !== 'string' ||
      !parsed.id
    ) {
      throw new Error('invalid');
    }
    return { at: new Date(parsed.at), id: parsed.id };
  } catch {
    const error = new Error('invalid_world_export_cursor');
    error.status = 400;
    throw error;
  }
}

export function assertWorldReadKey(supplied) {
  if (!config.worldReadKey) {
    const error = new Error('world_export_not_configured');
    error.status = 503;
    throw error;
  }
  const actual = Buffer.from(config.worldReadKey);
  const candidate = Buffer.from(String(supplied ?? ''));
  if (actual.length !== candidate.length || !timingSafeEqual(actual, candidate)) {
    const error = new Error('world_export_unauthorized');
    error.status = 401;
    throw error;
  }
}

export async function loadTraffiqWorldBatch({ cursor, limit = 250 } = {}) {
  const parsedCursor = decodeCursor(cursor);
  const safeLimit = Math.max(1, Math.min(1000, Number(limit) || 250));
  const result = parsedCursor
    ? await query(
        `SELECT id,type,severity,status,lat,lng,occurred_at,confirmations,disputes,updated_at
         FROM incidents
         WHERE (updated_at > $1 OR (updated_at = $1 AND id > $2::uuid))
         ORDER BY updated_at ASC,id ASC
         LIMIT $3`,
        [parsedCursor.at, parsedCursor.id, safeLimit],
      )
    : await query(
        `SELECT id,type,severity,status,lat,lng,occurred_at,confirmations,disputes,updated_at
         FROM incidents
         ORDER BY updated_at ASC,id ASC
         LIMIT $1`,
        [safeLimit],
      );

  const asOf = new Date().toISOString();
  const batch = buildTraffiqWorldBatch(result.rows, asOf);
  return {
    ...batch,
    nextCursor: result.rows.length === safeLimit
      ? encodeCursor(result.rows[result.rows.length - 1])
      : null,
    count: result.rows.length,
  };
}
