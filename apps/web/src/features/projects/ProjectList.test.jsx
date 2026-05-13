import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { ProjectList } from "./ProjectList.jsx";

describe("ProjectList", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("loads project cards and creates via modal", async () => {
    const state = {
      items: [
        {
          id: "p-1",
          name: "Core Platform",
          description: "Desc",
          lead: { id: "u-1", name: "Ada", email: "ada@test" },
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z"
        }
      ]
    };

    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, options = {}) => {
      const requestUrl = String(url);
      const method = options.method || "GET";
      if (requestUrl.includes("/api/projects") && method === "GET") {
        return { ok: true, json: async () => ({ items: state.items }) };
      }
      if (requestUrl.endsWith("/api/projects") && method === "POST") {
        const body = JSON.parse(options.body ?? "{}");
        const created = {
          id: "p-2",
          name: body.name,
          description: body.description || null,
          lead: {
            id: body.leadUserId,
            name: "Ada",
            email: "ada@test"
          },
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z"
        };
        state.items = [created, ...state.items];
        return { ok: true, json: async () => created };
      }
      if (requestUrl.includes("/api/workspaces/") && requestUrl.includes("/members")) {
        return {
          ok: true,
          json: async () => ({
            items: [{ userId: "u-1", name: "Ada", role: "owner", joinedAt: "2026-01-01T00:00:00.000Z" }]
          })
        };
      }
      return { ok: true, json: async () => ({ items: [] }) };
    });

    render(() => <ProjectList workspaceId="ws-test" />);
    await waitFor(() => {
      expect(screen.getByText("Core Platform")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "新建项目" }));
    await waitFor(() => expect(screen.getByRole("dialog", { name: "新建项目" })).toBeInTheDocument());

    const dlg = screen.getByRole("dialog", { name: "新建项目" });
    fireEvent.change(within(dlg).getByLabelText("项目名称"), { target: { value: "Mobile" } });
    fireEvent.change(within(dlg).getByLabelText("负责人"), { target: { value: "u-1" } });
    fireEvent.click(within(dlg).getByRole("button", { name: "创建" }));

    await waitFor(() => {
      expect(screen.getByText("Mobile")).toBeInTheDocument();
    });
  });
});
