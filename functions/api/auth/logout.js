import { clearSessionCookie, getSessionId, json } from "./_common.js";

export async function onRequestPost({ request, env }) {
  const sessionId = getSessionId(request);
  if (sessionId) await env.SALES_DATA.delete(`auth-session:${sessionId}`);
  return json({ ok: true }, { headers: { "set-cookie": clearSessionCookie() } });
}
