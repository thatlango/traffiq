import { z } from 'zod';
import { authenticate } from './auth.js';
import {
  autocompletePlaces,
  nearbyPlaces,
  placeCategories,
  recentPlaces,
  recordPlaceSearch,
  recordPlaceSelection,
  resolvePlace
} from './geo.js';

const ok = (res, data, status = 200) => res.status(status).json({ data, error: null });
const fail = (res, status, code, message, details = null) => res.status(status).json({ data: null, error: { code, message, details } });

const parse = (schema, value) => {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const error = new Error('validation_error');
  error.status = 400;
  error.details = result.error.flatten();
  throw error;
};

const limits = new Map();
const consume = (key, max = 90, windowMs = 60_000) => {
  const now = Date.now();
  const current = limits.get(key);
  if (!current || current.resetAt <= now) {
    limits.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  current.count += 1;
  if (current.count > max) return false;
  if (limits.size > 5000) {
    for (const [itemKey, value] of limits) if (value.resetAt <= now) limits.delete(itemKey);
  }
  return true;
};

const commonQuery = z.object({
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
  limit: z.coerce.number().int().min(1).max(20).optional(),
  map_provider: z.enum(['google', 'open']).optional().default('open')
});

const resultSchema = z.object({
  id: z.string().max(300).optional(),
  provider_place_id: z.string().max(500).nullable().optional(),
  name: z.string().trim().min(1).max(300),
  detail: z.string().max(1000).nullable().optional(),
  formatted_address: z.string().max(1000).nullable().optional(),
  lat: z.coerce.number().min(-90).max(90).nullable().optional(),
  lng: z.coerce.number().min(-180).max(180).nullable().optional(),
  category: z.string().max(120).nullable().optional(),
  source: z.string().max(80)
}).passthrough();

export function registerPlacesApi(app) {
  app.get('/v1/geo/categories', authenticate, (_req, res) => ok(res, { categories: placeCategories }));

  app.get('/v1/geo/recent', authenticate, async (req, res, next) => {
    try {
      const params = parse(z.object({ limit: z.coerce.number().int().min(1).max(20).optional() }), req.query);
      ok(res, { results: await recentPlaces({ userId: req.user.id, limit: params.limit }) });
    } catch (error) { next(error); }
  });

  app.get('/v1/geo/autocomplete', authenticate, async (req, res, next) => {
    const started = Date.now();
    try {
      if (!consume(`autocomplete:${req.user.id}:${req.ip}`, 120)) {
        return fail(res, 429, 'rate_limited', 'Too many place searches. Please try again shortly.');
      }
      const params = parse(commonQuery.extend({
        q: z.string().trim().min(2).max(200),
        session_token: z.string().trim().min(8).max(200).optional()
      }), req.query);
      const result = await autocompletePlaces({
        userId: req.user.id,
        q: params.q,
        lat: params.lat,
        lng: params.lng,
        limit: params.limit,
        mapProvider: params.map_provider,
        sessionToken: params.session_token
      });
      await recordPlaceSearch({
        userId: req.user.id,
        q: params.q,
        lat: params.lat,
        lng: params.lng,
        provider: result.providers.join(','),
        resultCount: result.results.length,
        latencyMs: Date.now() - started,
        metadata: { kind: 'autocomplete', map_provider: params.map_provider, google_used: result.google_used }
      });
      ok(res, result);
    } catch (error) { next(error); }
  });

  app.get('/v1/geo/nearby', authenticate, async (req, res, next) => {
    const started = Date.now();
    try {
      if (!consume(`nearby:${req.user.id}:${req.ip}`, 90)) {
        return fail(res, 429, 'rate_limited', 'Too many nearby searches. Please try again shortly.');
      }
      const params = parse(commonQuery.extend({
        category: z.string().trim().min(2).max(80),
        lat: z.coerce.number().min(-90).max(90),
        lng: z.coerce.number().min(-180).max(180),
        radius_m: z.coerce.number().int().min(500).max(50000).optional()
      }), req.query);
      const result = await nearbyPlaces({
        userId: req.user.id,
        category: params.category,
        lat: params.lat,
        lng: params.lng,
        radiusM: params.radius_m,
        limit: params.limit,
        mapProvider: params.map_provider
      });
      await recordPlaceSearch({
        userId: req.user.id,
        q: params.category,
        lat: params.lat,
        lng: params.lng,
        provider: result.providers.join(','),
        resultCount: result.results.length,
        latencyMs: Date.now() - started,
        metadata: { kind: 'nearby', radius_m: result.radius_m, map_provider: params.map_provider, google_used: result.google_used }
      });
      ok(res, result);
    } catch (error) { next(error); }
  });

  app.get('/v1/geo/places/:source/:providerPlaceId', authenticate, async (req, res, next) => {
    try {
      const params = parse(z.object({
        source: z.enum(['google', 'traffiq', 'memory']),
        providerPlaceId: z.string().trim().min(1).max(500)
      }), req.params);
      const queryParams = parse(z.object({ session_token: z.string().trim().min(8).max(200).optional() }), req.query);
      const item = await resolvePlace({
        userId: req.user.id,
        provider: params.source,
        providerPlaceId: params.providerPlaceId,
        id: `${params.source}:${params.providerPlaceId}`,
        sessionToken: queryParams.session_token
      });
      if (!item) return fail(res, 404, 'place_not_found', 'Place could not be resolved');
      ok(res, item);
    } catch (error) { next(error); }
  });

  app.post('/v1/geo/selections', authenticate, async (req, res, next) => {
    try {
      const body = parse(z.object({
        q: z.string().max(200).optional().default(''),
        lat: z.coerce.number().min(-90).max(90).optional(),
        lng: z.coerce.number().min(-180).max(180).optional(),
        result: resultSchema
      }), req.body);
      await recordPlaceSelection({ userId: req.user.id, q: body.q, lat: body.lat, lng: body.lng, result: body.result });
      ok(res, { recorded: true }, 201);
    } catch (error) { next(error); }
  });
}
