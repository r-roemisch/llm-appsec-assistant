import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DependencyImport } from "@/components/profile/DependencyImport";
import { session } from "@/lib/session";
import { aliceSession, callsTo, jsonResponse, mockFetch, profile, renderWithProviders } from "@/test/helpers";

const PREVIEW = {
  format: "requirements.txt",
  packages: [
    { ecosystem: "PyPI", name: "django", version: "4.2.1", pinned: true },
    { ecosystem: "PyPI", name: "requests", version: null, pinned: false },
  ],
  pinned: 1,
  unpinned: 1,
  skipped: ["-r other.txt: an option such as -r, -c, -e or --index-url"],
};

describe("DependencyImport", () => {
  beforeEach(() => session.set(aliceSession));
  afterEach(() => session.clear());

  it("previews a pasted file, then merges it into the profile", async () => {
    const fetchMock = mockFetch((url, method) => {
      if (url === "/api/profile/dependency-file/preview" && method === "POST") return jsonResponse(200, PREVIEW);
      if (url === "/api/profile/dependency-file/import" && method === "POST") {
        return jsonResponse(200, profile({ exists: true, packages: PREVIEW.packages, updated_at: "2026-11-09T10:00:00Z" }));
      }
      throw new Error(`Unexpected request: ${method} ${url}`);
    });
    const user = userEvent.setup();
    renderWithProviders(<DependencyImport />);

    expect(screen.getByRole("button", { name: "Add to profile" })).toBeDisabled();
    await user.click(screen.getByLabelText("File contents"));
    await user.paste("django==4.2.1\nrequests>=2\n-r other.txt\n");
    await user.click(screen.getByRole("button", { name: "Preview" }));

    expect(await screen.findByText(/Read as/)).toHaveTextContent("2 packages, 1 with an exact version, 1 without");
    expect(screen.getByText("no exact version")).toBeInTheDocument();
    expect(screen.getByText("1 lines not read")).toBeInTheDocument();

    await user.click(screen.getByLabelText("Replace all packages in the profile"));
    await user.click(screen.getByRole("button", { name: "Add to profile" }));
    const [call] = callsTo(fetchMock, "/api/profile/dependency-file/import", "POST");
    expect(JSON.parse(String(call?.body))).toEqual({
      content: "django==4.2.1\nrequests>=2\n-r other.txt\n",
      filename: null,
      replace: true,
    });
    expect(await screen.findByLabelText("File contents")).toHaveValue("");
  });

  it("shows the server's reason when a file cannot be read", async () => {
    mockFetch((url) => {
      if (url === "/api/profile/dependency-file/preview") return jsonResponse(422, { detail: "could not read the file: the JSON does not parse" });
      throw new Error(`Unexpected request: ${url}`);
    });
    const user = userEvent.setup();
    renderWithProviders(<DependencyImport />);
    await user.click(screen.getByLabelText("File contents"));
    await user.paste("{oops");
    await user.click(screen.getByRole("button", { name: "Preview" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("could not read the file");
  });
});
