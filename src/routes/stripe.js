const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const { STRIPE_PUBLIC_KEY } = require('../config');
const { validate } = require('../utils/validate');
const { checkoutSchema, syncSubscriptionSchema, customerPortalSchema } = require('../utils/schemas');
const stripeService = require('../services/stripe');

const router = express.Router();

// Public key
router.get('/public-key', (req, res) => {
  if (!STRIPE_PUBLIC_KEY) return res.status(500).json({ error: 'Stripe non configurato' });
  res.json({ publicKey: STRIPE_PUBLIC_KEY });
});

// Checkout session
router.post('/create-checkout-session', authMiddleware, (req, res) => {
  const errors = validate(req.body, checkoutSchema);
  if (errors) return res.status(400).json({ error: errors[0] });
  return stripeService.createCheckoutSession(req, res);
});

// Sync subscription
router.post('/sync-subscription', authMiddleware, (req, res) => {
  const errors = validate(req.body, syncSubscriptionSchema);
  if (errors) return res.status(400).json({ error: errors[0] });
  return stripeService.syncSubscription(req, res);
});

// Customer portal
router.post('/customer-portal', authMiddleware, (req, res) => {
  const errors = validate(req.body, customerPortalSchema);
  if (errors) return res.status(400).json({ error: errors[0] });
  return stripeService.createCustomerPortal(req, res);
});

module.exports = router;
