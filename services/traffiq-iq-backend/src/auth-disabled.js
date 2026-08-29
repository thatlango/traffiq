export function registerDisabledAuthRoutes(app) {
  // Google OAuth is intentionally disabled until Tuku Auth replaces the
  // temporary TraffIQ first-party email/password session system.
  app.all('/v1/auth/google', (_req, res) => {
    res.status(404).json({
      data: null,
      error: {
        code: 'not_found',
        message: 'Google sign-in is not available',
        details: null,
      },
    });
  });
}
