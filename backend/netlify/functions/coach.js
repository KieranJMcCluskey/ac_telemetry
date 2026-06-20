'use strict';

const https = require('https');
const { preflight, json } = require('./_shared/cors');
const { getUserFromToken, getBalance, deductToken } = require('./_shared/supabase');
const { COACH_SYSTEM_PROMPT } = require('./_shared/prompt');
const { Ratelimit } = require('@upstash/ratelimit');
const { Redis } = require('@upstash/redis');

let ratelimit;
function getRatelimit() {
  if (!ratelimit && process.env.UPSTASH_REDIS_REST_URL) {
    ratelimit = new Ratelimit({
      redis: Redis.fromEnv(),
      limiter: Ratelimit.slidingWindow(10, '1 h'),
      prefix: 'ac-coach',
    });
  }
  return ratelimit;
}

function extractJsonObject(text) {
  try { return JSON.parse(text.trim()); } catch {}
  let depth = 0, start = -1, inStr = false, esc = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (esc) { esc = false; continue; }
    if (ch === '\\' && inStr) { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === '{') { if (depth === 0) start = i; depth++; }
    else if (ch === '}') {
      depth--;
      if (depth === 0 && start >= 0) {
        try { return JSON.parse(text.substring(start, i + 1)); } catch {}
        start = -1;
      }
    }
  }
  return null;
}

function callClaude(userContent) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: [{ type: 'text', text: COACH_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: userContent }],
    });

    const req = https.request({
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'prompt-caching-2024-07-31',
        'Content-Length': Buffer.byteLength(body),
      },
    }, res => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) { reject(new Error(parsed.error.message || 'API error')); return; }
          const text = parsed.content?.[0]?.text || '';
          const report = extractJsonObject(text);
          if (!report) { reject(new Error('No valid JSON in response')); return; }
          resolve(report);
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

exports.handler = async (event) => {
  const pre = preflight(event);
  if (pre) return pre;

  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  const user = await getUserFromToken(event.headers.authorization);
  if (!user) return json(401, { error: 'Unauthorized' });

  // Rate limiting
  const rl = getRatelimit();
  if (rl) {
    const { success, remaining } = await rl.limit(user.id);
    if (!success) return json(429, { error: 'Rate limit exceeded. Try again in an hour.' });
  }

  // Token balance check
  const balance = await getBalance(user.id);
  if (balance < 1) {
    return json(402, { error: 'insufficient_tokens', balance });
  }

  let userContent;
  try {
    ({ userContent } = JSON.parse(event.body));
    if (!userContent) throw new Error('missing userContent');
  } catch {
    return json(400, { error: 'Invalid request body' });
  }

  let report;
  try {
    report = await callClaude(userContent);
  } catch (e) {
    return json(502, { error: e.message });
  }

  // Deduct token only after successful Claude call
  try {
    const ok = await deductToken(user.id);
    if (!ok) return json(402, { error: 'insufficient_tokens', balance: 0 });
  } catch (e) {
    console.error('Token deduction failed:', e.message);
    // Still return report — don't penalise user for our DB error
  }

  return json(200, report);
};
