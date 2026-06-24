'use strict';

require('./ws-polyfill'); // must precede createClient (Node 20 has no native WebSocket)
const { createClient } = require('@supabase/supabase-js');

// Service-role client — never expose this key client-side
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { persistSession: false } }
);

async function getUserFromToken(authHeader) {
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7);
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) return null;
  return user;
}

async function getBalance(userId) {
  const { data } = await supabaseAdmin
    .from('token_balances')
    .select('balance')
    .eq('user_id', userId)
    .single();
  return data?.balance ?? 0;
}

async function deductToken(userId) {
  const { data, error } = await supabaseAdmin.rpc('deduct_token', { p_user_id: userId });
  if (error) throw new Error(error.message);
  return data; // true if deducted, false if insufficient
}

async function creditTokens(userId, amount, stripeSessionId) {
  const { error } = await supabaseAdmin.rpc('credit_tokens', {
    p_user_id: userId,
    p_amount: amount,
    p_stripe_session_id: stripeSessionId,
  });
  if (error) throw new Error(error.message);
}

module.exports = { supabaseAdmin, getUserFromToken, getBalance, deductToken, creditTokens };
