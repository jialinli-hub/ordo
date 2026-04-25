import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { IssueList } from "./IssueList";

describe("IssueList", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders issue titles from api response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        items: [{ id: "i-1", title: "Fix auth bug" }]
      })
    });

    render(<IssueList />);

    await waitFor(() => {
      expect(screen.getByText("Fix auth bug")).toBeInTheDocument();
    });
  });
});
