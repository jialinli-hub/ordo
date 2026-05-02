import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { CycleList } from "./CycleList.jsx";

describe("CycleList", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("supports cycle creation and displays cycle summary stats", async () => {
    const cycles = [
      {
        id: "c-1",
        name: "Sprint 1",
        status: "active",
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
      expect(screen.getByText("Current")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "创建 Cycle" }));
    fireEvent.input(screen.getByLabelText("Cycle name"), { target: { value: "Sprint 2" } });
    fireEvent.input(screen.getByLabelText("Cycle startsAt"), { target: { value: "2026-05-01" } });
    fireEvent.input(screen.getByLabelText("Cycle endsAt"), { target: { value: "2026-05-14" } });
    const modal = screen.getByRole("dialog", { name: "创建 Cycle" });
    fireEvent.click(within(modal).getByRole("button", { name: /创\s*建/ }));

    await waitFor(() => {
      expect(screen.getByText("Sprint 2")).toBeInTheDocument();
      expect(screen.getByText("Upcoming")).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(screen.getByText("完成率 63%")).toBeInTheDocument();
      expect(screen.getAllByText("总任务 8").length).toBeGreaterThan(0);
      expect(screen.getAllByText("进行中 2").length).toBeGreaterThan(0);
      expect(screen.getAllByText("已完成 5").length).toBeGreaterThan(0);
      expect(screen.getByText("评审中 1")).toBeInTheDocument();
      expect(screen.getByText("8 scope")).toBeInTheDocument();
    });
  });
});
