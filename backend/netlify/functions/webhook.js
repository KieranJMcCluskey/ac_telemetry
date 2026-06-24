'use strict';

const Stripe = require('stripe');
const { creditTokens } = require('./_shared/supabase');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
  const sig = event.headers['stripe-signature'];

  let stripeEvent;
  try {
    stripeEvent = stripe.webhooks.constructEvent(
      event.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (e) {
    console.error('Webhook signature verification failed:', e.message);
    return { statusCode: 400, body: `Webhook Error: ${e.message}` };
  }

  if (stripeEvent.type === 'checkout.session.completed') {
    const session = stripeEvent.data.object;
    const { app, user_id, tokens } = session.metadata || {};

    // This Stripe account is shared with another app (who-am-i). Stripe delivers
    // every checkout.session.completed to both endpoints, so ack-and-ignore any
    // checkout that isn't ours — otherwise it fails delivery and Stripe retries.
    if (app !== 'ac-coach') {
      return { statusCode: 200, body: JSON.stringify({ received: true, ignored: true }) };
    }

    if (!user_id || !tokens) {
      console.error('Missing metadata in ac-coach session:', session.id);
      return { statusCode: 400, body: 'Missing metadata' };
    }

    const tokenCount = parseInt(tokens, 10);
    if (isNaN(tokenCount) || tokenCount <= 0) {
      return { statusCode: 400, body: 'Invalid token count' };
    }

    try {
      await creditTokens(user_id, tokenCount, session.id);
      console.log(`Credited ${tokenCount} tokens to user ${user_id} (session ${session.id})`);
    } catch (e) {
      console.error('Failed to credit tokens:', e.message);
      return { statusCode: 500, body: e.message };
    }
  }

  return { statusCode: 200, body: JSON.stringify({ received: true }) };
};
