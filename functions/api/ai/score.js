import { getSession, json } from "../auth/_common.js";

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
  const workload = Math.min(
    25,
    number(report.touches) * 2 +
      number(report.selfProspects) * 3 +
      number(report.softwareTouches) * 2 +
      number(report.posts) * 2
  );
  const opportunity = Math.min(
    25,
    opportunityUpdates.filter((item) => item.todayProgress || item.nextPlan).length * 8 +
      lineCount(report.opportunityText) * 5 +
      opportunities.filter((item) => item.owner === report.owner).length * 2
  );
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
    advice: issues.length
      ? `建议优先补齐：${issues.slice(0, 2).join("、")}。`
      : "建议保持当前节奏，并把高金额商机拆成明确下一步和截止时间。",
    evidence: {
      touches: number(report.touches),
      newSales: number(report.newSales),
      renewalSales: number(report.renewalSales),
      opportunityUpdates: opportunityUpdates.length,
      visitRecords: visitRecords.filter((item) => item.owner === report.owner).length
    },
    source: "local-rule"
  };
}

async function remoteScore(env, payload) {
  if (!env.AI_SCORE_ENDPOINT) return null;
  const response = await fetch(env.AI_SCORE_ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(env.AI_SCORE_API_KEY ? { authorization: `Bearer ${env.AI_SCORE_API_KEY}` } : {})
    },
    body: JSON.stringify(payload)
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = result?.error || result?.message || "AI score service failed";
    throw new Error(message);
  }
  return { ...result, source: result.source || "remote-ai" };
}

export async function onRequestPost({ request, env }) {
  const session = await getSession(request, env);
  if (!session) return json({ error: "Not logged in" }, { status: 401 });

  const payload = await request.json().catch(() => ({}));
  if (!payload.report) return json({ error: "Missing report" }, { status: 400 });

  try {
    const remote = await remoteScore(env, payload);
    return json(remote || localScore(payload.report, payload.context || {}));
  } catch (error) {
    return json({ ...localScore(payload.report, payload.context || {}), source: "local-rule-fallback", remoteError: error.message });
  }
}
