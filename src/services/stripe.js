const logger = require('pino')({ level: process.env.LOG_LEVEL || 'info' });
const { STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_ID_BASE, STRIPE_PRICE_ID_PRO } = require('../config');
const pool = require('../db/pool');

let stripe = null;
if (STRIPE_SECRET_KEY) {
  stripe = require('stripe')(STRIPE_SECRET_KEY);
  logger.info('✅ Stripe initialized');
} else {
  logger.info('⚠️  Stripe non configurato (manca STRIPE_SECRET_KEY)');
}

function getStripe() {
  return stripe;
}

// Stripe webhook handler (raw body, signature verification)
async function handleWebhook(req, res) {
  if (!stripe) return res.status(400).json({ error: 'Stripe non configurato' });

  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    logger.error('Stripe webhook signature error:', err.message);
    return res.status(400).json({ error: 'Firma webhook non valida' });
  }

  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const userId = parseInt(session.metadata?.userId, 10);
      const plan = session.metadata?.plan;

      if (userId && plan && ['base', 'pro'].includes(plan)) {
        try {
          await pool.query(
            'UPDATE users SET plan = ?, stripe_customer_id = ?, stripe_subscription_id = ?, subscription_status = ? WHERE id = ?',
            [plan, session.customer || null, session.subscription || null, 'active', userId]
          );
        } catch (_) {
          await pool.query('UPDATE users SET plan = ? WHERE id = ?', [plan, userId]);
        }
        logger.info(`✅ User ${userId} upgraded to ${plan}`);
      }
    }

    if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
      const sub = event.data.object;
      const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id;

      if (customerId) {
        try {
          await pool.query('UPDATE users SET subscription_status = ? WHERE stripe_customer_id = ?', [sub.status, customerId]);
        } catch (_) { /* colonna mancante */ }

        if (sub.status === 'canceled' || sub.status === 'unpaid') {
          try {
            await pool.query("UPDATE users SET plan = 'free', stripe_subscription_id = NULL WHERE stripe_customer_id = ?", [customerId]);
          } catch (_) {
            await pool.query("UPDATE users SET plan = 'free' WHERE stripe_customer_id = ?", [customerId]);
          }
          logger.info(`⬇️ Customer ${customerId} downgraded to free (status: ${sub.status})`);
        } else if (sub.status === 'active') {
          try {
            await pool.query('UPDATE users SET stripe_subscription_id = ? WHERE stripe_customer_id = ?', [sub.id, customerId]);
          } catch (_) {}

          const priceId = sub.items?.data?.[0]?.price?.id;
          if (priceId) {
            const planFromPrice = priceId === STRIPE_PRICE_ID_PRO ? 'pro'
                                : priceId === STRIPE_PRICE_ID_BASE ? 'base'
                                : null;
            if (planFromPrice) {
              const [users] = await pool.query('SELECT plan FROM users WHERE stripe_customer_id = ?', [customerId]);
              if (users.length > 0 && users[0].plan !== planFromPrice) {
                try {
                  await pool.query('UPDATE users SET plan = ? WHERE stripe_customer_id = ?', [planFromPrice, customerId]);
                  logger.info(`🔄 Customer ${customerId} plan updated to ${planFromPrice}`);
                } catch (_) {}
              }
            }
          }
        }
      }
    }
  } catch (err) {
    logger.error('Stripe webhook processing error:', err);
    return res.status(500).json({ error: 'Errore processamento webhook' });
  }

  res.json({ received: true });
}

// Create checkout session
async function createCheckoutSession(req, res) {
  try {
  if (!stripe) return res.status(500).json({ error: 'Stripe non configurato' });

  const { plan, successUrl, cancelUrl } = req.body;
  if (!plan || !['base', 'pro'].includes(plan)) {
    return res.status(400).json({ error: 'Piano non valido. Scegli base o pro.' });
  }

  const priceId = plan === 'base' ? STRIPE_PRICE_ID_BASE : STRIPE_PRICE_ID_PRO;
  if (!priceId) {
    return res.status(500).json({ error: `Price ID non configurato per il piano ${plan}.` });
  }

  const [users] = await pool.query(
    'SELECT id, email, name, stripe_customer_id, plan AS current_plan FROM users WHERE id = ?',
    [req.user.id]
  );
  if (users.length === 0) return res.status(404).json({ error: 'Utente non trovato' });

  const user = users[0];
  let customerId = user.stripe_customer_id;

  if (customerId) {
    const subs = await stripe.subscriptions.list({ customer: customerId, status: 'active', limit: 1 });

    if (subs.data.length > 0) {
      const sub = subs.data[0];
      if (user.current_plan === plan) {
        return res.status(400).json({ error: `Sei già sul piano ${plan === 'base' ? 'Base' : 'Pro'}.` });
      }

      // Upgrade/downgrade: aggiorna la subscription esistente
      const updatedSub = await stripe.subscriptions.update(sub.id, {
        items: [{ id: sub.items.data[0].id, price: priceId }],
        proration_behavior: 'always_invoice',
        metadata: { userId: String(req.user.id), plan },
      });

      // Aggiorna subito il piano (lo Stripe webhook confermerà)
      try {
        await pool.query('UPDATE users SET plan = ?, stripe_subscription_id = ? WHERE id = ?', [plan, updatedSub.id, req.user.id]);
      } catch (_) {
        await pool.query('UPDATE users SET plan = ? WHERE id = ?', [plan, req.user.id]);
      }
      return res.json({ url: successUrl || '/', subscription: 'updated' });
    }
  }

  // Nuovo checkout
  const session = await stripe.checkout.sessions.create({
    payment_method_types: ['card'],
    mode: 'subscription',
    customer: customerId || undefined,
    customer_email: customerId ? undefined : user.email,
    line_items: [{ price: priceId, quantity: 1 }],
    metadata: { userId: String(req.user.id), plan },
    success_url: successUrl || 'https://descrivicasa.it/?success=1',
    cancel_url: cancelUrl || 'https://descrivicasa.it/pricing',
  });

  res.json({ url: session.url });
  } catch (err) {
    logger.error('Stripe checkout error: ' + (err.message || err));
    return res.status(500).json({ error: 'Errore Stripe: ' + (err.message || 'sconosciuto') });
  }
}

// Customer portal
async function createCustomerPortal(req, res) {
  if (!stripe) return res.status(500).json({ error: 'Stripe non configurato' });

  const [users] = await pool.query('SELECT stripe_customer_id FROM users WHERE id = ?', [req.user.id]);
  if (users.length === 0 || !users[0].stripe_customer_id) {
    return res.status(400).json({ error: 'Nessuna subscription Stripe trovata.' });
  }

  const portal = await stripe.billingPortal.sessions.create({
    customer: users[0].stripe_customer_id,
    return_url: 'https://descrivicasa.it',
  });

  res.json({ url: portal.url });
}

// Sync subscription status
async function syncSubscription(req, res) {
  if (!stripe) return res.status(500).json({ error: 'Stripe non configurato' });

  const [users] = await pool.query(
    'SELECT stripe_customer_id, stripe_subscription_id FROM users WHERE id = ?',
    [req.user.id]
  );
  if (users.length === 0) return res.status(404).json({ error: 'Utente non trovato' });

  const { stripe_customer_id, stripe_subscription_id } = users[0];
  if (!stripe_customer_id || !stripe_subscription_id) {
    return res.status(400).json({ error: 'Nessuna subscription Stripe' });
  }

  const sub = await stripe.subscriptions.retrieve(stripe_subscription_id);
  let plan = 'free';
  if (sub.status === 'active') {
    const priceId = sub.items?.data?.[0]?.price?.id;
    if (priceId === STRIPE_PRICE_ID_PRO) plan = 'pro';
    else if (priceId === STRIPE_PRICE_ID_BASE) plan = 'base';
  }

  try {
    await pool.query(
      'UPDATE users SET plan = ?, subscription_status = ?, stripe_subscription_id = ? WHERE id = ?',
      [plan, sub.status, sub.id, req.user.id]
    );
  } catch (_) {
    await pool.query('UPDATE users SET plan = ? WHERE id = ?', [plan, req.user.id]);
  }

  res.json({ plan, status: sub.status });
}

module.exports = { getStripe, handleWebhook, createCheckoutSession, createCustomerPortal, syncSubscription };
