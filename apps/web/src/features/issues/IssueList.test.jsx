import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { IssueList } from "./IssueList.jsx";

const MOCK_ISSUE_VIEW_PREFS = {
  viewMode: "list",
  listGroupBy: "status",
  orderBy: "priority",
  orderDesc: false,
  showEmptyBoardColumns: false,
  columns: {
    id: true,
    status: true,
    assignee: true,
    priority: true,
    project: true,
    cycle: true,
    estimate: true,
    labels: true,
    dueDate: true,
    created: false,
    updated: false
  }
};

function issueViewPrefsResponse() {
  const body = JSON.stringify({ prefs: MOCK_ISSUE_VIEW_PREFS });
  return {
    ok: true,
    text: async () => body,
    json: async () => ({ prefs: MOCK_ISSUE_VIEW_PREFS })
  };
}

function mockCoreFetch() {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (url, options = {}) => {
    const requestUrl = String(url);
    if (requestUrl.includes("/api/issues") && !options.method && !requestUrl.includes("/api/issues/")) {
      return {
        ok: true,
        json: async () => ({
          items: [
            {
              id: "i-1",
              title: "Fix auth bug",
              status: "todo",
              type: "feature",
              priority: 2,
              projectId: "p-1",
              issueNumber: 1,
              createdAt: "2026-01-01",
              updatedAt: "2026-01-02"
            }
          ]
        })
      };
    }
    if (requestUrl.includes("/api/projects")) {
      return { ok: true, json: async () => ({ items: [{ id: "p-1", name: "Core", key: "COR" }] }) };
    }
    if (requestUrl.includes("/api/teams")) {
      return { ok: true, json: async () => ({ items: [{ id: "t-1", name: "Platform Team" }] }) };
    }
    if (requestUrl.includes("/api/cycles")) {
      return { ok: true, json: async () => ({ items: [] }) };
    }
    if (requestUrl.includes("/api/issue-view-preferences")) {
      if ((options.method || "").toUpperCase() === "PUT") {
        return issueViewPrefsResponse();
      }
      return issueViewPrefsResponse();
    }
    if (requestUrl.includes("/api/profile")) {
      return { ok: true, json: async () => ({ id: "u-1", name: "Test", email: "test@example.com" }) };
    }
    if (requestUrl.includes("/api/workspaces/") && requestUrl.includes("/members")) {
      return { ok: true, json: async () => ({ items: [{ userId: "u-1", name: "Alice" }] }) };
    }
    return { ok: true, json: async () => ({ items: [] }) };
  });
}

describe("IssueList", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders issue titles from api response", async () => {
    mockCoreFetch();

    render(() => <IssueList teamId="t-1" />);

    await waitFor(() => {
      expect(screen.getByText("Fix auth bug")).toBeInTheDocument();
    });
  });

  it("creates issue via dropdown and modal form", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, options = {}) => {
      const requestUrl = String(url);
      if (requestUrl.includes("/api/issues") && !options.method && requestUrl.includes("teamId=")) {
        return {
          ok: true,
          json: async () => ({
            items: [{ id: "i-1", title: "Fix auth bug", status: "todo", type: "feature", priority: 2 }]
          })
        };
      }
      if (requestUrl.includes("/api/projects")) {
        return { ok: true, json: async () => ({ items: [{ id: "p-1", name: "Core", key: "COR" }] }) };
      }
      if (requestUrl.includes("/api/cycles")) {
        return { ok: true, json: async () => ({ items: [] }) };
      }
      if (requestUrl.includes("/api/issue-view-preferences")) {
        const body = JSON.stringify({ prefs: MOCK_ISSUE_VIEW_PREFS });
        return { ok: true, text: async () => body, json: async () => JSON.parse(body) };
      }
      if (requestUrl.includes("/api/issues") && options.method === "POST") {
        return { ok: true, json: async () => ({ id: "i-2" }) };
      }
      return { ok: true, json: async () => ({ items: [] }) };
    });

    render(() => <IssueList teamId="t-1" teamName="TREX" workspaceId="w-1" />);

    await screen.findByText("Fix auth bug");

    fireEvent.click(screen.getByRole("button", { name: "打开新建任务菜单" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "新增任务" }));

    fireEvent.change(screen.getByLabelText("Issue title"), { target: { value: "新增任务" } });
    fireEvent.click(screen.getByRole("button", { name: "创建任务" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/api/issues"),
        expect.objectContaining({ method: "POST" })
      );
    });
  });

  it("filters issues by search text in right filter panel", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, options = {}) => {
      const requestUrl = String(url);
      if (requestUrl.includes("/api/issues") && !options.method) {
        return {
          ok: true,
          json: async () => ({
            items: [
              { id: "i-1", title: "Fix auth bug", status: "todo", type: "feature", priority: 2 },
              { id: "i-2", title: "Build search panel", status: "in_progress", type: "chore", priority: 3 }
            ]
          })
        };
      }
      if (requestUrl.includes("/api/projects")) {
        return { ok: true, json: async () => ({ items: [{ id: "p-1", name: "Core", key: "COR" }] }) };
      }
      if (requestUrl.includes("/api/cycles")) {
        return { ok: true, json: async () => ({ items: [] }) };
      }
      if (requestUrl.includes("/api/issue-view-preferences")) {
        return issueViewPrefsResponse();
      }
      return { ok: true, json: async () => ({ items: [{ id: "t-1", name: "Platform Team" }] }) };
    });

    render(() => <IssueList teamId="t-1" />);

    await screen.findAllByText("Fix auth bug");
    fireEvent.click(screen.getAllByRole("button", { name: "筛选任务" })[0]);
    fireEvent.change(screen.getByLabelText("Search issues"), { target: { value: "search" } });

    expect(screen.queryByText("Fix auth bug")).not.toBeInTheDocument();
    expect(screen.getByText("Build search panel")).toBeInTheDocument();
  });
});
