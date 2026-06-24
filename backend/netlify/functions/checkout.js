'use strict';

const Stripe = require('stripe');
const { preflight, json } = require('./_shared/cors');
const { getUserFromToken } = require('./_shared/supabase');

const PACKAGES = {
  '10':  { tokens: 10,  priceId: process.env.STRIPE_PRICE_10  },
  '100': { tokens: 100, priceId: process.env.STRIPE_PRICE_100 },
};

exports.handler = async (event) => {
  const pre = preflight(event);
  if (pre) return pre;

  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  const user = await getUserFromToken(event.headers.authorization);
  if (!user) return json(401, { error: 'Unauthorized' });

  let pkg;
  try {
    ({ package: pkg } = JSON.parse(event.body));
  } catch {
    return json(400, { error: 'Invalid body' });
  }

  const selected = PACKAGES[pkg];
  if (!selected) return json(400, { error: 'Invalid package. Use "10" or "100".' });
  if (!selected.priceId) return json(500, { error: `Price ID not configured for package ${pkg}` });

  const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
  const origin = process.env.SITE_URL || 'https://YOUR-SITE.netlify.app';

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: [{ price: selected.priceId, quantity: 1 }],
    success_url: `${origin}/success.html?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/`,
    customer_email: user.email,
    metadata: {
      app: 'ac-coach',
      user_id: user.id,
      tokens: String(selected.tokens),
    },
  });

  return json(200, { url: session.url });
};
