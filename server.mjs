import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { extname, join, normalize } from "node:path";
import { randomBytes } from "node:crypto";

const PORT = Number(process.env.PORT || 3000);
const ROOT = process.cwd();
const DATA_DIR = process.env.DATA_DIR || join(ROOT, "data");
const STATE_FILE = join(DATA_DIR, "state.json");
const SESSIONS_FILE = join(DATA_DIR, "sessions.json");
const LOGIN_FILE = join(DATA_DIR, "logins.json");
const SESSION_COOKIE = "crm_session";
const DEFAULT_CLIENT_ID = "da7de9b1f2ad25cd765808611f84fd0c";
const DEFAULT_CRM_HOST = "crm-tencent.xiaoshouyi.com";
const DEFAULT_CONNECTAPPS_HOST = "connectapps.xiaoshouyi.com";
const DEFAULT_BFF_ENDPOINT = "https://crmclaw.xiaoshouyi.com";

function json(res, data, status = 200, headers = {}) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...headers
  });
  res.end(JSON.stringify(data));
}

function text(res, body, status = 200, headers = {}) {
  res.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    ...headers
  });
  res.end(body);
}

function randomId(prefix) {
  return `${prefix}-${randomBytes(16).toString("hex")}`;
}

function parseCookies(req) {
  return Object.fromEntries(
    String(req.headers.cookie || "")
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf("=");
        return [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
      })
  );
}

function sessionCookie(sessionId, maxAge = 60 * 60 * 24 * 7) {
  return `${SESSION_COOKIE}=${encodeURIComponent(sessionId)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
}

function clearSessionCookie() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

function authConfig() {
  return {
    clientId: process.env.XIAOSHOUYI_CLIENT_ID || DEFAULT_CLIENT_ID,
    crmHost: process.env.XIAOSHOUYI_CRM_HOST || DEFAULT_CRM_HOST,
    connectappsHost: process.env.XIAOSHOUYI_CONNECTAPPS_HOST || DEFAULT_CONNECTAPPS_HOST,
    bffEndpoint: process.env.XIAOSHOUYI_BFF_ENDPOINT || DEFAULT_BFF_ENDPOINT
  };
}

function buildAuthorizeUrl(config, loginId) {
  const redirectUri = `https://${config.connectappsHost}/neocrm/claw/refer/auth/callback`;
  const authorizeUrl = new URL(`https://${config.crmHost}/oauth/oauth2/authorize.action`);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("client_id", config.clientId);
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("state", `${loginId},${config.clientId}`);
  authorizeUrl.searchParams.set("oauthType", "standard");
  return authorizeUrl.toString();
}

function inferRole(user) {
  const text = `${user?.name || ""} ${user?.email || ""}`;
  if (/Sean|刘想|xiang\.liu|王禹诚|主管|manager|admin/i.test(text)) return "manager";
  return "consultant";
}

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

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}

async function writeJson(file, data) {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(file, JSON.stringify(data, null, 2));
}

async function readState() {
  return readJson(STATE_FILE, { savedAt: "", data: null, modelVersion: 2 });
}

async function writeState(payload) {
  const savedAt = payload.savedAt || new Date().toISOString();
  const next = {
    savedAt,
    data: payload.data,
    modelVersion: 2
  };
  await writeJson(STATE_FILE, next);
  return next;
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function getSession(req) {
  const sessionId = parseCookies(req)[SESSION_COOKIE];
  if (!sessionId) return null;
  const sessions = await readJson(SESSIONS_FILE, {});
  const session = sessions[sessionId];
  if (!session) return null;
  if (session.user?.id === "local-manager" || session.user?.tenantId === "local") {
    delete sessions[sessionId];
    await writeJson(SESSIONS_FILE, sessions);
    return null;
  }
  if (session.expiresAt && new Date(session.expiresAt).getTime() <= Date.now()) {
    delete sessions[sessionId];
    await writeJson(SESSIONS_FILE, sessions);
    return null;
  }
  return { id: sessionId, ...session };
}

async function handleAuth(req, res, url) {
  if (url.pathname === "/api/auth/me" && req.method === "GET") {
    const session = await getSession(req);
    if (!session) return json(res, { loggedIn: false, user: null, role: "visitor" });
    return json(res, { loggedIn: true, user: session.user, role: session.role || "consultant" });
  }

  if (url.pathname === "/api/auth/start" && req.method === "POST") {
    const config = authConfig();
    const loginId = randomId("neocrm-web");
    const logins = await readJson(LOGIN_FILE, {});
    logins[loginId] = { loginId, startedAt: new Date().toISOString() };
    await writeJson(LOGIN_FILE, logins);
    return json(res, {
      loginId,
      authorizeUrl: buildAuthorizeUrl(config, loginId)
    });
  }

  if (url.pathname === "/api/auth/poll" && req.method === "GET") {
    const config = authConfig();
    const loginId = url.searchParams.get("loginId");
    const logins = await readJson(LOGIN_FILE, {});
    if (!loginId || !logins[loginId]) return json(res, { status: "failed", error: "Login request expired" }, 410);
    const tokenPayload = await queryToken(config, loginId);
    if (!tokenPayload?.accessToken) return json(res, { status: "pending" });

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

    delete logins[loginId];
    await writeJson(LOGIN_FILE, logins);
    const sessions = await readJson(SESSIONS_FILE, {});
    sessions[sessionId] = session;
    await writeJson(SESSIONS_FILE, sessions);
    return json(
      res,
      { status: "authenticated", loggedIn: true, user: session.user, role: session.role },
      200,
      { "set-cookie": sessionCookie(sessionId) }
    );
  }

  if (url.pathname === "/api/auth/logout" && req.method === "POST") {
    const sessionId = parseCookies(req)[SESSION_COOKIE];
    if (sessionId) {
      const sessions = await readJson(SESSIONS_FILE, {});
      delete sessions[sessionId];
      await writeJson(SESSIONS_FILE, sessions);
    }
    return json(res, { ok: true }, 200, { "set-cookie": clearSessionCookie() });
  }

  return false;
}

async function requireSession(req, res) {
  const session = await getSession(req);
  if (!session) {
    json(res, { error: "Not logged in" }, 401);
    return null;
  }
  return session;
}

async function handleState(req, res) {
  const session = await requireSession(req, res);
  if (!session) return;
  if (req.method === "GET") return json(res, await readState());
  if (req.method === "PUT") {
    const payload = await readBody(req);
    if (!payload?.data) return json(res, { error: "Invalid payload" }, 400);
    const next = await writeState(payload);
    return json(res, { ok: true, savedAt: next.savedAt, modelVersion: 2 });
  }
  return json(res, { error: "Method not allowed" }, 405);
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function lineCount(text) {
  return String(text || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean).length;
}

function localScore(report = {}, context = {}) {
  const opportunityUpdates = report.opportunityUpdates || [];
  const visitRecords = context.visitRecords || [];
  const opportunities = context.opportunities || [];
  const completenessFields = [
    report.owner,
    report.newSales || report.renewalSales,
    report.touches,
    opportunityUpdates.length || lineCount(report.opportunityText),
    report.tomorrowPlan
  ];
  const completeness = Math.round((completenessFields.filter(Boolean).length / completenessFields.length) * 20);
  const workload = Math.min(25, number(report.touches) * 2 + number(report.selfProspects) * 3 + number(report.softwareTouches) * 2 + number(report.posts) * 2);
  const opportunity = Math.min(25, opportunityUpdates.filter((item) => item.todayProgress || item.nextPlan).length * 8 + lineCount(report.opportunityText) * 5 + opportunities.filter((item) => item.owner === report.owner).length * 2);
  const visit = Math.min(15, visitRecords.filter((item) => item.owner === report.owner).length * 6 + number(report.visitScore) * 2);
  const plan = Math.min(15, lineCount(report.tomorrowPlan) * 5 + (String(report.tomorrowPlan || "").length > 20 ? 5 : 0));
  const score = Math.max(0, Math.min(100, completeness + workload + opportunity + visit + plan));
  const issues = [];
  if (!report.tomorrowPlan) issues.push("明日计划缺失");
  if (!opportunityUpdates.length && !lineCount(report.opportunityText)) issues.push("商机推进留痕不足");
  if (!visitRecords.filter((item) => item.owner === report.owner).length && !lineCount(report.visits)) issues.push("客户拜访记录不足");
  if (number(report.touches) < 8) issues.push("客户触达偏少");
  return {
    score,
    level: score >= 85 ? "A" : score >= 70 ? "B" : score >= 55 ? "C" : "D",
    summary: `今日完成触达 ${number(report.touches)} 个客户，新签 ${number(report.newSales).toLocaleString("zh-CN")}，商机推进 ${opportunityUpdates.length || lineCount(report.opportunityText)} 条。`,
    highlights: [
      number(report.newSales) > 0 ? "产生新签业绩" : "",
      number(report.selfProspects) > 0 ? "有自拓动作" : "",
      report.tomorrowPlan ? "明日计划有留痕" : ""
    ].filter(Boolean),
    issues,
    advice: issues.length ? `建议优先补齐：${issues.slice(0, 2).join("、")}。` : "建议保持当前节奏，并把高金额商机拆成明确下一步和截止时间。",
    evidence: {
      touches: number(report.touches),
      newSales: number(report.newSales),
      renewalSales: number(report.renewalSales),
      opportunityUpdates: opportunityUpdates.length,
      visitRecords: visitRecords.filter((item) => item.owner === report.owner).length
    },
    source: "server-local-rule"
  };
}

async function handleAiScore(req, res) {
  const session = await requireSession(req, res);
  if (!session) return;
  const payload = await readBody(req);
  if (!payload.report) return json(res, { error: "Missing report" }, 400);
  return json(res, localScore(payload.report, payload.context || {}));
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[（）()【】\[\]·.,，。]/g, "");
}

async function handleAccounts(req, res, url) {
  const session = await requireSession(req, res);
  if (!session) return;
  const state = await readState();
  const query = normalizeText(url.searchParams.get("q") || "");
  const source = [
    ...(state.data?.visitRecords || []),
    ...(state.data?.opportunities || [])
  ];
  const accountsByName = new Map();
  source.forEach((item) => {
    const name = item.customer || "";
    if (!name) return;
    const key = normalizeText(name);
    if (!accountsByName.has(key)) {
      accountsByName.set(key, {
        accountId: item.accountId || `local-${key}`,
        accountName: name,
        ownerName: item.owner || "",
        phone: "",
        website: "",
        address: "",
        province: "",
        city: "",
        updatedAt: item.updatedAt || item.date || ""
      });
    }
  });
  const accounts = Array.from(accountsByName.values());
  const matches = accounts
    .map((account) => {
      const name = normalizeText(account.accountName);
      const score = !query ? 1 : name === query ? 100 : name.startsWith(query) ? 80 : name.includes(query) ? 60 : 0;
      return { account, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 12)
    .map((item) => ({ ...item.account, score: item.score }));

  return json(res, {
    syncedAt: new Date().toISOString(),
    ownerName: session.user.name,
    count: accounts.length,
    matches,
    localOnly: true
  });
}

async function handlePerformance(req, res, url) {
  const session = await requireSession(req, res);
  if (!session) return;
  return json(res, {
    ownerName: url.searchParams.get("owner") || session.user.name,
    ownerId: session.user.id,
    date: url.searchParams.get("date") || new Date().toISOString().slice(0, 10),
    newSales: 0,
    renewalSales: 0,
    total: 0,
    records: [],
    localOnly: true
  });
}

async function handleVisits(req, res) {
  const session = await requireSession(req, res);
  if (!session) return;
  if (req.method === "GET") return json(res, { ok: true, localOnly: true, user: session.user });
  const body = await readBody(req);
  const visits = Array.isArray(body.visits) ? body.visits : [];
  return json(res, {
    syncedAt: new Date().toISOString(),
    dryRun: true,
    localOnly: true,
    total: visits.length,
    success: 0,
    failed: visits.length,
    results: visits.map((visit) => ({
      localId: visit.id,
      status: "failed",
      error: "腾讯服务器本地版暂未配置 CRM 真实同步"
    }))
  });
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml"
};

async function serveStatic(req, res, url) {
  const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
  const relative = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, "");
  const filePath = join(ROOT, relative);
  if (!filePath.startsWith(ROOT)) return json(res, { error: "Forbidden" }, 403);
  try {
    res.writeHead(200, { "content-type": MIME[extname(filePath)] || "application/octet-stream" });
    createReadStream(filePath).pipe(res);
  } catch {
    json(res, { error: "Not found" }, 404);
  }
}

async function router(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    if (url.pathname === "/api/health" && req.method === "GET") {
      return json(res, {
        ok: true,
        service: "salesdaywork",
        version: process.env.APP_VERSION || "development",
        timestamp: new Date().toISOString()
      });
    }
    if (url.pathname.startsWith("/api/auth/")) {
      const handled = await handleAuth(req, res, url);
      if (handled === false) return json(res, { error: "Not found" }, 404);
      return;
    }
    if (url.pathname === "/api/state") return handleState(req, res);
    if (url.pathname === "/api/ai/score" && req.method === "POST") return handleAiScore(req, res);
    if (url.pathname === "/api/crm/accounts") return handleAccounts(req, res, url);
    if (url.pathname === "/api/crm/performance") return handlePerformance(req, res, url);
    if (url.pathname === "/api/crm/visits") return handleVisits(req, res);
    return serveStatic(req, res, url);
  } catch (error) {
    json(res, { error: error.message || "Server error" }, 500);
  }
}

await mkdir(DATA_DIR, { recursive: true });
createServer(router).listen(PORT, "127.0.0.1", () => {
  console.log(`salesdaywork listening on http://127.0.0.1:${PORT}`);
});
