const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const pool = require('../db/pool');
const { UPLOAD_DIR } = require('../config');
const { injectContacts, cleanForPdf, propertyTypeLabel } = require('../utils/text');
const { resizeForPdf } = require('./image');

async function generatePdf(req, res) {
  try {
    const [rows] = await pool.query(
      `SELECT p.*, u.name AS user_name, u.email AS user_email
       FROM properties p JOIN users u ON p.user_id = u.id
       WHERE p.uuid = ? AND p.is_public = TRUE AND p.status IN ('published','draft')`,
      [req.params.uuid]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Immobile non trovato' });

    const p = rows[0];
    p.agent_name = p.agent_name || p.user_name;
    p.agent_email = p.agent_email || p.user_email;
    p.agent_phone = p.agent_phone || null;
    let description = p.description || '';
    if (description) {
      description = cleanForPdf(description);
      description = injectContacts(description, p);
    }

    const title = p.title || `${propertyTypeLabel(p.property_type)}${p.city ? ' in ' + p.city : ''}`;
    const priceText = p.contract_type === 'rent'
      ? `€ ${Number(p.price || 0).toLocaleString('it-IT')}/mese`
      : `€ ${Number(p.price || 0).toLocaleString('it-IT')}`;

    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="descrizione-${p.uuid}.pdf"`);
    doc.pipe(res);

    const primary = '#667eea';
    const dark = '#1d1d1f';
    const grey = '#86868b';
    const lightBg = '#f5f5f7';

    doc.on('pageAdded', () => {
      const savedFont = doc._font;
      const savedSize = doc._fontSize;
      const savedFill = doc._fillColor;
      doc.fontSize(8).font('Helvetica').fillColor(grey)
         .text(
           `DescriviCasa.it — Generato con AI il ${new Date().toLocaleDateString('it-IT')}`,
           50, doc.page.height - 40,
           { align: 'center', width: 495 }
         );
      if (savedFont) doc.font(savedFont);
      if (savedSize) doc.fontSize(savedSize);
      if (savedFill) doc.fillColor(savedFill);
    });

    // Header
    doc.fontSize(22).font('Helvetica-Bold').fillColor(primary).text('DescriviCasa.it', { align: 'center' });
    doc.moveDown(0.3);
    doc.fontSize(9).font('Helvetica').fillColor(grey).text('Descrizione Immobiliare Professionale', { align: 'center' });
    doc.moveDown(0.5);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor(primary).lineWidth(1).stroke();
    doc.moveDown(0.8);

    // Title + Price
    doc.fontSize(18).font('Helvetica-Bold').fillColor(dark).text(title, { align: 'left' });
    doc.moveDown(0.2);
    doc.fontSize(14).font('Helvetica-Bold').fillColor(primary).text(priceText);
    doc.moveDown(0.3);

    const addrParts = [p.address, p.city, p.province].filter(Boolean);
    if (addrParts.length > 0) {
      doc.fontSize(10).font('Helvetica').fillColor(grey).text(addrParts.join(', '));
    }
    doc.moveDown(0.6);

    // Features box
    doc.roundedRect(50, doc.y, 495, 10, 4).fill(lightBg);
    doc.moveDown(0.3);

    const features = [
      p.surface ? `Superficie: ${p.surface} mq` : null,
      p.rooms ? `Locali: ${p.rooms}` : null,
      p.bedrooms ? `Camere: ${p.bedrooms}` : null,
      p.bathrooms ? `Bagni: ${p.bathrooms}` : null,
      p.energy_class ? `Classe energetica: ${p.energy_class}` : null,
      p.building_state ? `Stato: ${p.building_state}` : null,
      p.heating ? `Riscaldamento: ${p.heating}` : null,
      p.furnished && p.furnished !== 'no' ? `Arredato: ${p.furnished}` : null,
      p.floor !== null && p.floor !== undefined ? `Piano: ${p.floor}${p.total_floors ? '/' + p.total_floors : ''}` : null,
    ].filter(Boolean);

    if (features.length > 0) {
      const colWidth = 230;
      const startY = doc.y;
      features.forEach((f, i) => {
        const col = i % 2;
        const row = Math.floor(i / 2);
        const bx = 50 + col * (colWidth + 35);
        const by = startY + row * 18;
        doc.fontSize(9).font('Helvetica').fillColor(dark).text(`• ${f}`, bx, by, { width: colWidth });
      });
      doc.moveDown(features.length > 1 ? Math.ceil(features.length / 2) * 0.8 + 0.3 : 0.8);
    }

    doc.moveTo(50, doc.y + 5).lineTo(545, doc.y + 5).strokeColor('#e8e8ed').lineWidth(0.5).stroke();
    doc.moveDown(0.6);

    // Photos
    let photoPaths = [];
    try {
      const rawPhotos = p.photos || '[]';
      const photos = typeof rawPhotos === 'string' ? JSON.parse(rawPhotos) : rawPhotos;
      photoPaths = photos.map(url => path.join(UPLOAD_DIR, path.basename(url))).filter(fs.existsSync);
    } catch (_) {}

    if (photoPaths.length > 0) {
      doc.fontSize(12).font('Helvetica-Bold').fillColor(dark).text('Galleria');
      doc.moveDown(0.4);
      const imgW = 235;
      const imgH = 155;
      const gap = 25;
      let imgY = doc.y;
      for (let i = 0; i < photoPaths.length; i++) {
        const col = i % 2;
        const row = Math.floor(i / 2);
        const ix = 50 + col * (imgW + gap);
        const iy = imgY + row * (imgH + 12);
        if (iy + imgH > doc.page.height - 55) {
          doc.addPage();
          imgY = doc.y;
          const newIy = imgY + Math.floor(i / 2) * (imgH + 12);
          const newIx = 50 + (i % 2) * (imgW + gap);
          const imgBuf = await resizeForPdf(photoPaths[i]);
          if (imgBuf) doc.image(imgBuf, newIx, newIy, { width: imgW, height: imgH });
        } else {
          const imgBuf = await resizeForPdf(photoPaths[i]);
          if (imgBuf) doc.image(imgBuf, ix, iy, { width: imgW, height: imgH });
        }
      }
      const rows = Math.ceil(photoPaths.length / 2);
      doc.y = imgY + rows * (imgH + 12) + 8;
    }

    // Description
    doc.fontSize(12).font('Helvetica-Bold').fillColor(dark).text('Descrizione');
    doc.moveDown(0.3);
    doc.fontSize(10).font('Helvetica').fillColor('#333').text(description || 'Descrizione in preparazione.', {
      lineGap: 4,
      align: 'justify',
    });

    doc.end();
  } catch (err) {
    if (!res.headersSent) {
      res.status(500).json({ error: 'Errore interno del server' });
    }
  }
}

module.exports = { generatePdf };
