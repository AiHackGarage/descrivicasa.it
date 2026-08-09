// Text utilities: title extraction, slugify, contact injection, PDF cleaning, property labels

function normalizePhotos(raw) {
  try {
    if (Array.isArray(raw)) return raw;
    if (typeof raw === 'string') {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    }
    return [];
  } catch (_) { return []; }
}

function extractTitle(description, property) {
  if (!description) return null;
  const match = description.match(/🏡\s*(.+?)(?:\n\n📝|\n📝|$)/s);
  let title = null;
  if (match && match[1]) {
    title = match[1].trim().replace(/\n/g, ' ').substring(0, 200);
  } else {
    title = description.split('\n')[0].replace(/^[🏡📝📍🏷️📞]\s*/, '').trim();
  }

  if (title && title.length < 120 && !title.includes('questo') && !title.includes('splendido') && !title.includes('situato')) {
    return title;
  }

  if (property) {
    const t = property.property_type || 'immobile';
    const typeLabel = propertyTypeLabel(t);
    const location = property.city || property.zone || '';
    const preposition = location ? (' in ' + location) : '';
    return typeLabel + preposition;
  }

  return title ? title.substring(0, 100) : null;
}

function slugify(text) {
  if (!text) return '';
  return text
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 80);
}

function injectContacts(description, property) {
  if (!description) return description;

  const agentPhone = property.agent_phone || null;
  const agentEmail = property.agent_email || null;

  let contactsText = '📞 CONTATTI\n';
  if (agentPhone) contactsText += `- Tel: ${agentPhone}\n`;
  if (agentEmail) contactsText += `- Email: ${agentEmail}\n`;

  const contactsRegex = /\n?📞\s*CONTATTI[\s\S]*$/;
  let cleaned = description.replace(contactsRegex, '').trimEnd();
  cleaned += '\n\n' + contactsText;

  return cleaned;
}

function cleanForPdf(text) {
  if (!text) return '';
  // Keep only printable characters that pdfkit/Helvetica can render:
  // ASCII 32-126, Italian accented chars, €, °, common latin-1, newlines
  let cleaned = text.replace(/[^\u0020-\u007E\u00A0-\u00FF\u0100-\u024F\u20AC\u00B0\n]/g, '');
  // Remove section markers like 🏡 📝 📍 🏷️ 📞 (they become garbage)
  cleaned = cleaned.replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27FF}\u{2300}-\u{23FF}\u{FE00}-\u{FEFF}]/gu, '');
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');
  cleaned = cleaned.replace(/^[ \t]+/gm, '');
  return cleaned.trim();
}

function propertyTypeLabel(t) {
  const labels = {
    apartment: 'Appartamento', villa: 'Villa', townhouse: 'Schiera',
    loft: 'Loft', penthouse: 'Attico', studio: 'Monolocale',
    office: 'Ufficio', commercial: 'Negozi e locali', land: 'Terreno',
    warehouse: 'Magazzino', garage: 'Box auto', building: 'Fabbricato',
  };
  return labels[t] || t;
}

function buildMetaDescription(property) {
  const parts = [];
  const type = propertyTypeLabel(property.property_type);
  if (type) parts.push(type);
  const contract = property.contract_type === 'rent' ? 'in affitto' : 'in vendita';
  parts.push(contract);
  if (property.city) parts.push('a ' + property.city);
  if (property.price) {
    const price = Number(property.price).toLocaleString('it-IT');
    parts.push(property.contract_type === 'rent' ? `€ ${price}/mese` : `€ ${price}`);
  }
  if (property.surface) parts.push(`${property.surface} mq`);
  if (property.rooms) parts.push(`${property.rooms} locali`);
  return parts.join(' — ').substring(0, 160);
}

module.exports = { normalizePhotos, extractTitle, slugify, injectContacts, cleanForPdf, propertyTypeLabel, buildMetaDescription };
