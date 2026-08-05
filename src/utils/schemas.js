// Validation schemas for all API endpoints
// Used with validate() from ./validate.js

const registerSchema = {
  name: { required: true, type: 'string', min: 1, max: 200 },
  email: { required: true, type: 'email' },
  password: { required: true, type: 'string', min: 6, max: 128 },
};

const loginSchema = {
  email: { required: true, type: 'email' },
  password: { required: true, type: 'string', min: 1 },
};

const googleAuthSchema = {
  credential: { required: true, type: 'string', min: 10 },
};

const chatSchema = {
  messages: { required: true, type: 'array', min: 1 },
};

const checkoutSchema = {
  plan: { required: true, type: 'string', enum: ['base', 'pro'] },
};

const syncSubscriptionSchema = {
  plan: { required: true, type: 'string', enum: ['base', 'pro'] },
};

const customerPortalSchema = {
  returnUrl: { required: true, type: 'string', min: 1 },
};

// Property create/update data (validated after JSON.parse)
const propertyDataSchema = {
  contract_type: { type: 'string', enum: ['sell', 'rent'] },
  property_type: { type: 'string', min: 1, max: 100 },
  address: { type: 'string', max: 500 },
  city: { type: 'string', max: 200 },
  province: { type: 'string', max: 10 },
  price: { type: 'number', min: 0, max: 999999999 },
  surface: { type: 'number', min: 1, max: 999999 },
  rooms: { type: 'number', min: 0, max: 999 },
  bedrooms: { type: 'number', min: 0, max: 999 },
  bathrooms: { type: 'number', min: 0, max: 999 },
  floor: { type: 'number', min: -10, max: 999 },
  total_floors: { type: 'number', min: 0, max: 999 },
  energy_class: { type: 'string', enum: ['A4', 'A3', 'A2', 'A1', 'B', 'C', 'D', 'E', 'F', 'G'] },
  heating: { type: 'string', max: 100 },
  furnished: { type: 'string', enum: ['no', 'yes', 'partial', 'No', 'Si', 'Parzialmente'] },
  building_state: { type: 'string', max: 100 },
  year_built: { type: 'number', min: 1800, max: 2030 },
  latitude: { type: 'number', min: -90, max: 90 },
  longitude: { type: 'number', min: -180, max: 180 },
  condo_fees: { type: 'number', min: 0, max: 999999 },
  agent_phone: { type: 'string', max: 30, pattern: '^(\\\\+?\\\\d{1,3}[-\\\\s]?)?\\\\d{6,15}$' },
  agent_email: { type: 'email' },
  title: { type: 'string', max: 500 },
  description: { type: 'string', max: 50000 },
  exposure: { type: 'string', max: 200 },
  balcony_sqm: { type: 'number', min: 0, max: 99999 },
  garden_sqm: { type: 'number', min: 0, max: 999999 },
  status: { type: 'string', enum: ['draft', 'published'] },
};

module.exports = {
  registerSchema,
  loginSchema,
  googleAuthSchema,
  chatSchema,
  checkoutSchema,
  syncSubscriptionSchema,
  customerPortalSchema,
  propertyDataSchema,
};
