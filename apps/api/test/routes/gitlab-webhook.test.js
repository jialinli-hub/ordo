const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { beforeEach } = require("node:test");
const app = require("../../src/app");
const { prisma } = require("../../src/repositories/prisma");
const { resetDatabase } = require("../helpers/reset-database");

/** 测试报告：GitLab 模拟载荷摘要 + 任务状态变化（便于人工核对） */
function reportGitlabScenario(title, sections) {
  const pad = "=".repeat(14);
  const lines = [`\n${pad} ${title} ${pad}`];
  for (const [heading, body] of sections) {
    lines.push(`— ${heading} —`);
    lines.push(typeof body === "string" ? body : JSON.stringify(body, null, 2));
  }
  lines.push(`${pad}${"=".repeat(title.length + 2)}${pad}\n`);
  // eslint-disable-next-line no-console
  console.log(lines.join("\n"));
}

beforeEach(async () => {
  await resetDatabase();
});

test("GitLab webhook should move issue status by rules (extract id from MR title)", async () => {
  const authHeaders = {
    Authorization: "Bearer dev-dingtalk:alice@example.com",
    "x-organization-id": "org-gitlab"
  };

  const teamRes = await request(app).post("/api/teams").set(authHeaders).send({ name: "Core Team" });
  assert.equal(teamRes.statusCode, 201);

  const projectRes = await request(app)
    .post("/api/projects")
    .set(authHeaders)
    .send({ name: "Issue Platform", key: "COR" });
  assert.equal(projectRes.statusCode, 201);

  const issueRes = await request(app).post("/api/issues").set(authHeaders).send({
    projectId: projectRes.body.id,
    teamId: teamRes.body.id,
    title: "Initial task"
  });
  assert.equal(issueRes.statusCode, 201);
  assert.equal(issueRes.body.status, "todo");
  assert.ok(typeof issueRes.body.issues_id === "string" && issueRes.body.issues_id.length > 0);

  const saveWorkflowRes = await request(app)
    .patch(`/api/teams/${encodeURIComponent(teamRes.body.id)}?workspaceId=${encodeURIComponent(teamRes.body.workspaceId)}`)
    .set(authHeaders)
    .send({
      workflowAutomations: {
        gitlab: {
          enabled: true,
          secret: "s3cr3t",
          rules: {
            onPrOpen: "in_review"
          },
          branchRules: []
        }
      }
    });
  assert.equal(saveWorkflowRes.statusCode, 200);

  const webhookPayload = {
    object_kind: "merge_request",
    object_attributes: {
      action: "open",
      state: "opened",
      title: `${issueRes.body.issues_id} Implement something`,
      description: "",
      source_branch: `feature/${issueRes.body.issues_id}-x`,
      target_branch: "main",
      draft: false
    }
  };

  reportGitlabScenario("MR 打开：从标题解析任务号 → onPrOpen", [
    [
      "1) 已创建任务（Webhook 之前）",
      {
        issueId: issueRes.body.id,
        issues_id: issueRes.body.issues_id,
        status: issueRes.body.status,
        title: issueRes.body.title
      }
    ],
    [
      "2) 模拟 GitLab：Merge Request Hook 载荷摘要",
      {
        object_kind: webhookPayload.object_kind,
        x_gitlab_event: "Merge Request Hook",
        title: webhookPayload.object_attributes.title,
        source_branch: webhookPayload.object_attributes.source_branch,
        target_branch: webhookPayload.object_attributes.target_branch,
        action: webhookPayload.object_attributes.action,
        state: webhookPayload.object_attributes.state
      }
    ]
  ]);

  const hookRes = await request(app)
    .post(`/api/integrations/gitlab/webhook/${encodeURIComponent(teamRes.body.id)}`)
    .set("X-Gitlab-Token", "s3cr3t")
    .set("X-Gitlab-Event", "Merge Request Hook")
    .send(webhookPayload);

  assert.equal(hookRes.statusCode, 200);
  assert.equal(hookRes.body.ok, true);
  assert.equal(hookRes.body.trigger, "onPrOpen");
  assert.equal(hookRes.body.desiredStatus, "in_review");
  assert.equal(hookRes.body.updatedCount, 1);

  const updatedIssueRes = await request(app).get(`/api/issues/${issueRes.body.id}`).set(authHeaders);
  assert.equal(updatedIssueRes.statusCode, 200);
  assert.equal(updatedIssueRes.body.status, "in_review");

  reportGitlabScenario("MR 打开：Webhook 结果与任务状态", [
    ["3) POST /api/integrations/gitlab/webhook/:teamId 响应", hookRes.body],
    [
      "4) 任务状态变化",
      { before: "todo", after: updatedIssueRes.body.status, issueId: issueRes.body.id }
    ]
  ]);
});

test("GitLab webhook (mock Push Hook) should accept new-branch push and match issue key from branch name", async () => {
  const authHeaders = {
    Authorization: "Bearer dev-dingtalk:alice@example.com",
    "x-organization-id": "org-gitlab-branch"
  };

  const teamRes = await request(app).post("/api/teams").set(authHeaders).send({ name: "Branch Team", identifier: "BRT" });
  assert.equal(teamRes.statusCode, 201);
  const teamId = teamRes.body.id;
  const workspaceId = teamRes.body.workspaceId;

  const projectRes = await request(app)
    .post("/api/projects")
    .set(authHeaders)
    .send({ name: "GL Branch Proj", key: "GBP" });
  assert.equal(projectRes.statusCode, 201);

  const issueRes = await request(app).post("/api/issues").set(authHeaders).send({
    projectId: projectRes.body.id,
    teamId,
    title: "Branch workflow task"
  });
  assert.equal(issueRes.statusCode, 201);
  const key = issueRes.body.issues_id;

  const saveWorkflowRes = await request(app)
    .patch(`/api/teams/${encodeURIComponent(teamId)}?workspaceId=${encodeURIComponent(workspaceId)}`)
    .set(authHeaders)
    .send({
      workflowAutomations: {
        gitlab: {
          enabled: true,
          secret: "branch-secret",
          rules: {
            onPrActivity: "in_progress"
          },
          branchRules: []
        }
      }
    });
  assert.equal(saveWorkflowRes.statusCode, 200);

  /** Mock：GitLab 首次 push 到新分支（before 全 0），任务号在分支名中 */
  const newBranchPushMock = {
    object_kind: "push",
    event_name: "push",
    before: "0000000000000000000000000000000000000000",
    after: "1a2b3c4d5e6f7890abcdef1234567890abcdabcd",
    ref: `refs/heads/feature/${key}-gitlab-new-branch`,
    checkout_sha: "1a2b3c4d5e6f7890abcdef1234567890abcdabcd",
    user_id: 1,
    user_name: "Alice",
    user_username: "alice",
    user_email: "alice@example.com",
    project: {
      id: 99,
      name: "mock-proj",
      path_with_namespace: "acme/mock-proj",
      web_url: "https://gitlab.example/acme/mock-proj",
      git_http_url: "https://gitlab.example/acme/mock-proj.git",
      git_ssh_url: "git@gitlab.example:acme/mock-proj.git"
    },
    commits: [
      {
        id: "1a2b3c4d5e6f7890abcdef1234567890abcdabcd",
        message: "chore: create branch for issue",
        title: "chore: create branch for issue",
        timestamp: "2026-05-10T12:00:00+00:00",
        url: `https://gitlab.example/acme/mock-proj/-/commit/1a2b3c4d5e6f7890abcdef1234567890abcdabcd`
      }
    ],
    total_commits_count: 1
  };

  reportGitlabScenario("Push Hook：新分支首次推送（before 全 0）→ onPrActivity", [
    [
      "1) 已创建任务",
      { issueId: issueRes.body.id, issues_id: key, status: issueRes.body.status, title: issueRes.body.title }
    ],
    [
      "2) 模拟 GitLab：Push Hook 载荷摘要",
      {
        object_kind: newBranchPushMock.object_kind,
        event_name: newBranchPushMock.event_name,
        ref: newBranchPushMock.ref,
        before: newBranchPushMock.before,
        after: newBranchPushMock.after,
        commits: (newBranchPushMock.commits || []).map((c) => ({
          id: c.id,
          message: c.message,
          url: c.url
        })),
        project: newBranchPushMock.project?.path_with_namespace
      }
    ]
  ]);

  const hookRes = await request(app)
    .post(`/api/integrations/gitlab/webhook/${encodeURIComponent(teamId)}`)
    .set("X-Gitlab-Token", "branch-secret")
    .set("X-Gitlab-Event", "Push Hook")
    .send(newBranchPushMock);

  assert.equal(hookRes.statusCode, 200);
  assert.equal(hookRes.body.ok, true);
  assert.equal(hookRes.body.trigger, "onPrActivity");
  assert.equal(hookRes.body.desiredStatus, "in_progress");
  assert.equal(hookRes.body.updatedCount, 1);
  assert.ok((hookRes.body.matchedIssueKeys || []).includes(key));

  const updatedIssueRes = await request(app).get(`/api/issues/${issueRes.body.id}`).set(authHeaders);
  assert.equal(updatedIssueRes.statusCode, 200);
  assert.equal(updatedIssueRes.body.status, "in_progress");

  reportGitlabScenario("Push Hook：处理结果与任务状态", [
    ["3) Webhook 响应", hookRes.body],
    ["4) 任务状态变化", { before: "todo", after: updatedIssueRes.body.status, matchedIssueKeys: hookRes.body.matchedIssueKeys }]
  ]);
});

test('GitLab Push Hook: commit message contains "Ref TREX-123" and links to issue TREX-123', async () => {
  const authHeaders = {
    Authorization: "Bearer dev-dingtalk:alice@example.com",
    "x-organization-id": "org-gitlab-ref-trex"
  };

  const teamRes = await request(app).post("/api/teams").set(authHeaders).send({ name: "T-Rex Team", identifier: "TREX" });
  assert.equal(teamRes.statusCode, 201);
  const teamId = teamRes.body.id;
  const workspaceId = teamRes.body.workspaceId;

  const projectRes = await request(app)
    .post("/api/projects")
    .set(authHeaders)
    .send({ name: "Ref Commit Proj", key: "RCP" });
  assert.equal(projectRes.statusCode, 201);

  const issueRes = await request(app).post("/api/issues").set(authHeaders).send({
    projectId: projectRes.body.id,
    teamId,
    title: "Task linked via Ref in commit message"
  });
  assert.equal(issueRes.statusCode, 201);
  assert.equal(issueRes.body.issues_id, "TREX-1");

  /** 将首条任务改为 TREX-123，模拟已存在编号 123 的任务（无需创建 122 条占位） */
  await prisma.issue.update({
    where: { id: issueRes.body.id },
    data: { issuesId: "TREX-123", issueNumber: 123 }
  });
  await prisma.issueNumberCounter.updateMany({
    where: { workspaceId, scopeKey: "identifier:TREX" },
    data: { current: 123 }
  });

  const saveWorkflowRes = await request(app)
    .patch(`/api/teams/${encodeURIComponent(teamId)}?workspaceId=${encodeURIComponent(workspaceId)}`)
    .set(authHeaders)
    .send({
      workflowAutomations: {
        gitlab: {
          enabled: true,
          secret: "ref-trex-secret",
          rules: { onPrActivity: "in_progress" },
          branchRules: []
        }
      }
    });
  assert.equal(saveWorkflowRes.statusCode, 200);

  const commitMessage = "docs: see Ref TREX-123 for the checklist (GitLab-style cross-reference)";
  const pushPayload = {
    object_kind: "push",
    event_name: "push",
    before: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    after: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    ref: "refs/heads/main",
    user_name: "dev",
    project: {
      id: 501,
      name: "rex-app",
      path_with_namespace: "dyno/rex-app",
      web_url: "https://gitlab.example/dyno/rex-app"
    },
    commits: [
      {
        id: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        message: commitMessage,
        title: commitMessage.split("\n")[0],
        timestamp: "2026-05-11T12:00:00+00:00",
        url: "https://gitlab.example/dyno/rex-app/-/commit/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
      }
    ],
    total_commits_count: 1
  };

  reportGitlabScenario('Push：commit message 含 "Ref TREX-123" → 关联 TREX-123', [
    [
      "1) 工作区内任务键（由 API 创建后改为 TREX-123）",
      { issueId: issueRes.body.id, issues_id: "TREX-123", statusBeforeWebhook: "todo" }
    ],
    [
      "2) 模拟 GitLab Push：commits[].message",
      { message: commitMessage, ref: pushPayload.ref, branch: "main" }
    ]
  ]);

  const hookRes = await request(app)
    .post(`/api/integrations/gitlab/webhook/${encodeURIComponent(teamId)}`)
    .set("X-Gitlab-Token", "ref-trex-secret")
    .set("X-Gitlab-Event", "Push Hook")
    .send(pushPayload);

  assert.equal(hookRes.statusCode, 200);
  assert.equal(hookRes.body.ok, true);
  assert.equal(hookRes.body.trigger, "onPrActivity");
  assert.equal(hookRes.body.desiredStatus, "in_progress");
  assert.equal(hookRes.body.updatedCount, 1);
  assert.ok((hookRes.body.matchedIssueKeys || []).includes("TREX-123"));

  const updatedIssueRes = await request(app).get(`/api/issues/${issueRes.body.id}`).set(authHeaders);
  assert.equal(updatedIssueRes.statusCode, 200);
  assert.equal(updatedIssueRes.body.issues_id, "TREX-123");
  assert.equal(updatedIssueRes.body.status, "in_progress");

  reportGitlabScenario("Push：Ref TREX-123 处理结果", [
    ["3) Webhook 响应", hookRes.body],
    ["4) 任务状态", { issues_id: updatedIssueRes.body.issues_id, status: updatedIssueRes.body.status }]
  ]);
});

test("GitLab webhook (mock MR Hook) should accept merge event and apply onMerge rule", async () => {
  const authHeaders = {
    Authorization: "Bearer dev-dingtalk:alice@example.com",
    "x-organization-id": "org-gitlab-mr-merge"
  };

  const teamRes = await request(app).post("/api/teams").set(authHeaders).send({ name: "MR Merge Team", identifier: "MMT" });
  assert.equal(teamRes.statusCode, 201);
  const teamId = teamRes.body.id;
  const workspaceId = teamRes.body.workspaceId;

  const projectRes = await request(app)
    .post("/api/projects")
    .set(authHeaders)
    .send({ name: "MR Merge Proj", key: "MMP" });
  assert.equal(projectRes.statusCode, 201);

  const issueRes = await request(app).post("/api/issues").set(authHeaders).send({
    projectId: projectRes.body.id,
    teamId,
    title: "MR merge task"
  });
  assert.equal(issueRes.statusCode, 201);
  const key = issueRes.body.issues_id;

  const saveWorkflowRes = await request(app)
    .patch(`/api/teams/${encodeURIComponent(teamId)}?workspaceId=${encodeURIComponent(workspaceId)}`)
    .set(authHeaders)
    .send({
      workflowAutomations: {
        gitlab: {
          enabled: true,
          secret: "merge-secret",
          rules: {
            onMerge: "done",
            onPrOpen: "in_review"
          },
          branchRules: []
        }
      }
    });
  assert.equal(saveWorkflowRes.statusCode, 200);

  /** Mock：GitLab MR 合并后 Hook（action/state 与官方文档一致） */
  const mrMergedMock = {
    object_kind: "merge_request",
    user: { name: "Bob", username: "bob" },
    project: {
      id: 42,
      name: "mock-app",
      path_with_namespace: "acme/mock-app",
      web_url: "https://gitlab.example/acme/mock-app"
    },
    object_attributes: {
      id: 9001,
      iid: 12,
      action: "merge",
      state: "merged",
      title: `${key} ship feature`,
      description: "Merged via mock",
      source_branch: `feature/${key}-impl`,
      target_branch: "main",
      draft: false,
      url: `https://gitlab.example/acme/mock-app/-/merge_requests/12`,
      last_commit: {
        id: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
        message: `Merge branch '${key}'`,
        author: { name: "Bob" }
      }
    }
  };

  reportGitlabScenario("MR 合并：action=merge → onMerge", [
    [
      "1) 已创建任务",
      { issueId: issueRes.body.id, issues_id: key, status: issueRes.body.status, title: issueRes.body.title }
    ],
    [
      "2) 模拟 GitLab：MR Hook（合并）载荷摘要",
      {
        object_kind: mrMergedMock.object_kind,
        x_gitlab_event: "Merge Request Hook",
        title: mrMergedMock.object_attributes.title,
        action: mrMergedMock.object_attributes.action,
        state: mrMergedMock.object_attributes.state,
        source_branch: mrMergedMock.object_attributes.source_branch,
        url: mrMergedMock.object_attributes.url
      }
    ]
  ]);

  const hookRes = await request(app)
    .post(`/api/integrations/gitlab/webhook/${encodeURIComponent(teamId)}`)
    .set("X-Gitlab-Token", "merge-secret")
    .set("X-Gitlab-Event", "Merge Request Hook")
    .send(mrMergedMock);

  assert.equal(hookRes.statusCode, 200);
  assert.equal(hookRes.body.ok, true);
  assert.equal(hookRes.body.trigger, "onMerge");
  assert.equal(hookRes.body.desiredStatus, "done");
  assert.equal(hookRes.body.updatedCount, 1);

  const updatedIssueRes = await request(app).get(`/api/issues/${issueRes.body.id}`).set(authHeaders);
  assert.equal(updatedIssueRes.statusCode, 200);
  assert.equal(updatedIssueRes.body.status, "done");

  reportGitlabScenario("MR 合并：处理结果与任务状态", [
    ["3) Webhook 响应", hookRes.body],
    ["4) 任务状态变化", { before: "todo", after: updatedIssueRes.body.status }]
  ]);
});

test("GitLab workspace webhook should log delivery and gitlab_event on push", async () => {
  const authHeaders = {
    Authorization: "Bearer dev-dingtalk:alice@example.com",
    "x-organization-id": "org-gitlab-ws"
  };

  const teamRes = await request(app).post("/api/teams").set(authHeaders).send({ name: "Ws Team", identifier: "WST" });
  assert.equal(teamRes.statusCode, 201);
  const workspaceId = teamRes.body.workspaceId;

  const mine = await request(app).get("/api/workspaces/mine").set(authHeaders);
  assert.equal(mine.statusCode, 200);
  const ws = mine.body.items.find((x) => x.id === workspaceId);
  assert.ok(ws);

  const patchWs = await request(app)
    .patch(`/api/workspaces/${encodeURIComponent(workspaceId)}`)
    .set(authHeaders)
    .send({
      name: ws.name,
      url: ws.url,
      gitlabIntegration: { enabled: true, secret: "ws-secret-99" }
    });
  assert.equal(patchWs.statusCode, 200);

  const projectRes = await request(app)
    .post("/api/projects")
    .set(authHeaders)
    .send({ name: "GL WS Proj", key: "GWP" });
  assert.equal(projectRes.statusCode, 201);

  const issueRes = await request(app).post("/api/issues").set(authHeaders).send({
    projectId: projectRes.body.id,
    teamId: teamRes.body.id,
    title: "Task for ws hook"
  });
  assert.equal(issueRes.statusCode, 201);
  const key = issueRes.body.issues_id;

  const pushPayload = {
    object_kind: "push",
    ref: "refs/heads/main",
    user_name: "dev",
    project: { name: "p", path_with_namespace: "grp/p", web_url: "https://gitlab.example/grp/p" },
    commits: [{ id: "abc", message: `fix ${key}`, url: "https://gitlab.example/c" }],
    total_commits_count: 1
  };

  reportGitlabScenario("Workspace 级 Webhook：Push（提交信息含任务号）", [
    [
      "1) 已创建任务",
      { issueId: issueRes.body.id, issues_id: key, status: issueRes.body.status, title: issueRes.body.title }
    ],
    [
      "2) 模拟 GitLab：Push Hook（workspace 路由）",
      {
        object_kind: pushPayload.object_kind,
        ref: pushPayload.ref,
        commits: pushPayload.commits,
        path: `/api/integrations/gitlab/webhook/workspace/${workspaceId}`
      }
    ]
  ]);

  const hookRes = await request(app)
    .post(`/api/integrations/gitlab/webhook/workspace/${encodeURIComponent(workspaceId)}`)
    .set("X-Gitlab-Token", "ws-secret-99")
    .set("X-Gitlab-Event", "Push Hook")
    .send(pushPayload);

  assert.equal(hookRes.statusCode, 200);
  assert.equal(hookRes.body.ok, true);
  assert.ok((hookRes.body.matchedIssueKeys || []).includes(key));

  const detailRes = await request(app).get(`/api/issues/${encodeURIComponent(issueRes.body.id)}`).set(authHeaders);
  assert.equal(detailRes.statusCode, 200);
  const types = (detailRes.body.activity || []).map((a) => a.type);
  assert.ok(types.includes("gitlab_event"));

  const delRes = await request(app)
    .get(`/api/workspaces/${encodeURIComponent(workspaceId)}/gitlab/deliveries?limit=5`)
    .set(authHeaders);
  assert.equal(delRes.statusCode, 200);
  assert.ok((delRes.body.items || []).length >= 1);

  reportGitlabScenario("Workspace Push：投递记录与活动类型", [
    ["3) Webhook 响应", hookRes.body],
    [
      "4) 任务活动（含 gitlab_event）",
      { activityTypes: (detailRes.body.activity || []).map((a) => a.type) }
    ],
    ["5) deliveries 最近一条摘要", (delRes.body.items || [])[0] || {}]
  ]);
});

