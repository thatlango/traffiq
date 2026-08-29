import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config } from './config.js';
import { checkDatabase, pool } from './db.js';
import { runMigrations } from '../scripts/migrate.js';
import { registerMobileCompatibilityFixes } from './mobile-compat-fixes.js';
import { registerMobileCompatibility } from './mobile-compat.js';
import { registerWebRuntime } from './web-runtime.js';
import { registerWebGeo } from './web-geo.js';
import { registerWebPublic } from './web-public.js';
import { registerMobileCompatibilityExtra } from './mobile-compat-extra.js';
import { registerMobileMedia } from './mobile-media.js';
import { registerWebClientExtra } from './web-client-extra.js';

const app = express();
app.set('trust proxy', 1);
app.use(helmet());
app.use(express.json({ limit: '2mb' }));
app.use(cors({
  origin(origin, cb) {
    if (!origin || config.corsOrigins.length === 0 || config.corsOrigins.includes(origin)) return cb(null, true);
    return cb(new Error('Origin not allowed'));
  }
}));

app.get('/health', async (_req, res, next) => {
  try { res.json({ ok: true, service: 'traffiq-client-adapter', dbTime: await checkDatabase() }); }
  catch (error) { next(error); }
});

registerMobileCompatibilityFixes(app);
registerWebClientExtra(app);
registerMobileCompatibility(app);
registerWebGeo(app);
registerWebPublic(app);
// First-party Web runtime comes before the legacy extra layer because it owns
// the unified /shared-trips reader for journey and standalone live shares.
registerWebRuntime(app);
registerMobileCompatibilityExtra(app);
registerMobileMedia(app);

app.use((req, res) => res.status(404).json({ data: null, error: { code: 'not_found', message: `No client route for ${req.path}`, details: null } }));
app.use((error, _req, res, _next) => {
  console.error(error);
  if (error.message === 'Origin not allowed') return res.status(403).json({ data: null, error: { code: 'origin_not_allowed', message: 'Origin not allowed', details: null } });
  if (error?.type === 'entity.too.large') return res.status(413).json({ data: null, error: { code: 'payload_too_large', message: 'Upload is too large', details: null } });
  res.status(error.status || 500).json({ data: null, error: { code: error.message || 'internal_error', message: error.status ? error.message : 'Internal server error', details: error.details || null } });
});

const port = Number(process.env.MOBILE_PORT || 10001);
async function start() {
  if (config.autoMigrate) await runMigrations();
  await checkDatabase();
  app.listen(port, '0.0.0.0', () => console.log(`TraffIQ client compatibility API listening on :${port}`));
}

start().catch(async error => {
  console.error('failed to start TraffIQ client compatibility API', error);
  await pool.end();
  process.exit(1);
});
