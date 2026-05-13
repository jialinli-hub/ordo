import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@solidjs/testing-library";
import { IssueDetail } from "./IssueDetail.jsx";

function issueResponse(overrides = {}) {
  const body = JSON.stringify({
    id: "i-1",
    organizationId: "o",
    workspaceId: "w",
    teamId: "t",
    projectId: "p-1",
    cycleId: null,
    title: "Demo",
    description: null,
    status: "in_progress",
    priority: 2,
    type: "feature",
    estimateHours: null,
    assigneeId: null,
    labels: [],
    dueDate: null,
    identifier: "TP",
    issues_id: "TP-1",
    issueNumber: 1,
    numberScope: "identifier:TP",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    comments: [],
    activity: [],
    attachments: [],
    subtasks: [],
    ...overrides
  });
  return {
    ok: true,
    status: 200,
    text: async () => body,
    json: async () => JSON.parse(body)
  };
}

describe("IssueDetail", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("status select should reflect issue status", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const requestUrl = String(url);
      if (requestUrl.includes("/api/issues/")) {
        return issueResponse({ status: "in_progress" });
      }
      if (requestUrl.includes("/api/profile")) {
        const body = JSON.stringify({ id: "u-1", name: "Test", email: "test@example.com" });
        return { ok: true, status: 200, text: async () => body, json: async () => JSON.parse(body) };
      }
      return { ok: true, status: 200, json: async () => ({ items: [] }) };
    });

    render(() => (
      <IssueDetail
        issueId="i-1"
        teamId="t-1"
        teamName="Team"
        workspacePathPrefix=""
        projects={[{ id: "p-1", name: "Core", key: "COR" }]}
        cycles={[]}
        members={[]}
      />
    ));

    await waitFor(() => {
      expect(screen.getByRole("combobox", { name: "状态" })).toBeInTheDocument();
    });

    const sel = screen.getByRole("combobox", { name: "状态" });
    expect(sel.value).toBe("in_progress");
  });

  it("shows GitLab development panel when activity contains merge_request", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const requestUrl = String(url);
      if (requestUrl.includes("/api/issues/")) {
        return issueResponse({
          activity: [
            {
              id: "a-1",
              type: "gitlab_event",
              userId: null,
              createdAt: "2026-01-05T12:00:00.000Z",
              payload: {
                eventKind: "merge_request",
                title: "Fix TP-1 thing",
                url: "https://gitlab.example.com/grp/p/-/merge_requests/3",
                sourceBranch: "fix-tp-1",
                targetBranch: "main",
                project: { path_with_namespace: "grp/p" }
              }
            }
          ]
        });
      }
      if (requestUrl.includes("/api/profile")) {
        const body = JSON.stringify({ id: "u-1", name: "Test", email: "test@example.com" });
        return { ok: true, status: 200, text: async () => body, json: async () => JSON.parse(body) };
      }
      return { ok: true, status: 200, json: async () => ({ items: [] }) };
    });

    render(() => (
      <IssueDetail
        issueId="TP-1"
        teamId="t-1"
        teamName="Team"
        workspacePathPrefix=""
        projects={[{ id: "p-1", name: "Core", key: "TP" }]}
        cycles={[]}
        members={[]}
      />
    ));

    await waitFor(() => {
      expect(screen.getByRole("region", { name: "GitLab 开发与合并" })).toBeInTheDocument();
    });
    expect(screen.getByText("Fix TP-1 thing")).toBeInTheDocument();
    const mrLink = screen.getByRole("link", { name: "合并请求" });
    expect(mrLink.getAttribute("href")).toBe("https://gitlab.example.com/grp/p/-/merge_requests/3");
  });
});

