// Shared audit-log helper. Underscore-prefixed so Vercel does not route it.
// Callers pass a service-key Supabase client. Audit writes must never block or
// fail the primary request, so everything is wrapped and swallowed.

const ALLOWED_ACTIONS = new Set([
  'login', 'logout',
  'email.send',
  'document.generate', 'data.export', 'data.delete_all',
  'hris.connect', 'hris.disconnect',
  'integration.connect', 'integration.disconnect',
  'settings.change',
  'demo.seed',
]);

export function clientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (xff) return String(xff).split(',')[0].trim().slice(0, 45);
  return (req.socket && req.socket.remoteAddress) ? String(req.socket.remoteAddress).slice(0, 45) : null;
}

export async function logAudit(sb, evt) {
  try {
    if (!sb || !evt || !ALLOWED_ACTIONS.has(evt.action)) return;
    // Keep detail small and free of message bodies / PII payloads.
    let detail = null;
    if (evt.detail && typeof evt.detail === 'object') {
      try { detail = JSON.parse(JSON.stringify(evt.detail)); } catch { detail = null; }
      if (detail && JSON.stringify(detail).length > 2000) detail = { note: 'truncated' };
    }
    await sb.from('audit_events').insert({
      company_id: evt.company_id || null,
      user_id: evt.user_id || null,
      user_email: (evt.user_email || null),
      action: String(evt.action).slice(0, 64),
      detail,
      ip: evt.ip || null,
    });
  } catch (e) { /* never block the primary request on an audit write */ }
}

export { ALLOWED_ACTIONS };
