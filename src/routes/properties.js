const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const pool = require('../db/pool');
const { UPLOAD_DIR, PLAN_CONFIG, PLAN_LIMITS } = require('../config');
const { authMiddleware } = require('../middleware/auth');
const { describePropertyWithData } = require('../services/ai/vision');
const { processUploadedFiles } = require('../services/image');
const { checkGenerationLimit } = require('../utils/limits');
const { extractTitle, injectContacts } = require('../utils/text');
const { serverError, aiError } = require('../utils/errors');
const { validate } = require('../utils/validate');
const { propertyDataSchema } = require('../utils/schemas');
const logger = require('pino')({ level: process.env.LOG_LEVEL || 'info' });

const router = express.Router();

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const session = crypto.randomUUID().slice(0, 12);
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, `${session}_${crypto.randomUUID().slice(0, 8)}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024, files: 5 },
  fileFilter: (req, file, cb) => {
    cb(null, ['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.mimetype));
  },
});

// Create property
router.post('/', authMiddleware, upload.array('files', 10), async (req, res) => {
  try {
    const data = typeof req.body.data === 'string' ? JSON.parse(req.body.data) : (req.body.data || req.body);
    const errors = validate(data, propertyDataSchema);
    if (errors) return res.status(400).json({ error: errors[0] });
    const uuid = crypto.randomUUID();
    const photoUrls = req.files ? req.files.map(f => `/media/uploads/${path.basename(f.path)}`) : [];

    await processUploadedFiles(req.files);

    await pool.query(
      `INSERT INTO properties (uuid, user_id, contract_type, property_type,
        address, civic, cap, city, province, zone, latitude, longitude,
        surface, rooms, bedrooms, bathrooms, floor, total_floors, elevator,
        building_state, year_built, energy_class, energy_index, heating, air_conditioning,
        exposure, balcony_sqm, garden_sqm, parking, basement, furnished,
        price, condo_fees, agent_name, agent_phone, agent_email, photos, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [uuid, req.user.id, data.contract_type || 'sell', data.property_type || 'apartment',
       data.address || null, data.civic || null, data.cap || null, data.city || null,
       data.province || null, data.zone || null, data.latitude || null, data.longitude || null,
       data.surface || null, data.rooms || null, data.bedrooms || null, data.bathrooms || null,
       data.floor ?? null, data.total_floors || null, data.elevator ? 1 : 0,
       data.building_state || null, data.year_built || null, data.energy_class || null,
       data.energy_index || null, data.heating || null, data.air_conditioning ? 1 : 0,
       data.exposure || null, data.balcony_sqm || null, data.garden_sqm || null,
       data.parking ? 1 : 0, data.basement ? 1 : 0, data.furnished || 'no',
       data.price || null, data.condo_fees || null,
       data.agent_name || null, data.agent_phone || null, data.agent_email || null,
       photoUrls.length > 0 ? JSON.stringify(photoUrls) : null,
       data.status || 'draft']
    );

    res.status(201).json({ uuid, message: 'Immobile creato' });
  } catch (err) {
    serverError(err, res, 'Create property');
  }
});

// List properties
router.get('/', authMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, uuid, contract_type, property_type, address, city, province, zone, surface, rooms, bedrooms, bathrooms, price, status, is_public, title, photos, description IS NOT NULL AS has_description, created_at, updated_at FROM properties WHERE user_id = ? ORDER BY updated_at DESC',
      [req.user.id]
    );
    // Normalize: ensure photos is always a parsed array & booleans are real booleans
    for (const r of rows) {
      if (typeof r.photos === 'string') { try { r.photos = JSON.parse(r.photos); } catch (_) { r.photos = []; } }
      if (!Array.isArray(r.photos)) r.photos = [];
      r.elevator = !!r.elevator;
      r.air_conditioning = !!r.air_conditioning;
      r.parking = !!r.parking;
      r.basement = !!r.basement;
      r.is_public = !!r.is_public;
    }
    res.json({ properties: rows });
  } catch (err) {
    serverError(err, res, 'List properties');
  }
});

// Get single property
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM properties WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Immobile non trovato' });
    const p = rows[0];
    p.photos = p.photos || [];
    p.elevator = !!p.elevator;
    p.air_conditioning = !!p.air_conditioning;
    p.parking = !!p.parking;
    p.basement = !!p.basement;
    p.is_public = !!p.is_public;
    res.json({ property: p });
  } catch (err) {
    serverError(err, res, 'Get property');
  }
});

// Update property
router.put('/:id', authMiddleware, upload.array('files', 10), async (req, res) => {
  try {
    const data = typeof req.body.data === 'string' ? JSON.parse(req.body.data) : (req.body.data || req.body);
    const errors = validate(data, propertyDataSchema);
    if (errors) return res.status(400).json({ error: errors[0] });
    const [existing] = await pool.query('SELECT photos FROM properties WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    if (existing.length === 0) return res.status(404).json({ error: 'Immobile non trovato' });

    let existingPhotos = [];
    try { existingPhotos = existing[0].photos || []; } catch (_) {}

    if (req.files && req.files.length > 0) {
      await processUploadedFiles(req.files);
      const newPhotos = req.files.map(f => `/media/uploads/${path.basename(f.path)}`);
      existingPhotos = [...existingPhotos, ...newPhotos];
    }

    await pool.query(
      `UPDATE properties SET contract_type=?, property_type=?, address=?, civic=?, cap=?, city=?,
       province=?, zone=?, latitude=?, longitude=?, surface=?, rooms=?,
       bedrooms=?, bathrooms=?, floor=?, total_floors=?, elevator=?,
       building_state=?, year_built=?, energy_class=?, energy_index=?,
       heating=?, air_conditioning=?, exposure=?, balcony_sqm=?, garden_sqm=?,
       parking=?, basement=?, furnished=?, price=?, condo_fees=?,
       agent_name=?, agent_phone=?, agent_email=?, photos=?,
       status=?, title=?, description=?
       WHERE id=? AND user_id=?`,
      [data.contract_type || 'sell', data.property_type || 'apartment',
       data.address !== undefined ? data.address : null,
       data.civic !== undefined ? data.civic : null,
       data.cap !== undefined ? data.cap : null,
       data.city !== undefined ? data.city : null,
       data.province !== undefined ? data.province : null,
       data.zone !== undefined ? data.zone : null,
       data.latitude !== undefined ? data.latitude : null,
       data.longitude !== undefined ? data.longitude : null,
       data.surface !== undefined ? data.surface : null,
       data.rooms !== undefined ? data.rooms : null,
       data.bedrooms !== undefined ? data.bedrooms : null,
       data.bathrooms !== undefined ? data.bathrooms : null,
       data.floor ?? null, data.total_floors !== undefined ? data.total_floors : null,
       data.elevator ? 1 : 0,
       data.building_state !== undefined ? data.building_state : null,
       data.year_built !== undefined ? data.year_built : null,
       data.energy_class !== undefined ? data.energy_class : null,
       data.energy_index !== undefined ? data.energy_index : null,
       data.heating !== undefined ? data.heating : null,
       data.air_conditioning ? 1 : 0,
       data.exposure !== undefined ? data.exposure : null,
       data.balcony_sqm !== undefined ? data.balcony_sqm : null,
       data.garden_sqm !== undefined ? data.garden_sqm : null,
       data.parking ? 1 : 0, data.basement ? 1 : 0, data.furnished || 'no',
       data.price !== undefined ? data.price : null,
       data.condo_fees !== undefined ? data.condo_fees : null,
       data.agent_name !== undefined ? data.agent_name : null,
       data.agent_phone !== undefined ? data.agent_phone : null,
       data.agent_email !== undefined ? data.agent_email : null,
       existingPhotos.length > 0 ? JSON.stringify(existingPhotos) : null,
       data.status || 'draft',
       data.title !== undefined ? data.title : null,
       data.description !== undefined ? data.description : null,
       req.params.id, req.user.id]
    );

    res.json({ message: 'Immobile aggiornato' });
  } catch (err) {
    serverError(err, res, 'Update property');
  }
});

// Delete property
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    await pool.query('DELETE FROM properties WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    res.json({ message: 'Immobile eliminato' });
  } catch (err) {
    serverError(err, res, 'Delete property');
  }
});

// Generate description for property
router.post('/:id/generate', authMiddleware, upload.array('files', 10), async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM properties WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Immobile non trovato' });

    const property = rows[0];
    let photos = property.photos || [];

    if (req.files && req.files.length > 0) {
      await processUploadedFiles(req.files);
      const newPhotos = req.files.map(f => `/media/uploads/${path.basename(f.path)}`);
      photos = [...photos, ...newPhotos];
    }

    if (photos.length === 0) {
      return res.status(400).json({ error: 'Carica almeno una foto per generare la descrizione' });
    }

    const plan = req.user.plan || 'free';
    const maxPhotos = (PLAN_CONFIG[plan] || PLAN_CONFIG.free).maxPhotos;
    if (photos.length > maxPhotos) {
      return res.status(400).json({ error: `Il piano ${plan} permette al massimo ${maxPhotos} foto. Passa a Pro per averne fino a 10.` });
    }

    const limitCheck = await checkGenerationLimit(req.user.id, plan);
    if (!limitCheck.allowed) {
      return res.status(403).json({ error: `Hai raggiunto il limite di ${PLAN_LIMITS[req.user.plan || 'free']} descrizioni gratuite.`, remaining: 0 });
    }

    const filePaths = photos.map(url => path.join(UPLOAD_DIR, path.basename(url))).filter(fs.existsSync);
    logger.info({ photosCount: photos.length, filePathsCount: filePaths.length, filesInRequest: req.files ? req.files.length : 0 }, 'Generate: photo resolution');

    const propertyWithContacts = {
      ...property,
      agent_name: property.agent_name || req.user.name,
      agent_phone: property.agent_phone || null,
      agent_email: property.agent_email || req.user.email,
    };

    const result = await describePropertyWithData(filePaths, propertyWithContacts, plan);
    if (result.error) {
      return aiError(result, res, 'generate');
    }

    const finalDescription = injectContacts(result.description, propertyWithContacts);

    await pool.query('UPDATE users SET monthly_generations = monthly_generations + 1 WHERE id = ?', [req.user.id]);
    await pool.query(
      'INSERT INTO generations (user_id, description, image_urls, model, property_uuid) VALUES (?, ?, ?, ?, ?)',
      [req.user.id, finalDescription, JSON.stringify(photos), result.model || '', property.uuid]
    ).catch(() => {});

    const title = extractTitle(finalDescription, propertyWithContacts);
    await pool.query('UPDATE properties SET description = ?, title = ?, ai_model = ?, photos = ?, status = ? WHERE id = ?',
      [finalDescription, title, result.model || '', JSON.stringify(photos), 'published', req.params.id]);

    res.json({
      description: finalDescription,
      title,
      model: result.model || '',
      photos,
      remaining: limitCheck.remaining - 1,
      propertyId: req.params.id,
      uuid: property.uuid,
    });
  } catch (err) {
    serverError(err, res, 'Generate property');
  }
});

module.exports = router;
