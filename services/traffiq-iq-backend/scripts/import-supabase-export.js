import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { pool, query, transaction } from '../src/db.js';
import { hashPassword, normalizeEmail, sha256 } from '../src/auth.js';
import { runMigrations } from './migrate.js';

const exportDir = path.resolve(process.argv[2] || process.env.SUPABASE_EXPORT_DIR || './supabase-export');
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function stableUuid(seed) {
  const hex = createHash('sha256').update(String(seed)).digest('hex').slice(0, 32).split('');
  hex[12] = '4';
  hex[16] = ['8', '9', 'a', 'b'][parseInt(hex[16], 16) % 4];
  const s = hex.join('');
  return `${s.slice(0,8)}-${s.slice(8,12)}-${s.slice(12,16)}-${s.slice(16,20)}-${s.slice(20)}`;
}

function sourceTable(filename) {
  return filename.replace(/\.jsonl$/i, '').replace(/-\d+$/,'');
}

async function readRows(file) {
  const raw = await fs.readFile(path.join(exportDir, file), 'utf8');
  return raw.split(/\r?\n/).filter(Boolean).map((line, index) => {
    try { return JSON.parse(line); }
    catch (error) { throw new Error(`${file}:${index + 1}: ${error.message}`); }
  });
}

function rowKey(table, row, index) {
  if (row.id != null) return String(row.id);
  if (row.token != null) return String(row.token);
  if (row.user_id != null && row.created_at != null) return `${row.user_id}:${row.created_at}`;
  return createHash('sha256').update(`${table}:${index}:${JSON.stringify(row)}`).digest('hex');
}

function modeOf(row) {
  const raw = String(row.transport_mode || row.vehicle || row.mode || 'car').toLowerCase();
  if (['boda','boda_boda','motorbike','motorcycle'].includes(raw)) return 'motorcycle';
  if (['matatu','taxi'].includes(raw)) return 'taxi';
  return ['car','bus','truck','bicycle','walking','other'].includes(raw) ? raw : 'car';
}

function journeyStatus(row) {
  if (row.ended_at || row.end_reason || row.auto_ended_at) return row.end_reason === 'cancelled' ? 'cancelled' : 'completed';
  return row.started_at ? 'completed' : 'planned';
}

async function archiveAll(files) {
  let archived = 0;
  for (const file of files) {
    const table = sourceTable(file);
    const rows = await readRows(file);
    await transaction(async (client) => {
      for (let i = 0; i < rows.length; i += 1) {
        await client.query(
          `INSERT INTO legacy_supabase_rows(source_table,source_key,row_data)
           VALUES($1,$2,$3::jsonb)
           ON CONFLICT(source_table,source_key) DO UPDATE SET row_data=EXCLUDED.row_data, imported_at=now()`,
          [table, rowKey(table, rows[i], i), JSON.stringify(rows[i])]
        );
      }
    });
    archived += rows.length;
    console.log(`archived ${rows.length} ${table} rows from ${file}`);
  }
  return archived;
}

async function collect(files, table) {
  const matched = files.filter((file) => sourceTable(file) === table).sort();
  const out = [];
  for (const file of matched) out.push(...await readRows(file));
  return out;
}

async function importUsers(files) {
  const users = await collect(files, 'users');
  const identities = await collect(files, 'identities');
  const profiles = await collect(files, 'profiles');
  const profileById = new Map(profiles.map((row) => [row.id, row]));
  const googleByUser = new Map(
    identities.filter((row) => row.provider === 'google').map((row) => [row.user_id, row.identity_data?.sub || row.identity_data?.provider_id || null])
  );

  for (const user of users) {
    if (!user.id || !user.email) continue;
    const profile = profileById.get(user.id) || {};
    const meta = user.raw_user_meta_data || {};
    const displayName = profile.display_name || profile.full_name || meta.full_name || meta.name || normalizeEmail(user.email).split('@')[0];
    const passwordHash = user.encrypted_password || await hashPassword(randomBytes(32).toString('base64url'));
    const googleSubject = googleByUser.get(user.id) || meta.provider_id || null;
    await query(
      `INSERT INTO users(id,email,phone,display_name,password_hash,status,created_at,updated_at,google_subject,city,avatar_url,preferences)
       VALUES($1,$2,$3,$4,$5,'active',COALESCE($6::timestamptz,now()),COALESCE($7::timestamptz,now()),$8,$9,$10,$11::jsonb)
       ON CONFLICT(id) DO UPDATE SET
         email=EXCLUDED.email,
         phone=COALESCE(EXCLUDED.phone,users.phone),
         display_name=EXCLUDED.display_name,
         password_hash=EXCLUDED.password_hash,
         updated_at=GREATEST(users.updated_at,EXCLUDED.updated_at),
         google_subject=COALESCE(EXCLUDED.google_subject,users.google_subject),
         city=COALESCE(EXCLUDED.city,users.city),
         avatar_url=COALESCE(EXCLUDED.avatar_url,users.avatar_url),
         preferences=CASE WHEN EXCLUDED.preferences='{}'::jsonb THEN users.preferences ELSE EXCLUDED.preferences END`,
      [user.id, normalizeEmail(user.email), profile.phone || user.phone || null, displayName, passwordHash,
       user.created_at || null, user.updated_at || null, googleSubject, profile.city || null,
       profile.avatar_url || meta.avatar_url || meta.picture || null, JSON.stringify(profile.preferences || {})]
    );
  }
  console.log(`canonical users: ${users.length}`);
}

async function importTrustedPeople(files) {
  const rows = await collect(files, 'trusted_people');
  for (const row of rows) {
    if (!row.id || !row.user_id || !row.name || !row.phone) continue;
    await query(
      `INSERT INTO trusted_people(id,user_id,name,phone,email,relationship,note,invite_status,invite_token_hash,invite_expires_at,
         can_view_live_trips,can_receive_emergency_alerts,can_receive_incident_updates,is_default_share_contact,is_emergency_contact,created_at,updated_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,COALESCE($16::timestamptz,now()),COALESCE($17::timestamptz,now()))
       ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,phone=EXCLUDED.phone,email=EXCLUDED.email,relationship=EXCLUDED.relationship,
         note=EXCLUDED.note,invite_status=EXCLUDED.invite_status,can_view_live_trips=EXCLUDED.can_view_live_trips,
         can_receive_emergency_alerts=EXCLUDED.can_receive_emergency_alerts,can_receive_incident_updates=EXCLUDED.can_receive_incident_updates,
         is_default_share_contact=EXCLUDED.is_default_share_contact,is_emergency_contact=EXCLUDED.is_emergency_contact,updated_at=EXCLUDED.updated_at`,
      [row.id,row.user_id,row.name,row.phone,row.email||null,row.relationship||null,row.note||null,row.invite_status||'pending',
       row.invite_token_hash||null,row.invite_expires_at||null,row.can_view_live_trips!==false,row.can_receive_emergency_alerts!==false,
       row.can_receive_incident_updates!==false,Boolean(row.is_default_share_contact),Boolean(row.is_emergency_contact),row.created_at||null,row.updated_at||null]
    );
  }
  console.log(`canonical trusted_people: ${rows.length}`);
}

async function importJourneys(files) {
  const rows = await collect(files, 'journeys');
  let pointCount = 0;
  for (const row of rows) {
    if (!row.id || !row.user_id) continue;
    const clientId = UUID_RE.test(String(row.client_journey_id || '')) ? row.client_journey_id : row.id;
    const pathPoints = Array.isArray(row.path) ? row.path : [];
    const last = pathPoints[pathPoints.length - 1] || null;
    await query(
      `INSERT INTO journeys(id,user_id,client_id,mode,status,origin_name,origin_lat,origin_lng,destination_name,destination_lat,destination_lng,
         started_at,ended_at,last_lat,last_lng,last_location_at,distance_m,duration_s,created_at,updated_at,journey_role,purpose,end_reason)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,COALESCE($19::timestamptz,now()),COALESCE($20::timestamptz,now()),$21,$22,$23)
       ON CONFLICT(id) DO UPDATE SET mode=EXCLUDED.mode,status=EXCLUDED.status,origin_name=EXCLUDED.origin_name,origin_lat=EXCLUDED.origin_lat,
         origin_lng=EXCLUDED.origin_lng,destination_name=EXCLUDED.destination_name,destination_lat=EXCLUDED.destination_lat,destination_lng=EXCLUDED.destination_lng,
         started_at=EXCLUDED.started_at,ended_at=EXCLUDED.ended_at,last_lat=EXCLUDED.last_lat,last_lng=EXCLUDED.last_lng,last_location_at=EXCLUDED.last_location_at,
         distance_m=EXCLUDED.distance_m,duration_s=EXCLUDED.duration_s,updated_at=EXCLUDED.updated_at,journey_role=EXCLUDED.journey_role,purpose=EXCLUDED.purpose,end_reason=EXCLUDED.end_reason`,
      [row.id,row.user_id,clientId,modeOf(row),journeyStatus(row),row.origin_label||null,row.origin_lat??null,row.origin_lng??null,
       row.destination_label||null,row.destination_lat??null,row.destination_lng??null,row.started_at||null,row.ended_at||row.auto_ended_at||null,
       last?.lat??null,last?.lng??null,last?.recorded_at||row.last_activity_at||row.ended_at||null,Number(row.distance_m||0),Number(row.duration_s||0),
       row.created_at||row.started_at||null,row.last_activity_at||row.ended_at||row.created_at||null,row.journey_role||null,row.purpose||'personal',row.end_reason||null]
    );

    for (let i = 0; i < pathPoints.length; i += 1) {
      const p = pathPoints[i];
      if (!Number.isFinite(Number(p?.lat)) || !Number.isFinite(Number(p?.lng))) continue;
      const pointId = stableUuid(`${row.id}:${p.recorded_at || i}:${p.lat}:${p.lng}`);
      await query(
        `INSERT INTO journey_points(journey_id,client_point_id,lat,lng,accuracy_m,speed_mps,bearing_deg,altitude_m,recorded_at,source)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,COALESCE($9::timestamptz,$10::timestamptz,now()),'legacy_supabase')
         ON CONFLICT(journey_id,client_point_id) DO NOTHING`,
        [row.id,pointId,Number(p.lat),Number(p.lng),p.accuracy??null,p.speed??null,p.heading??null,p.altitude??null,p.recorded_at||null,row.started_at||row.created_at||null]
      );
      pointCount += 1;
    }
  }
  console.log(`canonical journeys: ${rows.length}; path points: ${pointCount}`);
}

async function importLiveShares(files) {
  const rows = await collect(files, 'live_shares');
  for (const row of rows) {
    if (!row.id || !row.user_id || !row.token) continue;
    const expiresAt = row.expires_at || new Date(Date.now() + 24 * 3600_000).toISOString();
    await query(
      `INSERT INTO live_shares(id,user_id,token_hash,display_name,lat,lng,accuracy,heading,speed,active,expires_at,last_updated_at,created_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,COALESCE($12::timestamptz,now()),COALESCE($13::timestamptz,now()))
       ON CONFLICT(id) DO UPDATE SET token_hash=EXCLUDED.token_hash,display_name=EXCLUDED.display_name,lat=EXCLUDED.lat,lng=EXCLUDED.lng,
         accuracy=EXCLUDED.accuracy,heading=EXCLUDED.heading,speed=EXCLUDED.speed,active=EXCLUDED.active,expires_at=EXCLUDED.expires_at,last_updated_at=EXCLUDED.last_updated_at`,
      [row.id,row.user_id,sha256(row.token),row.display_name||null,row.lat??null,row.lng??null,row.accuracy??null,row.heading??null,row.speed??null,
       row.active!==false,expiresAt,row.location_updated_at||row.updated_at||null,row.created_at||null]
    );
  }
  console.log(`canonical live_shares: ${rows.length}`);
}

async function main() {
  const files = (await fs.readdir(exportDir)).filter((file) => file.endsWith('.jsonl')).sort();
  if (!files.length) throw new Error(`No .jsonl exports found in ${exportDir}`);
  await runMigrations();
  const archived = await archiveAll(files);
  await importUsers(files);
  await importTrustedPeople(files);
  await importJourneys(files);
  await importLiveShares(files);
  console.log(`migration complete: ${archived} source rows archived from ${files.length} files`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  await pool.end();
});
