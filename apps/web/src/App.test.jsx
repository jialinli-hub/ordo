import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import App from "./App.jsx";

/** 使用 `vi.fn` 替换 fetch，afterEach 还原为真实实现，避免与其他用例互相污染。 */
const savedFetch = globalThis.fetch.bind(globalThis);

/** 与 apps/web/src/api/client.js 一致：`window.fetch` 对齐 `globalThis`。 */
function shadowWindowFetch() {
  if (typeof window !== "undefined") {
    window.fetch = globalThis.fetch;
  }
}

/** 在未二次 spy 的前提下，重写当前 fetch mock 的实现（用例内特化）。 */
function setFetchImplementation(impl) {
  globalThis.fetch.mockImplementation(impl);
  shadowWindowFetch();
}

/** readJsonBody 优先读 text；与真实 Response 对齐，避免隐式原型上坏的 text()/空 body */
function jsonResponse(payload, status = 200) {
  const s = JSON.stringify(payload);
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => s,
    json: async () => JSON.parse(s)
  };
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem("ordo_access_token", "dev-dingtalk:test@example.com");
  /** 跳过静默注册 POST，减少与 `/api/workspaces/mine` 等请求的 effect 竞态 */
  sessionStorage.setItem("ordo_session_bootstrapped", "1");
  /**
   * 列表类响应仅 json()（无 text），readJsonBody 会走 json 分支。
   */
  globalThis.fetch = vi.fn(async function fetchStub(input, init = {}) {
    const requestUrl =
      typeof input === "string"
        ? input
        : input && typeof input === "object" && typeof input.url === "string"
          ? input.url
          : String(input);
    const method = String(init?.method || (typeof input !== "string" && input?.method ? input.method : "") || "GET").toUpperCase();
    const postBody = typeof init?.body === "string" ? init.body : "{}";

    if (requestUrl.includes("/api/auth/dingtalk") && !requestUrl.includes("exchange-code")) {
      return jsonResponse({
        accessToken: "dev-dingtalk:test@example.com",
        tokenType: "id_token",
        user: { id: "u", email: "test@example.com", name: "test" },
        workspace: { id: "w", organizationId: "o", name: "ws", url: "trex", key: null }
      });
    }
    if (requestUrl.includes("/api/workspaces/mine")) {
      return jsonResponse({
        items: [
          { id: "trex", name: "trex", url: "trex" },
          { id: "loa", name: "loa", url: "loa" }
        ]
      });
    }

    if (requestUrl.includes("/api/teams?workspaceId=loa")) {
      return jsonResponse({ items: [{ id: "loa-core", name: "loa-core" }] });
    }

    if (requestUrl.includes("/api/teams?workspaceId=trex")) {
      return jsonResponse({ items: [{ id: "trex-product", name: "trex-product" }] });
    }

    if (/\/api\/teams\/[^/?]+\?/.test(requestUrl)) {
      const idMatch = requestUrl.match(/\/api\/teams\/([^/?]+)/);
      const teamIdRaw = idMatch ? idMatch[1] : "team";
      const q = requestUrl.includes("?") ? requestUrl.slice(requestUrl.indexOf("?") + 1) : "";
      const wid = decodeURIComponent(new URLSearchParams(q).get("workspaceId") || "trex");
      return jsonResponse({
        id: decodeURIComponent(teamIdRaw),
        workspaceId: wid,
        name: decodeURIComponent(teamIdRaw),
        identifier: "TP",
        accentColor: "#4f46e5",
        iterationDurationDays: 14,
        cooldownDays: 2,
        autoCreateDailyCycles: true,
        issueLabels: [{ name: "bug", color: "#dc2626" }],
        issueStatuses: [{ key: "todo", label: "Todo" }],
        iterationStartWeekday: 1
      });
    }

    if (requestUrl.includes("/api/workspaces/") && requestUrl.includes("/members")) {
      return jsonResponse({
        items: [{ userId: "u1", name: "test", role: "owner", joinedAt: "2026-01-01T00:00:00.000Z" }]
      });
    }

    if (requestUrl.includes("/api/profile") && method === "GET") {
      return jsonResponse({ id: "u", name: "测试用户", email: "test@example.com" });
    }

    if (requestUrl.includes("/api/issues/my-pending-work")) {
      return jsonResponse({ total: 0, items: [] });
    }

    if (requestUrl.includes("/api/issues") && method === "GET") {
      return jsonResponse({ items: [], pageInfo: { total: 0 } });
    }

    if (requestUrl.includes("/api/search/quick")) {
      return jsonResponse({ projects: [], issues: [] });
    }

    if (requestUrl.includes("/api/projects") && method === "GET") {
      return jsonResponse({
        items: [{ id: "trex-product", name: "trex-product", key: "TP", description: null, lead: null }]
      });
    }

    if (requestUrl.includes("/api/projects") && method === "POST") {
      let name = "new-project";
      try {
        name = JSON.parse(postBody)?.name ?? name;
      } catch {
        /* ignore */
      }
      return jsonResponse({
        id: `p-${Date.now()}`,
        name,
        description: null,
        lead: { id: "u1", name: "test", email: "test@example.com" },
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z"
      });
    }

    return jsonResponse({
      items: [{ id: "trex-product", name: "trex-product", key: "TP", description: null, lead: null }]
    });
  });

  shadowWindowFetch();
});

afterEach(() => {
  cleanup();
  globalThis.fetch = savedFetch;
  if (typeof window !== "undefined") {
    window.fetch = savedFetch;
  }
});

describe("App shell pages", () => {
  it("test build uses empty VITE_API_BASE_URL for stable /api relative requests", () => {
    expect(import.meta.env.VITE_API_BASE_URL ?? "").toBe("");
  });

  it("renders projects home page by default", async () => {
    window.history.replaceState({}, "", "/");
    expect(localStorage.getItem("ordo_access_token")).toBeTruthy();

    render(() => <App />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Projects", level: 1 })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /^菜单：/ })).toBeInTheDocument();
      const panel = document.querySelector(".project-panel");
      expect(panel).toBeTruthy();
      expect(within(panel).getByText("trex-product")).toBeInTheDocument();
    });
  });

  it("renders team settings page for team route", async () => {
    window.history.replaceState({}, "", "/teams/trex-product/settings");

    render(() => <App />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "trex-product", level: 1 })).toBeInTheDocument();
    });
    expect(screen.getByText("General")).toBeInTheDocument();
    expect(screen.getByText("Members")).toBeInTheDocument();
    expect(screen.getByText("Issue labels")).toBeInTheDocument();
    expect(screen.getByText("Issue statuses")).toBeInTheDocument();
  });

  it("redirects legacy /settings/teams to first team settings", async () => {
    window.history.replaceState({}, "", "/settings/teams");

    render(() => <App />);

    await waitFor(() => {
      expect(window.location.pathname).toBe("/trex/workspace/teams/trex-product/settings");
    });
    expect(screen.getByRole("heading", { name: "trex-product", level: 1 })).toBeInTheDocument();
  });

  it("shows team navigation without views or team projects", async () => {
    window.history.replaceState({}, "", "/");

    render(() => <App />);

    await waitFor(() => {
      const titleNodes = screen.getAllByText("trex-product");
      expect(titleNodes.length).toBeGreaterThan(0);
    });
    expect(screen.queryByText("Issues")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "展开团队 trex-product" }));
    expect(screen.getByText("Issues")).toBeInTheDocument();
    expect(screen.getByText("Cycles")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Team settings" })).toBeInTheDocument();
    expect(screen.queryByText("Views")).not.toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Projects" }).length).toBe(1);
  });

  it("jumps to create team page when plus button is clicked", async () => {
    window.history.replaceState({}, "", "/");

    render(() => <App />);

    const button = await screen.findByRole("button", { name: "Open team actions" });
    fireEvent.click(button);

    await waitFor(() => {
      expect(window.location.pathname).toBe("/trex/settings/teams/new");
      expect(screen.getByRole("heading", { name: "Create a new team", level: 1 })).toBeInTheDocument();
    });
    expect(screen.getAllByLabelText("Team name").length).toBeGreaterThan(0);
    expect(screen.getByLabelText("Identifier")).toBeInTheDocument();
    expect(screen.queryByLabelText("Parent team")).not.toBeInTheDocument();
  });

  it("shows projects page with create modal (name, description, lead)", async () => {
    window.history.replaceState({}, "", "/");

    render(() => <App />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Projects", level: 1 })).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "新建项目" })).toBeInTheDocument();
    expect(screen.queryByLabelText("项目名称")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "新建项目" }));
    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: "新建项目" })).toBeInTheDocument();
    });
    const dialog = screen.getByRole("dialog", { name: "新建项目" });
    expect(within(dialog).getByLabelText("项目名称")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("项目描述")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("负责人")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "创建" })).toBeInTheDocument();
    const main = screen.getByRole("heading", { name: "Projects", level: 1 }).closest(".page-wrap");
    expect(main).toBeTruthy();
    expect(within(main).queryByLabelText("迭代名称")).not.toBeInTheDocument();
    expect(within(main).queryByLabelText("Issue title")).not.toBeInTheDocument();
  });

  it("navigates to team settings from sidebar link", async () => {
    window.history.replaceState({}, "", "/");

    render(() => <App />);

    await screen.findAllByText("trex-product");
    fireEvent.click(screen.getByRole("button", { name: "展开团队 trex-product" }));
    const teamSettingsLink = await screen.findByRole("link", { name: "Team settings" });
    fireEvent.click(teamSettingsLink);

    await waitFor(() => {
      expect(window.location.pathname).toBe("/trex/workspace/teams/trex-product/settings");
    });
    expect(screen.getByText("General")).toBeInTheDocument();
  });

  it("opens workspace switch modal and switches workspace", async () => {
    window.history.replaceState({}, "", "/");

    render(() => <App />);

    fireEvent.click(await screen.findByRole("button", { name: /^Workspace 菜单/ }));
    fireEvent.click(await screen.findByText("切换 Workspace"));
    fireEvent.click(screen.getByRole("radio", { name: "loa" }));
    fireEvent.click(screen.getByRole("button", { name: "确认切换" }));

    await waitFor(() => {
      expect(screen.getByText("loa-core")).toBeInTheDocument();
    });
    const sideNav = screen.getByText("Your teams").closest("aside");
    expect(within(sideNav).queryByText("trex-product")).not.toBeInTheDocument();
  });

  it("navigates to workspace create and settings pages from workspace menu", async () => {
    window.history.replaceState({}, "", "/");
    render(() => <App />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Projects", level: 1 })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: /^Workspace 菜单/ }));
    fireEvent.click(await screen.findByText("新建 Workspace"));
    expect(screen.getByRole("dialog", { name: "新建 Workspace" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^Workspace 菜单/ }));
    fireEvent.click(await screen.findByText("Workspace settings"));
    await waitFor(() => {
      expect(window.location.pathname).toBe("/trex/settings/workspaces");
    });
    expect(screen.getByRole("heading", { name: "Workspace settings", level: 1 })).toBeInTheDocument();
  });

  it("updates current workspace name and url in settings", async () => {
    window.history.replaceState({}, "", "/");
    setFetchImplementation(async (url, options = {}) => {
      const requestUrl = String(url);
      if (requestUrl.includes("/api/profile")) {
        return { ok: true, json: async () => ({ id: "u", name: "测试用户", email: "test@example.com" }) };
      }
      if (requestUrl.includes("/api/issues/my-pending-work")) {
        return { ok: true, json: async () => ({ total: 0, items: [] }) };
      }
      if (requestUrl.includes("/api/workspaces/mine")) {
        return {
          ok: true,
          json: async () => ({
            items: [{ id: "trex", name: "trex", url: "trex" }]
          })
        };
      }
      if (requestUrl.includes("/api/workspaces/trex") && options.method === "PATCH") {
        return {
          ok: true,
          json: async () => ({ id: "trex", name: "Trex Prime", url: "trex-prime" })
        };
      }
      if (requestUrl.includes("/api/teams?workspaceId=trex")) {
        return {
          ok: true,
          json: async () => ({ items: [{ id: "trex-product", name: "trex-product" }] })
        };
      }
      return { ok: true, json: async () => ({ items: [] }) };
    });

    render(() => <App />);
    fireEvent.click(await screen.findByRole("button", { name: /^菜单：/ }));
    fireEvent.click(await screen.findByText("Workspace 设置"));
    await screen.findByRole("heading", { name: "Workspace settings", level: 1 });

    fireEvent.change(screen.getByLabelText("Workspace settings name"), { target: { value: "Trex Prime" } });
    fireEvent.change(screen.getByLabelText("Workspace settings url"), { target: { value: "trex-prime" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(window.location.pathname).toBe("/trex-prime/settings/workspaces");
    });
    expect(screen.getByText('Workspace "Trex Prime" 已更新')).toBeInTheDocument();
  });

  it("shows login page after logout", async () => {
    window.history.replaceState({}, "", "/");
    render(() => <App />);

    const logoutButton = await screen.findByRole("button", { name: "退出登录" });
    fireEvent.click(logoutButton);

    expect(screen.getByRole("heading", { name: "登录 Ordo", level: 1 })).toBeInTheDocument();
  });

  it("shows workspace creation panel when user has no workspaces", async () => {
    window.history.replaceState({}, "", "/");
    setFetchImplementation(async (url) => {
      if (String(url).includes("/api/workspaces/mine")) {
        return { ok: true, json: async () => ({ items: [] }) };
      }
      return { ok: true, json: async () => ({ items: [] }) };
    });

    render(() => <App />);

    await waitFor(() => {
      expect(screen.getByText("你还没有 Workspace")).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "创建 Workspace" })).toBeInTheDocument();
  });

  it("shows duplicate-name message when workspace creation returns 409", async () => {
    window.history.replaceState({}, "", "/");
    setFetchImplementation(async (url, options = {}) => {
      const requestUrl = String(url);
      if (requestUrl.includes("/api/workspaces/mine")) {
        return { ok: true, json: async () => ({ items: [] }) };
      }
      if (requestUrl.includes("/api/workspaces") && options.method === "POST") {
        return {
          ok: false,
          status: 409,
          json: async () => ({ message: "workspace name already exists" })
        };
      }
      return { ok: true, json: async () => ({ items: [] }) };
    });

    render(() => <App />);
    await screen.findByText("你还没有 Workspace");
    fireEvent.change(screen.getByLabelText("Workspace name"), { target: { value: "trex" } });
    fireEvent.click(screen.getByRole("button", { name: "创建 Workspace" }));

    await waitFor(() => {
      expect(screen.getByText("Workspace 名称已存在，请换一个名字")).toBeInTheDocument();
    });
  });

  it("falls back to login when workspace request returns invalid token", async () => {
    window.history.replaceState({}, "", "/");
    setFetchImplementation(async (url) => {
      if (String(url).includes("/api/workspaces/mine")) {
        return {
          ok: false,
          status: 401,
          json: async () => ({ message: "Invalid idToken" })
        };
      }
      return { ok: true, json: async () => ({ items: [] }) };
    });

    render(() => <App />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "登录 Ordo", level: 1 })).toBeInTheDocument();
    });
  });

  it("exchanges DingTalk authCode on callback path and then enters workspace", async () => {
    localStorage.clear();
    window.history.replaceState({}, "", "/dingtalk/callback?authCode=abc123");
    setFetchImplementation(async (url, options = {}) => {
      const requestUrl = String(url);
      if (requestUrl.includes("/api/auth/dingtalk/exchange-code") && options.method === "POST") {
        return {
          ok: true,
          json: async () => ({ accessToken: "dev-dingtalk:callback@example.com" })
        };
      }
      if (requestUrl.includes("/api/workspaces/mine")) {
        return {
          ok: true,
          json: async () => ({ items: [{ id: "trex", name: "trex", url: "trex" }] })
        };
      }
      if (requestUrl.includes("/api/teams?workspaceId=trex")) {
        return {
          ok: true,
          json: async () => ({ items: [{ id: "trex-product", name: "trex-product" }] })
        };
      }
      return { ok: true, json: async () => ({ items: [] }) };
    });

    render(() => <App />);

    await waitFor(() => {
      expect(localStorage.getItem("ordo_access_token")).toBe("dev-dingtalk:callback@example.com");
      expect(window.location.pathname).toBe("/");
    });
  });
});
