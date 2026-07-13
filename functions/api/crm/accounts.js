import { crmQuery, crmRecords, getSession, json } from "../auth/_common.js";

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[（）()【】\[\]·.,，。]/g, "");
}

function accountKey(userId) {
  return `crm-accounts:${userId}`;
}

function matchScore(account, query) {
  const q = normalizeText(query);
  if (!q) return 1;
  const name = normalizeText(account.accountName);
  const aliases = (account.aliases || []).map(normalizeText);
  if (name === q || aliases.includes(q)) return 100;
  if (name.startsWith(q)) return 80;
  if (name.includes(q)) return 60;
  if (aliases.some((alias) => alias.includes(q))) return 50;
  return 0;
}

async function queryOwnedAccounts(session, offset = 0) {
  const fields = "id,accountName,ownerId,phone,website,address,Province__c,City__c,provinceA__c,cityA__c,RecentVisitDate__c,AccountTypeJJ__c,createdAt,updatedAt";
  const soql = [
    `SELECT ${fields} FROM account`,
    `WHERE ownerId = ${session.user.id}`,
    `ORDER BY updatedAt DESC LIMIT ${offset},100`
  ].join(" ");
  let result;
  try {
    result = await crmQuery(session, soql);
  } catch {
    result = await crmQuery(
      session,
      `SELECT id,accountName,ownerId FROM account WHERE ownerId = ${session.user.id} LIMIT ${offset},100`
    );
  }
  return crmRecords(result);
}

async function syncAccounts(session, env) {
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
  await env.SALES_DATA.put(accountKey(session.user.id), JSON.stringify(payload));
  return payload;
}

export async function onRequestPost({ request, env }) {
  const session = await getSession(request, env);
  if (!session) return json({ error: "Not logged in" }, { status: 401 });
  try {
    const payload = await syncAccounts(session, env);
    return json({
      syncedAt: payload.syncedAt,
      ownerName: payload.ownerName,
      count: payload.accounts.length,
      accounts: payload.accounts.slice(0, 20)
    });
  } catch (error) {
    return json({ error: error.message || "CRM customer sync failed" }, { status: 500 });
  }
}

export async function onRequestGet({ request, env }) {
  const session = await getSession(request, env);
  if (!session) return json({ error: "Not logged in" }, { status: 401 });

  const url = new URL(request.url);
  const query = url.searchParams.get("q") || "";
  let payload = await env.SALES_DATA.get(accountKey(session.user.id), "json");
  if (!payload) payload = await syncAccounts(session, env);

  const matches = payload.accounts
    .map((account) => ({ account, score: matchScore(account, query) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.account.accountName.localeCompare(b.account.accountName, "zh-CN"))
    .slice(0, 12)
    .map((item) => ({ ...item.account, score: item.score }));

  return json({
    syncedAt: payload.syncedAt,
    ownerName: payload.ownerName,
    count: payload.accounts.length,
    matches
  });
}
