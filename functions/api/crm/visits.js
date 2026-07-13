import { crmCreateRecord, crmQuery, crmRecords, getSession, json } from "../auth/_common.js";

const DEFAULT_VISIT_ENTITY_TYPE = "3771327758883690";
let activityDefaultsCache = new Map();

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function dateToTimestamp(date) {
  const value = date ? new Date(`${date}T09:00:00+08:00`).getTime() : Date.now();
  return Number.isFinite(value) ? value : Date.now();
}

function extractCreatedId(payload) {
  return (
    payload?.data?.record?.id ||
    payload?.data?.id ||
    payload?.result?.id ||
    payload?.id ||
    ""
  );
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

async function queryCurrentUser(session) {
  if (!session.user?.id) return null;
  try {
    const result = await crmQuery(
      session,
      `SELECT id,name,dimDepart FROM user WHERE id = ${session.user.id} LIMIT 1`
    );
    return crmRecords(result)[0] || null;
  } catch {
    return null;
  }
}

async function queryActivitySample(session) {
  const result = await crmQuery(
    session,
    "SELECT entityType,dimDepart FROM activityrecord WHERE dimDepart != null ORDER BY startTime DESC LIMIT 1"
  );
  return crmRecords(result)[0] || null;
}

async function activityDefaults(session, env) {
  const cacheKey = `${session.user?.id || "anonymous"}:${env.XIAOSHOUYI_VISIT_ENTITY_TYPE || ""}`;
  if (activityDefaultsCache.has(cacheKey)) return activityDefaultsCache.get(cacheKey);

  const user = await queryCurrentUser(session);
  let sample = null;
  try {
    sample = await queryActivitySample(session);
  } catch {
    sample = null;
  }

  const defaults = {
    entityType: String(env.XIAOSHOUYI_VISIT_ENTITY_TYPE || sample?.entityType || DEFAULT_VISIT_ENTITY_TYPE),
    dimDepart: String(session.user?.dimDepart || user?.dimDepart || sample?.dimDepart || "")
  };

  if (!defaults.dimDepart) {
    throw new Error("Cannot resolve CRM dimDepart for activityrecord");
  }
  activityDefaultsCache.set(cacheKey, defaults);
  return defaults;
}

function buildVisitContent(visit) {
  const lines = [
    `【日报拜访】${visit.customer || "未命名客户"} - ${visit.purpose || "客户沟通"}`,
    `拜访方式：${visit.method || "未填写"}`,
    visit.points ? `沟通要点：${visit.points}` : "",
    visit.pain ? `客户痛点：${visit.pain}` : "",
    visit.nextPlan ? `下一步计划：${visit.nextPlan}` : "",
    visit.deadline ? `跟进截止日：${visit.deadline}` : "",
    visit.score ? `拜访评分：${number(visit.score)}/5` : ""
  ].filter(Boolean);
  return lines.join("\n");
}

function buildVisitData(session, defaults, visit) {
  if (!visit.accountId) {
    throw new Error("缺少CRM客户ID，请先在客户名称里选择CRM客户");
  }
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

async function createVisit(session, defaults, visit) {
  const data = buildVisitData(session, defaults, visit);
  const payload = await crmCreateRecord(session, "activityrecord", data);
  return {
    localId: visit.id,
    status: "synced",
    crmRecordId: extractCreatedId(payload),
    payload
  };
}

function dryRunVisit(session, defaults, visit) {
  return {
    localId: visit.id,
    status: "dry-run",
    requestData: buildVisitData(session, defaults, visit)
  };
}

export async function onRequestGet({ request, env }) {
  const session = await getSession(request, env);
  if (!session) return json({ error: "Not logged in" }, { status: 401 });

  try {
    const defaults = await activityDefaults(session, env);
    return json({
      ok: true,
      user: session.user,
      defaults,
      objectApiKey: "activityrecord",
      requiredFields: ["content", "startTime", "ownerId", "dimDepart", "entityType"]
    });
  } catch (error) {
    return json({ error: error.message || "CRM visit debug failed", detail: compactError(error) }, { status: 500 });
  }
}

export async function onRequestPost({ request, env }) {
  const session = await getSession(request, env);
  if (!session) return json({ error: "Not logged in" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const visits = Array.isArray(body.visits) ? body.visits : [];
  if (!visits.length) return json({ error: "No visits to sync" }, { status: 400 });

  try {
    const defaults = await activityDefaults(session, env);
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
    return json({
      syncedAt: new Date().toISOString(),
      dryRun: Boolean(body.dryRun),
      defaults,
      total: visits.length,
      success: results.filter((item) => item.status === successStatus).length,
      failed: results.filter((item) => item.status === "failed").length,
      results
    });
  } catch (error) {
    return json({ error: error.message || "CRM visit sync failed", detail: compactError(error) }, { status: 500 });
  }
}
