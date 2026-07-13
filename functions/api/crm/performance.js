import { crmQuery, crmRecords, getSession, json } from "../auth/_common.js";

const DAY_MS = 24 * 60 * 60 * 1000;

function escapeSoql(value) {
  return String(value || "").replaceAll("'", "\\'");
}

function beijingDateRange(dateText) {
  const [year, month, day] = String(dateText).split("-").map(Number);
  const start = Date.UTC(year, month - 1, day) - 8 * 60 * 60 * 1000;
  return { start, end: start + DAY_MS - 1 };
}

function amount(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function classifyPerformance(record) {
  const text = String(record.NewOrOldSP__c || record.new_or_addon__c || record.newType__c || "");
  if (text.includes("老客")) return "renewal";
  if (text.includes("新客") || text.includes("增购")) return "new";
  return "other";
}

async function resolveOwnerId(session, ownerName) {
  if (!ownerName || ownerName === session.user?.name) return session.user?.id;
  const result = await crmQuery(
    session,
    `SELECT id,name FROM user WHERE name = '${escapeSoql(ownerName)}' LIMIT 5`
  );
  return crmRecords(result).find((item) => item.name === ownerName)?.id || session.user?.id;
}

async function queryPerformance(session, ownerId, dateField, start, end) {
  const fields = "id,ownerId,amount_Collected__c,Amount__c,NewOrOldSP__c,new_or_addon__c,newType__c,product_famliy__c,dkrq__c,GetDate__c,Account__c";
  const soql = [
    `SELECT ${fields} FROM SalesPerformance__c`,
    `WHERE ownerId = ${ownerId}`,
    `AND AccountGet__c = 0`,
    `AND (${dateField} >= ${start} AND ${dateField} <= ${end})`,
    `ORDER BY ${dateField} DESC LIMIT 200`
  ].join(" ");
  const result = await crmQuery(session, soql);
  return crmRecords(result);
}

export async function onRequestGet({ request, env }) {
  const session = await getSession(request, env);
  if (!session) return json({ error: "Not logged in" }, { status: 401 });

  const url = new URL(request.url);
  const date = url.searchParams.get("date") || new Date().toISOString().slice(0, 10);
  const ownerName = url.searchParams.get("owner") || session.user?.name || "";
  const ownerId = await resolveOwnerId(session, ownerName);
  if (!ownerId) return json({ error: "Cannot resolve CRM owner" }, { status: 400 });

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
      const value = amount(record.amount_Collected__c ?? record.Amount__c);
      const group = classifyPerformance(record);
      if (group === "new") acc.newSales += value;
      if (group === "renewal") acc.renewalSales += value;
      acc.total += value;
      return acc;
    },
    { newSales: 0, renewalSales: 0, total: 0 }
  );

  return json({
    ownerName,
    ownerId: String(ownerId),
    date,
    dateField,
    ...summary,
    records: records.map((record) => ({
      id: String(record.id || ""),
      amount: amount(record.amount_Collected__c ?? record.Amount__c),
      type: record.NewOrOldSP__c || record.new_or_addon__c || record.newType__c || "",
      product: record.product_famliy__c || "",
      date: record[dateField] || ""
    }))
  });
}
