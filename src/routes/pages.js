const express = require('express');
const path = require('path');
const pool = require('../db/pool');
const { serverError } = require('../utils/errors');

const router = express.Router();
const rootDir = path.join(__dirname, '..', '..');

// Static HTML pages
router.get('/', (req, res) => res.sendFile(path.join(rootDir, 'index.html')));
router.get('/index.html', (req, res) => res.sendFile(path.join(rootDir, 'index.html')));
router.get('/pricing', (req, res) => res.sendFile(path.join(rootDir, 'pricing.html')));
router.get('/privacy', (req, res) => res.sendFile(path.join(rootDir, 'privacy.html')));
router.get('/termini', (req, res) => res.sendFile(path.join(rootDir, 'termini.html')));
router.get('/p/:uuid', (req, res) => res.sendFile(path.join(rootDir, 'property.html')));
router.get('/p/:uuid/:slug', (req, res) => res.sendFile(path.join(rootDir, 'property.html')));
router.get('/robots.txt', (req, res) => res.sendFile(path.join(rootDir, 'robots.txt')));
router.get('/favicon.ico', (req, res) => res.sendFile(path.join(rootDir, 'favicon.ico')));
router.get('/favicon.png', (req, res) => res.sendFile(path.join(rootDir, 'favicon.png')));

// Sitemap
router.get('/sitemap.xml', async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT uuid, updated_at FROM properties WHERE is_public = TRUE AND status = 'published' AND description IS NOT NULL ORDER BY updated_at DESC LIMIT 1000"
    );
    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';
    xml += '  <url><loc>https://descrivicasa.it/</loc><changefreq>weekly</changefreq><priority>1.0</priority></url>\n';
    xml += '  <url><loc>https://descrivicasa.it/pricing</loc><changefreq>monthly</changefreq><priority>0.8</priority></url>\n';
    for (const r of rows) {
      xml += `  <url><loc>https://descrivicasa.it/p/${r.uuid}</loc><lastmod>${r.updated_at.toISOString().slice(0, 10)}</lastmod><changefreq>weekly</changefreq><priority>0.7</priority></url>\n`;
    }
    xml += '</urlset>';
    res.setHeader('Content-Type', 'application/xml');
    res.send(xml);
  } catch (err) {
    serverError(err, res, 'Sitemap');
  }
});

module.exports = router;
