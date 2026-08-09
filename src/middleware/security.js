// Security headers middleware
function securityHeaders(req, res, next) {
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline' https://accounts.google.com https://js.stripe.com; " +
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
    "frame-src https://js.stripe.com https://accounts.google.com; " +
    "connect-src 'self' https://api.openrouter.ai https://api.stripe.com; " +
    "img-src 'self' data: blob: https:; " +
    "font-src 'self' https://fonts.gstatic.com;"
  );
  next();
}

// CSRF check for state-changing requests (POST/PUT/PATCH/DELETE on /api)
function csrfProtection(req, res, next) {
  if (['POST','PUT','PATCH','DELETE'].includes(req.method) && req.path.startsWith('/api')) {
    const origin = req.get('origin');
    const referer = req.get('referer');
    const host = req.get('host');
    if (origin && !origin.endsWith(host) && !host.endsWith(origin.replace(/^https?:\/\//, ''))) {
      return res.status(403).json({ error: 'CSRF check failed' });
    }
  }
  next();
}

module.exports = { securityHeaders, csrfProtection };
