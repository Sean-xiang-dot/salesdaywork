import { clearSessionCookie, getSessionId, json } from "./_common.js";

export async function onRequestGet({ request, env }) {
  const sessionId = getSessionId(request);
  if (!sessionId) return json({ loggedIn: false, user: null, role: "visitor" });

  const session = await env.SALES_DATA.get(`auth-session:${sessionId}`, "json");
  if (!session) {
    return json(
      { loggedIn: false, user: null, role: "visitor" },
      { headers: { "set-cookie": clearSessionCookie() } }
    );
  }

  if (session.expiresAt && new Date(session.expiresAt).getTime() <= Date.now()) {
    await env.SALES_DATA.delete(`auth-session:${sessionId}`);
    return json(
      { loggedIn: false, user: null, role: "visitor" },
      { headers: { "set-cookie": clearSessionCookie() } }
    );
  }

  return json({
    loggedIn: true,
    user: session.user,
    role: session.role || "consultant"
  });
}
