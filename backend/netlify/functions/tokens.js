'use strict';

const { preflight, json } = require('./_shared/cors');
const { getUserFromToken, getBalance } = require('./_shared/supabase');

exports.handler = async (event) => {
  const pre = preflight(event);
  if (pre) return pre;

  if (event.httpMethod !== 'GET') return json(405, { error: 'Method not allowed' });

  const user = await getUserFromToken(event.headers.authorization);
  if (!user) return json(401, { error: 'Unauthorized' });

  const balance = await getBalance(user.id);
  return json(200, { balance, email: user.email });
};
