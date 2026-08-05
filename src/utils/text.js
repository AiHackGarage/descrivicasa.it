// Text utilities: title extraction, slugify, contact injection, PDF cleaning, property labels

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
  let cleaned = text.replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{2300}-\u{23FF}\u{2B00}-\u{2BFF}\u{FE00}-\u{FEFF}\u{200D}\u{20E3}\u{3299}\u{3297}\u{3030}\u{303D}\u{00A9}\u{00AE}\u{2122}\u{2139}\u{24C2}\u{2934}\u{2935}\u{25AA}\u{25AB}\u{25B6}\u{25C0}\u{25FB}-\u{25FE}\u{260E}\u{2611}\u{2614}\u{2615}\u{261D}\u{2620}\u{2622}\u{2623}\u{2626}\u{262A}\u{262E}\u{262F}\u{2638}-\u{263A}\u{2640}\u{2642}\u{2648}-\u{2653}\u{265F}\u{2660}\u{2663}\u{2665}\u{2666}\u{2668}\u{267B}\u{267E}\u{267F}\u{2692}-\u{2697}\u{2699}\u{269B}\u{269C}\u{26A0}\u{26A1}\u{26A7}\u{26AA}\u{26AB}\u{26B0}\u{26B1}\u{26BD}\u{26BE}\u{26C4}\u{26C5}\u{26C8}\u{26CE}\u{26CF}\u{26D1}\u{26D3}\u{26D4}\u{26E9}\u{26EA}\u{26F0}-\u{26F5}\u{26F7}-\u{26FA}\u{26FD}\u{2702}\u{2705}\u{2708}-\u{270D}\u{270F}\u{2712}\u{2714}\u{2716}\u{271D}\u{2721}\u{2728}\u{2733}\u{2734}\u{2744}\u{2747}\u{274C}\u{274E}\u{2753}-\u{2755}\u{2757}\u{2763}\u{2764}\u{2795}-\u{2797}\u{27A1}\u{27B0}\u{27BF}\u{231A}\u{231B}\u{2328}\u{23CF}\u{23E9}-\u{23F3}\u{23F8}-\u{23FA}]/gu, '');
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

module.exports = { extractTitle, slugify, injectContacts, cleanForPdf, propertyTypeLabel, buildMetaDescription };
