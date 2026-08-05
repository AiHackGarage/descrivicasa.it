/**
 * Lightweight schema-based input validator.
 *
 * Validates a flat object against a schema definition.
 * Returns null if valid, or an array of Italian error messages if invalid.
 *
 * Schema definition — each field can have:
 *   required:  boolean         — field must be present and non-empty (default: false)
 *   type:      'string'|'number'|'boolean'|'email'|'array'|'object'
 *   min:       number          — minimum string length, array length, or numeric value
 *   max:       number          — maximum string length, array length, or numeric value
 *   minLen:    number          — minimum string length (alias for min on strings)
 *   maxLen:    number          — maximum string length
 *   pattern:   RegExp|string   — regex the value must match
 *   enum:      Array           — value must be one of these
 *   trim:      boolean         — auto-trim strings before validation (default: true)
 *
 * Usage:
 *   const errors = validate(req.body, {
 *     email: { required: true, type: 'email' },
 *     password: { required: true, type: 'string', min: 6, max: 128 },
 *   });
 *   if (errors) return res.status(400).json({ error: errors[0] });
 */

const FIELD_LABELS = {
  name: 'Nome',
  email: 'Email',
  password: 'Password',
  credential: 'Token Google',
  messages: 'Messaggi',
  plan: 'Piano',
  returnUrl: 'URL di ritorno',
  contract_type: 'Tipo contratto',
  property_type: 'Tipo immobile',
  address: 'Indirizzo',
  city: 'Città',
  province: 'Provincia',
  price: 'Prezzo',
  surface: 'Superficie',
  rooms: 'Locali',
  bedrooms: 'Camere da letto',
  bathrooms: 'Bagni',
  floor: 'Piano',
  total_floors: 'Totale piani',
  energy_class: 'Classe energetica',
  heating: 'Riscaldamento',
  furnished: 'Arredato',
  building_state: 'Stato',
  year_built: 'Anno costruzione',
  latitude: 'Latitudine',
  longitude: 'Longitudine',
  condo_fees: 'Spese condominiali',
  agent_phone: 'Telefono',
  agent_email: 'Email contatto',
  title: 'Titolo',
  description: 'Descrizione',
  exposure: 'Esposizione',
  balcony_sqm: 'Balcone (mq)',
  garden_sqm: 'Giardino (mq)',
  status: 'Stato',
};

const TYPE_VALIDATORS = {
  string: (v) => typeof v === 'string',
  number: (v) => typeof v === 'number' || (typeof v === 'string' && v !== '' && !isNaN(Number(v))),
  boolean: (v) => typeof v === 'boolean' || v === 0 || v === 1 || v === '0' || v === '1' || v === 'true' || v === 'false',
  email: (v) => typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v),
  array: (v) => Array.isArray(v),
  object: (v) => v !== null && typeof v === 'object' && !Array.isArray(v),
};

function label(field) {
  return FIELD_LABELS[field] || field;
}

function validateField(value, field, rules) {
  const errors = [];

  // Normalize value
  let val = value;
  if (rules.type === 'number' && typeof val === 'string' && val !== '') {
    val = Number(val);
  }
  if (rules.trim !== false && typeof val === 'string') {
    val = val.trim();
  }

  // Required check
  if (rules.required) {
    if (val === undefined || val === null || val === '') {
      errors.push(`${label(field)} è obbligatorio`);
      return errors; // stop — can't validate further if missing
    }
  } else {
    // Optional: skip validation if empty
    if (val === undefined || val === null || val === '') {
      return [];
    }
  }

  // Type check
  if (rules.type && TYPE_VALIDATORS[rules.type]) {
    if (!TYPE_VALIDATORS[rules.type](val)) {
      const typeNames = { string: 'testo', number: 'numero', boolean: 'booleano', email: 'email valida', array: 'array', object: 'oggetto' };
      errors.push(`${label(field)} deve essere un ${typeNames[rules.type] || rules.type}`);
      return errors;
    }
  }

  // Min/Max for strings
  if (rules.min !== undefined && typeof val === 'string') {
    if (val.length < rules.min) {
      errors.push(`${label(field)} deve essere almeno ${rules.min} caratteri`);
    }
  }
  if (rules.max !== undefined && typeof val === 'string') {
    if (val.length > rules.max) {
      errors.push(`${label(field)} non può superare ${rules.max} caratteri`);
    }
  }

  // Min/Max for numbers
  if (rules.min !== undefined && typeof val === 'number') {
    if (val < rules.min) {
      errors.push(`${label(field)} deve essere almeno ${rules.min}`);
    }
  }
  if (rules.max !== undefined && typeof val === 'number') {
    if (val > rules.max) {
      errors.push(`${label(field)} non può superare ${rules.max}`);
    }
  }

  // Min/Max for arrays
  if (rules.min !== undefined && Array.isArray(val)) {
    if (val.length < rules.min) {
      errors.push(`${label(field)} deve contenere almeno ${rules.min} elementi`);
    }
  }

  // Pattern
  if (rules.pattern) {
    const re = typeof rules.pattern === 'string' ? new RegExp(rules.pattern) : rules.pattern;
    if (!re.test(String(val))) {
      errors.push(`${label(field)} non è nel formato corretto`);
    }
  }

  // Enum
  if (rules.enum && !rules.enum.includes(val)) {
    errors.push(`${label(field)} non è un valore valido (accettati: ${rules.enum.join(', ')})`);
  }

  return errors;
}

/**
 * Validate an object against a schema.
 * @param {Object} input - The object to validate (e.g., req.body)
 * @param {Object} schema - Validation schema
 * @returns {string[]|null} Array of error messages, or null if valid
 */
function validate(input, schema) {
  const errors = [];

  for (const [field, rules] of Object.entries(schema)) {
    const fieldErrors = validateField(input[field], field, rules);
    errors.push(...fieldErrors);
    if (fieldErrors.length > 0 && rules.required) {
      // Stop on first required-field error to avoid cascading
      break;
    }
  }

  return errors.length > 0 ? errors : null;
}

module.exports = { validate };
