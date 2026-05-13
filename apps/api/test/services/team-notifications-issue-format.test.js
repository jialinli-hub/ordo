const test = require("node:test");
const assert = require("node:assert/strict");
const {
  formatIssueNotify,
  buildIssueDeepLink,
  buildProjectDeepLink,
  buildWorkspaceHomeDeepLink,
  buildCyclesListDeepLink,
  formatCycleNotifyCreated,
  formatProjectNotify
} = require("../../src/services/teamNotifications");

test("buildIssueDeepLink: root /issues path + encoded issuesId (no workspace slug)", () => {
  assert.equal(
    buildIssueDeepLink({
      publicBase: "https://app.example.com/",
      workspaceUrlSlug: "trex",
      issuesId: "PLAT-1"
    }),
    "https://app.example.com/issues/PLAT-1"
  );
});

test("buildIssueDeepLink encodes special characters in issuesId", () => {
  assert.equal(
    buildIssueDeepLink({
      publicBase: "https://app.example.com",
      workspaceUrlSlug: "trex",
      issuesId: "RAW#1"
    }),
    `https://app.example.com/issues/${encodeURIComponent("RAW#1")}`
  );
});

test("buildProjectDeepLink", () => {
  assert.equal(
    buildProjectDeepLink({
      publicBase: "https://app.example.com/",
      workspaceUrlSlug: "acme",
      projectId: "p-uuid-9"
    }),
    "https://app.example.com/acme/projects/p-uuid-9"
  );
});

test("buildWorkspaceHomeDeepLink", () => {
  assert.equal(
    buildWorkspaceHomeDeepLink("https://app.example.com/", "trex"),
    "https://app.example.com/trex/"
  );
});

test("buildCyclesListDeepLink", () => {
  assert.equal(
    buildCyclesListDeepLink("https://app.example.com", "trex", { id: "1", name: "Core" }),
    "https://app.example.com/trex/workspace/teams/core/cycles"
  );
});

test("formatIssueNotify created: action+type icons, 迭代优先, @dingTalkUserId", () => {
  const { text, atMobiles, atUserIds } = formatIssueNotify({
    action: "created",
    issuesId: "PLAT-9",
    issueType: "feature",
    title: "修复导出",
    status: "todo",
    actor: { name: "Alice" },
    assignee: { name: "Bob", dingTalkUserId: "userid-88" },
    estimateHours: 2.5,
    dueDate: new Date("2026-06-01T08:00:00.000Z"),
    cycleName: "Sprint 1",
    projectKey: "ISA",
    issueUrl: "https://app.example.com/issues/PLAT-9"
  });
  assert.ok(text.startsWith("Ordo\n\n"));
  assert.ok(text.includes("✨📌任务 PLAT-9"));
  assert.ok(text.includes("修复导出"));
  assert.ok(text.includes("创建人：Alice"));
  assert.ok(text.includes("承接人：@userid-88 Bob"));
  assert.ok(text.includes("预估工时：2.5 小时"));
  assert.ok(text.includes("截止时间："));
  assert.ok(text.includes("迭代：Sprint 1"));
  assert.ok(!text.includes("项目：ISA"));
  assert.ok(text.includes("落地页：https://app.example.com/issues/PLAT-9"));
  assert.deepEqual(atUserIds, ["userid-88"]);
  assert.deepEqual(atMobiles, []);
});

test("formatIssueNotify created: bug type uses 🐛", () => {
  const { text } = formatIssueNotify({
    action: "created",
    issuesId: "B-1",
    issueType: "bug",
    title: "x",
    actor: { name: "A" },
    assignee: null,
    estimateHours: null,
    dueDate: null,
    cycleName: null,
    projectKey: "P",
    issueUrl: "https://x/y"
  });
  assert.ok(text.includes("✨🐛任务 B-1"));
});

test("formatIssueNotify commented", () => {
  const { text } = formatIssueNotify({
    action: "commented",
    issuesId: "T-1",
    issueType: "chore",
    title: " housekeeping",
    commentBody: "hello\nworld",
    commenter: { name: "U" },
    assignee: null,
    issueUrl: "https://a/b"
  });
  assert.ok(text.includes("💬📋任务 T-1"));
  assert.ok(text.includes("评论人：U"));
  assert.ok(text.includes("评论摘要：hello world"));
});

test("formatIssueNotify completed", () => {
  const { text } = formatIssueNotify({
    action: "completed",
    issuesId: "T-2",
    issueType: "feature",
    title: "Done",
    actor: { name: "Closer" },
    assignee: { name: "Self", dingTalkUserId: "u1" },
    cycleName: null,
    projectKey: "PRJ",
    issueUrl: "https://z"
  });
  assert.ok(text.includes("✅📌任务 T-2"));
  assert.ok(text.includes("完成操作：Closer"));
  assert.ok(text.includes("项目：PRJ"));
});

test("formatIssueNotify created: 无迭代时展示项目", () => {
  const { text } = formatIssueNotify({
    action: "created",
    issuesId: "ISA-1",
    issueType: "feature",
    title: "T",
    actor: { name: "A" },
    assignee: null,
    estimateHours: null,
    dueDate: null,
    cycleName: null,
    projectKey: "ISA",
    issueUrl: ""
  });
  assert.ok(text.includes("项目：ISA"));
  assert.ok(!text.includes("迭代："));
});

test("formatCycleNotifyCreated includes landing", () => {
  const t = formatCycleNotifyCreated({
    name: "S1",
    startsAt: "2026-01-01T00:00:00.000Z",
    endsAt: "2026-01-14T00:00:00.000Z",
    status: "active",
    projectKey: "K",
    landingUrl: "https://app.example.com/ws/workspace/teams/t/cycles"
  });
  assert.ok(t.startsWith("Ordo\n\n"));
  assert.ok(t.includes("🔄 新建迭代 S1"));
  assert.ok(t.includes("落地页：https://app.example.com/ws/workspace/teams/t/cycles"));
});

test("formatProjectNotify created / deleted", () => {
  const c = formatProjectNotify({
    action: "created",
    name: "P1",
    key: "P1K",
    landingUrl: "https://x/ws/"
  });
  assert.ok(c.includes("📁 新建项目 P1"));
  assert.ok(c.includes("标识：P1K"));
  assert.ok(c.includes("落地页：https://x/ws/"));
  const d = formatProjectNotify({
    action: "deleted",
    name: "P1",
    key: "P1K",
    landingUrl: "https://x/ws/"
  });
  assert.ok(d.includes("🗑️ 已删除项目 P1"));
});

test("formatIssueNotify rejects unknown action", () => {
  assert.throws(() => formatIssueNotify({ action: "updated", issuesId: "x" }), /unsupported action/);
});
