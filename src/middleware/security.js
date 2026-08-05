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

module.exports = { securityHeaders };
