const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const pool = require('../db/pool');
const { UPLOAD_DIR } = require('../config');
const { injectContacts, cleanForPdf, propertyTypeLabel, normalizePhotos } = require('../utils/text');
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

    const doc = new PDFDocument({ size: 'A4', margin: 50, bufferPages: true });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="descrizione-${p.uuid}.pdf"`);

    doc.on('error', () => {
      if (!res.headersSent) res.status(500).json({ error: 'Errore generazione PDF' });
      else res.end();
    });
    doc.pipe(res);

    const primary = '#667eea';
    const dark = '#1d1d1f';
    const grey = '#86868b';
    const lightBg = '#f5f5f7';
    const W = 495; // usable width (A4 595 - 2*50 margins)

    // ═══════════════════════════════════════════
    // PAGE 1: Header + Title + Features + Gallery
    // ═══════════════════════════════════════════

    // Header (subtle)
    doc.fontSize(10).font('Helvetica').fillColor(grey)
       .text('DescriviCasa.it — Descrizione Immobiliare Professionale', { align: 'left' });
    doc.moveDown(0.3);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor(primary).lineWidth(1.5).stroke();
    doc.moveDown(0.6);

    // Title big
    doc.fontSize(20).font('Helvetica-Bold').fillColor(dark).text(title, { align: 'left' });
    doc.moveDown(0.2);

    // Price
    doc.fontSize(16).font('Helvetica-Bold').fillColor(primary).text(priceText, { continued: false });
    doc.moveDown(0.1);

    // Address
    const addrParts = [p.address, p.city, p.province].filter(Boolean);
    if (addrParts.length > 0) {
      doc.fontSize(10).font('Helvetica').fillColor(grey).text(addrParts.join(', '));
    }
    doc.moveDown(0.5);

    // Features: single-line chips
    const chips = [
      p.surface ? `${p.surface} mq` : null,
      p.rooms ? `${p.rooms} locali` : null,
      p.bedrooms ? `${p.bedrooms} camere` : null,
      p.bathrooms ? `${p.bathrooms} bagni` : null,
      p.energy_class ? `Cl. en. ${p.energy_class}` : null,
      p.building_state ? p.building_state : null,
      p.heating ? p.heating : null,
      p.floor !== null && p.floor !== undefined ? `Piano ${p.floor}${p.total_floors ? '/' + p.total_floors : ''}` : null,
      p.furnished && p.furnished !== 'no' ? `Arredato` : null,
    ].filter(Boolean);

    if (chips.length > 0) {
      const chipH = 20;
      const chipPadding = 12;
      const startY = doc.y;
      let x = 50;

      chips.forEach((c) => {
        const w = doc.widthOfString(c) + chipPadding * 2;
        if (x + w > 545) { x = 50; doc.y += chipH + 6; }
        doc.roundedRect(x, doc.y, w, chipH, 4).fill(lightBg);
        doc.fontSize(8.5).font('Helvetica').fillColor(dark)
           .text(c, x + chipPadding, doc.y + (chipH - 8.5) / 2, { width: w - chipPadding * 2 });
        x += w + 8;
      });
      doc.y = startY + Math.ceil((x > 545 ? 1 : 0) + 1) * (chipH + 6) + 6;
    }

    doc.moveDown(0.4);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#e8e8ed').lineWidth(0.5).stroke();
    doc.moveDown(0.6);

    // Gallery — 2-column grid
    let photoPaths = [];
    try {
      const photos = normalizePhotos(p.photos);
      if (Array.isArray(photos)) {
        photoPaths = photos.map(url => path.join(UPLOAD_DIR, path.basename(url))).filter(fs.existsSync);
      }
    } catch (_) {}

    if (photoPaths.length > 0) {
      const imgW = 235;
      const imgH = 160;
      const gap = 25;
      let imgY = doc.y;

      for (let i = 0; i < photoPaths.length; i++) {
        const col = i % 2;
        const row = Math.floor(i / 2);
        const ix = 50 + col * (imgW + gap);
        const iy = imgY + row * (imgH + 10);

        if (iy + imgH > doc.page.height - 60) {
          doc.addPage();
          imgY = 60;
          const newIy = imgY + Math.floor((i % photoPaths.length) / 2) * (imgH + 10);
          const newIx = 50 + (i % 2) * (imgW + gap);
          const imgBuf = await resizeForPdf(photoPaths[i]);
          if (imgBuf) doc.image(imgBuf, newIx, newIy, { width: imgW, height: imgH }).strokeColor('#e8e8ed').lineWidth(0.3).stroke();
        } else {
          const imgBuf = await resizeForPdf(photoPaths[i]);
          if (imgBuf) doc.image(imgBuf, ix, iy, { width: imgW, height: imgH }).strokeColor('#e8e8ed').lineWidth(0.3).stroke();
        }
      }
      const rows = Math.ceil(photoPaths.length / 2);
      doc.y = imgY + rows * (imgH + 10) + 15;
    }

    // ═══════════════════════════════════════════
    // PAGE 2: Description — full width, clean
    // ═══════════════════════════════════════════
    doc.addPage();

    // Page header
    doc.fontSize(10).font('Helvetica').fillColor(grey)
       .text('DescriviCasa.it — Descrizione Immobiliare Professionale', { align: 'left' });
    doc.moveDown(0.3);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor(primary).lineWidth(1).stroke();
    doc.moveDown(0.6);

    // Re-print title small
    doc.fontSize(12).font('Helvetica-Bold').fillColor(dark).text(title);
    doc.fontSize(11).font('Helvetica').fillColor(grey).text(priceText);
    doc.moveDown(0.6);

    // Description header
    doc.fontSize(14).font('Helvetica-Bold').fillColor(primary).text('Descrizione');
    doc.moveDown(0.4);

    // Description body — full width, justified
    if (description) {
      const paragraphs = description.split(/\n\n+/).filter(Boolean);
      paragraphs.forEach((para) => {
        // Clean section headers (remove emoji, keep text)
        let text = para.replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27FF}\u{2300}-\u{23FF}]/gu, '').trim();
        if (!text) return;
        // Check if it's a section header
        const isHeader = /^[A-Z\s]{3,}/.test(text) && text.length < 50;
        doc.fontSize(isHeader ? 11 : 10)
           .font(isHeader ? 'Helvetica-Bold' : 'Helvetica')
           .fillColor(isHeader ? dark : '#333')
           .text(text, {
             width: W,
             align: isHeader ? 'left' : 'justify',
             lineGap: isHeader ? 3 : 4,
             paragraphGap: isHeader ? 6 : 3,
           });
      });
    } else {
      doc.fontSize(10).font('Helvetica').fillColor(grey)
         .text('Descrizione in preparazione.', { width: W, align: 'center' });
    }

    doc.end();
  } catch (err) {
    if (!res.headersSent) {
      res.status(500).json({ error: 'Errore generazione PDF: ' + err.message });
    } else {
      try { res.end(); } catch (_) {}
    }
  }
}

module.exports = { generatePdf };
