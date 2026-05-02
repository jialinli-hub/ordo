import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { CycleList } from "./CycleList.jsx";

describe("CycleList", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("cycleView current shows only the current iteration", async () => {
    const t = Date.now();
    const cycles = [
      {
        id: "c-active",
        name: "Active sprint",
        startsAt: new Date(t - 86400000).toISOString(),
        endsAt: new Date(t + 86400000).toISOString(),
        summary: { totalIssues: 1, doneIssues: 0, completionRate: 0 }
      },
      {
        id: "c-future",
        name: "Future sprint",
        startsAt: new Date(t + 10 * 86400000).toISOString(),
        endsAt: new Date(t + 24 * 86400000).toISOString(),
        summary: { totalIssues: 0, doneIssues: 0, completionRate: 0 }
      }
    ];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const requestUrl = String(url);
      if (requestUrl.includes("/api/cycles")) {
        return { ok: true, json: async () => ({ items: cycles }) };
      }
      return { ok: true, json: async () => ({ items: [] }) };
    });

    render(() => <CycleList teamId="t-1" cycleView="current" />);
    await waitFor(() => {
      expect(screen.getByText("Active sprint")).toBeInTheDocument();
    });
    expect(screen.queryByText("Future sprint")).not.toBeInTheDocument();
    expect(screen.getByText("按状态")).toBeInTheDocument();
    expect(screen.getByText("按类别")).toBeInTheDocument();
    expect(screen.getByText("工时")).toBeInTheDocument();
  });

  it("cycleView upcoming shows only the next planned iteration", async () => {
    const t = Date.now();
    const cycles = [
      {
        id: "c-near",
        name: "Next sprint",
        startsAt: new Date(t + 2 * 86400000).toISOString(),
        endsAt: new Date(t + 14 * 86400000).toISOString(),
        summary: { totalIssues: 0, doneIssues: 0, completionRate: 0 }
      },
      {
        id: "c-later",
        name: "Later sprint",
        startsAt: new Date(t + 40 * 86400000).toISOString(),
        endsAt: new Date(t + 54 * 86400000).toISOString(),
        summary: { totalIssues: 0, doneIssues: 0, completionRate: 0 }
      }
    ];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const requestUrl = String(url);
      if (requestUrl.includes("/api/cycles")) {
        return { ok: true, json: async () => ({ items: cycles }) };
      }
      return { ok: true, json: async () => ({ items: [] }) };
    });

    render(() => <CycleList teamId="t-1" cycleView="upcoming" />);
    await waitFor(() => {
      expect(screen.getByText("Next sprint")).toBeInTheDocument();
    });
    expect(screen.queryByText("Later sprint")).not.toBeInTheDocument();
  });

  it("supports cycle creation and displays cycle summary stats", async () => {
    const t = Date.now();
    const toDateInput = (d) => {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      return `${y}-${m}-${day}`;
    };
    const cycles = [
      {
        id: "c-1",
        name: "Sprint 1",
        status: "active",
        startsAt: new Date(t - 5 * 86400000).toISOString(),
        endsAt: new Date(t + 20 * 86400000).toISOString(),
        summary: {
          totalIssues: 8,
          doneIssues: 5,
          inProgressIssues: 2,
          inReviewIssues: 1,
          todoIssues: 0,
          completionRate: 62.5,
          scopeCount: 8
        }
      }
    ];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, options = {}) => {
      const requestUrl = String(url);
      const method = options.method || "GET";
      if (method === "POST" && requestUrl.includes("/api/cycles")) {
        const body = JSON.parse(String(options.body));
        expect(body.teamId).toBe("t-1");
        cycles.push({
          id: "c-2",
          name: body.name,
          status: "planned",
          startsAt: new Date(body.startsAt).toISOString(),
          endsAt: new Date(body.endsAt).toISOString(),
          summary: {
            totalIssues: 0,
            doneIssues: 0,
            inProgressIssues: 0,
            inReviewIssues: 0,
            todoIssues: 0,
            completionRate: 0,
            scopeCount: 0
          }
        });
        return { ok: true, json: async () => cycles[cycles.length - 1] };
      }
      if (method === "GET" && requestUrl.includes("/api/cycles")) {
        return { ok: true, json: async () => ({ items: cycles }) };
      }
      return { ok: true, json: async () => ({ items: cycles }) };
    });

    render(() => <CycleList teamId="t-1" />);
    await waitFor(() => {
      expect(screen.getByText("Sprint 1")).toBeInTheDocument();
      expect(screen.getByText("当前")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "创建 Cycle" }));
    fireEvent.input(screen.getByLabelText("Cycle name"), { target: { value: "Sprint 2" } });
    const sprint2Start = new Date(t + 30 * 86400000);
    const sprint2End = new Date(t + 50 * 86400000);
    fireEvent.input(screen.getByLabelText("Cycle startsAt"), { target: { value: toDateInput(sprint2Start) } });
    fireEvent.input(screen.getByLabelText("Cycle endsAt"), { target: { value: toDateInput(sprint2End) } });
    const modal = screen.getByRole("dialog", { name: "创建 Cycle" });
    fireEvent.click(within(modal).getByRole("button", { name: /创\s*建/ }));

    await waitFor(() => {
      expect(screen.getByText("Sprint 2")).toBeInTheDocument();
      expect(screen.getByText("未开始")).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(screen.getByText(/5\s*\/\s*8\s*·\s*63\s*%/)).toBeInTheDocument();
      expect(screen.getByText(/完成率\s*63\s*%/)).toBeInTheDocument();
      expect(screen.getByText(/任务\s*8/)).toBeInTheDocument();
      expect(screen.getByText(/已完成\s*5/)).toBeInTheDocument();
    });
  });
});
