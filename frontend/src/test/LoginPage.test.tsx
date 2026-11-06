import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { session } from "@/lib/session";
import { LoginPage } from "@/pages/LoginPage";
import { aliceSession, jsonResponse } from "@/test/helpers";

type FetchMock = Mock<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>;

const health = {
  status: "ok",
  version: "0.1.0",
  providers: { openrouter: true, ollama: false },
  tracing: "jsonl",
};

function mockBackend(): FetchMock {
  const fetchMock: FetchMock = vi.fn(async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (url === "/api/health") return jsonResponse(200, health);
    if (url === "/api/auth/me") return jsonResponse(401, { detail: "Not authenticated" });
    if (url === "/api/auth/login" && method === "POST") {
      const body = JSON.parse(String(init?.body)) as { username: string; password: string };
      if (body.username === "alice" && body.password === "correct horse") return jsonResponse(200, aliceSession);
      return jsonResponse(401, { detail: "Invalid username or password" });
    }
    throw new Error(`Unexpected request: ${method} ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderLogin() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/login"]}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<div>Signed-in home</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("LoginPage", () => {
  beforeEach(() => {
    session.clear();
  });

  it("submits the credentials and navigates on success", async () => {
    const fetchMock = mockBackend();
    const user = userEvent.setup();
    renderLogin();

    await user.type(screen.getByLabelText("Username"), "alice");
    await user.type(screen.getByLabelText("Password"), "correct horse");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByText("Signed-in home")).toBeInTheDocument();
    const loginCall = fetchMock.mock.calls.find(([input]) => String(input) === "/api/auth/login");
    expect(loginCall).toBeDefined();
    expect(JSON.parse(String(loginCall?.[1]?.body))).toEqual({ username: "alice", password: "correct horse" });
    expect(session.csrfToken()).toBe("csrf-token-1");
  });

  it("shows the server detail on 401", async () => {
    mockBackend();
    const user = userEvent.setup();
    renderLogin();

    await user.type(screen.getByLabelText("Username"), "alice");
    await user.type(screen.getByLabelText("Password"), "wrong");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid username or password");
    expect(screen.queryByText("Signed-in home")).not.toBeInTheDocument();
    expect(session.get()).toBeNull();
  });

  it("shows the health footer", async () => {
    mockBackend();
    renderLogin();

    expect(await screen.findByText("Rampart 0.1.0")).toBeInTheDocument();
    expect(screen.getByText("OpenRouter configured")).toBeInTheDocument();
    expect(screen.getByText("Ollama unreachable")).toBeInTheDocument();
    expect(screen.getByText("Tracing to JSONL files")).toBeInTheDocument();
  });
});
