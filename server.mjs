import { createServer } from "node:http";
import { access, readFile, mkdir, writeFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { extname, join, normalize } from "node:path";
import { randomBytes } from "node:crypto";

const PORT = Number(process.env.PORT || 3000);
const ROOT = process.cwd();
const DATA_DIR = process.env.DATA_DIR || join(ROOT, "data");
const STATE_FILE = join(DATA_DIR, "state.json");
const SESSIONS_FILE = join(DATA_DIR, "sessions.json");
const LOGIN_FILE = join(DATA_DIR, "logins.json");
const CRM_CACHE_TTL_MS = Number(process.env.CRM_CACHE_TTL_MS || 30 * 60 * 1000);
const STATE_ARRAY_KEYS = [
  "reports",
  "onlineRecords",
  "visitRecords",
  "opportunities",
  "supervisorReviews",
  "aiScores",
  "reportVersions",
  "syncEvents"
];
const SESSION_COOKIE = "crm_session";
const DEFAULT_CLIENT_ID = "da7de9b1f2ad25cd765808611f84fd0c";
const DEFAULT_CRM_HOST = "crm-tencent.xiaoshouyi.com";
const DEFAULT_CONNECTAPPS_HOST = "connectapps.xiaoshouyi.com";
const DEFAULT_BFF_ENDPOINT = "https://crmclaw.xiaoshouyi.com";
const DEFAULT_VISIT_ENTITY_TYPE = "3771327758883690";

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
  const managerKeywords = String(process.env.CRM_MANAGER_ROLE_KEYWORDS || "组长,负责人,分公司负责人,主管,经理,总监,城市经理,区域负责人")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const managerNames = String(process.env.CRM_MANAGER_NAMES || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const managerEmails = String(process.env.CRM_MANAGER_EMAILS || "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  const roleText = [
    user?.roleName,
    user?.role,
    user?.userRole,
    user?.profileName,
    user?.title,
    user?.position,
    user?.jobTitle,
    user?.duty,
    user?.post,
    user?.departmentRole
  ].filter(Boolean).join(" ");
  if (managerKeywords.some((keyword) => roleText.includes(keyword))) return "manager";
  if (managerNames.includes(user?.name || "")) return "manager";
  if (managerEmails.includes(String(user?.email || "").toLowerCase())) return "manager";
  return "consultant";
}

function escapeSoql(value) {
  return String(value || "").replaceAll("'", "\\'");
}

function soqlValue(value) {
  const textValue = String(value || "").trim();
  if (/^\d+$/.test(textValue)) return textValue;
  return `'${escapeSoql(textValue)}'`;
}

function cacheFile(prefix, id) {
  return join(DATA_DIR, `${prefix}-${String(id || "anonymous").replace(/[^a-zA-Z0-9_-]/g, "_")}.json`);
}

function isManager(session) {
  return session?.role === "manager";
}

function ownerName(session) {
  return session?.user?.name || "";
}

function canSeeRecord(session, record) {
  return isManager(session) || record?.owner === ownerName(session);
}

function scopedData(data, session) {
  if (!data || typeof data !== "object" || isManager(session)) return data;
  const owner = ownerName(session);
  const next = { ...data, users: owner ? [owner] : [] };
  STATE_ARRAY_KEYS.forEach((key) => {
    next[key] = (data[key] || []).filter((item) => key === "syncEvents" && !item.owner ? true : canSeeRecord(session, item));
  });
  next.checklist = data.checklist || [];
  return next;
}

function mergeOwnerRecords(existing = {}, incoming = {}, session) {
  if (isManager(session)) return incoming;
  const owner = ownerName(session);
  const mergeByOwner = (key) => [
    ...((existing[key] || []).filter((item) => item.owner !== owner)),
    ...((incoming[key] || []).filter((item) => item.owner === owner))
  ];
  const mergedEvents = new Map();
  [...(existing.syncEvents || []), ...((incoming.syncEvents || []).filter((item) => item.owner === owner || !item.owner))]
    .forEach((item) => {
      if (item?.id) mergedEvents.set(item.id, item);
    });
  return {
    ...existing,
    users: Array.from(new Set([...(existing.users || []), owner].filter(Boolean))),
    checklist: existing.checklist || incoming.checklist || [],
    reports: mergeByOwner("reports"),
    onlineRecords: mergeByOwner("onlineRecords"),
    visitRecords: mergeByOwner("visitRecords"),
    opportunities: mergeByOwner("opportunities"),
    supervisorReviews: [
      ...((existing.supervisorReviews || []).filter((item) => item.owner !== owner && item.createdBy !== owner)),
      ...((incoming.supervisorReviews || []).filter((item) => item.owner === owner || item.createdBy === owner))
    ],
    aiScores: mergeByOwner("aiScores"),
    reportVersions: mergeByOwner("reportVersions"),
    syncEvents: Array.from(mergedEvents.values()).slice(-500)
  };
}

async function crmQuery(session, soql) {
  const requestUrl = new URL(`${session.baseUrl || `https://${authConfig().crmHost}`}/rest/data/v2/query`);
  requestUrl.searchParams.set("q", soql);
  const response = await fetch(requestUrl, {
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

async function crmCreateRecord(session, objectApiKey, data) {
  const response = await fetch(`${session.baseUrl || `https://${authConfig().crmHost}`}/rest/data/v2.0/xobjects/${objectApiKey}`, {
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

function crmRecords(payload) {
  return payload?.result?.records || payload?.data?.records || payload?.records || [];
}

async function queryCurrentUser(session) {
  if (!session.user?.id) return null;
  const extendedFields = "id,name,email,dimDepart,roleName,role,userRole,profileName,title,position,jobTitle,duty,post,departmentRole";
  try {
    const result = await crmQuery(session, `SELECT ${extendedFields} FROM user WHERE id = ${soqlValue(session.user.id)} LIMIT 1`);
    return crmRecords(result)[0] || null;
  } catch {
    try {
      const result = await crmQuery(session, `SELECT id,name,email,dimDepart FROM user WHERE id = ${soqlValue(session.user.id)} LIMIT 1`);
      return crmRecords(result)[0] || null;
    } catch {
      return null;
    }
  }
}

async function queryDepartmentUsers(session, dimDepart) {
  if (!dimDepart) return [];
  const extendedFields = "id,name,email,dimDepart,roleName,role,userRole,profileName,title,position,jobTitle,duty,post,departmentRole";
  try {
    const result = await crmQuery(
      session,
      `SELECT ${extendedFields} FROM user WHERE dimDepart = ${soqlValue(dimDepart)} LIMIT 200`
    );
    return crmRecords(result);
  } catch {
    const result = await crmQuery(
      session,
      `SELECT id,name,email,dimDepart FROM user WHERE dimDepart = ${soqlValue(dimDepart)} LIMIT 200`
    );
    return crmRecords(result);
  }
}

function normalizeCrmUser(item, fallback = {}) {
  return {
    id: String(item?.id || fallback.id || ""),
    name: item?.name || fallback.name || "",
    email: item?.email || fallback.email || "",
    dimDepart: String(item?.dimDepart || fallback.dimDepart || ""),
    roleName: item?.roleName || fallback.roleName || "",
    role: item?.role || fallback.role || "",
    userRole: item?.userRole || fallback.userRole || "",
    profileName: item?.profileName || fallback.profileName || "",
    title: item?.title || fallback.title || "",
    position: item?.position || fallback.position || "",
    jobTitle: item?.jobTitle || fallback.jobTitle || "",
    duty: item?.duty || fallback.duty || "",
    post: item?.post || fallback.post || "",
    departmentRole: item?.departmentRole || fallback.departmentRole || ""
  };
}

async function resolveTeam(session, { force = false } = {}) {
  const file = cacheFile("crm-team", session.user?.id);
  if (!force) {
    const cached = await readJson(file, null);
    if (cached?.syncedAt && Date.now() - new Date(cached.syncedAt).getTime() < CRM_CACHE_TTL_MS) return cached;
  }

  const current = normalizeCrmUser(await queryCurrentUser(session), session.user);
  const dimDepart = current.dimDepart || session.user?.dimDepart || "";
  let members = [];
  if (isManager(session) && dimDepart) {
    try {
      members = (await queryDepartmentUsers(session, dimDepart)).map((item) => normalizeCrmUser(item));
    } catch {
      members = [];
    }
  }
  if (!members.length) members = [current];
  const uniqueMembers = Array.from(new Map(members.filter((item) => item.name).map((item) => [item.id || item.name, item])).values());
  const payload = {
    syncedAt: new Date().toISOString(),
    source: dimDepart && isManager(session) ? "crm-dimDepart" : "crm-current-user",
    role: session.role,
    currentUser: current,
    department: {
      id: dimDepart,
      name: dimDepart ? `CRM部门 ${dimDepart}` : ""
    },
    members: uniqueMembers
  };
  await writeJson(file, payload);
  return payload;
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
    if (!session) return json(res, { loggedIn: false, user: null, role: "visitor" }, 200, { "set-cookie": clearSessionCookie() });
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
      dimDepart: crmUser.dimDepart || "",
      roleName: crmUser.roleName || "",
      role: crmUser.role || "",
      userRole: crmUser.userRole || "",
      profileName: crmUser.profileName || "",
      title: crmUser.title || "",
      position: crmUser.position || "",
      jobTitle: crmUser.jobTitle || "",
      duty: crmUser.duty || "",
      post: crmUser.post || "",
      departmentRole: crmUser.departmentRole || ""
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
    const crmCurrentUser = await queryCurrentUser(session);
    if (crmCurrentUser?.dimDepart || crmCurrentUser?.email || crmCurrentUser?.name) {
      session.user = normalizeCrmUser(crmCurrentUser, session.user);
      session.role = inferRole(session.user);
    }

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
  if (req.method === "GET") {
    const payload = await readState();
    return json(res, { ...payload, data: scopedData(payload.data, session), modelVersion: 2 });
  }
  if (req.method === "PUT") {
    const payload = await readBody(req);
    if (!payload?.data) return json(res, { error: "Invalid payload" }, 400);
    const existing = await readState();
    const data = mergeOwnerRecords(existing?.data || {}, payload.data, session);
    const next = await writeState({ ...payload, data });
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
  if (req.method === "POST") {
    try {
      const payload = await syncAccounts(session, { force: true });
      return json(res, {
        syncedAt: payload.syncedAt,
        ownerName: payload.ownerName,
        count: payload.accounts.length,
        accounts: payload.accounts.slice(0, 50)
      });
    } catch (error) {
      return json(res, { error: error.message || "CRM customer sync failed", detail: compactError(error) }, 500);
    }
  }
  const query = normalizeText(url.searchParams.get("q") || "");
  try {
    const payload = await syncAccounts(session);
    const matches = payload.accounts
      .map((account) => ({ account, score: accountMatchScore(account, query) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || a.account.accountName.localeCompare(b.account.accountName, "zh-CN"))
      .slice(0, 12)
      .map((item) => ({ ...item.account, score: item.score }));
    return json(res, {
      syncedAt: payload.syncedAt,
      ownerName: payload.ownerName,
      count: payload.accounts.length,
      matches
    });
  } catch (error) {
    return json(res, { error: error.message || "CRM customer search failed", detail: compactError(error) }, 500);
  }
}

function accountMatchScore(account, query) {
  if (!query) return 1;
  const name = normalizeText(account.accountName);
  const aliases = (account.aliases || []).map(normalizeText);
  if (name === query || aliases.includes(query)) return 100;
  if (name.startsWith(query)) return 80;
  if (name.includes(query)) return 60;
  if (aliases.some((alias) => alias.includes(query))) return 50;
  return 0;
}

async function queryOwnedAccounts(session, offset = 0) {
  const fields = "id,accountName,ownerId,phone,website,address,Province__c,City__c,provinceA__c,cityA__c,RecentVisitDate__c,AccountTypeJJ__c,createdAt,updatedAt";
  const soql = [
    `SELECT ${fields} FROM account`,
    `WHERE ownerId = ${soqlValue(session.user.id)}`,
    `ORDER BY updatedAt DESC LIMIT ${offset},100`
  ].join(" ");
  try {
    const result = await crmQuery(session, soql);
    return crmRecords(result);
  } catch {
    const fallback = await crmQuery(
      session,
      `SELECT id,accountName,ownerId FROM account WHERE ownerId = ${soqlValue(session.user.id)} LIMIT ${offset},100`
    );
    return crmRecords(fallback);
  }
}

async function syncAccounts(session, { force = false } = {}) {
  const file = cacheFile("crm-accounts", session.user?.id);
  if (!force) {
    const cached = await readJson(file, null);
    if (cached?.syncedAt && Date.now() - new Date(cached.syncedAt).getTime() < CRM_CACHE_TTL_MS) return cached;
  }
  const accounts = [];
  for (let offset = 0; offset < 1000; offset += 100) {
    const records = await queryOwnedAccounts(session, offset);
    accounts.push(...records);
    if (records.length < 100) break;
  }
  const normalized = accounts.map((item) => ({
    accountId: String(item.id || ""),
    accountName: item.accountName || "",
    ownerId: String(item.ownerId || session.user.id || ""),
    ownerName: session.user.name || "",
    phone: item.phone || "",
    website: item.website || "",
    address: item.address || "",
    province: item.Province__c || item.provinceA__c || "",
    city: item.City__c || item.cityA__c || "",
    provinceId: item.provinceA__c || "",
    cityId: item.cityA__c || "",
    recentVisitDate: item.RecentVisitDate__c || "",
    accountType: item.AccountTypeJJ__c || "",
    createdAt: item.createdAt || "",
    updatedAt: item.updatedAt || "",
    aliases: []
  })).filter((item) => item.accountId && item.accountName);
  const payload = {
    ownerId: session.user.id,
    ownerName: session.user.name,
    syncedAt: new Date().toISOString(),
    accounts: normalized
  };
  await writeJson(file, payload);
  return payload;
}

async function resolveOwnerId(session, owner) {
  if (!owner || owner === session.user?.name) return session.user?.id;
  const team = await resolveTeam(session).catch(() => null);
  const member = team?.members?.find((item) => item.name === owner);
  if (member?.id) return member.id;
  const result = await crmQuery(session, `SELECT id,name FROM user WHERE name = '${escapeSoql(owner)}' LIMIT 5`);
  return crmRecords(result).find((item) => item.name === owner)?.id || session.user?.id;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function beijingDateRange(dateText) {
  const [year, month, day] = String(dateText).split("-").map(Number);
  const start = Date.UTC(year, month - 1, day) - 8 * 60 * 60 * 1000;
  return { start, end: start + DAY_MS - 1 };
}

function classifyPerformance(record) {
  const textValue = String(record.NewOrOldSP__c || record.new_or_addon__c || record.newType__c || "");
  if (textValue.includes("老客")) return "renewal";
  if (textValue.includes("新客") || textValue.includes("增购")) return "new";
  return "other";
}

async function queryPerformance(session, ownerId, dateField, start, end) {
  const fields = "id,ownerId,amount_Collected__c,Amount__c,NewOrOldSP__c,new_or_addon__c,newType__c,product_famliy__c,dkrq__c,GetDate__c,Account__c";
  const soql = [
    `SELECT ${fields} FROM SalesPerformance__c`,
    `WHERE ownerId = ${soqlValue(ownerId)}`,
    `AND AccountGet__c = 0`,
    `AND (${dateField} >= ${start} AND ${dateField} <= ${end})`,
    `ORDER BY ${dateField} DESC LIMIT 200`
  ].join(" ");
  const result = await crmQuery(session, soql);
  return crmRecords(result);
}

async function handlePerformance(req, res, url) {
  const session = await requireSession(req, res);
  if (!session) return;
  try {
    const date = url.searchParams.get("date") || new Date().toISOString().slice(0, 10);
    const owner = url.searchParams.get("owner") || session.user.name;
    if (!isManager(session) && owner !== session.user.name) return json(res, { error: "Cannot query another owner" }, 403);
    const ownerId = await resolveOwnerId(session, owner);
    if (!ownerId) return json(res, { error: "Cannot resolve CRM owner" }, 400);
    const { start, end } = beijingDateRange(date);
    let dateField = "dkrq__c";
    let records = [];
    try {
      records = await queryPerformance(session, ownerId, dateField, start, end);
    } catch {
      dateField = "GetDate__c";
      records = await queryPerformance(session, ownerId, dateField, start, end);
    }
    const summary = records.reduce(
      (acc, record) => {
        const value = number(record.amount_Collected__c ?? record.Amount__c);
        const group = classifyPerformance(record);
        if (group === "new") acc.newSales += value;
        if (group === "renewal") acc.renewalSales += value;
        acc.total += value;
        return acc;
      },
      { newSales: 0, renewalSales: 0, total: 0 }
    );
    return json(res, {
      ownerName: owner,
      ownerId: String(ownerId),
      date,
      dateField,
      ...summary,
      records: records.map((record) => ({
        id: String(record.id || ""),
        amount: number(record.amount_Collected__c ?? record.Amount__c),
        type: record.NewOrOldSP__c || record.new_or_addon__c || record.newType__c || "",
        product: record.product_famliy__c || "",
        date: record[dateField] || ""
      }))
    });
  } catch (error) {
    return json(res, { error: error.message || "CRM performance query failed", detail: compactError(error) }, 500);
  }
}

function dateToTimestamp(date) {
  const value = date ? new Date(`${date}T09:00:00+08:00`).getTime() : Date.now();
  return Number.isFinite(value) ? value : Date.now();
}

function extractCreatedId(payload) {
  return payload?.data?.record?.id || payload?.data?.id || payload?.result?.id || payload?.id || "";
}

function compactError(error) {
  return {
    message: error?.message || "CRM request failed",
    status: error?.status || "",
    crmPayload: error?.payload || null,
    requestData: error?.requestData || null,
    soql: error?.soql || ""
  };
}

async function queryActivitySample(session) {
  const result = await crmQuery(
    session,
    "SELECT entityType,dimDepart FROM activityrecord WHERE dimDepart != null ORDER BY startTime DESC LIMIT 1"
  );
  return crmRecords(result)[0] || null;
}

async function activityDefaults(session) {
  const user = await queryCurrentUser(session);
  let sample = null;
  try {
    sample = await queryActivitySample(session);
  } catch {
    sample = null;
  }
  const defaults = {
    entityType: String(process.env.XIAOSHOUYI_VISIT_ENTITY_TYPE || sample?.entityType || DEFAULT_VISIT_ENTITY_TYPE),
    dimDepart: String(session.user?.dimDepart || user?.dimDepart || sample?.dimDepart || "")
  };
  if (!defaults.dimDepart) throw new Error("Cannot resolve CRM dimDepart for activityrecord");
  return defaults;
}

function buildVisitContent(visit) {
  return [
    `【日报拜访】${visit.customer || "未命名客户"} - ${visit.purpose || "客户沟通"}`,
    `拜访方式：${visit.method || "未填写"}`,
    visit.points ? `沟通要点：${visit.points}` : "",
    visit.pain ? `客户痛点：${visit.pain}` : "",
    visit.nextPlan ? `下一步计划：${visit.nextPlan}` : "",
    visit.deadline ? `跟进截止日：${visit.deadline}` : "",
    visit.score ? `拜访评分：${number(visit.score)}/5` : ""
  ].filter(Boolean).join("\n");
}

function buildVisitData(session, defaults, visit) {
  if (!visit.accountId) throw new Error("缺少CRM客户ID，请先在客户名称里选择CRM客户");
  const startTime = dateToTimestamp(visit.date);
  const data = {
    content: buildVisitContent(visit),
    startTime,
    endTime: startTime,
    ownerId: session.user.id,
    dimDepart: defaults.dimDepart,
    entityType: defaults.entityType,
    activityRecordFrom: 1,
    activityRecordFrom_data: visit.accountId,
    dbcRelation26: visit.accountId
  };
  if (visit.nextPlan) data.NextPlan__c = visit.nextPlan;
  if (visit.pain) data.describe__c = visit.pain;
  return data;
}

function buildActionContent(action) {
  const title = action.type === "daily-action" ? "日报动作" : "商机推进";
  return [
    `【${title}】${action.customer || "未命名客户"}`,
    action.owner ? `顾问：${action.owner}` : "",
    action.date ? `日期：${action.date}` : "",
    action.stage ? `阶段：${action.stage}` : "",
    action.progress ? `推进内容：${action.progress}` : "",
    action.nextPlan ? `下一步计划：${action.nextPlan}` : "",
    action.nextActionDate ? `下次跟进：${action.nextActionDate}` : "",
    action.amount ? `商机金额：${number(action.amount).toLocaleString("zh-CN")}` : "",
    action.reportId ? `来源日报：${action.reportId}` : ""
  ].filter(Boolean).join("\n");
}

function buildActionData(session, defaults, action) {
  if (!action.accountId) throw new Error("缺少CRM客户ID，请先匹配CRM客户");
  if (!isManager(session) && action.owner && action.owner !== session.user.name) {
    throw new Error("不能同步其他顾问的CRM动作");
  }
  const startTime = dateToTimestamp(action.date);
  return {
    content: buildActionContent(action),
    startTime,
    endTime: startTime,
    ownerId: session.user.id,
    dimDepart: defaults.dimDepart,
    entityType: defaults.entityType,
    activityRecordFrom: 1,
    activityRecordFrom_data: action.accountId,
    dbcRelation26: action.accountId
  };
}

async function createVisit(session, defaults, visit) {
  const data = buildVisitData(session, defaults, visit);
  const payload = await crmCreateRecord(session, "activityrecord", data);
  return { localId: visit.id, status: "synced", crmRecordId: extractCreatedId(payload), payload };
}

function dryRunVisit(session, defaults, visit) {
  return { localId: visit.id, status: "dry-run", requestData: buildVisitData(session, defaults, visit) };
}

async function createCrmAction(session, defaults, action) {
  const data = buildActionData(session, defaults, action);
  const payload = await crmCreateRecord(session, "activityrecord", data);
  return { localId: action.localId || action.id, status: "synced", crmRecordId: extractCreatedId(payload), payload };
}

function dryRunCrmAction(session, defaults, action) {
  return { localId: action.localId || action.id, status: "dry-run", requestData: buildActionData(session, defaults, action) };
}

async function handleVisits(req, res) {
  const session = await requireSession(req, res);
  if (!session) return;
  if (req.method === "GET") {
    try {
      const defaults = await activityDefaults(session);
      return json(res, {
        ok: true,
        user: session.user,
        defaults,
        objectApiKey: "activityrecord",
        requiredFields: ["content", "startTime", "ownerId", "dimDepart", "entityType"]
      });
    } catch (error) {
      return json(res, { error: error.message || "CRM visit debug failed", detail: compactError(error) }, 500);
    }
  }
  const body = await readBody(req);
  const visits = Array.isArray(body.visits) ? body.visits : [];
  if (!visits.length) return json(res, { error: "No visits to sync" }, 400);
  try {
    const defaults = await activityDefaults(session);
    const results = [];
    for (const visit of visits) {
      try {
        results.push(body.dryRun ? dryRunVisit(session, defaults, visit) : await createVisit(session, defaults, visit));
      } catch (error) {
        results.push({
          localId: visit.id,
          status: "failed",
          error: error.message || "CRM visit sync failed",
          detail: compactError(error)
        });
      }
    }
    const successStatus = body.dryRun ? "dry-run" : "synced";
    return json(res, {
      syncedAt: new Date().toISOString(),
      dryRun: Boolean(body.dryRun),
      defaults,
      total: visits.length,
      success: results.filter((item) => item.status === successStatus).length,
      failed: results.filter((item) => item.status === "failed").length,
      results
    });
  } catch (error) {
    return json(res, { error: error.message || "CRM visit sync failed", detail: compactError(error) }, 500);
  }
}

async function handleTeam(req, res) {
  const session = await requireSession(req, res);
  if (!session) return;
  try {
    const payload = await resolveTeam(session, { force: req.method === "POST" });
    return json(res, payload);
  } catch (error) {
    return json(res, { error: error.message || "CRM team query failed", detail: compactError(error) }, 500);
  }
}

async function handleActions(req, res) {
  const session = await requireSession(req, res);
  if (!session) return;
  const body = await readBody(req);
  const actions = Array.isArray(body.actions) ? body.actions : [];
  if (!actions.length) return json(res, { error: "No CRM actions to sync" }, 400);
  try {
    const defaults = await activityDefaults(session);
    const results = [];
    for (const action of actions) {
      try {
        results.push(body.dryRun ? dryRunCrmAction(session, defaults, action) : await createCrmAction(session, defaults, action));
      } catch (error) {
        results.push({
          localId: action.localId || action.id,
          status: "failed",
          error: error.message || "CRM action sync failed",
          detail: compactError(error)
        });
      }
    }
    const successStatus = body.dryRun ? "dry-run" : "synced";
    return json(res, {
      syncedAt: new Date().toISOString(),
      dryRun: Boolean(body.dryRun),
      defaults,
      total: actions.length,
      success: results.filter((item) => item.status === successStatus).length,
      failed: results.filter((item) => item.status === "failed").length,
      results
    });
  } catch (error) {
    return json(res, { error: error.message || "CRM action sync failed", detail: compactError(error) }, 500);
  }
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
    await access(filePath);
    res.writeHead(200, { "content-type": MIME[extname(filePath)] || "application/octet-stream" });
    const stream = createReadStream(filePath);
    stream.on("error", () => {
      if (!res.headersSent) json(res, { error: "Not found" }, 404);
      else res.end();
    });
    stream.pipe(res);
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
    if (url.pathname === "/api/crm/team") return handleTeam(req, res);
    if (url.pathname === "/api/crm/actions" && req.method === "POST") return handleActions(req, res);
    return serveStatic(req, res, url);
  } catch (error) {
    json(res, { error: error.message || "Server error" }, 500);
  }
}

await mkdir(DATA_DIR, { recursive: true });
createServer(router).listen(PORT, "127.0.0.1", () => {
  console.log(`salesdaywork listening on http://127.0.0.1:${PORT}`);
});
