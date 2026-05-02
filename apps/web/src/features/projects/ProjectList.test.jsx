import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { ProjectList } from "./ProjectList.jsx";

describe("ProjectList", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("loads projects, search, and create via modal", async () => {
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
        const created = { id: "p-2", name: body.name, key: body.key };
        state.items = [...state.items, created];
        return { ok: true, json: async () => created };
      }
      return { ok: true, json: async () => ({ items: state.items }) };
    });

    render(() => <ProjectList />);
    await waitFor(() => {
      expect(screen.getByText("Core Platform")).toBeInTheDocument();
      expect(screen.getByText("CORE")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText("Project search"), { target: { value: "Other" } });
    expect(screen.queryByText("Core Platform")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Project search"), { target: { value: "" } });
    expect(screen.getByText("Core Platform")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "创建项目" }));
    expect(screen.getByRole("dialog", { name: "创建项目" })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Project name"), { target: { value: "Mobile" } });
    fireEvent.change(screen.getByLabelText("Project key"), { target: { value: "MOB" } });
    const modal = screen.getByRole("dialog", { name: "创建项目" });
    fireEvent.click(within(modal).getByRole("button", { name: /创\s*建/ }));

    await waitFor(() => {
      expect(screen.getByText("Mobile")).toBeInTheDocument();
      expect(screen.getByText("MOB")).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "创建项目" })).not.toBeInTheDocument();
    });
  });
});
