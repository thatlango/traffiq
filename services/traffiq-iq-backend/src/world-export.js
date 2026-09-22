import { timingSafeEqual } from 'node:crypto';
import { config } from './config.js';
import { query } from './db.js';

function incidentLabel(type) {
  return String(type || 'incident')
    .split(/[_-]+/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function iso(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('invalid_world_source_timestamp');
  return date.toISOString();
}

export function buildTraffiqWorldBatch(rows, asOf = new Date().toISOString()) {
  const entities = rows
    .map(row => ({
      id: 'traffiq:incident:' + row.id,
      type: 'traffic_incident',
      label: incidentLabel(row.type),
      observedAt: iso(row.updated_at ?? row.occurred_at),
      location: {
        latitude: Number(row.lat),
        longitude: Number(row.lng),
      },
      properties: {
        incidentType: String(row.type),
        severity: String(row.severity),
        status: String(row.status),
        occurredAt: iso(row.occurred_at),
        confirmations: Number(row.confirmations ?? 0),
        disputes: Number(row.disputes ?? 0),
      },
      confidence: {
        level: 'observed',
        basis: 'TraffIQ incident observation; not an enforcement or verified road-authority determination.',
      },
      provenance: [{
        sourceId: 'traffiq',
        sourceLabel: 'TraffIQ',
        fetchedAt: asOf,
        evidenceId: String(row.id),
      }],
    }))
    .sort((a, b) => a.id.localeCompare(b.id));

  const events = rows
    .map(row => ({
      id: 'traffiq:event:incident:' + row.id,
      type: 'traffic.incident.observed',
      occurredAt: iso(row.occurred_at),
      entityIds: ['traffiq:incident:' + row.id],
      properties: {
        incidentType: String(row.type),
        severity: String(row.severity),
        status: String(row.status),
      },
      confidence: {
        level: 'observed',
        basis: 'TraffIQ incident observation.',
      },
      provenance: [{
        sourceId: 'traffiq',
        sourceLabel: 'TraffIQ',
        fetchedAt: asOf,
        evidenceId: String(row.id),
      }],
    }))
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.id.localeCompare(b.id));

  return {
    sourceId: 'traffiq',
    asOf,
    entities,
    relations: [],
    events,
  };
}

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
