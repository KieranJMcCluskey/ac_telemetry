'use strict';

// @supabase/supabase-js's createClient always constructs a realtime client that
// requires a global WebSocket. Netlify runs these functions on Node 20 (no native
// WebSocket), so polyfill it with `ws`. Require this module BEFORE any createClient
// call. We only use auth + REST/RPC; this just satisfies the constructor.
if (typeof globalThis.WebSocket === 'undefined') {
  globalThis.WebSocket = require('ws');
}

module.exports = {};
