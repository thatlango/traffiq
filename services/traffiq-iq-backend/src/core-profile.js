import { config } from './config.js';

export async function syncCanonicalProfile(coreUserId, patch) {
  if (!coreUserId) return null;
  if (!config.tukuProfileSyncKey) {
    const error = new Error('tuku_profile_sync_unavailable');
    error.status = 503;
    throw error;
  }
  const response = await fetch(`${config.tukuCoreUrl}/api/v1/identity/profile/bridge`, {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
      'x-tuku-product-code': 'traffiq',
      'x-tuku-profile-sync-key': config.tukuProfileSyncKey,
    },
    body: JSON.stringify({ coreUserId, ...patch }),
    signal: AbortSignal.timeout(15_000),
  });
  const envelope = await response.json().catch(() => null);
  const payload = envelope?.data ?? envelope;
  if (!response.ok) {
    const error = new Error(payload?.message || envelope?.error?.message || 'tuku_profile_sync_failed');
    error.status = response.status >= 400 && response.status < 500 ? response.status : 502;
    error.details = envelope?.error ?? payload ?? envelope ?? null;
    throw error;
  }
  return payload;
}
