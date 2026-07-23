const STORAGE_KEY = "sales-supervisor-mvp";
const SHARED_STATE_API = "/api/state";
const AUTH_API = "/api/auth";
const CRM_PERFORMANCE_API = "/api/crm/performance";
const CRM_ACCOUNTS_API = "/api/crm/accounts";
const CRM_VISITS_API = "/api/crm/visits";
const CRM_TEAM_API = "/api/crm/team";
const CRM_ACTIONS_API = "/api/crm/actions";
const AI_SCORE_API = "/api/ai/score";
const USE_SHARED_STATE = location.hostname.endsWith("pages.dev") || (!["", "localhost", "127.0.0.1"].includes(location.hostname) && location.protocol.startsWith("http"));
const TODAY = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const STAGES = ["初步沟通", "方案确认", "参访体验", "合同推进", "付款中", "已成交", "已丢单"];
const WEEKDAY_KEYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
let sharedStateStatus = USE_SHARED_STATE ? { mode: "connecting", savedAt: "" } : { mode: "local", savedAt: "" };
let sharedSaveTimer = null;
let authState = { loggedIn: false, loading: USE_SHARED_STATE, user: null, role: "visitor" };
let authPollTimer = null;
let performanceStatus = { loading: false, source: "", message: "" };
let teamState = { loading: false, syncedAt: "", source: "", department: null, members: [] };
let ownerManuallyChanged = false;
let accountCacheStatus = { count: 0, syncedAt: "", message: "" };
let crmAccountCache = new Map();
let opportunityDraftRows = createOpportunityDraftRows(3);

const seedState = {
  users: ["梁霄淇", "冷哲", "晁小慧", "夏俊莉"],
  checklist: [
    { id: 1, module: "线上市场", task: "小红书内容发布", time: "09:00-10:00", priority: "高", days: ["周一", "周二", "周三", "周四", "周五", "周六", "周日"] },
    { id: 2, module: "线上市场", task: "各平台评论私信回复", time: "09:00-10:00", priority: "高", days: ["周一", "周二", "周三", "周四", "周五", "周六"] },
    { id: 3, module: "线上市场", task: "主动互动≥10条（同行+目标客户）", time: "09:30-10:30", priority: "高", days: ["周一", "周二", "周三", "周四", "周五"] },
    { id: 4, module: "线上市场", task: "内容数据记录（阅读/点赞/收藏/评论/私信）", time: "17:00-17:30", priority: "中", days: ["周一", "周二", "周三", "周四", "周五", "周六"] },
    { id: 5, module: "线上市场", task: "高意向线索标记→CRM", time: "10:00-10:30", priority: "高", days: ["周一", "周二", "周三", "周四", "周五"] },
    { id: 6, module: "商机跟进", task: "A级商机当日跟进", time: "10:30-12:00", priority: "高", days: ["周一", "周二", "周三", "周四", "周五", "周六"] },
    { id: 7, module: "商机跟进", task: "B级商机跟进（每2-3天）", time: "10:30-12:00", priority: "高", days: ["周一", "周三", "周五"] },
    { id: 8, module: "商机跟进", task: "C/D级商机激活", time: "16:00-17:00", priority: "中", days: ["周一", "周四"] },
    { id: 9, module: "商机跟进", task: "CRM商机状态更新", time: "17:00-17:30", priority: "高", days: ["周一", "周二", "周三", "周四", "周五", "周六"] },
    { id: 10, module: "方案梳理", task: "方案输出/修改", time: "10:30-12:00", priority: "高", days: ["周一", "周二", "周三", "周四", "周五"] },
    { id: 11, module: "方案梳理", task: "方案质量自查（客户名/Logo/数据/排版）", time: "11:30-12:00", priority: "中", days: ["周一", "周二", "周三", "周四", "周五"] },
    { id: 12, module: "线下拜访", task: "拜访准备（客户研究+材料+目标+路线）", time: "提前1天", priority: "高", days: ["周一", "周二", "周三", "周四", "周五"] },
    { id: 13, module: "线下拜访", task: "客户拜访/线上演示", time: "13:30-17:00", priority: "高", days: ["周一", "周二", "周三", "周四", "周五"] },
    { id: 14, module: "线下拜访", task: "拜访记录填写（30分钟内）", time: "拜访后", priority: "高", days: ["周一", "周二", "周三", "周四", "周五"] },
    { id: 15, module: "线下拜访", task: "活动执行（如有）", time: "按排期", priority: "中", days: [] },
    { id: 16, module: "管理", task: "晨会：汇报昨日成果+今日计划", time: "08:30-09:00", priority: "高", days: ["周一", "周二", "周三", "周四", "周五", "周六"] },
    { id: 17, module: "管理", task: "夕会复盘", time: "18:00-18:30", priority: "高", days: ["周一", "周二", "周三", "周四", "周五", "周六"] },
    { id: 18, module: "管理", task: "日报提交", time: "18:00-18:30", priority: "高", days: ["周一", "周二", "周三", "周四", "周五", "周六"] },
    { id: 19, module: "管理", task: "明日计划&优先级排序", time: "17:30-18:00", priority: "高", days: ["周一", "周二", "周三", "周四", "周五", "周六"] }
  ],
  reports: [
    {
      id: "r1",
      date: "2026-07-08",
      owner: "梁霄淇",
      newSales: 34000,
      renewalSales: 6000,
      touches: 14,
      posts: 2,
      selfProspects: 3,
      softwareTouches: 5,
      onlinePlatform: "小红书",
      onlineViews: 1650,
      onlineMessages: 12,
      onlineLeads: 3,
      visits: "售后，瀚林，增购价值，预计增购2台\n售前，奕辰，全科，参访邀约",
      visitScore: 4,
      visitInsight: "客户增购意愿明确，下一步重点确认付款和合同版本。",
      opportunityText: "瀚林，合同已签署，开票待付款，预计本周回款\n奕辰，增购一体机+录课，本周完成付款",
      linkedOpportunity: "o1",
      stage: "合同推进",
      actionChecks: [1, 2, 3, 4, 5, 6, 9, 10, 12, 13, 14, 16, 17, 18, 19],
      extraWork: "协助客户安装对接，处理开票信息。",
      tomorrowPlan: "跟进瀚林付款；确认奕辰合同版本；推进景老师参访。"
    },
    {
      id: "r2",
      date: "2026-07-08",
      owner: "冷哲",
      newSales: 12000,
      renewalSales: 0,
      touches: 11,
      posts: 1,
      selfProspects: 4,
      softwareTouches: 3,
      onlinePlatform: "小红书",
      onlineViews: 980,
      onlineMessages: 9,
      onlineLeads: 2,
      visits: "售前，喵老师，英语体验，邀请线下体验\n售后，guest老师，激发邀约体验",
      visitScore: 4,
      visitInsight: "佛山客户有线下体验意向，需明确体验时间和预算。",
      opportunityText: "喵老师，佛山想要线下体验英语老师，约体验\n江老师，咨询65寸在珠海，线上邀约体验",
      linkedOpportunity: "o5",
      stage: "参访体验",
      actionChecks: [1, 2, 3, 4, 6, 7, 9, 10, 12, 13, 14, 16, 17, 18, 19],
      extraWork: "整理佛山客户名单，复盘本周邀约话术。",
      tomorrowPlan: "确认喵老师体验时间；跟进江老师预算；补充软件IP触达。"
    },
    {
      id: "r3",
      date: "2026-07-08",
      owner: "夏俊莉",
      newSales: 10000,
      renewalSales: 2000,
      touches: 7,
      posts: 1,
      selfProspects: 2,
      softwareTouches: 2,
      onlinePlatform: "小红书",
      onlineViews: 620,
      onlineMessages: 4,
      onlineLeads: 1,
      visits: "售前，Sherry，硬件需求，安排下周介绍",
      visitScore: 3,
      visitInsight: "客户需求初步明确，需要继续确认设备规格和预算。",
      opportunityText: "Sherry，常得我跟进，本周上班白天可约",
      linkedOpportunity: "o9",
      stage: "初步沟通",
      actionChecks: [1, 2, 4, 6, 9, 12, 13, 16, 17, 18, 19],
      extraWork: "整理转介绍名单。",
      tomorrowPlan: "确认Sherry设备规格和预算。"
    }
  ],
  onlineRecords: [
    { id: "on1", date: "2026-07-08", owner: "梁霄淇", platform: "小红书", posts: 2, views: 1650, likes: 60, saves: 31, comments: 8, messages: 12, leads: 3, source: "后台导入" },
    { id: "on2", date: "2026-07-08", owner: "冷哲", platform: "小红书", posts: 1, views: 980, likes: 38, saves: 18, comments: 5, messages: 9, leads: 2, source: "后台导入" },
    { id: "on3", date: "2026-07-08", owner: "夏俊莉", platform: "小红书", posts: 1, views: 620, likes: 22, saves: 10, comments: 2, messages: 4, leads: 1, source: "后台导入" }
  ],
  visitRecords: [
    { id: "v1", date: "2026-07-08", owner: "梁霄淇", customer: "瀚林", method: "线上", purpose: "增购沟通", points: "合同已签署，开票待付款，预计本周回款", pain: "需要尽快完成设备增购和安装对接", nextPlan: "跟进付款并确认安装排期", deadline: "2026-07-09", score: 4 },
    { id: "v2", date: "2026-07-08", owner: "冷哲", customer: "喵老师", method: "线下", purpose: "体验邀约", points: "佛山想要线下体验英语老师", pain: "需要确认体验老师和时间", nextPlan: "约线下体验并确认预算", deadline: "2026-07-09", score: 4 },
    { id: "v3", date: "2026-07-08", owner: "夏俊莉", customer: "Sherry", method: "线上", purpose: "需求沟通", points: "硬件需求初步明确", pain: "设备规格和预算待确认", nextPlan: "安排下周介绍", deadline: "2026-07-14", score: 3 }
  ],
  opportunities: [
    {
      id: "o1",
      owner: "梁霄淇",
      customer: "瀚林",
      source: "售后",
      need: "硬件",
      amount: 40000,
      stage: "合同推进",
      status: "open",
      progress: "合同已签署，开票待付款，预计本周回款",
      nextActionDate: "2026-07-09",
      updatedAt: "2026-07-08"
    },
    {
      id: "o2",
      owner: "梁霄淇",
      customer: "豌豆思维",
      source: "个人自拓",
      need: "软件",
      amount: 50000,
      stage: "付款中",
      status: "open",
      progress: "编程线上课，合同流程完成，等财务付款",
      nextActionDate: "2026-07-10",
      updatedAt: "2026-07-07"
    },
    {
      id: "o3",
      owner: "梁霄淇",
      customer: "奕辰",
      source: "个人自拓",
      need: "硬件",
      amount: 24000,
      stage: "合同推进",
      status: "open",
      progress: "增购一体机+录课，本周完成付款",
      nextActionDate: "2026-07-09",
      updatedAt: "2026-07-08"
    },
    {
      id: "o4",
      owner: "梁霄淇",
      customer: "景",
      source: "KOS",
      need: "硬件",
      amount: 19000,
      stage: "参访体验",
      status: "open",
      progress: "已参访，对比希沃中",
      nextActionDate: "2026-07-12",
      updatedAt: "2026-07-05"
    },
    {
      id: "o5",
      owner: "冷哲",
      customer: "喵老师",
      source: "自拓",
      need: "硬件",
      amount: 15999,
      stage: "参访体验",
      status: "open",
      progress: "佛山想要线下体验英语老师",
      nextActionDate: "2026-07-09",
      updatedAt: "2026-07-08"
    },
    {
      id: "o6",
      owner: "冷哲",
      customer: "guest老师",
      source: "自拓",
      need: "硬件",
      amount: 21000,
      stage: "初步沟通",
      status: "open",
      progress: "电话微信激发邀约体验",
      nextActionDate: "2026-07-11",
      updatedAt: "2026-07-08"
    },
    {
      id: "o7",
      owner: "冷哲",
      customer: "叶老师",
      source: "个人自拓",
      need: "软件",
      amount: 2000,
      stage: "方案确认",
      status: "open",
      progress: "订阅版方案沟通，待明确使用人数",
      nextActionDate: "2026-07-13",
      updatedAt: "2026-07-04"
    },
    {
      id: "o8",
      owner: "冷哲",
      customer: "江老师",
      source: "自拓",
      need: "硬件",
      amount: 15999,
      stage: "初步沟通",
      status: "open",
      progress: "咨询65寸在珠海，邀约体验",
      nextActionDate: "2026-07-10",
      updatedAt: "2026-07-08"
    },
    {
      id: "o9",
      owner: "夏俊莉",
      customer: "Sherry",
      source: "KOS",
      need: "硬件",
      amount: 15999,
      stage: "初步沟通",
      status: "open",
      progress: "下周邀约线上介绍，这周上班白天可约",
      nextActionDate: "2026-07-14",
      updatedAt: "2026-07-08"
    }
  ],
  supervisorReviews: [],
  aiScores: [],
  reportVersions: [],
  syncEvents: []
};

let state = loadState();

function loadState() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) return normalizeState(structuredClone(seedState));
  try {
    return normalizeState(JSON.parse(saved));
  } catch {
    return normalizeState(structuredClone(seedState));
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  persistSharedState();
}

async function hydrateSharedState() {
  if (!USE_SHARED_STATE) return;
  try {
    const response = await fetch(SHARED_STATE_API, { cache: "no-store" });
    if (!response.ok) throw new Error("shared state unavailable");
    const payload = await response.json();
    sharedStateStatus = { mode: "shared", savedAt: payload.savedAt || "" };
    if (isImportableState(payload.data)) {
      state = normalizeState(payload.data);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      render();
      return;
    }
    persistSharedState();
    renderStorageStatus();
  } catch {
    sharedStateStatus = { mode: "fallback", savedAt: "" };
    renderStorageStatus();
  }
}

function persistSharedState() {
  if (!USE_SHARED_STATE) return;
  window.clearTimeout(sharedSaveTimer);
  sharedSaveTimer = window.setTimeout(async () => {
    try {
      const savedAt = new Date().toISOString();
      const response = await fetch(SHARED_STATE_API, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ savedAt, data: state })
      });
      if (!response.ok) throw new Error("shared state save failed");
      sharedStateStatus = { mode: "shared", savedAt };
    } catch {
      sharedStateStatus = { mode: "fallback", savedAt: "" };
    }
    renderStorageStatus();
  }, 450);
}

function normalizeState(nextState) {
  nextState.users ||= structuredClone(seedState.users);
  nextState.checklist ||= structuredClone(seedState.checklist);
  nextState.reports ||= [];
  nextState.onlineRecords ||= inferOnlineRecords(nextState.reports);
  nextState.visitRecords ||= inferVisitRecords(nextState.reports);
  nextState.opportunities ||= [];
  nextState.supervisorReviews ||= [];
  nextState.aiScores ||= [];
  nextState.reportVersions ||= [];
  nextState.syncEvents ||= [];
  nextState.reports = nextState.reports.map((report) => ({
    ...report,
    onlinePlatform: report.onlinePlatform || "小红书",
    onlineViews: number(report.onlineViews) || number(report.posts) * 800,
    onlineMessages: number(report.onlineMessages) || number(report.softwareTouches) + number(report.selfProspects),
    onlineLeads: number(report.onlineLeads) || Math.min(3, number(report.selfProspects) || 0),
    visitScore: number(report.visitScore) || (lineCount(report.visits) ? 3 : 0),
    visitInsight: report.visitInsight || "",
    actionChecks: report.actionChecks || inferActionChecks(report, nextState.checklist)
  }));
  nextState.onlineRecords = nextState.onlineRecords.map((item) => ({
    ...item,
    posts: number(item.posts),
    views: number(item.views),
    likes: number(item.likes),
    saves: number(item.saves),
    comments: number(item.comments),
    messages: number(item.messages),
    leads: number(item.leads),
    source: item.source || "手工录入"
  }));
  nextState.visitRecords = nextState.visitRecords.map((item) => ({
    ...item,
    accountId: item.accountId || "",
    crmSyncStatus: item.crmSyncStatus || (item.crmRecordId ? "synced" : "local"),
    crmRecordId: item.crmRecordId || "",
    crmSyncError: item.crmSyncError || "",
    score: number(item.score),
    date: item.date || TODAY,
    deadline: item.deadline || ""
  }));
  nextState.opportunities = nextState.opportunities.map((item) => ({
    ...item,
    accountId: item.accountId || "",
    crmSyncStatus: item.crmSyncStatus || (item.crmRecordId ? "synced" : item.accountId ? "pending" : "local"),
    crmRecordId: item.crmRecordId || "",
    crmSyncError: item.crmSyncError || "",
    amount: number(item.amount),
    stage: item.stage || "初步沟通",
    grade: item.grade || inferOpportunityGrade(item),
    score: number(item.score) || inferOpportunityScore(item),
    status: item.status || (["已成交", "已丢单"].includes(item.stage) ? "closed" : "open"),
    progress: item.progress || "",
    nextActionDate: item.nextActionDate || "",
    estimatedCloseDate: item.estimatedCloseDate || "",
    updatedAt: item.updatedAt || TODAY
  }));
  nextState.supervisorReviews = nextState.supervisorReviews.map((item) => ({
    ...item,
    date: item.date || TODAY,
    owner: item.owner || "",
    comment: item.comment || "",
    createdAt: item.createdAt || new Date().toISOString(),
    createdBy: item.createdBy || "主管"
  }));
  nextState.aiScores = nextState.aiScores.map((item) => ({
    ...item,
    date: item.date || TODAY,
    owner: item.owner || "",
    score: number(item.score),
    source: item.source || "local-rule"
  }));
  nextState.reportVersions = nextState.reportVersions.map((item) => ({
    ...item,
    date: item.date || TODAY,
    owner: item.owner || "",
    savedAt: item.savedAt || item.createdAt || new Date().toISOString(),
    changedFields: item.changedFields || []
  }));
  nextState.reports = nextState.reports.map((report) => ({
    ...report,
    opportunityUpdates: (report.opportunityUpdates || []).map((item) => ({
      ...item,
      crmSyncStatus: item.crmSyncStatus || "pending",
      crmRecordId: item.crmRecordId || "",
      crmSyncError: item.crmSyncError || ""
    }))
  }));
  return nextState;
}

function inferOnlineRecords(reports) {
  return (reports || [])
    .filter((report) => number(report.onlineViews) || number(report.onlineLeads) || number(report.posts))
    .map((report) => ({
      id: `on-${report.id}`,
      date: report.date || TODAY,
      owner: report.owner,
      platform: report.onlinePlatform || "小红书",
      posts: number(report.posts),
      views: number(report.onlineViews) || number(report.posts) * 800,
      likes: Math.round((number(report.onlineViews) || 0) * 0.04),
      saves: Math.round((number(report.onlineViews) || 0) * 0.02),
      comments: Math.max(0, number(report.onlineMessages) - number(report.softwareTouches)),
      messages: number(report.onlineMessages),
      leads: number(report.onlineLeads) || Math.min(3, number(report.selfProspects) || 0),
      source: "历史日报推断"
    }));
}

function inferVisitRecords(reports) {
  const records = [];
  (reports || []).forEach((report) => {
    String(report.visits || "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .forEach((line, index) => {
        const parts = line.split(/[，,]/).map((item) => item.trim());
        records.push({
          id: `v-${report.id}-${index}`,
          date: report.date || TODAY,
          owner: report.owner,
          customer: parts[1] || "未命名客户",
          method: parts[0] || "线上",
          purpose: parts[2] || "客户沟通",
          points: line,
          pain: report.visitInsight || "",
          nextPlan: parts[3] || report.tomorrowPlan || "",
          deadline: report.date || TODAY,
          score: Math.min(5, 2 + Math.max(1, parts.length - 2))
        });
      });
  });
  return records;
}

function inferActionChecks(report, checklist = state?.checklist || seedState.checklist) {
  const required = requiredActionsForDate(checklist);
  const base = required
    .filter((item) => ["管理"].includes(item.module))
    .map((item) => item.id);
  if (number(report.posts) > 0) base.push(1, 4);
  if (number(report.touches) > 0) base.push(2, 3, 5);
  if (lineCount(report.opportunityText) > 0 || report.linkedOpportunity) base.push(6, 9);
  if (lineCount(report.visits) > 0) base.push(12, 13, 14);
  return [...new Set(base)];
}

function inferOpportunityGrade(opportunity) {
  if (number(opportunity.amount) >= 30000 || ["合同推进", "付款中"].includes(opportunity.stage)) return "A";
  if (number(opportunity.amount) >= 15000 || opportunity.stage === "参访体验") return "B";
  return "C";
}

function inferOpportunityScore(opportunity) {
  const gradeBase = { A: 86, B: 72, C: 56, D: 38 };
  return gradeBase[inferOpportunityGrade(opportunity)] || 50;
}

function number(value) {
  const parsed = Number(String(value || "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function uid(prefix) {
  return `${prefix}${Date.now()}${Math.floor(Math.random() * 1000)}`;
}

function lineCount(text) {
  return String(text || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean).length;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function dayDiff(date) {
  const today = new Date(`${TODAY}T00:00:00`);
  const target = new Date(`${date}T00:00:00`);
  return Math.floor((today - target) / 86400000);
}

function isManagerRole() {
  return authState.role === "manager";
}

function shouldScopeToCurrentUser() {
  return USE_SHARED_STATE && authState.loggedIn && !isManagerRole();
}

function visibleOwners() {
  const owner = currentCrmOwnerName();
  if (shouldScopeToCurrentUser()) return owner ? [owner] : [];
  const crmOwners = (teamState.members || []).map((item) => item.name).filter(Boolean);
  if (crmOwners.length) return Array.from(new Set(crmOwners));
  return state.users;
}

function canSeeOwner(owner) {
  return !shouldScopeToCurrentUser() || owner === currentCrmOwnerName();
}

function reportsToday() {
  return state.reports.filter((report) => report.date === TODAY && canSeeOwner(report.owner));
}

function requiredActionsForToday() {
  return requiredActionsForDate(state.checklist);
}

function requiredActionsForDate(checklist) {
  const day = WEEKDAY_KEYS[new Date(`${TODAY}T00:00:00`).getDay()];
  return checklist.filter((item) => item.days.includes(day));
}

function actionCompletion(report) {
  const required = requiredActionsForToday();
  const completed = new Set(report?.actionChecks || []);
  const done = required.filter((item) => completed.has(item.id)).length;
  return { done, total: required.length, rate: required.length ? Math.round((done / required.length) * 100) : 0 };
}

function moduleStats() {
  const reports = reportsToday();
  const onlineRecords = onlineRecordsToday();
  const visitRecords = visitRecordsToday();
  const openOpps = openOpportunities();
  const totalAmount = openOpps.reduce((sum, item) => sum + number(item.amount), 0);
  const gradeA = openOpps.filter((item) => item.grade === "A").length;
  const onlineLeads = onlineRecords.reduce((sum, item) => sum + number(item.leads), 0);
  const avgVisit = visitRecords.length ? Math.round((visitRecords.reduce((sum, item) => sum + number(item.score), 0) / visitRecords.length) * 10) / 10 : 0;
  return [
    { module: "商机分级", done: gradeA, total: openOpps.length || 1, rate: openOpps.length ? Math.round((gradeA / openOpps.length) * 100) : 0 },
    { module: "线上运营", done: onlineLeads, total: Math.max(reports.length * 3, 1), rate: Math.min(100, Math.round((onlineLeads / Math.max(reports.length * 3, 1)) * 100)) },
    { module: "销售漏斗", done: Math.round(totalAmount / 10000), total: 40, rate: Math.min(100, Math.round((totalAmount / 400000) * 100)) },
    { module: "客户拜访", done: avgVisit, total: 5, rate: Math.round((avgVisit / 5) * 100) }
  ];
}

function onlineRecordsToday() {
  return state.onlineRecords.filter((item) => item.date === TODAY && canSeeOwner(item.owner));
}

function visitRecordsToday() {
  return state.visitRecords.filter((item) => item.date === TODAY && canSeeOwner(item.owner));
}

function isClosedOpportunity(opportunity) {
  return opportunity.status === "closed" || ["已成交", "已丢单"].includes(opportunity.stage);
}

function openOpportunities() {
  return state.opportunities.filter((item) => !isClosedOpportunity(item) && canSeeOwner(item.owner));
}

function weekEndDate() {
  const date = new Date(`${TODAY}T00:00:00`);
  const day = date.getDay() || 7;
  date.setDate(date.getDate() + (7 - day));
  return date.toISOString().slice(0, 10);
}

function weeklyFollowupOpportunities(owner) {
  const end = weekEndDate();
  return openOpportunities()
    .filter((item) => item.owner === owner)
    .filter((item) => !item.nextActionDate || item.nextActionDate <= end || dayDiff(item.updatedAt) >= 2)
    .sort((a, b) => String(a.nextActionDate || "9999-12-31").localeCompare(String(b.nextActionDate || "9999-12-31")));
}

function reportMoveCount(report) {
  return (report.opportunityUpdates || []).filter((item) => item.todayProgress || item.nextPlan).length + lineCount(report.opportunityText);
}

function scoreReport(report) {
  const completenessFields = [
    report.owner,
    report.newSales || report.renewalSales,
    report.touches,
    (report.opportunityUpdates || []).length,
    report.tomorrowPlan
  ];
  const completeness = Math.round(
    (completenessFields.filter(Boolean).length / completenessFields.length) * 20
  );
  const workload = Math.min(20, number(report.touches) + number(report.posts) * 2 + number(report.selfProspects) * 2);
  const updates = (report.opportunityUpdates || []).filter((item) => item.todayProgress || item.nextPlan);
  const opportunityQuality = Math.min(30, reportMoveCount(report) * 7 + (updates.length ? 8 : 0) + (updates.some((item) => item.stage) ? 5 : 0));
  const planQuality = Math.min(15, lineCount(report.tomorrowPlan) * 5 + (String(report.tomorrowPlan || "").length > 20 ? 5 : 0));
  const review = Math.min(15, lineCount(report.extraWork) * 4 + 6);
  return Math.min(100, completeness + workload + opportunityQuality + planQuality + review);
}

function workloadScoreFromStats(stats) {
  return Math.min(
    100,
    number(stats.touches) * 4 +
      number(stats.onlineLeads) * 8 +
      number(stats.opportunityMoves) * 12 +
      number(stats.visitCount) * 14 +
      (stats.report ? 10 : 0)
  );
}

function opportunityReserveScore(owner) {
  const opportunities = openOpportunities().filter((item) => item.owner === owner);
  const amount = opportunities.reduce((sum, item) => sum + number(item.amount), 0);
  const gradeA = opportunities.filter((item) => item.grade === "A").length;
  const stale = opportunities.filter((item) => riskReason(item)).length;
  const base = Math.min(35, opportunities.length * 7) + Math.min(35, Math.round(amount / 10000) * 4) + Math.min(20, gradeA * 10);
  return Math.max(0, Math.min(100, base - stale * 10));
}

function ownerStats(owner) {
  const ownerReports = reportsToday().filter((report) => report.owner === owner);
  const report = ownerReports[ownerReports.length - 1];
  const opportunities = openOpportunities().filter((item) => item.owner === owner);
  const ownerVisits = visitRecordsToday().filter((item) => item.owner === owner);
  const score = report ? scoreReport(report) : 0;
  const result = {
    owner,
    report,
    score,
    onlineLeads: onlineRecordsToday().filter((item) => item.owner === owner).reduce((sum, item) => sum + number(item.leads), 0),
    visitScore: ownerVisits.length ? Math.round((ownerVisits.reduce((sum, item) => sum + number(item.score), 0) / ownerVisits.length) * 10) / 10 : 0,
    visitCount: ownerVisits.length,
    newSales: report ? number(report.newSales) : 0,
    renewalSales: report ? number(report.renewalSales) : 0,
    touches: report ? number(report.touches) : 0,
    opportunityMoves: report ? reportMoveCount(report) : 0,
    amount: opportunities.reduce((sum, item) => sum + number(item.amount), 0)
  };
  result.workloadScore = workloadScoreFromStats(result);
  result.reserveScore = opportunityReserveScore(owner);
  return result;
}

function riskReason(opportunity) {
  if (isClosedOpportunity(opportunity)) return "";
  const stale = dayDiff(opportunity.updatedAt) >= 3;
  const vague = !opportunity.nextActionDate || String(opportunity.progress || "").length < 12;
  const highValueEarly = number(opportunity.amount) >= 20000 && ["初步沟通", "方案确认"].includes(opportunity.stage);
  if (stale) return "连续3天以上未更新";
  if (vague) return "下一步计划不清晰";
  if (highValueEarly) return "高金额商机仍处早期阶段";
  return "";
}

function render() {
  renderAuth();
  renderOptions();
  renderPerformanceStatus();
  renderDailyOpportunities();
  renderDailyVisits();
  renderDashboard();
  renderOnline();
  renderVisits();
  renderOpportunities();
  renderAi();
  renderManagerFocus();
  renderSync();
  renderSyncRetryList();
  renderReportHistory();
  renderSupervisorReviews();
  renderSyncLog();
  renderReadiness();
  renderStorageStatus();
}

function addSyncEvent(event) {
  state.syncEvents.push({
    id: uid("s"),
    at: new Date().toISOString(),
    owner: event.owner || currentCrmOwnerName() || "",
    status: event.status || "system",
    title: event.title || "系统记录",
    detail: event.detail || "",
    success: event.success ?? "",
    failed: event.failed ?? ""
  });
  state.syncEvents = state.syncEvents.slice(-500);
}

function currentCrmOwnerName() {
  return authState.loggedIn ? authState.user?.name || "" : "";
}

function ensureKnownUser(name) {
  if (name && !state.users.includes(name)) {
    state.users = [...state.users, name];
  }
}

function renderAuth() {
  const target = document.querySelector("#authWidget");
  if (!target) return;
  if (!USE_SHARED_STATE) {
    target.innerHTML = `
      <div class="auth-card">
        <span>本地预览</span>
        <button class="ghost-button" type="button" data-auth-action="local">CRM登录</button>
      </div>
    `;
    return;
  }
  if (authState.loading) {
    target.innerHTML = `<div class="auth-card"><span>正在检查CRM身份</span></div>`;
    return;
  }
  if (!authState.loggedIn) {
    target.innerHTML = `
      <div class="auth-card">
        <span>未登录CRM</span>
        <button class="ghost-button" type="button" data-auth-action="login">CRM登录</button>
      </div>
    `;
    return;
  }
  const user = authState.user || {};
  const roleLabel = authState.role === "manager" ? "主管" : "顾问";
  const departmentLabel = teamState.department?.id ? ` · ${teamState.department.name || teamState.department.id}` : "";
  target.innerHTML = `
    <div class="auth-card signed-in">
      <span>${escapeHtml(user.name || "CRM用户")} · ${roleLabel}${escapeHtml(departmentLabel)}</span>
      <button class="ghost-button" type="button" data-auth-action="logout">退出</button>
    </div>
  `;
}

async function hydrateCrmTeam(force = false) {
  if (!USE_SHARED_STATE || !authState.loggedIn) {
    teamState = { loading: false, syncedAt: "", source: "", department: null, members: [] };
    return;
  }
  teamState = { ...teamState, loading: true };
  try {
    const response = await fetch(CRM_TEAM_API, { method: force ? "POST" : "GET", cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "CRM团队读取失败");
    teamState = {
      loading: false,
      syncedAt: payload.syncedAt || "",
      source: payload.source || "",
      department: payload.department || null,
      members: payload.members || []
    };
    (teamState.members || []).forEach((member) => ensureKnownUser(member.name));
  } catch {
    teamState = { loading: false, syncedAt: "", source: "fallback", department: null, members: [] };
    ensureKnownUser(currentCrmOwnerName());
  }
}

async function hydrateAuth() {
  if (!USE_SHARED_STATE) {
    authState = { loggedIn: false, loading: false, user: null, role: "visitor" };
    renderAuth();
    return;
  }
  try {
    const response = await fetch(`${AUTH_API}/me`, { cache: "no-store" });
    const payload = await response.json();
    authState = { loading: false, ...payload };
  } catch {
    authState = { loggedIn: false, loading: false, user: null, role: "visitor" };
  }
  if (authState.loggedIn) {
    await hydrateCrmTeam();
    await hydrateSharedState();
  }
  render();
  hydrateCrmPerformance();
}

async function startCrmLogin() {
  if (!USE_SHARED_STATE) {
    alert("CRM网页登录需要使用线上地址测试，本地预览没有 Cloudflare Functions。");
    return;
  }
  try {
    authState = { ...authState, loading: true };
    renderAuth();
    const response = await fetch(`${AUTH_API}/start`, { method: "POST" });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "CRM登录启动失败");
    window.open(payload.authorizeUrl, "_blank", "noopener,noreferrer");
    await pollCrmLogin(payload.loginId);
  } catch (error) {
    authState = { loggedIn: false, loading: false, user: null, role: "visitor" };
    renderAuth();
    alert(error.message || "CRM登录启动失败");
  }
}

function pollCrmLogin(loginId, tries = 0) {
  window.clearTimeout(authPollTimer);
  return new Promise((resolve) => {
    const tick = async () => {
      try {
        const response = await fetch(`${AUTH_API}/poll?loginId=${encodeURIComponent(loginId)}`, { cache: "no-store" });
        const payload = await response.json();
        if (payload.status === "authenticated") {
          await hydrateAuth();
          resolve();
          return;
        }
        if (payload.status === "failed") {
          authState = { loggedIn: false, loading: false, user: null, role: "visitor" };
          renderAuth();
          alert(payload.error || "CRM授权失败");
          resolve();
          return;
        }
      } catch {
        // Continue polling; the user may still be finishing CRM authorization.
      }
      if (tries >= 150) {
        authState = { loggedIn: false, loading: false, user: null, role: "visitor" };
        renderAuth();
        alert("CRM授权超时，请重新点击登录。");
        resolve();
        return;
      }
      authPollTimer = window.setTimeout(() => {
        tries += 1;
        tick();
      }, 2000);
    };
    tick();
  });
}

async function logoutCrm() {
  if (!USE_SHARED_STATE) return;
  await fetch(`${AUTH_API}/logout`, { method: "POST" });
  authState = { loggedIn: false, loading: false, user: null, role: "visitor" };
  render();
}

function renderOptions() {
  ensureKnownUser(currentCrmOwnerName());
  const owners = visibleOwners();
  const ownerOptions = owners.map((user) => `<option>${user}</option>`).join("");
  document.querySelectorAll('select[name="owner"]').forEach((select) => {
    const current = select.value;
    select.innerHTML = `<option value="">请选择</option>${ownerOptions}`;
    const crmOwner = currentCrmOwnerName();
    select.value = (!ownerManuallyChanged && owners.includes(crmOwner) ? crmOwner : "") || (owners.includes(current) ? current : "") || owners[0] || "";
    select.classList.toggle("locked-select", shouldScopeToCurrentUser());
  });

  document.querySelectorAll('input[name="date"]').forEach((dateInput) => {
    if (!dateInput.value) dateInput.value = TODAY;
  });
}

function renderPerformanceStatus() {
  const target = document.querySelector("#performanceStatus");
  if (!target) return;
  target.className = `inline-status ${performanceStatus.source || ""}`;
  target.textContent = performanceStatus.message || "登录 CRM 后，系统会按提交人和日期自动带出新签/老客业绩。";
}

async function hydrateCrmPerformance() {
  if (!USE_SHARED_STATE || !authState.loggedIn) {
    performanceStatus = { loading: false, source: "", message: "登录 CRM 后，系统会按提交人和日期自动带出新签/老客业绩。" };
    renderPerformanceStatus();
    return;
  }
  const form = document.querySelector("#dailyForm");
  const owner = form?.elements.owner?.value || currentCrmOwnerName();
  const date = form?.elements.date?.value || TODAY;
  if (!owner || !date) return;

  performanceStatus = { loading: true, source: "loading", message: "正在从 CRM 销售绩效取数..." };
  renderPerformanceStatus();
  try {
    const url = new URL(CRM_PERFORMANCE_API, location.origin);
    url.searchParams.set("owner", owner);
    url.searchParams.set("date", date);
    const response = await fetch(url, { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "CRM业绩取数失败");
    form.elements.newSales.value = Math.round(number(payload.newSales));
    form.elements.renewalSales.value = Math.round(number(payload.renewalSales));
    performanceStatus = {
      loading: false,
      source: "success",
      message: `已从 CRM 销售绩效带出：新签 ${Math.round(number(payload.newSales)).toLocaleString("zh-CN")}，老客 ${Math.round(number(payload.renewalSales)).toLocaleString("zh-CN")}；口径：新客+增购=新签，老客=老客。`
    };
  } catch (error) {
    performanceStatus = {
      loading: false,
      source: "error",
      message: `CRM业绩暂未带出：${error.message || "请稍后重试"}`
    };
  }
  renderPerformanceStatus();
}

function renderDailyOpportunities() {
  const owner = document.querySelector('#dailyForm select[name="owner"]')?.value || visibleOwners()[0] || state.users[0];
  const opportunities = weeklyFollowupOpportunities(owner);
  const tbody = document.querySelector("#dailyOpportunityTable");
  document.querySelector("#dailyOpportunityCount").textContent = `${opportunities.length}条`;
  tbody.innerHTML =
    opportunities
      .map(
        (item) => `
          <tr data-opportunity-id="${item.id}">
            <td class="opportunity-name">
              <strong>${escapeHtml(item.customer)}</strong>
              <span>${escapeHtml(item.source || "未填来源")}</span>
            </td>
            <td>${number(item.amount).toLocaleString("zh-CN")}</td>
            ${dailySheetCell(item.stage, "stage", "select", item.stage)}
            ${dailySheetCell("点击填写", "todayProgress", "textarea", "")}
            ${dailySheetCell("点击填写", "nextPlan", "textarea", "")}
            ${dailySheetCell(formatDateForDisplay(item.nextActionDate), "nextActionDate", "date", item.nextActionDate)}
            ${dailySheetCell("未关单", "closeResult", "select", "")}
          </tr>
        `
      )
      .join("") || `<tr><td class="empty-row" colspan="7">该提交人本周暂无待跟进商机</td></tr>`;
}

function dailySheetCell(label, field, type, value) {
  return `
    <td class="sheet-cell" tabindex="0" data-daily-field="${field}" data-editor-type="${type}" data-value="${escapeHtml(value || "")}">
      <span>${escapeHtml(label || "-")}</span>
    </td>
  `;
}

function renderDailyVisits(count = 3) {
  const tbody = document.querySelector("#dailyVisitTable");
  tbody.innerHTML = Array.from({ length: count }, (_, index) => dailyVisitRow(index)).join("");
}

function dailyVisitRow(index) {
  return `
    <tr data-daily-visit-row="${index}">
      ${dailyVisitCell("客户名称", "customer", "account", "")}
      ${dailyVisitCell("线上", "method", "select", "线上")}
      ${dailyVisitCell("拜访目的", "purpose", "text", "")}
      ${dailyVisitCell("沟通要点", "points", "textarea", "")}
      ${dailyVisitCell("客户痛点", "pain", "textarea", "")}
      ${dailyVisitCell("下一步计划", "nextPlan", "textarea", "")}
      ${dailyVisitCell(formatDateForDisplay(TODAY), "deadline", "date", TODAY)}
      ${dailyVisitCell("3", "score", "number", "3")}
    </tr>
  `;
}

function dailyVisitCell(label, field, type, value) {
  return `
    <td class="sheet-cell" tabindex="0" data-daily-visit-field="${field}" data-editor-type="${type}" data-value="${escapeHtml(value || "")}" data-account-id="">
      <span>${escapeHtml(label || "-")}</span>
    </td>
  `;
}

function ensureDailyVisitRows() {
  const rows = Array.from(document.querySelectorAll("#dailyVisitTable tr[data-daily-visit-row]"));
  const last = rows[rows.length - 1];
  if (!last || !isDailyVisitRowFilled(last)) return;
  last.insertAdjacentHTML("afterend", dailyVisitRow(rows.length));
}

function isDailyVisitRowFilled(row) {
  return Array.from(row.querySelectorAll("[data-daily-visit-field]")).some((field) => {
    const value = String(field.dataset.value || "").trim();
    return value && !["线上", "3", TODAY].includes(value);
  });
}

function renderDashboard() {
  const todaysReports = reportsToday();
  const owners = visibleOwners();
  const ownerCount = Math.max(owners.length, 1);
  const submitRate = Math.round((todaysReports.length / ownerCount) * 100);
  const stats = owners.map(ownerStats).sort((a, b) => b.score - a.score);
  const openOpps = openOpportunities();
  const onlineRecords = onlineRecordsToday();
  const gradeA = openOpps.filter((item) => item.grade === "A").length;
  const onlineLeads = onlineRecords.reduce((sum, item) => sum + number(item.leads), 0);
  const funnelAmount = openOpps.reduce((sum, item) => sum + number(item.amount), 0);
  const visitRecords = visitRecordsToday();
  const avgVisitScore = visitRecords.length ? Math.round((visitRecords.reduce((sum, item) => sum + number(item.score), 0) / visitRecords.length) * 10) / 10 : 0;
  const risks = openOpportunities().filter((item) => riskReason(item));
  const workloadSorted = [...stats].sort((a, b) => b.workloadScore - a.workloadScore);
  const reserveSorted = [...stats].sort((a, b) => b.reserveScore - a.reserveScore);
  const lowestReserve = [...stats].sort((a, b) => a.reserveScore - b.reserveScore)[0];
  const lowestWorkload = [...stats].sort((a, b) => a.workloadScore - b.workloadScore)[0];
  const todayFollowups = owners.flatMap((owner) => weeklyFollowupOpportunities(owner).slice(0, 2));

  document.querySelector("#sidebarSubmitRate").textContent = `${submitRate}%`;
  document.querySelector("#metricGradeA").textContent = gradeA;
  document.querySelector("#metricReportsSub").textContent = `${todaysReports.length}/${ownerCount}人已提交`;
  document.querySelector("#metricOnlineLeads").textContent = onlineLeads;
  document.querySelector("#metricFunnelAmount").textContent = `${Math.round(funnelAmount / 10000)}万`;
  document.querySelector("#metricVisitScore").textContent = avgVisitScore || "0";
  document.querySelector("#morningBrief").textContent =
    todayFollowups.length
      ? `今天优先推进 ${todayFollowups.slice(0, 3).map((item) => `${item.owner}-${item.customer}`).join("、")}；${lowestReserve ? `${lowestReserve.owner} 商机储备偏弱，需要补新线索。` : ""}`
      : "当前没有明显到期商机，早会重点检查新增线索、客户触达和昨日未完成项。";
  document.querySelector("#eveningBrief").textContent =
    todaysReports.length
      ? `今日 ${todaysReports.length}/${ownerCount} 人已提交，${shouldScopeToCurrentUser() ? "个人" : "团队"}新签 ${totalTodaySales().toLocaleString("zh-CN")}；${risks.length ? `${risks.length} 条商机需要主管介入。` : "商机风险暂时可控。"}${lowestWorkload ? ` ${lowestWorkload.owner} 工作量饱和度最低，晚复盘需确认真实动作。` : ""}`
      : "当前还没有日报，晚复盘无法形成有效判断，建议先提醒顾问提交。";

  document.querySelector("#rankingList").innerHTML = stats
    .map(
      (item, index) => `
        <div class="rank-row">
          <div class="rank-no">${index + 1}</div>
          <div class="rank-main">
            <strong>${item.owner}</strong>
            <span>线上线索 ${item.onlineLeads} · 拜访评分 ${item.visitScore || 0} · 商机推进 ${item.opportunityMoves} · 商机池 ${item.amount.toLocaleString("zh-CN")}</span>
          </div>
          <div class="score-pill">${item.score}分</div>
        </div>
      `
    )
    .join("");

  document.querySelector("#moduleList").innerHTML = moduleStats()
    .map(
      (item) => `
        <div class="module-row">
          <div class="module-name">${escapeHtml(item.module)}</div>
          <div class="module-track"><div class="module-fill" style="width:${item.rate}%"></div></div>
          <div class="module-rate">${item.done}/${item.total}</div>
        </div>
      `
    )
    .join("");

  document.querySelector("#riskList").innerHTML =
    risks
      .map(
        (item) => `
          <div class="risk-item">
            <strong>${item.customer} · ${item.owner}</strong>
            <span>${riskReason(item)}。金额 ${number(item.amount).toLocaleString("zh-CN")}，当前阶段：${item.stage}。</span>
          </div>
        `
      )
      .join("") || `<div class="risk-item"><strong>暂无高风险商机</strong><span>今日商机推进节奏正常。</span></div>`;

  document.querySelector("#workloadList").innerHTML = workloadSorted
    .map((item) => diagnosisRow(item.owner, item.workloadScore, `触达 ${item.touches} · 拜访 ${item.visitCount} · 商机推进 ${item.opportunityMoves} · 线上线索 ${item.onlineLeads}`))
    .join("");

  document.querySelector("#opportunityScoreList").innerHTML = reserveSorted
    .map((item) => diagnosisRow(item.owner, item.reserveScore, `商机池 ${item.amount.toLocaleString("zh-CN")} · 推进 ${item.opportunityMoves} · 拜访评分 ${item.visitScore || 0}`))
    .join("");

  document.querySelector("#coachInsightList").innerHTML = stats
    .map((item) => coachInsightCard(item))
    .join("");
}

function totalTodaySales() {
  return reportsToday().reduce((sum, item) => sum + number(item.newSales) + number(item.renewalSales), 0);
}

function diagnosisRow(owner, score, detail) {
  const level = score >= 75 ? "high" : score >= 45 ? "mid" : "low";
  const label = score >= 75 ? "健康" : score >= 45 ? "需关注" : "偏低";
  return `
    <div class="diagnosis-row ${level}">
      <div>
        <strong>${escapeHtml(owner)}</strong>
        <span>${escapeHtml(detail)}</span>
      </div>
      <b>${score}分 · ${label}</b>
    </div>
  `;
}

function coachInsightCard(item) {
  if (!item.report) {
    return `
      <article class="coach-card low">
        <strong>${escapeHtml(item.owner)} · 未形成日报</strong>
        <p>今日缺少过程数据，主管无法判断客户触达、商机推进和明日计划。</p>
        <span>建议动作：晚复盘前补交日报，并补齐至少1条重点商机下一步。</span>
      </article>
    `;
  }
  const issues = [];
  if (item.workloadScore < 45) issues.push("工作量偏低");
  if (item.reserveScore < 45) issues.push("商机储备偏弱");
  if (item.visitScore && item.visitScore < 4) issues.push("拜访质量需复盘");
  if (item.opportunityMoves < 2) issues.push("商机推进记录偏少");
  const level = issues.length >= 2 ? "low" : issues.length ? "mid" : "high";
  const summary = `新签 ${item.newSales.toLocaleString("zh-CN")}，老客 ${item.renewalSales.toLocaleString("zh-CN")}，触达 ${item.touches}，商机推进 ${item.opportunityMoves} 条。`;
  const advice = issues.length ? `建议聚焦：${issues.join("、")}。` : "今日动作结构较完整，可沉淀为组内参考样例。";
  return `
    <article class="coach-card ${level}">
      <strong>${escapeHtml(item.owner)} · AI动作诊断</strong>
      <p>${escapeHtml(summary)}</p>
      <span>${escapeHtml(advice)}</span>
    </article>
  `;
}

function managerFocusItems() {
  const owners = visibleOwners();
  const todaysReports = reportsToday();
  const submitted = new Set(todaysReports.map((report) => report.owner));
  const missing = owners
    .filter((owner) => !submitted.has(owner))
    .map((owner) => ({
      level: "high",
      title: `${owner} 今日未提交日报`,
      detail: "晚复盘前需要补交，否则看板无法判断真实销售动作。"
    }));

  const lowReports = todaysReports
    .map((report) => ({ report, aiScore: latestAiScore(report), score: latestAiScore(report)?.score || scoreReport(report) }))
    .filter((item) => item.score < 70)
    .map((item) => ({
      level: item.score < 50 ? "high" : "mid",
      title: `${item.report.owner} 日报质量 ${item.score}分`,
      detail: item.aiScore?.issues?.join("、") || "商机推进、明日计划或过程动作记录不足。"
    }));

  const opportunityRisks = openOpportunities()
    .filter((item) => riskReason(item))
    .slice(0, 6)
    .map((item) => ({
      level: number(item.amount) >= 20000 ? "high" : "mid",
      title: `${item.owner} · ${item.customer} 商机风险`,
      detail: `${riskReason(item)}，金额 ${number(item.amount).toLocaleString("zh-CN")}，阶段 ${item.stage}。`
    }));

  const syncRisks = state.visitRecords
    .filter((item) => canSeeOwner(item.owner) && item.accountId && item.crmSyncStatus === "failed")
    .slice(0, 4)
    .map((item) => ({
      level: "mid",
      title: `${item.owner} · ${item.customer} CRM同步失败`,
      detail: item.crmSyncError || "需要重试或检查CRM字段映射。"
    }));

  return [...missing, ...lowReports, ...opportunityRisks, ...syncRisks].slice(0, 12);
}

function renderManagerFocus() {
  const target = document.querySelector("#managerFocusList");
  if (!target) return;
  const items = managerFocusItems();
  target.innerHTML = items.length
    ? items
        .map(
          (item) => `
            <article class="focus-row ${item.level}">
              <div>
                <strong>${escapeHtml(item.title)}</strong>
                <span>${escapeHtml(item.detail)}</span>
              </div>
              <b>${item.level === "high" ? "优先" : "关注"}</b>
            </article>
          `
        )
        .join("")
    : `<article class="focus-row high"><div><strong>今日暂无重点风险</strong><span>日报、商机和同步状态暂时稳定。</span></div><b>正常</b></article>`;
}

function renderOnline() {
  document.querySelector("#onlineTable").innerHTML = state.onlineRecords
    .filter((item) => canSeeOwner(item.owner))
    .map(
      (item) => `
        <tr>
          <td>${escapeHtml(item.date)}</td>
          <td>${escapeHtml(item.owner)}</td>
          <td>${escapeHtml(item.platform)}</td>
          <td>${number(item.posts)}</td>
          <td>${number(item.views).toLocaleString("zh-CN")}</td>
          <td>${number(item.likes)}</td>
          <td>${number(item.saves)}</td>
          <td>${number(item.comments)}</td>
          <td>${number(item.messages)}</td>
          <td><strong>${number(item.leads)}</strong></td>
          <td>${escapeHtml(item.source)}</td>
        </tr>
      `
    )
    .join("");
}

function renderVisits() {
  document.querySelector("#visitTable").innerHTML = state.visitRecords
    .filter((item) => canSeeOwner(item.owner))
    .map(
      (item) => `
        <tr data-visit-id="${item.id}">
          ${visitCell(item.date, "date", "date", item.date)}
          ${visitCell(item.owner, "owner", "select", item.owner)}
          ${visitCell(item.customer, "customer", "text", item.customer, item.accountId)}
          ${visitCell(item.method, "method", "select", item.method)}
          ${visitCell(item.purpose, "purpose", "text", item.purpose)}
          ${visitCell(item.points, "points", "textarea", item.points)}
          ${visitCell(item.pain, "pain", "textarea", item.pain)}
          ${visitCell(item.nextPlan, "nextPlan", "textarea", item.nextPlan)}
          ${visitCell(item.deadline, "deadline", "date", item.deadline)}
          ${visitCell(item.score, "score", "number", item.score)}
          <td>${visitSyncBadge(item)}</td>
        </tr>
      `
    )
    .join("");
}

function visitSyncBadge(item) {
  const status = item.crmSyncStatus || (item.crmRecordId ? "synced" : "local");
  const labels = {
    local: "本地",
    pending: "待同步",
    syncing: "同步中",
    synced: "已同步",
    failed: "失败"
  };
  const detail = item.crmRecordId || item.crmSyncError || (item.accountId ? item.accountId : "未匹配CRM客户");
  return `<span class="sync-badge ${escapeHtml(status)}">${labels[status] || status}</span><small class="sync-detail">${escapeHtml(detail || "")}</small>`;
}

function customerCellLabel(label, accountId) {
  const previewButton = accountId
    ? `<button class="customer-preview-button" type="button" data-account-preview="${escapeHtml(accountId)}">预览</button>`
    : "";
  return `<span>${escapeHtml(label || "-")}</span>${previewButton}`;
}

function visitCell(label, field, type, value, accountId = "") {
  return `
    <td class="sheet-cell ${field === "customer" && accountId ? "customer-linked-cell" : ""}" tabindex="0" data-visit-field="${field}" data-editor-type="${type}" data-value="${escapeHtml(value)}" data-account-id="${escapeHtml(accountId || "")}">
      ${field === "customer" ? customerCellLabel(label, accountId) : `<span>${escapeHtml(label || "-")}</span>`}
    </td>
  `;
}

function renderOpportunities() {
  const rows = state.opportunities
    .filter((item) => canSeeOwner(item.owner))
    .map((item) => {
      const risk = riskReason(item);
      const closed = isClosedOpportunity(item);
      return `
        <tr class="${closed ? "status-closed" : ""}" data-opportunity-id="${item.id}">
          ${spreadsheetCell(item.owner, "owner", "select", item.owner)}
          ${spreadsheetCell(item.customer, "customer", "account", item.customer, item.accountId)}
          ${spreadsheetCell(item.source || "未填", "source", "text", item.source || "")}
          ${spreadsheetCell(item.need || "-", "need", "text", item.need || "")}
          ${spreadsheetCell(item.grade || "C", "grade", "select", item.grade || "C")}
          ${spreadsheetCell(item.score || 0, "score", "number", item.score || 0)}
          ${spreadsheetCell(number(item.amount).toLocaleString("zh-CN"), "amount", "number", number(item.amount))}
          ${spreadsheetCell(item.stage, "stage", "select", item.stage)}
          ${spreadsheetCell(item.progress || "-", "progress", "textarea", item.progress || "")}
          ${spreadsheetCell(formatDateForDisplay(item.nextActionDate), "nextActionDate", "date", item.nextActionDate || "")}
          ${spreadsheetCell(formatDateForDisplay(item.estimatedCloseDate), "estimatedCloseDate", "date", item.estimatedCloseDate || "")}
          ${spreadsheetCell(closed ? "已关单" : "跟进中", "status", "select", closed ? "closed" : "open")}
          <td>${risk ? `<span class="tag">${risk}</span>` : closed ? "已归档" : "正常"}</td>
        </tr>
      `;
    })
    .join("");
  document.querySelector("#opportunityTable").innerHTML = rows + opportunityDraftRows.map(opportunityDraftRow).join("");
}

function spreadsheetCell(label, field, type, value, accountId = "") {
  return `
    <td class="sheet-cell ${field === "customer" && accountId ? "customer-linked-cell" : ""}" tabindex="0" data-opportunity-field="${field}" data-editor-type="${type}" data-value="${escapeHtml(value)}" data-account-id="${escapeHtml(accountId || "")}">
      ${field === "customer" ? customerCellLabel(label, accountId) : `<span>${escapeHtml(label)}</span>`}
    </td>
  `;
}

function createOpportunityDraftRows(count) {
  return Array.from({ length: count }, () => emptyOpportunityDraft());
}

function emptyOpportunityDraft() {
  return {
    draftId: uid("od"),
    owner: "",
    accountId: "",
    customer: "",
    source: "",
    need: "",
    grade: "",
    score: "",
    amount: "",
    stage: "",
    progress: "",
    nextActionDate: "",
    estimatedCloseDate: "",
    status: ""
  };
}

function opportunityDraftRow(draft) {
  return `
    <tr class="draft-row" data-opportunity-draft-id="${draft.draftId}">
      ${opportunityDraftCell(draft.owner, "owner", "select")}
      ${opportunityDraftCell(draft.customer, "customer", "account", draft.accountId)}
      ${opportunityDraftCell(draft.source, "source", "text")}
      ${opportunityDraftCell(draft.need, "need", "text")}
      ${opportunityDraftCell(draft.grade, "grade", "select")}
      ${opportunityDraftCell(draft.score, "score", "number")}
      ${opportunityDraftCell(draft.amount, "amount", "number")}
      ${opportunityDraftCell(draft.stage, "stage", "select")}
      ${opportunityDraftCell(draft.progress, "progress", "textarea")}
      ${opportunityDraftCell(draft.nextActionDate, "nextActionDate", "date")}
      ${opportunityDraftCell(draft.estimatedCloseDate, "estimatedCloseDate", "date")}
      ${opportunityDraftCell(draft.status, "status", "select")}
      <td class="draft-hint">空白行</td>
    </tr>
  `;
}

function opportunityDraftCell(value, field, type, accountId = "") {
  return `
    <td class="sheet-cell draft-cell ${field === "customer" && accountId ? "customer-linked-cell" : ""}" tabindex="0" data-opportunity-field="${field}" data-editor-type="${type}" data-value="${escapeHtml(value || "")}" data-account-id="${escapeHtml(accountId || "")}">
      ${field === "customer" ? customerCellLabel(formatOpportunityDraftLabel(field, value), accountId) : `<span>${escapeHtml(formatOpportunityDraftLabel(field, value))}</span>`}
    </td>
  `;
}

function formatOpportunityDraftLabel(field, value) {
  if (value) {
    if (["nextActionDate", "estimatedCloseDate"].includes(field)) return formatDateForDisplay(value);
    if (field === "status") return value === "closed" ? "已关单" : "跟进中";
    return value;
  }
  const labels = {
    owner: "顾问",
    customer: "客户名称",
    source: "来源",
    need: "需求",
    grade: "等级",
    score: "评分",
    amount: "金额",
    stage: "阶段",
    progress: "跟进情况",
    nextActionDate: "下次跟进",
    estimatedCloseDate: "预计成交",
    status: "状态"
  };
  return labels[field] || "点击填写";
}

function formatDateForDisplay(value) {
  if (!value) return "-";
  return String(value).replaceAll("-", "/");
}

function renderAi() {
  const stats = visibleOwners().map(ownerStats).sort((a, b) => b.score - a.score);
  document.querySelector("#aiCards").innerHTML = stats
    .map((item) => {
      const report = item.report;
      if (!report) {
        return `<div class="ai-card"><strong>${item.owner} · 未提交</strong><span>今日未形成日报留痕，主管需要提醒补交，否则无法判断真实动作。</span></div>`;
      }
      const aiScore = latestAiScore(report);
      const highlights = aiScore?.highlights || [];
      const evidence = aiScore?.evidence || {};
      const evidenceRows = Object.entries(evidence).filter(([, value]) => value !== undefined && value !== null && value !== "");
      const highlight = item.newSales > 0 ? `今日产生新签 ${item.newSales.toLocaleString("zh-CN")}` : "今日暂无新签结果";
      const problem = item.opportunityMoves >= 2 ? "商机推进记录较明确" : "商机推进偏少，需要补充具体客户和下一步";
      const advice = report.tomorrowPlan ? `明日建议围绕：${report.tomorrowPlan}` : "明日计划缺失，建议至少写3个可检查动作。";
      return `
        <div class="ai-card">
          <strong>${item.owner} · ${aiScore ? `${aiScore.score}分` : `${item.score}分`}</strong>
          <span>日报盘点：${aiScore?.summary || `${highlight}，触达 ${item.touches} 个客户，工作量饱和度 ${item.workloadScore}分。`}</span>
          <span>拜访总结：今日 ${item.visitCount} 条拜访，平均评分 ${item.visitScore || 0}分。</span>
          <span>商机储备：储备评分 ${item.reserveScore}分，商机池 ${item.amount.toLocaleString("zh-CN")}。</span>
          <span>问题：${aiScore?.issues?.join("、") || problem}。</span>
          <span>${aiScore?.advice || advice}</span>
          ${
            highlights.length || evidenceRows.length
              ? `<div class="ai-evidence">
                  ${highlights.length ? `<p>${highlights.map((text) => escapeHtml(text)).join("；")}</p>` : ""}
                  ${
                    evidenceRows.length
                      ? `<ul>${evidenceRows.map(([key, value]) => `<li><b>${escapeHtml(key)}</b>${escapeHtml(String(value))}</li>`).join("")}</ul>`
                      : ""
                  }
                </div>`
              : ""
          }
          <small>${aiScore ? `AI来源：${escapeHtml(aiScore.source || "ai")}` : "AI来源：前端规则估算"}</small>
        </div>
      `;
    })
    .join("");

  const totalNewSales = reportsToday().reduce((sum, item) => sum + number(item.newSales), 0);
  const top = stats[0];
  const risks = openOpportunities().filter((item) => riskReason(item));
  const activeOwners = stats.filter((item) => item.report).map((item) => item.owner).join("、");
  document.querySelector("#weeklySummary").innerHTML = `
    <div>
      <h3>一、团队概况</h3>
      <p>本周销售管理重点集中在日报提交、商机推进、客户触达和新签回款。今日已提交成员包括 ${activeOwners || "暂无"}，新签合计 ${totalNewSales.toLocaleString("zh-CN")}。</p>
    </div>
    <div>
      <h3>二、个人表现</h3>
      <ul>
        ${stats
          .map((item) => `<li>${item.owner}：AI评分 ${item.score}，新签 ${item.newSales.toLocaleString("zh-CN")}，商机推进 ${item.opportunityMoves} 条。</li>`)
          .join("")}
      </ul>
    </div>
    <div>
      <h3>三、主管关注</h3>
      <p>${top ? `${top.owner} 当前综合表现领先，可复用其商机推进和明日计划写法。` : ""}${risks.length ? ` 当前有 ${risks.length} 条商机需要主管介入，优先确认下一步时间和成交阻碍。` : " 当前暂无明显高风险商机。"}</p>
    </div>
    <div>
      <h3>四、下周动作</h3>
      <p>建议围绕高金额商机建立每日推进检查，要求每条重点商机都有下次跟进日期、明确成交障碍和主管支持项。</p>
    </div>
  `;
}

function latestAiScore(report) {
  if (!report) return null;
  return state.aiScores
    .filter((item) => item.reportId === report.id || (item.owner === report.owner && item.date === report.date))
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))[0] || null;
}

function reportVersionsFor(report) {
  if (!report) return [];
  return state.reportVersions
    .filter((item) => item.reportId === report.id || (item.owner === report.owner && item.date === report.date))
    .sort((a, b) => String(b.savedAt || "").localeCompare(String(a.savedAt || "")));
}

function diffReportFields(before = {}, after = {}) {
  const labels = {
    newSales: "新签业绩",
    renewalSales: "老客业绩",
    touches: "触达客户数",
    posts: "发帖数",
    selfProspects: "自拓数量",
    softwareTouches: "软件IP触达",
    opportunityUpdates: "商机跟进",
    extraWork: "额外工作",
    tomorrowPlan: "明日计划"
  };
  return Object.entries(labels)
    .filter(([field]) => JSON.stringify(before[field] ?? "") !== JSON.stringify(after[field] ?? ""))
    .map(([, label]) => label);
}

function renderReportHistory() {
  const target = document.querySelector("#reportHistoryList");
  if (!target) return;
  const reports = state.reports
    .filter((item) => canSeeOwner(item.owner))
    .slice()
    .sort((a, b) => `${b.date}-${b.owner}`.localeCompare(`${a.date}-${a.owner}`));
  target.innerHTML = reports.length
    ? reports.map((report) => {
        const aiScore = latestAiScore(report);
        const review = state.supervisorReviews.find((item) => item.owner === report.owner && item.date === report.date);
        const versions = reportVersionsFor(report);
        const latestVersion = versions[0];
        return `
          <article class="history-row">
            <div>
              <strong>${escapeHtml(report.date)} · ${escapeHtml(report.owner)}</strong>
              <span>新签 ${number(report.newSales).toLocaleString("zh-CN")} · 老客 ${number(report.renewalSales).toLocaleString("zh-CN")} · 触达 ${number(report.touches)} · 商机推进 ${reportMoveCount(report)}</span>
              ${latestVersion ? `<small>修改 ${versions.length} 次 · 最近调整：${escapeHtml((latestVersion.changedFields || []).join("、") || "内容更新")}</small>` : ""}
            </div>
            <em>${aiScore ? `AI ${aiScore.score}分` : "未评分"}${review ? " · 已点评" : ""}</em>
          </article>
        `;
      }).join("")
    : `<div class="empty-preview">暂无日报历史</div>`;
}

function renderSupervisorReviews() {
  const target = document.querySelector("#reviewList");
  if (!target) return;
  const reviews = state.supervisorReviews
    .filter((item) => canSeeOwner(item.owner))
    .slice()
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  target.innerHTML = reviews.length
    ? reviews.map((item) => `
      <article class="review-row">
        <div>
          <strong>${escapeHtml(item.date)} · ${escapeHtml(item.owner)}</strong>
          <span>${escapeHtml(item.comment)}</span>
        </div>
        <em>${escapeHtml(item.createdBy || "主管")} · ${new Date(item.createdAt).toLocaleString("zh-CN")}</em>
      </article>
    `).join("")
    : `<div class="empty-preview">暂无主管点评</div>`;
}

function renderSyncLog() {
  const target = document.querySelector("#syncLog");
  if (!target) return;
  const events = state.syncEvents
    .filter((item) => !item.owner || canSeeOwner(item.owner))
    .slice(-80)
    .reverse();
  target.innerHTML = events.length
    ? events.map((item) => `
      <article class="sync-log-row">
        <div>
          <strong>${escapeHtml(item.title || item.status || "系统记录")}</strong>
          <span>${escapeHtml(item.detail || "")}</span>
        </div>
        <em>${item.at ? new Date(item.at).toLocaleString("zh-CN") : ""}</em>
      </article>
    `).join("")
    : `<div class="empty-preview">暂无同步日志</div>`;
}

async function refreshAiScores() {
  if (!USE_SHARED_STATE || !authState.loggedIn) {
    alert("请先在顶部完成 CRM 登录，再刷新 AI 评分。");
    return;
  }
  const reports = reportsToday();
  if (!reports.length) {
    alert("今天还没有可评分的日报。");
    return;
  }
  const button = document.querySelector("#refreshAiScoreButton");
  if (button) {
    button.disabled = true;
    button.textContent = "评分中...";
  }
  let success = 0;
  let failed = 0;
  for (const report of reports) {
    try {
      const response = await fetch(AI_SCORE_API, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          report,
          context: {
            opportunities: state.opportunities.filter((item) => item.owner === report.owner),
            visitRecords: state.visitRecords.filter((item) => item.owner === report.owner && item.date === report.date),
            onlineRecords: state.onlineRecords.filter((item) => item.owner === report.owner && item.date === report.date)
          }
        })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "AI评分失败");
      state.aiScores = state.aiScores.filter((item) => item.reportId !== report.id);
      state.aiScores.push({
        id: uid("ai"),
        reportId: report.id,
        date: report.date,
        owner: report.owner,
        createdAt: new Date().toISOString(),
        ...payload
      });
      success += 1;
    } catch {
      failed += 1;
    }
  }
  addSyncEvent({
    status: "ai-score",
    title: "AI评分已刷新",
    detail: `成功 ${success} 条，失败 ${failed} 条`,
    success,
    failed
  });
  saveState();
  render();
  if (button) {
    button.disabled = false;
    button.textContent = "刷新AI评分";
  }
}

function renderSync() {
  const pendingVisits = state.visitRecords.filter((item) => canSeeOwner(item.owner) && item.accountId && item.crmSyncStatus !== "synced");
  const pendingOpportunities = pendingOpportunityActions();
  const pendingDailyActions = pendingDailyCrmActions();
  const syncItems = [
    {
      title: "商机阶段变化",
      value: pendingOpportunities.length,
      text: "先写回CRM过程记录，商机主表阶段字段待映射确认"
    },
    {
      title: "拜访记录",
      value: pendingVisits.length,
      text: "匹配到CRM客户后，可回写 activityrecord"
    },
    {
      title: "日报客户动作",
      value: pendingDailyActions.length,
      text: "把日报中的商机推进写成客户跟进过程"
    }
  ];

  document.querySelector("#syncGrid").innerHTML = syncItems
    .map(
      (item) => `
        <div class="sync-card">
          <strong>${item.title}</strong>
          <span>${item.value} 条待同步</span>
          <p>${item.text}</p>
        </div>
      `
    )
    .join("");
}

function pendingOpportunityActions() {
  return state.opportunities
    .filter((item) => canSeeOwner(item.owner) && item.crmSyncStatus !== "synced")
    .filter((item) => item.accountId || item.crmSyncStatus === "failed")
    .map((item) => ({
      localId: item.id,
      type: "opportunity",
      owner: item.owner,
      customer: item.customer,
      accountId: item.accountId,
      date: item.updatedAt || TODAY,
      stage: item.stage,
      progress: item.progress || item.need,
      nextPlan: item.nextPlan || "",
      nextActionDate: item.nextActionDate,
      amount: item.amount,
      sourceRecord: item
    }));
}

function pendingDailyCrmActions() {
  return state.reports
    .filter((report) => canSeeOwner(report.owner))
    .flatMap((report) =>
      (report.opportunityUpdates || [])
        .filter((update) => update.crmSyncStatus !== "synced")
        .map((update) => {
          const opportunity = state.opportunities.find((item) => item.id === update.opportunityId) || {};
          return {
            localId: `${report.id}:${update.opportunityId}`,
            type: "daily-action",
            owner: report.owner,
            customer: opportunity.customer || update.customer || "",
            accountId: opportunity.accountId || update.accountId || "",
            date: report.date,
            stage: update.closeResult || update.stage || opportunity.stage || "",
            progress: update.todayProgress,
            nextPlan: update.nextPlan,
            nextActionDate: update.nextActionDate,
            amount: opportunity.amount,
            reportId: report.id,
            sourceRecord: update
          };
        })
    )
    .filter((item) => item.progress || item.nextPlan || item.stage || item.nextActionDate);
}

function renderSyncRetryList() {
  const target = document.querySelector("#syncRetryList");
  if (!target) return;
  const visits = state.visitRecords
    .filter((item) => canSeeOwner(item.owner) && item.accountId && ["failed", "pending"].includes(item.crmSyncStatus))
    .slice()
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
  const opportunityActions = pendingOpportunityActions();
  const dailyActions = pendingDailyCrmActions();
  const hasItems = visits.length || opportunityActions.length || dailyActions.length;
  target.innerHTML = hasItems
    ? `
      <div class="retry-head">
        <strong>待处理CRM同步</strong>
        <span>拜访 ${visits.length} 条 · 商机 ${opportunityActions.length} 条 · 日报动作 ${dailyActions.length} 条</span>
      </div>
      ${visits
        .map(
          (visit) => `
            <article class="retry-row">
              <div>
                <strong>${escapeHtml(visit.date)} · ${escapeHtml(visit.owner)} · ${escapeHtml(visit.customer)}</strong>
                <span>${escapeHtml(visit.crmSyncError || (visit.crmSyncStatus === "pending" ? "等待同步到CRM" : "CRM同步失败"))}</span>
              </div>
              <button class="ghost-button" type="button" data-retry-visit="${escapeHtml(visit.id)}">重试</button>
            </article>
          `
        )
        .join("")}
      ${opportunityActions
        .map((action) => syncActionRow(action, "商机推进", "data-retry-opportunity-action"))
        .join("")}
      ${dailyActions
        .map((action) => syncActionRow(action, "日报动作", "data-retry-daily-action"))
        .join("")}
    `
    : `<div class="empty-preview">暂无失败或待同步CRM动作</div>`;
}

function syncActionRow(action, label, retryAttr) {
  const disabled = action.accountId ? "" : "disabled";
  const detail = action.accountId
    ? action.sourceRecord?.crmSyncError || "等待同步到CRM过程记录"
    : "缺少CRM客户ID，请先在客户字段匹配CRM客户";
  return `
    <article class="retry-row">
      <div>
        <strong>${escapeHtml(action.date || TODAY)} · ${escapeHtml(action.owner)} · ${escapeHtml(label)} · ${escapeHtml(action.customer || "未匹配客户")}</strong>
        <span>${escapeHtml(detail)}</span>
      </div>
      <button class="ghost-button" type="button" ${retryAttr}="${escapeHtml(action.localId)}" ${disabled}>重试</button>
    </article>
  `;
}

function renderReadiness() {
  const items = [
    {
      title: "共享数据库",
      status: "KV结构化",
      text: "已从单个大JSON拆成日报、商机、拜访、点评、AI评分、同步日志等结构化KV集合。"
    },
    {
      title: "登录与权限",
      status: "基础已接入",
      text: "已按CRM登录身份区分顾问/主管：顾问只看自己，主管看团队；管理员配置仍需补齐。"
    },
    {
      title: "CRM回写",
      status: "待联调",
      text: "需要确认商机、客户、跟进记录、回款字段映射，并做重复客户匹配。"
    },
    {
      title: "AI评分服务",
      status: "接口已接",
      text: "已接 /api/ai/score，支持外部AI评分服务；未配置时使用后端规则评分兜底。"
    },
    {
      title: "线上运营数据",
      status: "半自动优先",
      text: "小红书私信和线索通常需要账号授权、后台导出或服务商接口；公开抓取只能覆盖部分互动。"
    },
    {
      title: "审计与备份",
      status: "基础已补",
      text: "已补日报历史、主管点评和同步日志；后续可扩展为不可篡改审计流。"
    }
  ];

  const grid = document.querySelector("#readinessGrid");
  if (!grid) return;
  grid.innerHTML = items
    .map(
      (item) => `
        <article class="readiness-card">
          <div>
            <strong>${item.title}</strong>
            <span>${item.status}</span>
          </div>
          <p>${item.text}</p>
        </article>
      `
    )
    .join("");
}

function renderStorageStatus() {
  const target = document.querySelector("#storageStatus");
  if (!target) return;
  const size = new Blob([JSON.stringify(state)]).size;
  const lastSync = state.syncEvents[state.syncEvents.length - 1]?.at;
  const storageMode = {
    connecting: "正在连接云端共享数据",
    shared: "Cloudflare KV 共享数据",
    fallback: "云端不可用，临时回退本地",
    local: "浏览器本地 localStorage"
  }[sharedStateStatus.mode] || "浏览器本地 localStorage";
  const rows = [
    ["当前存储", storageMode],
    ["可见顾问", `${visibleOwners().length} 人`],
    ["日报", `${state.reports.filter((item) => canSeeOwner(item.owner)).length} 条`],
    ["日报修改记录", `${state.reportVersions.filter((item) => canSeeOwner(item.owner)).length} 条`],
    ["商机", `${state.opportunities.filter((item) => canSeeOwner(item.owner)).length} 条`],
    ["拜访记录", `${state.visitRecords.filter((item) => canSeeOwner(item.owner)).length} 条`],
    ["待同步拜访", `${state.visitRecords.filter((item) => canSeeOwner(item.owner) && item.accountId && item.crmSyncStatus !== "synced").length} 条`],
    ["线上运营记录", `${state.onlineRecords.filter((item) => canSeeOwner(item.owner)).length} 条`],
    ["CRM团队范围", teamState.members?.length ? `${teamState.members.length} 人` : "未同步"],
    ["CRM部门", teamState.department?.name || teamState.department?.id || "暂无"],
    ["CRM客户缓存", accountCacheStatus.count ? `${accountCacheStatus.count} 个客户` : "未同步"],
    ["数据包大小", `${Math.max(1, Math.round(size / 1024))} KB`],
    ["团队最近同步", teamState.syncedAt ? new Date(teamState.syncedAt).toLocaleString("zh-CN") : "暂无"],
    ["客户最近同步", accountCacheStatus.syncedAt ? new Date(accountCacheStatus.syncedAt).toLocaleString("zh-CN") : "暂无"],
    ["最近云端保存", sharedStateStatus.savedAt ? new Date(sharedStateStatus.savedAt).toLocaleString("zh-CN") : "暂无"],
    ["最近模拟同步", lastSync ? new Date(lastSync).toLocaleString("zh-CN") : "暂无"]
  ];
  target.innerHTML = rows.map(([label, value]) => `<div><span>${label}</span><strong>${value}</strong></div>`).join("");
}

function switchView(view) {
  document.querySelectorAll(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.view === view));
  document.querySelectorAll(".view").forEach((item) => item.classList.remove("active"));
  document.querySelector(`#${view}View`).classList.add("active");
}

document.querySelectorAll("[data-view]").forEach((button) => {
  button.addEventListener("click", () => switchView(button.dataset.view));
});

document.querySelectorAll("[data-view-target]").forEach((button) => {
  button.addEventListener("click", () => switchView(button.dataset.viewTarget));
});

document.querySelector("#authWidget").addEventListener("click", (event) => {
  const action = event.target.closest("[data-auth-action]")?.dataset.authAction;
  if (action === "login") startCrmLogin();
  if (action === "logout") logoutCrm();
  if (action === "local") alert("本地预览只能看界面；CRM网页登录请使用线上 Pages 地址。");
});

document.querySelector('#dailyForm select[name="owner"]').addEventListener("change", () => {
  ownerManuallyChanged = true;
  renderDailyOpportunities();
  hydrateCrmPerformance();
});

document.querySelector('#dailyForm input[name="date"]').addEventListener("change", hydrateCrmPerformance);

document.querySelector("#refreshAiScoreButton")?.addEventListener("click", refreshAiScores);

document.querySelector("#reviewForm")?.addEventListener("submit", (event) => {
  event.preventDefault();
  if (USE_SHARED_STATE && authState.loggedIn && !isManagerRole()) {
    alert("主管点评由主管账号填写。");
    return;
  }
  const form = new FormData(event.currentTarget);
  const review = Object.fromEntries(form.entries());
  if (!review.owner || !review.date || !review.comment?.trim()) {
    alert("请选择日期、顾问并填写点评。");
    return;
  }
  state.supervisorReviews = state.supervisorReviews.filter((item) => !(item.owner === review.owner && item.date === review.date));
  state.supervisorReviews.push({
    id: uid("rv"),
    owner: review.owner,
    date: review.date,
    comment: review.comment.trim(),
    createdAt: new Date().toISOString(),
    createdBy: authState.user?.name || "主管"
  });
  addSyncEvent({
    owner: review.owner,
    status: "supervisor-review",
    title: "主管点评已保存",
    detail: `${review.date} ${review.owner}：${review.comment.trim().slice(0, 40)}`
  });
  event.currentTarget.reset();
  saveState();
  render();
});

document.querySelector("#dailyOpportunityTable").addEventListener("click", (event) => {
  beginDailyCellEdit(event.target.closest(".sheet-cell"));
});

document.querySelector("#dailyOpportunityTable").addEventListener("keydown", (event) => {
  const cell = event.target.closest(".sheet-cell");
  if (cell && event.key === "Enter") {
    event.preventDefault();
    beginDailyCellEdit(cell);
  }
});

document.querySelector("#dailyVisitTable").addEventListener("click", (event) => {
  const previewButton = event.target.closest("[data-account-preview]");
  if (previewButton) {
    event.preventDefault();
    event.stopPropagation();
    openCustomerPreview(previewButton.dataset.accountPreview);
    return;
  }
  beginDailyVisitCellEdit(event.target.closest(".sheet-cell"));
});

document.querySelector("#dailyVisitTable").addEventListener("keydown", (event) => {
  const cell = event.target.closest(".sheet-cell");
  if (cell && event.key === "Enter") {
    event.preventDefault();
    beginDailyVisitCellEdit(cell);
  }
});

document.querySelector("#dailyForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const report = Object.fromEntries(form.entries());
  ["newSales", "renewalSales", "touches", "posts", "selfProspects", "softwareTouches"].forEach((field) => {
    report[field] = number(report[field]);
  });
  report.opportunityUpdates = Array.from(document.querySelectorAll("#dailyOpportunityTable tr[data-opportunity-id]"))
    .map((row) => {
      const get = (field) => row.querySelector(`[data-daily-field="${field}"]`)?.dataset.value?.trim() || "";
      return {
        opportunityId: row.dataset.opportunityId,
        stage: get("stage"),
        todayProgress: get("todayProgress"),
        nextPlan: get("nextPlan"),
        nextActionDate: get("nextActionDate"),
        closeResult: get("closeResult"),
        crmSyncStatus: "pending",
        crmRecordId: "",
        crmSyncError: ""
      };
    })
    .filter((item) => item.todayProgress || item.nextPlan || item.closeResult || item.nextActionDate);
  const previousReport = state.reports.find((item) => item.date === report.date && item.owner === report.owner);
  report.id = previousReport?.id || uid("r");
  if (previousReport) {
    const changedFields = diffReportFields(previousReport, report);
    if (changedFields.length) {
      state.reportVersions.push({
        id: uid("rvn"),
        reportId: report.id,
        date: report.date,
        owner: report.owner,
        savedAt: new Date().toISOString(),
        savedBy: currentCrmOwnerName() || report.owner,
        changedFields,
        before: previousReport,
        after: report
      });
      state.reportVersions = state.reportVersions.slice(-1000);
    }
  }
  state.reports = state.reports.filter((item) => !(item.date === report.date && item.owner === report.owner));
  state.reports.push(report);

  report.opportunityUpdates.forEach((update) => {
    const target = state.opportunities.find((item) => item.id === update.opportunityId);
    if (target) {
      target.stage = update.closeResult || update.stage || target.stage;
      target.progress = [update.todayProgress, update.nextPlan && `下一步：${update.nextPlan}`].filter(Boolean).join("；") || target.progress;
      target.nextActionDate = update.nextActionDate || target.nextActionDate;
      target.status = update.closeResult ? "closed" : target.status || "open";
      target.updatedAt = report.date;
      target.crmSyncStatus = target.accountId ? "pending" : "local";
      target.crmSyncError = target.accountId ? "" : "缺少CRM客户ID，请先匹配CRM客户";
    }
  });

  const visitRows = Array.from(document.querySelectorAll("#dailyVisitTable tr[data-daily-visit-row]"))
    .filter(isDailyVisitRowFilled)
    .map((row) => {
      const get = (field) => row.querySelector(`[data-daily-visit-field="${field}"]`)?.dataset.value?.trim() || "";
      return {
        id: uid("v"),
        date: report.date,
        owner: report.owner,
        accountId: row.querySelector(`[data-daily-visit-field="customer"]`)?.dataset.accountId || "",
        customer: get("customer") || "未命名客户",
        method: get("method") || "线上",
        purpose: get("purpose") || "客户沟通",
        points: get("points"),
        pain: get("pain"),
        nextPlan: get("nextPlan"),
        deadline: get("deadline"),
        score: number(get("score")) || 3,
        crmSyncStatus: row.querySelector(`[data-daily-visit-field="customer"]`)?.dataset.accountId ? "pending" : "local",
        crmRecordId: "",
        crmSyncError: ""
      };
    });
  if (visitRows.length) {
    const existingIds = new Set(visitRows.map((item) => `${item.date}-${item.owner}-${item.customer}-${item.purpose}`));
    state.visitRecords = state.visitRecords.filter((item) => !existingIds.has(`${item.date}-${item.owner}-${item.customer}-${item.purpose}`));
    state.visitRecords.push(...visitRows);
  }

  addSyncEvent({
    owner: report.owner,
    status: "daily-report",
    title: "日报已保存",
    detail: `${report.date} ${report.owner} 保存日报，商机推进 ${report.opportunityUpdates.length} 条，拜访 ${visitRows.length} 条`
  });
  saveState();
  render();
  switchView("dashboard");
});

document.querySelector("#opportunityTable").addEventListener("click", (event) => {
  const previewButton = event.target.closest("[data-account-preview]");
  if (previewButton) {
    event.preventDefault();
    event.stopPropagation();
    openCustomerPreview(previewButton.dataset.accountPreview);
    return;
  }
  beginOpportunityCellEdit(event.target.closest(".sheet-cell"));
});

document.querySelector("#opportunityTable").addEventListener("keydown", (event) => {
  const cell = event.target.closest(".sheet-cell");
  if (cell && event.key === "Enter") {
    event.preventDefault();
    beginOpportunityCellEdit(cell);
  }
});

document.querySelector("#visitTable").addEventListener("click", (event) => {
  const previewButton = event.target.closest("[data-account-preview]");
  if (previewButton) {
    event.preventDefault();
    event.stopPropagation();
    openCustomerPreview(previewButton.dataset.accountPreview);
    return;
  }
  beginVisitCellEdit(event.target.closest(".sheet-cell"));
});

document.querySelector("#visitTable").addEventListener("keydown", (event) => {
  const cell = event.target.closest(".sheet-cell");
  if (cell && event.key === "Enter") {
    event.preventDefault();
    beginVisitCellEdit(cell);
  }
});

document.querySelector("#customerDrawer")?.addEventListener("click", (event) => {
  if (event.target.closest("[data-customer-close]")) closeCustomerPreview();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeCustomerPreview();
});

function beginOpportunityCellEdit(cell) {
  if (!cell || cell.querySelector(".sheet-editor")) return;
  const row = cell.closest("tr[data-opportunity-id]");
  const draftRow = cell.closest("tr[data-opportunity-draft-id]");
  if (draftRow) {
    beginOpportunityDraftCellEdit(cell, draftRow.dataset.opportunityDraftId);
    return;
  }
  const opportunity = state.opportunities.find((item) => item.id === row?.dataset.opportunityId);
  if (!opportunity) return;
  const field = cell.dataset.opportunityField;
  const type = cell.dataset.editorType;
  const currentValue = field === "status" ? (isClosedOpportunity(opportunity) ? "closed" : "open") : opportunity[field] || "";
  if (field === "customer") {
    beginAccountCellEdit(cell, currentValue, (account) => {
      rememberCrmAccounts([account]);
      opportunity.customer = account.accountName || currentValue || "";
      opportunity.accountId = account.accountId || "";
      opportunity.updatedAt = TODAY;
      opportunity.crmSyncStatus = account.accountId ? "pending" : "local";
      opportunity.crmSyncError = "";
      saveState();
      renderOpportunities();
      renderDashboard();
      renderDailyOpportunities();
    });
    return;
  }
  const editor = createOpportunityEditor(field, type, currentValue);
  const commit = () => {
    updateOpportunityFromCell(cell, editor.value);
  };
  editor.addEventListener("blur", commit, { once: true });
  editor.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && type !== "textarea") {
      event.preventDefault();
      editor.blur();
    }
    if (event.key === "Escape") {
      event.preventDefault();
      renderOpportunities();
    }
  });
  cell.innerHTML = "";
  cell.append(editor);
  editor.focus();
  if (editor.select) editor.select();
}

function beginOpportunityDraftCellEdit(cell, draftId) {
  const draft = opportunityDraftRows.find((item) => item.draftId === draftId);
  if (!draft) return;
  const field = cell.dataset.opportunityField;
  const type = cell.dataset.editorType;
  if (field === "customer") {
    beginAccountCellEdit(cell, draft.customer || "", (account) => {
      rememberCrmAccounts([account]);
      draft.customer = account.accountName || draft.customer || "";
      draft.accountId = account.accountId || "";
      if (isMeaningfulOpportunityDraft(draft)) {
        state.opportunities.push(opportunityFromDraft(draft));
        opportunityDraftRows = opportunityDraftRows.filter((item) => item.draftId !== draft.draftId);
        ensureOpportunityDraftRows();
        saveState();
        render();
        return;
      }
      updateInlineCell(cell, draft.customer, formatOpportunityDraftLabel(field, draft.customer));
      const beforeCount = opportunityDraftRows.length;
      ensureOpportunityDraftRows();
      if (opportunityDraftRows.length !== beforeCount) renderOpportunities();
    });
    return;
  }
  const editor = createOpportunityEditor(field, type, draft[field] || "");
  const commit = () => {
    updateOpportunityDraftFromCell(cell, editor.value);
  };
  editor.addEventListener("blur", commit, { once: true });
  editor.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && type !== "textarea") {
      event.preventDefault();
      editor.blur();
    }
    if (event.key === "Escape") {
      event.preventDefault();
      renderOpportunities();
    }
  });
  cell.innerHTML = "";
  cell.append(editor);
  editor.focus();
  if (editor.select) editor.select();
}

function updateOpportunityDraftFromCell(cell, value) {
  const row = cell.closest("tr[data-opportunity-draft-id]");
  const draft = opportunityDraftRows.find((item) => item.draftId === row?.dataset.opportunityDraftId);
  const field = cell.dataset.opportunityField;
  if (!draft || !field) return;
  draft[field] = ["amount", "score"].includes(field) ? number(value) : value;
  if (isMeaningfulOpportunityDraft(draft)) {
    state.opportunities.push(opportunityFromDraft(draft));
    opportunityDraftRows = opportunityDraftRows.filter((item) => item.draftId !== draft.draftId);
    ensureOpportunityDraftRows();
    saveState();
    render();
    return;
  }
  updateInlineCell(cell, draft[field], formatOpportunityDraftLabel(field, draft[field]));
  const beforeCount = opportunityDraftRows.length;
  ensureOpportunityDraftRows();
  if (opportunityDraftRows.length !== beforeCount) renderOpportunities();
}

function isMeaningfulOpportunityDraft(draft) {
  const hasCustomer = String(draft.customer || "").trim();
  const hasBusinessDetail = Boolean(
    String(draft.source || "").trim() ||
      String(draft.need || "").trim() ||
      String(draft.progress || "").trim() ||
      number(draft.amount) ||
      String(draft.nextActionDate || "").trim() ||
      String(draft.estimatedCloseDate || "").trim()
  );
  return Boolean(hasCustomer && hasBusinessDetail);
}

function hasAnyOpportunityDraftInput(draft) {
  return Boolean(
    String(draft.customer || "").trim() ||
      String(draft.source || "").trim() ||
      String(draft.need || "").trim() ||
      String(draft.progress || "").trim() ||
      number(draft.amount) ||
      number(draft.score) ||
      String(draft.nextActionDate || "").trim() ||
      String(draft.estimatedCloseDate || "").trim()
  );
}

function opportunityFromDraft(draft) {
  const owner = draft.owner || visibleOwners()[0] || state.users[0] || currentCrmOwnerName();
  const opportunity = {
    id: uid("o"),
    owner,
    customer: draft.customer || "未命名客户",
    accountId: draft.accountId || "",
    source: draft.source || "手工录入",
    need: draft.need || "",
    amount: number(draft.amount),
    stage: draft.stage || "初步沟通",
    status: draft.status || "open",
    progress: draft.progress || "",
    nextActionDate: draft.nextActionDate || "",
    estimatedCloseDate: draft.estimatedCloseDate || "",
    updatedAt: TODAY
  };
  opportunity.grade = draft.grade || inferOpportunityGrade(opportunity);
  opportunity.score = number(draft.score) || inferOpportunityScore(opportunity);
  opportunity.crmSyncStatus = opportunity.accountId ? "pending" : "local";
  opportunity.crmRecordId = "";
  opportunity.crmSyncError = opportunity.accountId ? "" : "缺少CRM客户ID，请先匹配CRM客户";
  return opportunity;
}

function ensureOpportunityDraftRows() {
  while (opportunityDraftRows.length < 3 || hasAnyOpportunityDraftInput(opportunityDraftRows[opportunityDraftRows.length - 1])) {
    opportunityDraftRows.push(emptyOpportunityDraft());
  }
}

function createOpportunityEditor(field, type, value) {
  if (field === "owner") return createSelectEditor(visibleOwners().length ? visibleOwners() : state.users, value);
  if (field === "stage") return createSelectEditor(STAGES, value);
  if (field === "grade") return createSelectEditor(["A", "B", "C", "D"], value);
  if (field === "status") return createSelectEditor(["open", "closed"], value, { open: "跟进中", closed: "已关单" });
  if (type === "textarea") {
    const textarea = document.createElement("textarea");
    textarea.className = "sheet-editor sheet-editor-textarea";
    textarea.value = value || "";
    return textarea;
  }
  const input = document.createElement("input");
  input.className = "sheet-editor";
  input.type = type === "date" ? "date" : "text";
  input.inputMode = type === "number" ? "numeric" : "text";
  input.value = value || "";
  return input;
}

function beginDailyCellEdit(cell) {
  if (!cell || cell.querySelector(".sheet-editor")) return;
  const field = cell.dataset.dailyField;
  const type = cell.dataset.editorType;
  const value = cell.dataset.value || "";
  const editor = createDailyEditor(field, type, value);
  attachInlineEditor(cell, editor, type, (nextValue) => {
    updateInlineCell(cell, nextValue, formatDailyCellLabel(field, nextValue));
  });
}

function createDailyEditor(field, type, value) {
  if (field === "stage") return createSelectEditor(STAGES, value);
  if (field === "closeResult") return createSelectEditor(["", "已成交", "已丢单"], value, { "": "未关单" });
  return createOpportunityEditor(field, type, value);
}

function formatDailyCellLabel(field, value) {
  if (field === "closeResult") return value || "未关单";
  if (field === "nextActionDate") return formatDateForDisplay(value);
  return value || "点击填写";
}

function beginDailyVisitCellEdit(cell) {
  if (!cell || cell.querySelector(".sheet-editor")) return;
  const field = cell.dataset.dailyVisitField;
  const type = cell.dataset.editorType;
  const value = cell.dataset.value || "";
  if (field === "customer") {
    beginAccountCellEdit(cell, value, (account) => {
      rememberCrmAccounts([account]);
      cell.dataset.accountId = account.accountId || "";
      updateInlineCell(cell, account.accountName || value, account.accountName || "客户名称");
      ensureDailyVisitRows();
    });
    return;
  }
  const editor = createDailyVisitEditor(field, type, value);
  attachInlineEditor(cell, editor, type, (nextValue) => {
    updateInlineCell(cell, nextValue, formatDailyVisitCellLabel(field, nextValue));
    ensureDailyVisitRows();
  });
}

function createDailyVisitEditor(field, type, value) {
  if (field === "method") return createSelectEditor(["线上", "线下", "电话", "微信", "到访"], value);
  return createOpportunityEditor(field, type, value);
}

function beginAccountCellEdit(cell, value, commitAccount) {
  const wrapper = document.createElement("div");
  wrapper.className = "account-search-editor";
  const input = document.createElement("input");
  input.className = "sheet-editor";
  input.type = "text";
  input.value = value || "";
  input.placeholder = "搜索CRM客户";
  const list = document.createElement("div");
  list.className = "account-suggestions";
  wrapper.append(input, list);

  let selected = null;
  let searchTimer = null;
  const renderSuggestions = (accounts) => {
    if (!accounts.length) {
      list.innerHTML = `<button type="button" disabled>未匹配到客户，请先同步CRM客户</button>`;
      return;
    }
    list.innerHTML = accounts
      .map(
        (account, index) => `
          <button type="button" data-index="${index}">
            <strong>${escapeHtml(account.accountName)}</strong>
            <span>${escapeHtml(accountSubtitle(account))}</span>
          </button>
        `
      )
      .join("");
    list.querySelectorAll("button[data-index]").forEach((button) => {
      button.addEventListener("mousedown", (event) => {
        event.preventDefault();
        selected = accounts[number(button.dataset.index)];
        commitAccount(selected);
      });
    });
  };
  const search = () => {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(async () => {
      try {
        const url = new URL(CRM_ACCOUNTS_API, location.origin);
        url.searchParams.set("q", input.value.trim());
        const response = await fetch(url, { cache: "no-store" });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "客户搜索失败");
        accountCacheStatus = {
          count: payload.count || 0,
          syncedAt: payload.syncedAt || "",
          message: payload.count ? "已同步CRM客户缓存" : "未同步CRM客户"
        };
        rememberCrmAccounts(payload.matches || []);
        renderStorageStatus();
        renderSuggestions(payload.matches || []);
      } catch (error) {
        list.innerHTML = `<button type="button" disabled>${escapeHtml(error.message || "客户搜索失败")}</button>`;
      }
    }, 220);
  };
  input.addEventListener("input", () => {
    cell.dataset.accountId = "";
    search();
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      const first = list.querySelector("button[data-index]");
      if (first) first.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      else commitAccount({ accountName: input.value.trim(), accountId: "" });
    }
    if (event.key === "Escape") {
      event.preventDefault();
      updateInlineCell(cell, value, value || "客户名称");
    }
  });
  input.addEventListener("blur", () => {
    window.setTimeout(() => {
      if (!selected) commitAccount({ accountName: input.value.trim(), accountId: "" });
    }, 120);
  }, { once: true });

  cell.innerHTML = "";
  cell.append(wrapper);
  input.focus();
  input.select();
  search();
}

function rememberCrmAccounts(accounts) {
  (accounts || []).forEach((account) => {
    if (account?.accountId) crmAccountCache.set(String(account.accountId), account);
  });
}

function looksLikeCrmId(value) {
  return /^\d{10,}$/.test(String(value || "").trim());
}

function displayTextValue(value) {
  const text = String(value || "").trim();
  return text && !looksLikeCrmId(text) ? text : "";
}

function accountSubtitle(account) {
  const locationText = [displayTextValue(account?.province), displayTextValue(account?.city)].filter(Boolean).join(" · ");
  const phoneText = displayTextValue(account?.phone);
  return [locationText, phoneText].filter(Boolean).join(" · ") || account?.ownerName || (account?.accountId ? "已匹配CRM客户" : "未匹配CRM客户");
}

function formatCrmDate(value) {
  if (!value) return "";
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 1000000000000) return new Date(numeric).toLocaleDateString("zh-CN");
  if (/^\d{4}-\d{2}-\d{2}/.test(String(value))) return String(value).slice(0, 10);
  return String(value);
}

function customerMetaItem(label, value) {
  return `<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value || "暂无")}</strong></div>`;
}

function formatDailyVisitCellLabel(field, value) {
  if (field === "deadline") return formatDateForDisplay(value);
  const placeholders = {
    customer: "客户名称",
    purpose: "拜访目的",
    points: "沟通要点",
    pain: "客户痛点",
    nextPlan: "下一步计划",
    score: "3"
  };
  return value || placeholders[field] || "-";
}

function attachInlineEditor(cell, editor, type, commitValue) {
  const previousValue = cell.dataset.value || "";
  const previousLabel = cell.textContent.trim();
  const commit = () => {
    commitValue(editor.value);
  };
  editor.addEventListener("blur", commit, { once: true });
  editor.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && type !== "textarea") {
      event.preventDefault();
      editor.blur();
    }
    if (event.key === "Escape") {
      event.preventDefault();
      updateInlineCell(cell, previousValue, previousLabel);
    }
  });
  cell.innerHTML = "";
  cell.append(editor);
  editor.focus();
  if (editor.select) editor.select();
}

function updateInlineCell(cell, value, label) {
  cell.dataset.value = value || "";
  const accountId = cell.dataset.accountId || "";
  const isCustomerCell = cell.dataset.dailyVisitField === "customer" || cell.dataset.visitField === "customer" || cell.dataset.opportunityField === "customer";
  cell.classList.toggle("customer-linked-cell", Boolean(isCustomerCell && accountId));
  cell.innerHTML = isCustomerCell ? customerCellLabel(label || "-", accountId) : `<span>${escapeHtml(label || "-")}</span>`;
}

function normalizeCustomerName(value) {
  return String(value || "").replace(/\s+/g, "").toLowerCase();
}

function findAccountById(accountId) {
  const id = String(accountId || "");
  if (crmAccountCache.has(id)) return crmAccountCache.get(id);
  const visit = state.visitRecords.find((item) => String(item.accountId || "") === id);
  if (visit) return { accountId: id, accountName: visit.customer, ownerName: visit.owner };
  const opportunity = state.opportunities.find((item) => String(item.accountId || "") === id);
  if (opportunity) return { accountId: id, accountName: opportunity.customer, ownerName: opportunity.owner };
  return null;
}

function customerContext(accountId) {
  const account = findAccountById(accountId) || { accountId, accountName: "未命名客户" };
  const nameKey = normalizeCustomerName(account.accountName);
  const matchesCustomer = (item) => {
    const sameId = accountId && String(item.accountId || "") === String(accountId);
    const sameName = nameKey && normalizeCustomerName(item.customer).includes(nameKey);
    return sameId || sameName;
  };
  const visits = state.visitRecords.filter((item) => canSeeOwner(item.owner) && matchesCustomer(item));
  const opportunities = state.opportunities.filter((item) => canSeeOwner(item.owner) && matchesCustomer(item));
  const reports = state.reports.filter((report) => canSeeOwner(report.owner) && (
    String(report.visits || "").includes(account.accountName || "") ||
    String(report.opportunityText || "").includes(account.accountName || "") ||
    opportunities.some((item) => item.owner === report.owner && item.updatedAt === report.date)
  ));
  const openAmount = opportunities
    .filter((item) => !isClosedOpportunity(item))
    .reduce((sum, item) => sum + number(item.amount), 0);
  return { account, visits, opportunities, reports, openAmount };
}

function previewList(items, renderItem, emptyText) {
  if (!items.length) return `<div class="empty-preview">${escapeHtml(emptyText)}</div>`;
  return items.map(renderItem).join("");
}

function openCustomerPreview(accountId) {
  if (!accountId) return;
  const drawer = document.querySelector("#customerDrawer");
  const target = document.querySelector("#customerPreview");
  if (!drawer || !target) return;
  const context = customerContext(accountId);
  const { account, visits, opportunities, reports, openAmount } = context;
  const latestVisit = visits.slice().sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];
  const activeOpps = opportunities.filter((item) => !isClosedOpportunity(item));
  target.innerHTML = `
    <div class="customer-preview-head">
      <div>
        <span>CRM客户预览</span>
        <h2>${escapeHtml(account.accountName || "未命名客户")}</h2>
        <p>${escapeHtml(accountSubtitle(account))}</p>
      </div>
      <button class="icon-button" type="button" data-customer-close>×</button>
    </div>
    <div class="customer-kpis">
      <div><span>未关单商机</span><strong>${activeOpps.length}</strong></div>
      <div><span>商机金额</span><strong>${openAmount.toLocaleString("zh-CN")}</strong></div>
      <div><span>拜访记录</span><strong>${visits.length}</strong></div>
    </div>
    <div class="customer-meta">
      ${customerMetaItem("负责人", account.ownerName)}
      ${customerMetaItem("电话", displayTextValue(account.phone))}
      ${customerMetaItem("省市", [displayTextValue(account.province), displayTextValue(account.city)].filter(Boolean).join(" · "))}
      ${customerMetaItem("地址", account.address)}
      ${customerMetaItem("网站", account.website)}
      ${customerMetaItem("最近拜访", latestVisit ? `${latestVisit.date} · ${latestVisit.owner}` : formatCrmDate(account.recentVisitDate))}
      ${customerMetaItem("CRM更新", formatCrmDate(account.updatedAt))}
      ${customerMetaItem("CRM ID", account.accountId || "-")}
    </div>
    <section class="preview-section">
      <h3>相关商机</h3>
      <div class="preview-stack">
        ${previewList(opportunities, (item) => `
          <article class="preview-row">
            <div><strong>${escapeHtml(item.stage || "未填阶段")} · ${escapeHtml(item.owner)}</strong><span>${escapeHtml(item.progress || item.need || "暂无跟进内容")}</span></div>
            <em>${number(item.amount).toLocaleString("zh-CN")}</em>
          </article>
        `, "暂无相关商机")}
      </div>
    </section>
    <section class="preview-section">
      <h3>拜访记录</h3>
      <div class="preview-stack">
        ${previewList(visits.slice().reverse(), (item) => `
          <article class="preview-row">
            <div><strong>${escapeHtml(item.date)} · ${escapeHtml(item.method || "拜访")}</strong><span>${escapeHtml(item.points || item.purpose || "暂无沟通要点")}</span></div>
            <em>${escapeHtml(item.score ? `${item.score}分` : "")}</em>
          </article>
        `, "暂无拜访记录")}
      </div>
    </section>
    <section class="preview-section">
      <h3>日报动作</h3>
      <div class="preview-stack">
        ${previewList(reports.slice().reverse(), (item) => `
          <article class="preview-row">
            <div><strong>${escapeHtml(item.date)} · ${escapeHtml(item.owner)}</strong><span>${escapeHtml(item.tomorrowPlan || item.extraWork || "暂无日报动作")}</span></div>
          </article>
        `, "暂无日报动作")}
      </div>
    </section>
  `;
  drawer.classList.add("open");
  drawer.setAttribute("aria-hidden", "false");
}

function closeCustomerPreview() {
  const drawer = document.querySelector("#customerDrawer");
  drawer?.classList.remove("open");
  drawer?.setAttribute("aria-hidden", "true");
}

function beginVisitCellEdit(cell) {
  if (!cell || cell.querySelector(".sheet-editor")) return;
  const row = cell.closest("tr[data-visit-id]");
  const record = state.visitRecords.find((item) => item.id === row?.dataset.visitId);
  if (!record) return;
  const field = cell.dataset.visitField;
  const type = cell.dataset.editorType;
  if (field === "customer") {
    beginAccountCellEdit(cell, record.customer || "", (account) => {
      rememberCrmAccounts([account]);
      record.customer = account.accountName || record.customer || "";
      record.accountId = account.accountId || "";
      record.crmSyncStatus = record.accountId ? "pending" : "local";
      record.crmRecordId = "";
      record.crmSyncError = "";
      saveState();
      renderVisits();
      renderSync();
    });
    return;
  }
  const editor = createVisitEditor(field, type, record[field] || "");
  const commit = () => {
    updateVisitFromCell(cell, editor.value);
  };
  editor.addEventListener("blur", commit, { once: true });
  editor.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && type !== "textarea") {
      event.preventDefault();
      editor.blur();
    }
    if (event.key === "Escape") {
      event.preventDefault();
      renderVisits();
    }
  });
  cell.innerHTML = "";
  cell.append(editor);
  editor.focus();
  if (editor.select) editor.select();
}

function createVisitEditor(field, type, value) {
  if (field === "owner") return createSelectEditor(visibleOwners().length ? visibleOwners() : state.users, value);
  if (field === "method") return createSelectEditor(["线上", "线下", "电话", "微信", "到访"], value);
  return createOpportunityEditor(field, type, value);
}

function updateVisitFromCell(cell, value) {
  const field = cell.dataset.visitField;
  if (!field) return;
  const row = cell.closest("tr[data-visit-id]");
  const record = state.visitRecords.find((item) => item.id === row?.dataset.visitId);
  if (!record) return;
  record[field] = field === "score" ? number(value) : value;
  if (record.accountId && record.crmSyncStatus === "synced") {
    record.crmSyncStatus = "pending";
    record.crmSyncError = "";
  }
  saveState();
  renderVisits();
  renderDashboard();
  renderAi();
  renderSync();
}

function createSelectEditor(options, value, labels = {}) {
  const select = document.createElement("select");
  select.className = "sheet-editor";
  options.forEach((option) => {
    const item = document.createElement("option");
    item.value = option;
    item.textContent = labels[option] || option;
    item.selected = option === value;
    select.append(item);
  });
  return select;
}

function updateOpportunityFromCell(cell, value) {
  const field = cell.dataset.opportunityField;
  if (!field) return;
  const row = cell.closest("tr[data-opportunity-id]");
  const opportunity = state.opportunities.find((item) => item.id === row?.dataset.opportunityId);
  if (!opportunity) return;
  opportunity[field] = ["amount", "score"].includes(field) ? number(value) : value;
  if (field === "stage" && ["已成交", "已丢单"].includes(value)) opportunity.status = "closed";
  if (field === "status" && value === "open" && ["已成交", "已丢单"].includes(opportunity.stage)) opportunity.stage = "合同推进";
  opportunity.updatedAt = TODAY;
  opportunity.crmSyncStatus = opportunity.accountId ? "pending" : "local";
  opportunity.crmSyncError = opportunity.accountId ? "" : "缺少CRM客户ID，请先匹配CRM客户";
  saveState();
  renderOpportunities();
  renderDashboard();
  renderAi();
  renderSync();
  renderDailyOpportunities();
}

document.querySelector("#addOpportunityButton").addEventListener("click", () => {
  document.querySelector("#opportunityDialog").showModal();
});

document.querySelector("#addOnlineButton").addEventListener("click", () => {
  const owners = visibleOwners().length ? visibleOwners() : state.users;
  const owner = owners[state.onlineRecords.length % owners.length];
  const views = 900 + state.onlineRecords.length * 180;
  state.onlineRecords.push({
    id: uid("on"),
    date: TODAY,
    owner,
    platform: "小红书",
    posts: 1,
    views,
    likes: Math.round(views * 0.04),
    saves: Math.round(views * 0.02),
    comments: Math.round(views * 0.006),
    messages: Math.round(views * 0.008),
    leads: Math.max(1, Math.round(views / 800)),
    source: "手工录入"
  });
  saveState();
  render();
  switchView("online");
});

document.querySelector("#mockOnlineSyncButton").addEventListener("click", () => {
  state.onlineRecords = state.onlineRecords.concat(
    (visibleOwners().length ? visibleOwners() : state.users).slice(0, 2).map((owner, index) => {
      const views = 1200 + index * 420;
      return {
        id: uid("sync"),
        date: TODAY,
        owner,
        platform: "小红书",
        posts: 1,
        views,
        likes: Math.round(views * 0.045),
        saves: Math.round(views * 0.024),
        comments: Math.round(views * 0.007),
        messages: Math.round(views * 0.01),
        leads: 2 + index,
        source: "模拟接口同步"
      };
    })
  );
  saveState();
  render();
});

document.querySelector("#opportunityForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const opportunity = Object.fromEntries(form.entries());
  opportunity.id = uid("o");
  opportunity.amount = number(opportunity.amount);
  opportunity.grade = inferOpportunityGrade(opportunity);
  opportunity.score = inferOpportunityScore(opportunity);
  opportunity.estimatedCloseDate = "";
  opportunity.status = "open";
  opportunity.updatedAt = TODAY;
  state.opportunities.push(opportunity);
  saveState();
  event.currentTarget.reset();
  document.querySelector("#opportunityDialog").close();
  render();
});

document.querySelector("#seedButton").addEventListener("click", () => {
  state = structuredClone(seedState);
  saveState();
  render();
});

document.querySelector("#mockSyncButton").addEventListener("click", () => {
  addSyncEvent({ status: "mocked", title: "模拟同步任务", detail: "已生成一条演示用 CRM 同步任务" });
  saveState();
  renderSyncLog();
  alert("已模拟生成 CRM 同步任务。正式接入时可改为调用 CRM API。");
});

function crmSyncErrorMessage(result) {
  if (!result) return "CRM拜访同步失败";
  const payload = result.detail?.crmPayload || {};
  const crmText = payload.errorInfo || payload.msg || payload.message || payload.error_description || "";
  const fieldText = result.detail?.requestData
    ? `字段：${Object.keys(result.detail.requestData).join("、")}`
    : "";
  return [result.error, crmText, fieldText].filter(Boolean).join("；") || "CRM拜访同步失败";
}

async function syncVisitBatch(pendingVisits, { silent = false } = {}) {
  if (!USE_SHARED_STATE || !authState.loggedIn) {
    alert("请先在顶部完成 CRM 登录，再同步拜访记录。");
    return;
  }
  if (!pendingVisits.length) {
    alert("暂无可同步的拜访记录。请先在拜访客户名称中选择CRM客户。");
    return;
  }
  pendingVisits.forEach((item) => {
    item.crmSyncStatus = "syncing";
    item.crmSyncError = "";
  });
  saveState();
  renderVisits();
  renderSync();
  renderSyncRetryList();
  renderStorageStatus();

  try {
    const response = await fetch(CRM_VISITS_API, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ visits: pendingVisits })
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "CRM拜访同步失败");
    const results = new Map((payload.results || []).map((item) => [item.localId, item]));
    pendingVisits.forEach((visit) => {
      const result = results.get(visit.id);
      if (result?.status === "synced") {
        visit.crmSyncStatus = "synced";
        visit.crmRecordId = result.crmRecordId || "已创建";
        visit.crmSyncError = "";
      } else {
        visit.crmSyncStatus = "failed";
        visit.crmSyncError = crmSyncErrorMessage(result);
      }
    });
    addSyncEvent({
      status: "crm-visits",
      title: "拜访同步到CRM",
      detail: `成功 ${payload.success || 0} 条，失败 ${payload.failed || 0} 条`,
      success: payload.success,
      failed: payload.failed
    });
    saveState();
    render();
    if (!silent) alert(`拜访同步完成：成功 ${payload.success || 0} 条，失败 ${payload.failed || 0} 条。`);
  } catch (error) {
    pendingVisits.forEach((visit) => {
      visit.crmSyncStatus = "failed";
      visit.crmSyncError = error.message || "CRM拜访同步失败";
    });
    addSyncEvent({
      status: "crm-visits-failed",
      title: "拜访同步失败",
      detail: error.message || "CRM拜访同步失败",
      failed: pendingVisits.length
    });
    saveState();
    renderVisits();
    renderSync();
    renderSyncRetryList();
    renderStorageStatus();
    if (!silent) alert(error.message || "CRM拜访同步失败");
  }
}

function crmActionErrorMessage(result) {
  if (!result) return "CRM动作同步失败";
  const payload = result.detail?.crmPayload || {};
  const crmText = payload.errorInfo || payload.msg || payload.message || payload.error_description || "";
  const fieldText = result.detail?.requestData
    ? `字段：${Object.keys(result.detail.requestData).join("、")}`
    : "";
  return [result.error, crmText, fieldText].filter(Boolean).join("；") || "CRM动作同步失败";
}

async function syncCrmActions(actions, label, { silent = false } = {}) {
  if (!USE_SHARED_STATE || !authState.loggedIn) {
    alert("请先在顶部完成 CRM 登录，再同步CRM动作。");
    return;
  }
  const eligible = actions.filter((item) => item.accountId);
  if (!eligible.length) {
    alert("暂无可同步的CRM动作。请先在客户字段匹配CRM客户。");
    return;
  }
  eligible.forEach((item) => {
    item.sourceRecord.crmSyncStatus = "syncing";
    item.sourceRecord.crmSyncError = "";
  });
  saveState();
  renderSync();
  renderSyncRetryList();
  renderStorageStatus();

  try {
    const response = await fetch(CRM_ACTIONS_API, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ actions: eligible.map(({ sourceRecord, ...action }) => action) })
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || `${label}同步失败`);
    const results = new Map((payload.results || []).map((item) => [item.localId, item]));
    eligible.forEach((action) => {
      const result = results.get(action.localId);
      if (result?.status === "synced") {
        action.sourceRecord.crmSyncStatus = "synced";
        action.sourceRecord.crmRecordId = result.crmRecordId || "已创建";
        action.sourceRecord.crmSyncError = "";
      } else {
        action.sourceRecord.crmSyncStatus = "failed";
        action.sourceRecord.crmSyncError = crmActionErrorMessage(result);
      }
    });
    addSyncEvent({
      status: "crm-actions",
      title: `${label}同步到CRM`,
      detail: `成功 ${payload.success || 0} 条，失败 ${payload.failed || 0} 条`,
      success: payload.success,
      failed: payload.failed
    });
    saveState();
    render();
    if (!silent) alert(`${label}同步完成：成功 ${payload.success || 0} 条，失败 ${payload.failed || 0} 条。`);
  } catch (error) {
    eligible.forEach((action) => {
      action.sourceRecord.crmSyncStatus = "failed";
      action.sourceRecord.crmSyncError = error.message || `${label}同步失败`;
    });
    addSyncEvent({
      status: "crm-actions-failed",
      title: `${label}同步失败`,
      detail: error.message || `${label}同步失败`,
      failed: eligible.length
    });
    saveState();
    render();
    if (!silent) alert(error.message || `${label}同步失败`);
  }
}

document.querySelector("#syncVisitsButton")?.addEventListener("click", async () => {
  const pendingVisits = state.visitRecords.filter((item) => canSeeOwner(item.owner) && item.accountId && item.crmSyncStatus !== "synced");
  await syncVisitBatch(pendingVisits);
});

document.querySelector("#syncOpportunityActionsButton")?.addEventListener("click", async () => {
  await syncCrmActions(pendingOpportunityActions(), "商机推进");
});

document.querySelector("#syncDailyActionsButton")?.addEventListener("click", async () => {
  await syncCrmActions(pendingDailyCrmActions(), "日报动作");
});

document.querySelector("#syncRetryList")?.addEventListener("click", async (event) => {
  const id = event.target.closest("[data-retry-visit]")?.dataset.retryVisit;
  if (id) {
    const visit = state.visitRecords.find((item) => item.id === id && canSeeOwner(item.owner));
    if (!visit) return;
    await syncVisitBatch([visit]);
    return;
  }
  const opportunityActionId = event.target.closest("[data-retry-opportunity-action]")?.dataset.retryOpportunityAction;
  if (opportunityActionId) {
    const action = pendingOpportunityActions().find((item) => item.localId === opportunityActionId);
    if (action) await syncCrmActions([action], "商机推进");
    return;
  }
  const dailyActionId = event.target.closest("[data-retry-daily-action]")?.dataset.retryDailyAction;
  if (dailyActionId) {
    const action = pendingDailyCrmActions().find((item) => item.localId === dailyActionId);
    if (action) await syncCrmActions([action], "日报动作");
  }
});

document.querySelector("#exportDataButton")?.addEventListener("click", () => {
  const payload = {
    exportedAt: new Date().toISOString(),
    app: "salesdaywork",
    version: 1,
    data: state
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `salesdaywork-backup-${TODAY}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
});

document.querySelector("#importDataButton")?.addEventListener("click", () => {
  document.querySelector("#importDataFile")?.click();
});

document.querySelector("#refreshSharedDataButton")?.addEventListener("click", async () => {
  if (!USE_SHARED_STATE) {
    alert("当前是本地预览模式，线上地址会自动使用云端共享数据。");
    return;
  }
  await hydrateSharedState();
  alert(sharedStateStatus.mode === "shared" ? "已刷新云端数据。" : "云端数据暂不可用，当前仍使用本地数据。");
});

document.querySelector("#syncAccountsButton")?.addEventListener("click", async () => {
  if (!USE_SHARED_STATE || !authState.loggedIn) {
    alert("请先在顶部完成 CRM 登录，再同步名下客户。");
    return;
  }
  accountCacheStatus = { count: 0, syncedAt: "", message: "正在同步CRM客户..." };
  renderStorageStatus();
  try {
    const response = await fetch(CRM_ACCOUNTS_API, { method: "POST" });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "CRM客户同步失败");
    accountCacheStatus = {
      count: payload.count || 0,
      syncedAt: payload.syncedAt || "",
      message: `已同步 ${payload.count || 0} 个CRM客户`
    };
    rememberCrmAccounts(payload.accounts || []);
    addSyncEvent({
      status: "crm-accounts",
      title: "CRM客户缓存已同步",
      detail: `同步 ${payload.count || 0} 个名下客户`,
      success: payload.count || 0,
      failed: 0
    });
    saveState();
    renderStorageStatus();
    alert(`已同步 ${payload.count || 0} 个CRM客户。拜访填写时可直接搜索匹配。`);
  } catch (error) {
    accountCacheStatus = { count: 0, syncedAt: "", message: error.message || "CRM客户同步失败" };
    renderStorageStatus();
    alert(accountCacheStatus.message);
  }
});

document.querySelector("#importDataFile")?.addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    const imported = parsed.data || parsed;
    if (!isImportableState(imported)) {
      alert("导入失败：文件结构不符合当前系统数据格式。");
      return;
    }
    state = normalizeState(imported);
    saveState();
    render();
    switchView("dashboard");
    alert("已导入数据，当前看板和各业务表已刷新。");
  } catch {
    alert("导入失败：请确认选择的是 JSON 数据文件。");
  } finally {
    event.target.value = "";
  }
});

function isImportableState(value) {
  return Boolean(
    value &&
      Array.isArray(value.users) &&
      Array.isArray(value.reports) &&
      Array.isArray(value.opportunities) &&
      Array.isArray(value.visitRecords) &&
      Array.isArray(value.onlineRecords)
  );
}

render();
hydrateSharedState();
hydrateAuth();
