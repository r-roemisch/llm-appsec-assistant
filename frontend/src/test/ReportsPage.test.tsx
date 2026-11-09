import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { session } from "@/lib/session";
import type { ReportDetailOut } from "@/lib/types";
import { ReportPage } from "@/pages/ReportPage";
import { ReportsPage } from "@/pages/ReportsPage";
import { aliceSession, callsTo, jsonResponse, mockFetch, renderWithProviders, report } from "@/test/helpers";

const vulnerabilities = report({ id: "r1", title: "Dependency review: requests 2.25.0", size: 5120 });
const injection = report({ id: "r2", title: "Injection test: staging bot", conversation_id: null, size: 900 });

const detail: ReportDetailOut = {
  ...vulnerabilities,
  markdown:
    "# Dependency review\n\n8 known vulnerabilities.\n\n<script>alert(1)</script>\n\n[OSV](https://osv.dev/vulnerability/GHSA-x)",
};

function renderRoutes(route: string) {
  return renderWithProviders(
    <Routes>
      <Route path="/reports" element={<ReportsPage />} />
      <Route path="/reports/:id" element={<ReportPage />} />
    </Routes>,
    { route },
  );
}

describe("Reports", () => {
  beforeEach(() => session.set(aliceSession));
  afterEach(() => session.clear());

  it("lists Reports with date, size, an open link and a download link", async () => {
    mockFetch((url) => {
      if (url === "/api/reports") return jsonResponse(200, [vulnerabilities, injection]);
      throw new Error(`Unexpected request: ${url}`);
    });
    renderRoutes("/reports");

    const list = await screen.findByRole("list", { name: "Your reports" });
    const rows = within(list).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByRole("link", { name: "Dependency review: requests 2.25.0" })).toHaveAttribute("href", "/reports/r1");
    expect(rows[0]).toHaveTextContent("5 KB");
    expect(rows[0]).toHaveTextContent("2026");
    expect(within(rows[0]).getByRole("link", { name: "From a conversation" })).toHaveAttribute("href", "/c/c1");
    const download = within(rows[0]).getByRole("link", { name: "Download Dependency review: requests 2.25.0" });
    expect(download).toHaveAttribute("href", "/api/reports/r1/download");
    expect(download).toHaveAttribute("download");
    expect(within(rows[1]).queryByRole("link", { name: "From a conversation" })).not.toBeInTheDocument();
  });

  it("deletes a Report after confirmation", async () => {
    let reports = [vulnerabilities, injection];
    const fetchMock = mockFetch((url, method) => {
      if (url === "/api/reports") return jsonResponse(200, reports);
      if (url === "/api/reports/r2" && method === "DELETE") {
        reports = [vulnerabilities];
        return jsonResponse(204);
      }
      throw new Error(`Unexpected request: ${method} ${url}`);
    });
    const user = userEvent.setup();
    renderRoutes("/reports");

    await user.click(await screen.findByRole("button", { name: "Delete Injection test: staging bot" }));
    const dialog = screen.getByRole("dialog", { name: "Delete Injection test: staging bot?" });
    expect(callsTo(fetchMock, "/api/reports/r2", "DELETE")).toHaveLength(0);
    await user.click(within(dialog).getByRole("button", { name: "Delete report" }));

    await waitFor(() => expect(screen.queryByText("Injection test: staging bot")).not.toBeInTheDocument());
    const [request] = callsTo(fetchMock, "/api/reports/r2", "DELETE");
    expect(new Headers(request.headers).get("X-CSRF-Token")).toBe("csrf-token-1");
    expect(screen.getByText("Dependency review: requests 2.25.0")).toBeInTheDocument();
  });

  it("explains how to get a first Report", async () => {
    mockFetch(() => jsonResponse(200, []));
    renderRoutes("/reports");
    expect(await screen.findByText("No reports yet")).toBeInTheDocument();
  });

  it("renders one Report as safe Markdown with a download button", async () => {
    mockFetch((url) => {
      if (url === "/api/reports/r1") return jsonResponse(200, detail);
      throw new Error(`Unexpected request: ${url}`);
    });
    const { container } = renderRoutes("/reports/r1");

    const article = await screen.findByRole("article", { name: "Report" });
    expect(within(article).getByRole("heading", { name: "Dependency review" })).toBeInTheDocument();
    expect(container.querySelector("script")).toBeNull();
    expect(within(article).getByRole("link", { name: "OSV" })).toHaveAttribute("rel", expect.stringContaining("noopener noreferrer"));
    expect(screen.getByRole("link", { name: "Download" })).toHaveAttribute("href", "/api/reports/r1/download");
    expect(screen.getByRole("link", { name: "Open the conversation" })).toHaveAttribute("href", "/c/c1");
  });

  it("says when a Report does not exist", async () => {
    mockFetch(() => jsonResponse(404, { detail: "report not found" }));
    renderRoutes("/reports/missing");
    expect(await screen.findByText("This report does not exist.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Download" })).not.toBeInTheDocument();
  });
});
