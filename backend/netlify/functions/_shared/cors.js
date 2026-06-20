'use strict';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

function preflight(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS, body: '' };
  }
  return null;
}

function json(statusCode, body, extra = {}) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', ...CORS, ...extra },
    body: JSON.stringify(body),
  };
}

module.exports = { preflight, json, CORS };
