const required = (name, fallback = undefined) => {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === '') throw new Error(`Missing environment variable: ${name}`);
  return value;
};

const int = (name, fallback) => {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(value)) throw new Error(`Invalid numeric environment variable: ${name}`);
  return value;
};

export const config = {
  env: process.env.NODE_ENV ?? 'development',
  port: int('PORT', 10000),
  databaseUrl: required('DATABASE_URL'),
  autoMigrate: (process.env.AUTO_MIGRATE ?? 'true').toLowerCase() === 'true',
  jwtSecret: required('JWT_SECRET'),
  accessTokenMinutes: int('ACCESS_TOKEN_MINUTES', 15),
  refreshTokenDays: int('REFRESH_TOKEN_DAYS', 30),
  corsOrigins: (process.env.CORS_ORIGINS ?? '').split(',').map(v => v.trim()).filter(Boolean),
  publicApiBaseUrl: process.env.PUBLIC_API_BASE_URL ?? '',
  publicWebBaseUrl: process.env.PUBLIC_WEB_BASE_URL ?? '',
  routingBaseUrl: process.env.ROUTING_BASE_URL ?? 'https://router.project-osrm.org',
  geocodingBaseUrl: process.env.GEOCODING_BASE_URL ?? 'https://nominatim.openstreetmap.org',
  geocodingUserAgent: process.env.GEOCODING_USER_AGENT ?? 'TraffIQ/1.0'
};

if (config.jwtSecret.length < 32) {
  throw new Error('JWT_SECRET must be at least 32 characters');
}
