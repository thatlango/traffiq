# TraffIQ IQ Backend

Independent backend for the TraffIQ Android and iOS applications. It has no Lovable runtime or SDK dependency. Mobile clients talk only to this API; PostgreSQL remains private behind the service.

## V1 responsibilities

- first-party account authentication with short-lived access tokens and rotating refresh tokens
- device registration for Android/iOS push-token readiness
- server-side place search and route preview so API keys/providers are not embedded in mobile apps
- journey lifecycle: plan, start, pause, GPS point batches, completion and server-computed journey statistics
- offline-safe ingestion using client-generated UUIDs and uniqueness constraints
- incidents, evidence metadata, nearby incident feeds and community confirmation/dispute voting
- expiring journey-share tokens for live-location sharing
- sync pull cursor for restoring mobile state after offline periods
- notification outbox ready for FCM/APNs workers

## API surface

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | service/database health |
| GET | `/v1/meta` | mobile capabilities and enums |
| POST | `/v1/auth/register` | create account |
| POST | `/v1/auth/login` | sign in |
| POST | `/v1/auth/refresh` | rotate refresh token |
| POST | `/v1/auth/logout` | revoke refresh token |
| PUT | `/v1/devices/current` | register/update device |
| GET | `/v1/geo/search` | place search proxy |
| POST | `/v1/routes/preview` | road-following route alternatives |
| POST/GET | `/v1/journeys` | create/list journeys |
| POST | `/v1/journeys/:id/start` | begin journey |
| POST | `/v1/journeys/:id/pause` | pause tracking |
| POST | `/v1/journeys/:id/points` | idempotent GPS batch ingestion (max 500) |
| POST | `/v1/journeys/:id/end` | complete and finalize stats |
| POST | `/v1/journeys/:id/share` | create share token |
| GET | `/public/journeys/:token` | restricted public live journey view |
| POST | `/v1/incidents` | report incident |
| GET | `/v1/incidents/nearby` | nearby active incidents |
| PUT | `/v1/incidents/:id/vote` | confirm/dispute report |
| GET | `/v1/sync/pull?since=...` | restore user-owned changed records |

## Mobile contract rules

1. Generate a UUID on-device before creating a journey, incident or GPS point. Retry the same UUID until acknowledged.
2. Buffer GPS points locally when connectivity disappears. Send batches when connectivity returns. Do not end a journey merely because data is offline.
3. Treat `serverTime` from sync responses as the next pull cursor.
4. Route preview returns GeoJSON road geometry; clients must draw that geometry instead of a straight origin/destination line.
5. Public journey links expose only live journey state and location, never the owner's email/phone.

## Local development

```bash
cp .env.example .env
npm install
npm run migrate
npm start
```

The service can auto-run versioned migrations on startup with `AUTO_MIGRATE=true`.

## Infrastructure

Recommended first deployment: Render web service + PostgreSQL, both in Frankfurt. For production, move from free infrastructure to a persistent paid database before the pilot carries real user data. Object storage (incident photos), FCM/APNs delivery workers, rate limiting and observability are deliberately separate follow-on services rather than hidden inside the mobile clients.
