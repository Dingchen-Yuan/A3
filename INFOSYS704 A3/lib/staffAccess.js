const crypto = require('node:crypto');
const DEMO_ACCESS_CODE = 'INFOSYS_704';

function createStaffAccess(configuredKey) {
  // Deliberately public classroom access. A private configured key disables
  // the public hint; never return that private key to the browser or logs.
  const accessCode = configuredKey || DEMO_ACCESS_CODE;
  const hintAvailable = accessCode === DEMO_ACCESS_CODE;
  const sessions = new Map(), attempts = new Map();
  const digest = value => crypto.createHash('sha256').update(String(value)).digest();
  const cookieName = 'kmart_staff_session';
  const cookie = (req, token, age) => `${cookieName}=${token}; Path=/api/assist/staff; HttpOnly; SameSite=Strict; Max-Age=${age}${req.socket && req.socket.encrypted ? '; Secure' : ''}`;
  function tokenFor(req) {
    const match = String((req.headers || {}).cookie || '').split(';').map(value => value.trim()).find(value => value.startsWith(cookieName + '='));
    return match ? match.slice(cookieName.length + 1) : '';
  }
  function session(req) {
    const token = tokenFor(req), key = digest(token).toString('hex'), found = sessions.get(key);
    if (!found || found.expires <= Date.now()) { sessions.delete(key); return null; }
    return found.actor;
  }
  function sameOrigin(req) {
    const headers = req.headers || {};
    if (!headers.origin) return true;
    try { return new URL(headers.origin).host === headers.host; } catch (err) { return false; }
  }
  function login(req, res, body) {
    const ip = (req.socket || {}).remoteAddress || 'local';
    const previous = attempts.get(ip);
    if (previous && previous.until > Date.now() && previous.count >= 5) return { status: 429, error: 'Too many sign-in attempts. Try again in 15 minutes.' };
    if (!sameOrigin(req)) return { status: 403, error: 'Sign in from this application.' };
    if (!body || typeof body.name !== 'string' || body.name.trim().length < 2 || body.name.trim().length > 80 || /[\x00-\x1F<>]/.test(body.name)) return { status: 400, error: 'Enter your staff name (2–80 characters).' };
    if (typeof body.accessCode !== 'string' || !crypto.timingSafeEqual(digest(body.accessCode), digest(accessCode))) {
      const entry = previous && previous.until > Date.now() ? previous : { count: 0, until: Date.now() + 900000 };
      entry.count += 1; attempts.set(ip, entry);
      return { status: 401, error: 'Staff sign-in details were not accepted.' };
    }
    attempts.delete(ip);
    for (const [key, value] of sessions) if (value.expires <= Date.now()) sessions.delete(key);
    const token = crypto.randomBytes(32).toString('base64url');
    const actor = { id: 'staff-' + crypto.randomBytes(6).toString('hex'), name: body.name.trim(), role: 'recovery_staff' };
    sessions.set(digest(token).toString('hex'), { actor, expires: Date.now() + 8 * 3600000 });
    res.setHeader('Set-Cookie', cookie(req, token, 8 * 3600));
    return { status: 200, actor };
  }
  function logout(req, res) {
    sessions.delete(digest(tokenFor(req)).toString('hex'));
    res.setHeader('Set-Cookie', cookie(req, '', 0));
  }
  return { hintAvailable, publicHint: hintAvailable ? DEMO_ACCESS_CODE : null, session, sameOrigin, login, logout };
}

module.exports = { createStaffAccess, DEMO_ACCESS_CODE };
