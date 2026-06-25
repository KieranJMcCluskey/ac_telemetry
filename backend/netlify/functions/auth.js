'use strict';

require('./_shared/ws-polyfill'); // must precede createClient (Node 20 has no native WebSocket)
const { createClient } = require('@supabase/supabase-js');
const { preflight, json } = require('./_shared/cors');

// Public anon client — used only for signIn / signUp
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY,
  { auth: { persistSession: false } }
);

exports.handler = async (event) => {
  const pre = preflight(event);
  if (pre) return pre;

  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  let action, email, password;
  try {
    ({ action, email, password } = JSON.parse(event.body));
  } catch {
    return json(400, { error: 'Invalid body' });
  }

  if (!email || !password) return json(400, { error: 'email and password required' });

  if (action === 'login') {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return json(401, { error: error.message });
    return json(200, {
      accessToken:  data.session.access_token,
      refreshToken: data.session.refresh_token,
      email:        data.user.email,
    });
  }

  if (action === 'register') {
    const { error } = await supabase.auth.signUp({ email, password });
    if (error) return json(400, { error: error.message });
    return json(200, { ok: true, message: 'Account created — you can sign in now.' });
  }

  return json(400, { error: 'action must be "login" or "register"' });
};
