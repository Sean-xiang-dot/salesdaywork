import { getSession, inferRole, json } from "./auth/_common.js";

const STATE_KEY = "team-state";
const STRUCTURED_KEYS = {
  meta: "state:meta",
  users: "state:users",
  checklist: "state:checklist",
  reports: "state:reports",
  onlineRecords: "state:onlineRecords",
  visitRecords: "state:visitRecords",
  opportunities: "state:opportunities",
  supervisorReviews: "state:supervisorReviews",
  aiScores: "state:aiScores",
  reportVersions: "state:reportVersions",
  syncEvents: "state:syncEvents"
};

function isManager(session) {
  return inferRole(session?.user) === "manager";
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
  return {
    ...data,
    users: owner ? [owner] : [],
    reports: (data.reports || []).filter((item) => canSeeRecord(session, item)),
    onlineRecords: (data.onlineRecords || []).filter((item) => canSeeRecord(session, item)),
    visitRecords: (data.visitRecords || []).filter((item) => canSeeRecord(session, item)),
    opportunities: (data.opportunities || []).filter((item) => canSeeRecord(session, item)),
    supervisorReviews: (data.supervisorReviews || []).filter((item) => canSeeRecord(session, item)),
    aiScores: (data.aiScores || []).filter((item) => canSeeRecord(session, item)),
    reportVersions: (data.reportVersions || []).filter((item) => canSeeRecord(session, item)),
    syncEvents: (data.syncEvents || []).filter((item) => !item.owner || canSeeRecord(session, item))
  };
}

function mergeOwnerRecords(existing = {}, incoming = {}, session) {
  if (isManager(session)) return incoming;
  const owner = ownerName(session);
  const mergeByOwner = (key) => [
    ...((existing[key] || []).filter((item) => item.owner !== owner)),
    ...((incoming[key] || []).filter((item) => item.owner === owner))
  ];
  const mergedEvents = new Map();
  [...(existing.syncEvents || []), ...((incoming.syncEvents || []).filter((item) => item.owner === owner || !item.owner))].forEach((item) => {
    if (item?.id) mergedEvents.set(item.id, item);
  });
  return {
    ...existing,
    users: Array.from(new Set([...(existing.users || []), owner].filter(Boolean))),
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
    checklist: existing.checklist || incoming.checklist || [],
    syncEvents: Array.from(mergedEvents.values()).slice(-200)
  };
}

async function readStructuredState(env) {
  const entries = await Promise.all(
    Object.entries(STRUCTURED_KEYS).map(async ([name, key]) => [name, await env.SALES_DATA.get(key, "json")])
  );
  const values = Object.fromEntries(entries);
  const hasStructuredData = Object.entries(values).some(([name, value]) => name !== "meta" && value);
  if (!hasStructuredData) return null;
  return {
    savedAt: values.meta?.savedAt || "",
    data: {
      users: values.users || [],
      checklist: values.checklist || [],
      reports: values.reports || [],
      onlineRecords: values.onlineRecords || [],
      visitRecords: values.visitRecords || [],
      opportunities: values.opportunities || [],
      supervisorReviews: values.supervisorReviews || [],
      aiScores: values.aiScores || [],
      reportVersions: values.reportVersions || [],
      syncEvents: values.syncEvents || []
    }
  };
}

async function writeStructuredState(env, savedAt, data) {
  const safeData = data || {};
  await Promise.all([
    env.SALES_DATA.put(STRUCTURED_KEYS.meta, JSON.stringify({ savedAt, modelVersion: 2 })),
    env.SALES_DATA.put(STRUCTURED_KEYS.users, JSON.stringify(safeData.users || [])),
    env.SALES_DATA.put(STRUCTURED_KEYS.checklist, JSON.stringify(safeData.checklist || [])),
    env.SALES_DATA.put(STRUCTURED_KEYS.reports, JSON.stringify(safeData.reports || [])),
    env.SALES_DATA.put(STRUCTURED_KEYS.onlineRecords, JSON.stringify(safeData.onlineRecords || [])),
    env.SALES_DATA.put(STRUCTURED_KEYS.visitRecords, JSON.stringify(safeData.visitRecords || [])),
    env.SALES_DATA.put(STRUCTURED_KEYS.opportunities, JSON.stringify(safeData.opportunities || [])),
    env.SALES_DATA.put(STRUCTURED_KEYS.supervisorReviews, JSON.stringify(safeData.supervisorReviews || [])),
    env.SALES_DATA.put(STRUCTURED_KEYS.aiScores, JSON.stringify(safeData.aiScores || [])),
    env.SALES_DATA.put(STRUCTURED_KEYS.reportVersions, JSON.stringify((safeData.reportVersions || []).slice(-1000))),
    env.SALES_DATA.put(STRUCTURED_KEYS.syncEvents, JSON.stringify((safeData.syncEvents || []).slice(-500)))
  ]);
}

async function readState(env) {
  const structured = await readStructuredState(env);
  if (structured) return structured;
  const legacy = await env.SALES_DATA.get(STATE_KEY, "json");
  if (legacy?.data) {
    await writeStructuredState(env, legacy.savedAt || new Date().toISOString(), legacy.data);
  }
  return legacy;
}

export async function onRequestGet({ request, env }) {
  const session = await getSession(request, env);
  if (!session) return json({ error: "Not logged in" }, { status: 401 });

  const payload = await readState(env);
  return json(payload ? { ...payload, data: scopedData(payload.data, session), modelVersion: 2 } : { savedAt: "", data: null, modelVersion: 2 });
}

export async function onRequestPut({ request, env }) {
  const session = await getSession(request, env);
  if (!session) return json({ error: "Not logged in" }, { status: 401 });

  const payload = await request.json();
  if (!payload || typeof payload !== "object" || !payload.data) {
    return json({ error: "Invalid payload" }, { status: 400 });
  }

  const existing = await readState(env);
  const savedAt = payload.savedAt || new Date().toISOString();
  const data = mergeOwnerRecords(existing?.data || {}, payload.data, session);
  await writeStructuredState(env, savedAt, data);

  return json({ ok: true, savedAt, modelVersion: 2 });
}
