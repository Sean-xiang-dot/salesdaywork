const DEFAULT_CLIENT_ID = "da7de9b1f2ad25cd765808611f84fd0c";
const CRM_HOST = "crm-tencent.xiaoshouyi.com";
const CONNECTAPPS_HOST = "connectapps.xiaoshouyi.com";
const BFF_ENDPOINT = "https://crmclaw.xiaoshouyi.com";
const SESSION_COOKIE = "crm_session";

export function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...(init.headers || {})
    }
  });
}

export function randomId(prefix) {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const value = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${prefix}-${value}`;
}

export function authConfig(env) {
  const clientId = env.XIAOSHOUYI_CLIENT_ID || DEFAULT_CLIENT_ID;
  return {
    clientId,
    crmHost: env.XIAOSHOUYI_CRM_HOST || CRM_HOST,
    connectappsHost: env.XIAOSHOUYI_CONNECTAPPS_HOST || CONNECTAPPS_HOST,
    bffEndpoint: env.XIAOSHOUYI_BFF_ENDPOINT || BFF_ENDPOINT
  };
}

export function buildAuthorizeUrl(config, loginId) {
  const redirectUri = `https://${config.connectappsHost}/neocrm/claw/refer/auth/callback`;
  const authorizeUrl = new URL(`https://${config.crmHost}/oauth/oauth2/authorize.action`);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("client_id", config.clientId);
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("state", `${loginId},${config.clientId}`);
  authorizeUrl.searchParams.set("oauthType", "standard");
  return authorizeUrl.toString();
}

export function parseCookies(request) {
  return Object.fromEntries(
    (request.headers.get("cookie") || "")
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf("=");
        return [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
      })
  );
}

export function sessionCookie(sessionId, maxAge = 60 * 60 * 8) {
  return `${SESSION_COOKIE}=${encodeURIComponent(sessionId)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

export function clearSessionCookie() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export function getSessionId(request) {
  return parseCookies(request)[SESSION_COOKIE] || "";
}

export async function getSession(request, env) {
  const sessionId = getSessionId(request);
  if (!sessionId) return null;
  const session = await env.SALES_DATA.get(`auth-session:${sessionId}`, "json");
  if (!session) return null;
  if (session.expiresAt && new Date(session.expiresAt).getTime() <= Date.now()) {
    await env.SALES_DATA.delete(`auth-session:${sessionId}`);
    return null;
  }
  return { id: sessionId, ...session };
}

export function inferRole(user) {
  const text = `${user?.name || ""} ${user?.email || ""}`;
  if (/Sean|向|王禹诚|主管|manager|admin/i.test(text)) return "manager";
  return "consultant";
}

export async function crmQuery(session, soql) {
  const url = new URL(`${session.baseUrl || "https://crm-tencent.xiaoshouyi.com"}/rest/data/v2/query`);
  url.searchParams.set("q", soql);
  const response = await fetch(url, {
    headers: {
      authorization: `Bearer ${session.accessToken}`,
      accept: "application/json"
    }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload?.msg || payload?.message || payload?.error_description || "CRM query failed";
    const error = new Error(message);
    error.status = response.status;
    error.payload = payload;
    error.soql = soql;
    throw error;
  }
  return payload;
}

export async function crmCreateRecord(session, objectApiKey, data) {
  const response = await fetch(`${session.baseUrl || "https://crm-tencent.xiaoshouyi.com"}/rest/data/v2.0/xobjects/${objectApiKey}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${session.accessToken}`,
      "content-type": "application/json",
      accept: "application/json"
    },
    body: JSON.stringify({ data })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || (payload?.code && payload.code !== 200)) {
    const message = payload?.msg || payload?.message || payload?.error_description || "CRM create failed";
    const error = new Error(message);
    error.status = response.status;
    error.payload = payload;
    error.requestData = data;
    throw error;
  }
  return payload;
}

export function crmRecords(payload) {
  return payload?.result?.records || payload?.data?.records || payload?.records || [];
}
