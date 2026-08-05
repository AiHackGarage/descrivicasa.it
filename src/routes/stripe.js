const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const { STRIPE_PUBLIC_KEY } = require('../config');
const stripeService = require('../services/stripe');

const router = express.Router();

// Stripe webhook (raw body — registered before express.json)
router.post('/webhook', express.raw({ type: 'application/json' }), (req, res) => stripeService.handleWebhook(req, res));

// Public key
router.get('/public-key', (req, res) => {
  if (!STRIPE_PUBLIC_KEY) return res.status(500).json({ error: 'Stripe non configurato' });
  res.json({ publicKey: STRIPE_PUBLIC_KEY });
});

// Checkout session
router.post('/create-checkout-session', authMiddleware, (req, res) => stripeService.createCheckoutSession(req, res));

// Sync subscription
router.post('/sync-subscription', authMiddleware, (req, res) => stripeService.syncSubscription(req, res));

// Customer portal
router.post('/customer-portal', authMiddleware, (req, res) => stripeService.createCustomerPortal(req, res));

module.exports = router;
