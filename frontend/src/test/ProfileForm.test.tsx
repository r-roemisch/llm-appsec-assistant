import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ProfileForm } from "@/components/profile/ProfileForm";
import { buildProfileInput, countCharacters, PROFILE_LIMITS } from "@/lib/profile";
import { session } from "@/lib/session";
import { aliceSession, callsTo, jsonResponse, mockFetch, profile, renderWithProviders, target } from "@/test/helpers";

const ECOSYSTEMS = ["PyPI", "npm"];

describe("buildProfileInput", () => {
  it("trims rows, drops blank ones and sends an empty version as null", () => {
    const result = buildProfileInput(
      "FastAPI",
      [
        { ecosystem: "PyPI", name: " fastapi ", version: " 0.162.0 " },
        { ecosystem: "npm", name: "", version: "" },
        { ecosystem: "npm", name: "react", version: "" },
      ],
      ECOSYSTEMS,
    );
    expect(result).toEqual({
      ok: true,
      input: {
        stack: "FastAPI",
        packages: [
          { ecosystem: "PyPI", name: "fastapi", version: "0.162.0" },
          { ecosystem: "npm", name: "react", version: null },
        ],
        target_ids: [],
      },
    });
  });

  it("passes the attached Target ids through", () => {
    expect(buildProfileInput("", [], ECOSYSTEMS, ["t2", "t1"])).toEqual({
      ok: true,
      input: { stack: "", packages: [], target_ids: ["t2", "t1"] },
    });
  });

  it("refuses values over the limits, naming the row", () => {
    expect(buildProfileInput("x".repeat(PROFILE_LIMITS.stack + 1), [], ECOSYSTEMS)).toEqual({
      ok: false,
      error: "The stack description is longer than 2,000 characters.",
    });
    expect(buildProfileInput("", [{ ecosystem: "PyPI", name: "", version: "1.0" }], ECOSYSTEMS)).toEqual({
      ok: false,
      error: "Give package 1 a name.",
    });
    const long = { ecosystem: "PyPI", name: "n".repeat(PROFILE_LIMITS.name + 1), version: "" };
    expect(buildProfileInput("", [long], ECOSYSTEMS)).toMatchObject({ ok: false, error: expect.stringContaining("214") });
    const version = { ecosystem: "PyPI", name: "a", version: "v".repeat(PROFILE_LIMITS.version + 1) };
    expect(buildProfileInput("", [version], ECOSYSTEMS)).toMatchObject({ ok: false, error: expect.stringContaining("64") });
    expect(buildProfileInput("", [{ ecosystem: "Hex", name: "phoenix", version: "" }], ECOSYSTEMS)).toMatchObject({
      ok: false,
    });
    const many = Array.from({ length: PROFILE_LIMITS.packages + 1 }, (_, index) => ({
      ecosystem: "npm",
      name: `pkg-${index}`,
      version: "",
    }));
    expect(buildProfileInput("", many, ECOSYSTEMS)).toEqual({ ok: false, error: "A profile holds at most 50 packages." });
  });

  it("counts characters as code points, like the server", () => {
    expect(countCharacters("🔐 key")).toBe(5);
  });
});

describe("ProfileForm", () => {
  beforeEach(() => session.set(aliceSession));
  afterEach(() => session.clear());

  it("counts the stack against its limit and will not save over it", async () => {
    const fetchMock = mockFetch((url) => {
      throw new Error(`Unexpected request: ${url}`);
    });
    const user = userEvent.setup();
    renderWithProviders(<ProfileForm profile={profile()} />);

    expect(screen.getByText("0 / 2,000")).toBeInTheDocument();
    await user.click(screen.getByLabelText("Stack"));
    await user.paste("x".repeat(2001));

    expect(screen.getByText("2,001 / 2,000")).toHaveClass("text-destructive");
    expect(screen.getByLabelText("Stack")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("button", { name: "Save profile" })).toBeDisabled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("allows at most 50 packages", () => {
    const packages = Array.from({ length: 50 }, (_, index) => ({ ecosystem: "PyPI", name: `pkg-${index}`, version: null }));
    renderWithProviders(
      <ProfileForm profile={profile({ exists: true, packages, updated_at: "2026-11-08T09:00:00Z" })} />,
    );

    expect(screen.getByText("50 / 50")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add package" })).toBeDisabled();
    expect(screen.getByText("A profile holds at most 50 packages.")).toBeInTheDocument();
  });

  it("adds and removes package rows and saves them", async () => {
    const saved = profile({
      exists: true,
      stack: "LangGraph agent",
      packages: [{ ecosystem: "PyPI", name: "langchain-core", version: "1.7.6" }],
      updated_at: "2026-11-08T10:00:00Z",
    });
    const fetchMock = mockFetch((url, method) => {
      if (url === "/api/profile" && method === "PUT") return jsonResponse(200, saved);
      throw new Error(`Unexpected request: ${method} ${url}`);
    });
    const user = userEvent.setup();
    renderWithProviders(<ProfileForm profile={profile()} />);

    await user.type(screen.getByLabelText("Stack"), "LangGraph agent");
    await user.click(screen.getByRole("button", { name: "Add package" }));
    await user.type(screen.getByLabelText("Name of package 1"), " langchain-core ");
    await user.type(screen.getByLabelText("Version of package 1"), "1.7.6");
    expect(screen.getByRole("combobox", { name: "Ecosystem of package 1" })).toHaveTextContent("PyPI");
    await user.click(screen.getByRole("button", { name: "Add package" }));
    await user.type(screen.getByLabelText("Name of package 2"), "left-pad");
    await user.click(screen.getByRole("button", { name: "Remove package 2" }));
    expect(screen.queryByLabelText("Name of package 2")).not.toBeInTheDocument();
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Save profile" }));

    const [put] = callsTo(fetchMock, "/api/profile", "PUT");
    expect(JSON.parse(String(put.body))).toEqual({
      stack: "LangGraph agent",
      packages: [{ ecosystem: "PyPI", name: "langchain-core", version: "1.7.6" }],
      target_ids: [],
    });
    expect(new Headers(put.headers).get("X-CSRF-Token")).toBe("csrf-token-1");
  });

  it("flags a package without a name before sending, and shows the server's 422 detail", async () => {
    const fetchMock = mockFetch((url, method) => {
      if (url === "/api/profile" && method === "PUT") {
        return jsonResponse(422, {
          detail: [{ loc: ["body", "packages", 0, "ecosystem"], msg: "Input should be a known ecosystem", type: "value_error" }],
        });
      }
      throw new Error(`Unexpected request: ${method} ${url}`);
    });
    const user = userEvent.setup();
    renderWithProviders(<ProfileForm profile={profile({ ecosystems: ["PyPI"] })} />);

    await user.click(screen.getByRole("button", { name: "Add package" }));
    await user.type(screen.getByLabelText("Version of package 1"), "2.0");
    await user.click(screen.getByRole("button", { name: "Save profile" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Give package 1 a name.");
    expect(fetchMock).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText("Name of package 1"), "requests");
    await user.click(screen.getByRole("button", { name: "Save profile" }));
    expect(await screen.findByText("ecosystem: Input should be a known ecosystem")).toBeInTheDocument();
  });

  it("deletes the profile after confirmation", async () => {
    const fetchMock = mockFetch((url, method) => {
      if (url === "/api/profile" && method === "DELETE") return jsonResponse(204);
      throw new Error(`Unexpected request: ${method} ${url}`);
    });
    const user = userEvent.setup();
    renderWithProviders(
      <ProfileForm profile={profile({ exists: true, stack: "Django", updated_at: "2026-11-08T09:00:00Z" })} />,
    );

    await user.click(screen.getByRole("button", { name: "Delete profile" }));
    const dialog = await screen.findByRole("dialog");
    expect(fetchMock).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Delete profile" }));

    expect(callsTo(fetchMock, "/api/profile", "DELETE")).toHaveLength(1);
  });

  it("cannot delete a profile that was never saved", () => {
    renderWithProviders(<ProfileForm profile={profile()} />);
    expect(screen.getByRole("button", { name: "Delete profile" })).toBeDisabled();
    expect(screen.getByText("Not saved yet")).toBeInTheDocument();
  });

  it("checks the attached Targets and saves the selection as target_ids", async () => {
    const saved = profile({ exists: true, target_ids: ["t2"], updated_at: "2026-11-08T11:00:00Z" });
    const fetchMock = mockFetch((url, method) => {
      if (url === "/api/profile" && method === "PUT") return jsonResponse(200, saved);
      throw new Error(`Unexpected request: ${method} ${url}`);
    });
    const user = userEvent.setup();
    renderWithProviders(
      <ProfileForm
        profile={profile({ exists: true, target_ids: ["t1"], updated_at: "2026-11-08T09:00:00Z" })}
        targets={[
          target({ id: "t1", name: "Staging bot", profile: "secure" }),
          target({ id: "t2", name: "Vuln app", base_url: "http://127.0.0.1:8002", profile: "vulnerable" }),
        ]}
      />,
    );

    const staging = screen.getByRole("checkbox", { name: "Staging bot" });
    const vuln = screen.getByRole("checkbox", { name: "Vuln app" });
    expect(staging).toBeChecked();
    expect(vuln).not.toBeChecked();

    await user.click(vuln);
    await user.click(staging);
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Save profile" }));
    const [put] = callsTo(fetchMock, "/api/profile", "PUT");
    expect(JSON.parse(String(put.body)).target_ids).toEqual(["t2"]);
  });

  it("links to the Targets page when none are registered", () => {
    renderWithProviders(<ProfileForm profile={profile()} />);
    expect(screen.getByText(/No Targets registered yet/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Register one" })).toHaveAttribute("href", "/targets");
  });
});
