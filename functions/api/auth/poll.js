import { authConfig, inferRole, json, randomId, sessionCookie } from "./_common.js";

async function queryToken(config, loginId) {
  const url = new URL(`https://${config.connectappsHost}/neocrm/claw/refer/token/query`);
  url.searchParams.set("clawId", loginId);
  const response = await fetch(url, { headers: { accept: "application/json" } });
  if (!response.ok) return null;
  return response.json();
}

async function queryUserInfo(config, accessToken) {
  const response = await fetch(`${config.bffEndpoint}/user/info`, {
    headers: {
      authorization: `Bearer ${accessToken}`,
      "x-openapi-baseurl": `https://${config.crmHost}`,
      accept: "application/json"
    }
  });
  if (!response.ok) return {};
  const payload = await response.json();
  return payload?.data?.result || payload?.data || {};
}

export async function onRequestGet({ request, env }) {
  const config = authConfig(env);
  const loginId = new URL(request.url).searchParams.get("loginId");
  if (!loginId) return json({ status: "failed", error: "Missing loginId" }, { status: 400 });

  const login = await env.SALES_DATA.get(`auth-login:${loginId}`, "json");
  if (!login) return json({ status: "failed", error: "Login request expired" }, { status: 410 });

  const tokenPayload = await queryToken(config, loginId);
  if (!tokenPayload?.accessToken) return json({ status: "pending" });

  const crmUser = await queryUserInfo(config, tokenPayload.accessToken);
  const user = {
    id: String(crmUser.id || tokenPayload.userId || ""),
    name: crmUser.name || tokenPayload.userName || "CRM用户",
    email: crmUser.email || "",
    tenantId: String(tokenPayload.tenantId || crmUser.tenantId || ""),
    tenantName: crmUser.tenantName || "",
    dimDepart: crmUser.dimDepart || ""
  };
  const expiresAt = tokenPayload.expiresAt || new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
  const sessionId = randomId("crm-session");
  const session = {
    user,
    role: inferRole(user),
    accessToken: tokenPayload.accessToken,
    refreshToken: tokenPayload.refreshToken || "",
    baseUrl: `https://${config.crmHost}`,
    createdAt: new Date().toISOString(),
    expiresAt
  };

  await env.SALES_DATA.put(`auth-session:${sessionId}`, JSON.stringify(session), { expirationTtl: 60 * 60 * 8 });
  await env.SALES_DATA.delete(`auth-login:${loginId}`);

  return json(
    { status: "authenticated", loggedIn: true, user, role: session.role },
    { headers: { "set-cookie": sessionCookie(sessionId) } }
  );
}
