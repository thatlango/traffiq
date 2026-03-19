import { Router } from "express";
import { Pool } from "pg";

const router = Router();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// POST /api/auth/register — upsert user after Google auth
router.post("/auth/register", async (req, res) => {
  const { googleId, email, name, avatarUrl, platform } = req.body;
  if (!email || !name) return res.status(400).json({ error: "email and name required" });

  try {
    const result = await pool.query(
      `INSERT INTO users (google_id, email, name, avatar_url, device_platform)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (email) DO UPDATE
         SET google_id = COALESCE(EXCLUDED.google_id, users.google_id),
             name = EXCLUDED.name,
             avatar_url = COALESCE(EXCLUDED.avatar_url, users.avatar_url),
             device_platform = EXCLUDED.device_platform,
             last_active = NOW()
       RETURNING *`,
      [googleId ?? null, email, name, avatarUrl ?? null, platform ?? "unknown"]
    );
    res.json(result.rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/users/:id/heartbeat — update last_active
router.patch("/users/:id/heartbeat", async (req, res) => {
  try {
    await pool.query(
      `UPDATE users SET last_active = NOW() WHERE google_id = $1 OR id::text = $1`,
      [req.params.id]
    );
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/journeys — save completed journey
router.post("/journeys", async (req, res) => {
  const { userId, journeyId, mode, startedAt, endedAt, distanceKm, maxSpeed, avgSpeed, overspeedEvents, safetyScore, startLat, startLng } = req.body;
  try {
    await pool.query(
      `INSERT INTO journeys (id, user_id, mode, started_at, ended_at, distance_km, max_speed, avg_speed, overspeed_events, safety_score, start_lat, start_lng)
       VALUES ($1, (SELECT id FROM users WHERE google_id = $2 OR id::text = $2 LIMIT 1), $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (id) DO NOTHING`,
      [journeyId, userId, mode, new Date(startedAt), endedAt ? new Date(endedAt) : null, distanceKm ?? 0, maxSpeed ?? 0, avgSpeed ?? 0, overspeedEvents ?? 0, safetyScore ?? 100, startLat ?? null, startLng ?? null]
    );
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/incidents — save incident report
router.post("/incidents", async (req, res) => {
  const { userId, incidentId, type, description, latitude, longitude } = req.body;
  try {
    await pool.query(
      `INSERT INTO incidents (id, user_id, type, description, latitude, longitude)
       VALUES ($1, (SELECT id FROM users WHERE google_id = $2 OR id::text = $2 LIMIT 1), $3, $4, $5, $6)
       ON CONFLICT (id) DO NOTHING`,
      [incidentId, userId, type, description ?? null, latitude ?? null, longitude ?? null]
    );
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/incidents/:id/confirm — admin: increment confirmed count
router.patch("/incidents/:id/confirm", async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE incidents SET confirmed = confirmed + 1 WHERE id = $1 RETURNING id, confirmed`,
      [req.params.id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: "incident not found" });
    res.json(result.rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/incidents/:id/dismiss — admin: set confirmed to -1 (dismissed)
router.patch("/incidents/:id/dismiss", async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE incidents SET confirmed = -1 WHERE id = $1 RETURNING id, confirmed`,
      [req.params.id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: "incident not found" });
    res.json(result.rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/analytics/overview
router.get("/analytics/overview", async (_req, res) => {
  try {
    const [totalUsers, activeToday, totalJourneys, totalIncidents, liveUsers, newSignups] = await Promise.all([
      pool.query("SELECT COUNT(*) FROM users"),
      pool.query("SELECT COUNT(*) FROM users WHERE last_active > NOW() - INTERVAL '24 hours'"),
      pool.query("SELECT COUNT(*) FROM journeys"),
      pool.query("SELECT COUNT(*) FROM incidents"),
      pool.query("SELECT COUNT(*) FROM users WHERE last_active > NOW() - INTERVAL '5 minutes'"),
      pool.query("SELECT COUNT(*) FROM users WHERE created_at > NOW() - INTERVAL '7 days'"),
    ]);

    const safetyAvg = await pool.query("SELECT ROUND(AVG(safety_score)) AS avg FROM journeys WHERE safety_score > 0");

    res.json({
      totalUsers: parseInt(totalUsers.rows[0].count),
      activeToday: parseInt(activeToday.rows[0].count),
      totalJourneys: parseInt(totalJourneys.rows[0].count),
      totalIncidents: parseInt(totalIncidents.rows[0].count),
      liveUsers: parseInt(liveUsers.rows[0].count),
      newSignupsThisWeek: parseInt(newSignups.rows[0].count),
      averageSafetyScore: parseInt(safetyAvg.rows[0].avg) || 0,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/analytics/users — paginated user list
router.get("/analytics/users", async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
  const offset = parseInt(req.query.offset as string) || 0;
  try {
    const result = await pool.query(
      `SELECT id, email, name, avatar_url, device_platform, created_at, last_active,
              signup_city, signup_country,
              CASE WHEN last_active > NOW() - INTERVAL '5 minutes' THEN true ELSE false END AS is_live
       FROM users ORDER BY last_active DESC LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    const countRes = await pool.query("SELECT COUNT(*) FROM users");
    res.json({ users: result.rows, total: parseInt(countRes.rows[0].count) });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/analytics/signups-by-city
router.get("/analytics/signups-by-city", async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT signup_city AS city, signup_country AS country,
              COUNT(*) AS count,
              AVG(signup_lat) AS lat, AVG(signup_lng) AS lng
       FROM users WHERE signup_city IS NOT NULL
       GROUP BY signup_city, signup_country ORDER BY count DESC LIMIT 20`
    );
    res.json(result.rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/analytics/daily-signups — last 30 days
router.get("/analytics/daily-signups", async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT DATE(created_at AT TIME ZONE 'Africa/Kampala') AS day,
              COUNT(*) AS count
       FROM users
       WHERE created_at > NOW() - INTERVAL '30 days'
       GROUP BY day ORDER BY day ASC`
    );
    res.json(result.rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/analytics/daily-journeys — last 30 days
router.get("/analytics/daily-journeys", async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT DATE(started_at AT TIME ZONE 'Africa/Kampala') AS day,
              COUNT(*) AS count,
              ROUND(AVG(safety_score)) AS avg_score
       FROM journeys
       WHERE started_at > NOW() - INTERVAL '30 days'
       GROUP BY day ORDER BY day ASC`
    );
    res.json(result.rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/analytics/recent-incidents — with server-side filter + pagination
router.get("/analytics/recent-incidents", async (req, res) => {
  const limit  = Math.min(parseInt(req.query.limit  as string) || 100, 500);
  const offset = parseInt(req.query.offset as string) || 0;
  const type   = req.query.type   as string | undefined;
  const days   = parseInt(req.query.days as string) || 0;

  const conditions: string[] = [];
  const params: any[] = [];
  let idx = 1;

  if (type && type !== "all") { conditions.push(`i.type = $${idx++}`); params.push(type); }
  if (days > 0) { conditions.push(`i.created_at > NOW() - INTERVAL '${days} days'`); }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  try {
    const [rows, total] = await Promise.all([
      pool.query(
        `SELECT i.*, u.name AS reporter_name, u.device_platform
         FROM incidents i
         LEFT JOIN users u ON u.id = i.user_id
         ${where}
         ORDER BY i.created_at DESC
         LIMIT $${idx++} OFFSET $${idx++}`,
        [...params, limit, offset]
      ),
      pool.query(
        `SELECT COUNT(*) FROM incidents i ${where}`,
        params
      ),
    ]);
    res.json({ incidents: rows.rows, total: parseInt(total.rows[0].count) });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/analytics/incidents-stats — summary for dashboard
router.get("/analytics/incidents-stats", async (_req, res) => {
  try {
    const [byType, daily, summary] = await Promise.all([
      pool.query(
        `SELECT type, COUNT(*) AS count, ROUND(AVG(confirmed)) AS avg_confirmed
         FROM incidents GROUP BY type ORDER BY count DESC`
      ),
      pool.query(
        `SELECT DATE(created_at AT TIME ZONE 'Africa/Kampala') AS day, COUNT(*) AS count
         FROM incidents
         WHERE created_at > NOW() - INTERVAL '14 days'
         GROUP BY day ORDER BY day ASC`
      ),
      pool.query(
        `SELECT
           COUNT(*) AS total,
           ROUND(AVG(confirmed)) AS avg_confirmed,
           COUNT(*) FILTER (WHERE latitude IS NOT NULL AND longitude IS NOT NULL) AS with_location,
           COUNT(*) FILTER (WHERE confirmed > 0) AS verified,
           COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours') AS today
         FROM incidents`
      ),
    ]);

    res.json({
      byType: byType.rows,
      daily:  daily.rows,
      summary: summary.rows[0],
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/analytics/transport-modes — pie chart data
router.get("/analytics/transport-modes", async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT mode, COUNT(*) AS count FROM journeys GROUP BY mode ORDER BY count DESC`
    );
    res.json(result.rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
