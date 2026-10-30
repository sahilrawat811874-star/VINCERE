/**
 * Swasthya - Authentication & Role-Based Access Control Middleware
 * 
 * Verifies HMAC-SHA256 signed tokens, enforces patient/doctor role separation,
 * and guards sensitive medical endpoints.
 */

const crypto = require('crypto');

const TOKEN_SECRET = process.env.TOKEN_SECRET || 'swasthya_production_token_secret_default_key_32';

function issueToken({ id, role, patientUid, name, expiresInMs = 1000 * 60 * 60 * 24 }) {
  const payload = {
    id,
    role,
    patientUid,
    name: name || 'User',
    iat: Date.now(),
    exp: Date.now() + expiresInMs
  };
  const json = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', TOKEN_SECRET).update(json).digest('base64url');
  return `${json}.${signature}`;
}

function verifyToken(rawToken) {
  if (!rawToken || typeof rawToken !== 'string') return null;
  const parts = rawToken.split('.');
  if (parts.length !== 2) return null;

  const [json, signature] = parts;
  const expectedSig = crypto.createHmac('sha256', TOKEN_SECRET).update(json).digest('base64url');

  const bufA = Buffer.from(signature);
  const bufB = Buffer.from(expectedSig);
  if (bufA.length !== bufB.length || !crypto.timingSafeEqual(bufA, bufB)) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(json, 'base64url').toString('utf8'));
    if (payload.exp && payload.exp < Date.now()) {
      return null; // Expired
    }
    return payload;
  } catch {
    return null;
  }
}

function requireAuth(requiredRole = null) {
  return (req, res, next) => {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';

    if (!token) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Authentication required. Please sign in.' }));
    }

    const user = verifyToken(token);
    if (!user) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Invalid or expired session. Please sign in again.' }));
    }

    if (requiredRole && user.role !== requiredRole) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: `Forbidden: this action requires '${requiredRole}' privileges.` }));
    }

    req.user = user;
    if (next) next();
  };
}

module.exports = {
  issueToken,
  verifyToken,
  requireAuth
};

