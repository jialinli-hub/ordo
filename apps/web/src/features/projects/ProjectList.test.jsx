import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { ProjectList } from "./ProjectList.jsx";

describe("ProjectList", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("loads projects and create with inline name-only form", async () => {
    const state = {
      items: [{ id: "p-1", name: "Core Platform", key: "CORE" }]
    };

    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, options = {}) => {
      const requestUrl = String(url);
      const method = options.method || "GET";
      if (requestUrl.includes("/api/projects") && method === "GET") {
        return { ok: true, json: async () => ({ items: state.items }) };
      }
      if (requestUrl.endsWith("/api/projects") && method === "POST") {
        const body = JSON.parse(options.body);
        const created = { id: "p-2", name: body.name };
        state.items = [...state.items, created];
        return { ok: true, json: async () => created };
      }
      return { ok: true, json: async () => ({ items: state.items }) };
    });

    render(() => <ProjectList />);
    await waitFor(() => {
      expect(screen.getByText("Core Platform")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText("项目名称"), { target: { value: "Mobile" } });
    fireEvent.click(screen.getByRole("button", { name: "创建" }));

    await waitFor(() => {
      expect(screen.getByText("Mobile")).toBeInTheDocument();
    });
  });
});
