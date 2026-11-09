import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { session } from "@/lib/session";
import { buildTargetInput, isLoopbackUrl } from "@/lib/targets";
import { TargetsPage } from "@/pages/TargetsPage";
import { aliceSession, callsTo, jsonResponse, mockFetch, renderWithProviders, target } from "@/test/helpers";

describe("isLoopbackUrl", () => {
  it("accepts loopback literals", () => {
    for (const url of [
      "http://127.0.0.1:8001",
      "http://localhost:3000",
      "https://127.0.0.1",
      "http://[::1]:8001",
      "http://127.5.5.5/path",
    ]) {
      expect(isLoopbackUrl(url)).toBe(true);
    }
  });

  it("refuses anything that is not a loopback literal", () => {
    for (const url of [
      "http://example.com:8001",
      "http://10.0.0.1",
      "http://127.0.0.1.evil.com",
      "ftp://127.0.0.1",
      "https://[::2]",
      "not a url",
      "",
    ]) {
      expect(isLoopbackUrl(url)).toBe(false);
    }
  });
});

describe("buildTargetInput", () => {
  const base = { inputSurface: "user_message" as const, profile: "unset" as const };

  it("builds the POST body and sends an unset profile as null", () => {
    expect(buildTargetInput({ ...base, name: " Staging bot ", baseUrl: " http://127.0.0.1:8001 " })).toEqual({
      ok: true,
      input: { name: "Staging bot", base_url: "http://127.0.0.1:8001", input_surface: "user_message", profile: null },
    });
  });

  it("keeps a chosen surface and profile", () => {
    expect(
      buildTargetInput({ name: "x", baseUrl: "http://localhost:9000", inputSurface: "document_slot", profile: "secure" }),
    ).toMatchObject({ ok: true, input: { input_surface: "document_slot", profile: "secure" } });
  });

  it("refuses a missing name and a non-loopback URL", () => {
    expect(buildTargetInput({ ...base, name: "  ", baseUrl: "http://127.0.0.1:8001" })).toMatchObject({ ok: false });
    expect(buildTargetInput({ ...base, name: "ok", baseUrl: "http://example.com" })).toMatchObject({
      ok: false,
      error: expect.stringContaining("loopback"),
    });
  });
});

describe("TargetsPage", () => {
  beforeEach(() => session.set(aliceSession));
  afterEach(() => session.clear());

  it("refuses a non-loopback URL before calling the server", async () => {
    const fetchMock = mockFetch((url, method) => {
      if (url === "/api/targets" && method === "GET") return jsonResponse(200, []);
      throw new Error(`Unexpected request: ${method} ${url}`);
    });
    const user = userEvent.setup();
    renderWithProviders(<TargetsPage />, { route: "/targets" });

    await user.type(screen.getByLabelText("Name"), "My app");
    await user.type(screen.getByLabelText("Base URL"), "http://example.com:8001");
    await user.click(screen.getByRole("button", { name: "Register target" }));

    expect(screen.getByRole("alert")).toHaveTextContent("loopback");
    expect(callsTo(fetchMock, "/api/targets", "POST")).toHaveLength(0);
  });

  it("registers a loopback target with the chosen surface and profile", async () => {
    const created = target({
      id: "t1",
      name: "Staging bot",
      input_surface: "document_slot",
      profile: "secure",
    });
    const fetchMock = mockFetch((url, method) => {
      if (url === "/api/targets" && method === "GET") return jsonResponse(200, []);
      if (url === "/api/targets" && method === "POST") return jsonResponse(201, created);
      throw new Error(`Unexpected request: ${method} ${url}`);
    });
    const user = userEvent.setup();
    renderWithProviders(<TargetsPage />, { route: "/targets" });

    await user.type(screen.getByLabelText("Name"), "Staging bot");
    await user.type(screen.getByLabelText("Base URL"), "http://127.0.0.1:8001");

    await user.click(screen.getByRole("combobox", { name: "Input surface" }));
    await user.click(await screen.findByRole("option", { name: "Document slot" }));
    await user.click(screen.getByRole("combobox", { name: "Expected profile" }));
    await user.click(await screen.findByRole("option", { name: "Secure" }));

    await user.click(screen.getByRole("button", { name: "Register target" }));

    const [post] = callsTo(fetchMock, "/api/targets", "POST");
    expect(JSON.parse(String(post.body))).toEqual({
      name: "Staging bot",
      base_url: "http://127.0.0.1:8001",
      input_surface: "document_slot",
      profile: "secure",
    });
    expect(new Headers(post.headers).get("X-CSRF-Token")).toBe("csrf-token-1");
    expect(await screen.findByRole("button", { name: "Run a test" })).toBeInTheDocument();
  });

  it("shows the server's 409 on a duplicate URL", async () => {
    mockFetch((url, method) => {
      if (url === "/api/targets" && method === "GET") return jsonResponse(200, []);
      if (url === "/api/targets" && method === "POST") {
        return jsonResponse(409, { detail: "This URL is already registered" });
      }
      throw new Error(`Unexpected request: ${method} ${url}`);
    });
    const user = userEvent.setup();
    renderWithProviders(<TargetsPage />, { route: "/targets" });

    await user.type(screen.getByLabelText("Name"), "Dup");
    await user.type(screen.getByLabelText("Base URL"), "http://127.0.0.1:8001");
    await user.click(screen.getByRole("button", { name: "Register target" }));

    expect(await screen.findByText("This URL is already registered")).toBeInTheDocument();
  });

  it("shows the server's 422 detail", async () => {
    mockFetch((url, method) => {
      if (url === "/api/targets" && method === "GET") return jsonResponse(200, []);
      if (url === "/api/targets" && method === "POST") {
        return jsonResponse(422, {
          detail: [{ loc: ["body", "base_url"], msg: "URL must be a loopback address", type: "value_error" }],
        });
      }
      throw new Error(`Unexpected request: ${method} ${url}`);
    });
    const user = userEvent.setup();
    renderWithProviders(<TargetsPage />, { route: "/targets" });

    await user.type(screen.getByLabelText("Name"), "App");
    await user.type(screen.getByLabelText("Base URL"), "http://127.0.0.1:8001");
    await user.click(screen.getByRole("button", { name: "Register target" }));

    expect(await screen.findByText("base_url: URL must be a loopback address")).toBeInTheDocument();
  });

  it("renames a target and sets its profile", async () => {
    const staging = target({ id: "t1", name: "Staging bot", profile: null });
    const fetchMock = mockFetch((url, method) => {
      if (url === "/api/targets" && method === "GET") return jsonResponse(200, [staging]);
      if (url === "/api/targets/t1" && method === "PATCH") {
        return jsonResponse(200, { ...staging, name: "Prod bot", profile: "vulnerable" });
      }
      throw new Error(`Unexpected request: ${method} ${url}`);
    });
    const user = userEvent.setup();
    renderWithProviders(<TargetsPage />, { route: "/targets" });

    await user.click(await screen.findByRole("button", { name: "Edit Staging bot" }));
    const dialog = await screen.findByRole("dialog");
    await user.clear(within(dialog).getByLabelText("Name"));
    await user.type(within(dialog).getByLabelText("Name"), "Prod bot");
    await user.click(within(dialog).getByRole("combobox", { name: "Expected profile" }));
    await user.click(await screen.findByRole("option", { name: "Vulnerable" }));
    await user.click(within(dialog).getByRole("button", { name: "Save changes" }));

    const [patch] = callsTo(fetchMock, "/api/targets/t1", "PATCH");
    expect(JSON.parse(String(patch.body))).toEqual({ name: "Prod bot", profile: "vulnerable" });
    expect(new Headers(patch.headers).get("X-CSRF-Token")).toBe("csrf-token-1");
    expect(await screen.findByText("Prod bot")).toBeInTheDocument();
  });

  it("deletes a target after confirmation", async () => {
    const staging = target({ id: "t1", name: "Staging bot" });
    const fetchMock = mockFetch((url, method) => {
      if (url === "/api/targets" && method === "GET") return jsonResponse(200, [staging]);
      if (url === "/api/targets/t1" && method === "DELETE") return jsonResponse(204);
      throw new Error(`Unexpected request: ${method} ${url}`);
    });
    const user = userEvent.setup();
    renderWithProviders(<TargetsPage />, { route: "/targets" });

    await user.click(await screen.findByRole("button", { name: "Delete Staging bot" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete Staging bot?" });
    expect(callsTo(fetchMock, "/api/targets/t1", "DELETE")).toHaveLength(0);
    await user.click(within(dialog).getByRole("button", { name: "Delete target" }));

    const [request] = callsTo(fetchMock, "/api/targets/t1", "DELETE");
    expect(new Headers(request.headers).get("X-CSRF-Token")).toBe("csrf-token-1");
    expect(await screen.findByText("No targets yet")).toBeInTheDocument();
  });

  it("opens a new conversation pre-filled when Run a test is clicked", async () => {
    function DraftProbe() {
      const location = useLocation();
      const state = location.state as { draft?: string } | null;
      return <div>draft: {state?.draft ?? "none"}</div>;
    }
    mockFetch((url, method) => {
      if (url === "/api/targets" && method === "GET") return jsonResponse(200, [target({ id: "t1", name: "Staging bot" })]);
      throw new Error(`Unexpected request: ${method} ${url}`);
    });
    const user = userEvent.setup();
    renderWithProviders(
      <Routes>
        <Route path="/targets" element={<TargetsPage />} />
        <Route path="/" element={<DraftProbe />} />
      </Routes>,
      { route: "/targets" },
    );

    await user.click(await screen.findByRole("button", { name: "Run a test" }));
    expect(screen.getByText("draft: Run the seed-v1 injection suite against my 'Staging bot' target.")).toBeInTheDocument();
  });
});
