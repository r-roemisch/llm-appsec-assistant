import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { session } from "@/lib/session";
import type { KnowledgeStatusOut, SourceOut } from "@/lib/types";
import { checkUpload, fileExtension } from "@/lib/uploads";
import { KnowledgePage } from "@/pages/KnowledgePage";
import {
  aliceSession,
  callsTo,
  jsonResponse,
  knowledgeStatus,
  mockFetch,
  model,
  renderWithProviders,
  source,
} from "@/test/helpers";

const myUpload = source({
  id: "s-up",
  title: "threat-model.md",
  source_type: "upload",
  origin: "threat-model.md",
  license_note: null,
  mine: true,
  passage_count: 12,
  embedded_count: 0,
  size_bytes: 1536,
});
const owasp = source({ id: "s-owasp", title: "OWASP Top 10 for LLM Applications 2025" });
const fixture = source({
  id: "s-fix",
  title: "Synthetic RAG poisoning notes",
  origin: "fixtures/rag_poisoning.md",
  license_note: "MIT, synthetic",
  synthetic: true,
  passage_count: 3,
  embedded_count: 0,
});
const guide = source({
  id: "s-guide",
  title: "Rampart user guide",
  source_type: "app_docs",
  origin: "docs/guides/user_guide.md",
  license_note: "MIT",
  passage_count: 18,
  embedded_count: 0,
});

const models = {
  models: [model({ id: "openai/text-embedding-3-small", display_name: "Text Embedding 3 Small", kind: "embedding" })],
  slots: {},
};

interface Backend {
  status?: KnowledgeStatusOut;
  sources?: SourceOut[];
  upload?: () => Response;
}

function mockBackend({ status = knowledgeStatus(), sources = [myUpload, owasp, fixture, guide], upload }: Backend = {}) {
  return mockFetch((url, method) => {
    if (url === "/api/knowledge/status") return jsonResponse(200, status);
    if (url === "/api/knowledge/sources") return jsonResponse(200, sources);
    if (url === "/api/models") return jsonResponse(200, models);
    if (url === "/api/knowledge/uploads" && method === "POST" && upload) return upload();
    if (url === "/api/knowledge/sources/s-up" && method === "DELETE") return jsonResponse(204);
    throw new Error(`Unexpected request: ${method} ${url}`);
  });
}

describe("checkUpload", () => {
  const status = knowledgeStatus({ max_upload_bytes: 1024, uploads: 2, max_uploads: 3 });

  it("accepts the listed types within the size limit", () => {
    expect(checkUpload({ name: "Notes.MD", size: 10 }, status)).toBeNull();
    expect(fileExtension("archive.tar.gz")).toBe(".gz");
    expect(fileExtension(".md")).toBe("");
  });

  it("refuses other types, empty and oversized files, and uploads past the limit", () => {
    expect(checkUpload({ name: "tool.exe", size: 10 }, status)).toBe(
      "tool.exe is not a supported file type. Upload a .pdf, .md, .markdown or .txt file.",
    );
    expect(checkUpload({ name: "empty.txt", size: 0 }, status)).toBe("empty.txt is empty.");
    expect(checkUpload({ name: "big.pdf", size: 2048 }, status)).toBe("big.pdf is 2 KB; the limit is 1 KB.");
    expect(checkUpload({ name: "ok.pdf", size: 10 }, { ...status, uploads: 3 })).toMatch(/already have 3 uploads/);
  });
});

describe("KnowledgePage", () => {
  beforeEach(() => session.set(aliceSession));
  afterEach(() => session.clear());

  it("shows the retrieval mode with its reason, the embedding Model and the counts", async () => {
    mockBackend({
      status: knowledgeStatus({
        retrieval_mode: "bm25",
        reason: "Ollama is not reachable at http://127.0.0.1:11434",
        embedding_available: false,
        embedded_passages: 0,
      }),
    });
    renderWithProviders(<KnowledgePage />);

    expect(await screen.findByText("Keyword search only")).toBeInTheDocument();
    expect(screen.getByText("Reason: Ollama is not reachable at http://127.0.0.1:11434")).toBeInTheDocument();
    expect(await screen.findByText("Text Embedding 3 Small")).toBeInTheDocument();
    expect(screen.getByText("Unavailable")).toBeInTheDocument();
    expect(screen.getByText("1 of 50")).toBeInTheDocument();
    expect(screen.getByText(".pdf, .md, .markdown, .txt up to 5 MB. 1 of 50 uploads used.")).toBeInTheDocument();
  });

  it("lists the user's uploads and the shared Sources in their groups", async () => {
    mockBackend();
    renderWithProviders(<KnowledgePage />);

    expect(await screen.findByText("Hybrid search")).toBeInTheDocument();
    const uploads = await screen.findByRole("list", { name: "Your uploads" });
    expect(within(uploads).getByText("threat-model.md")).toBeInTheDocument();
    expect(within(uploads).getByText("12 passages")).toBeInTheDocument();
    expect(within(uploads).getByText("1.5 KB")).toBeInTheDocument();
    expect(within(uploads).getByText(/^Uploaded /)).toBeInTheDocument();
    expect(within(uploads).getByRole("button", { name: "Delete threat-model.md" })).toBeInTheDocument();

    const curated = screen.getByRole("region", { name: "Curated" });
    expect(within(curated).getByText("OWASP Top 10 for LLM Applications 2025")).toBeInTheDocument();
    const link = within(curated).getByRole("link", { name: /genai\.owasp\.org/ });
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(within(curated).getByText("License: CC BY-SA 4.0")).toBeInTheDocument();
    expect(within(curated).getByText("42 embedded")).toBeInTheDocument();
    expect(within(curated).getAllByText("Synthetic fixture")).toHaveLength(1);
    expect(within(curated).getByText("fixtures/rag_poisoning.md")).toBeInTheDocument();

    const guides = screen.getByRole("region", { name: "Rampart guides" });
    expect(within(guides).getByText("Rampart user guide")).toBeInTheDocument();
    expect(within(guides).queryByRole("link")).not.toBeInTheDocument();
    expect(within(guides).getByText("docs/guides/user_guide.md")).toBeInTheDocument();
  });

  it("explains rampart ingest when there are no shared Sources", async () => {
    mockBackend({ sources: [] });
    renderWithProviders(<KnowledgePage />);

    expect(await screen.findByText("No shared Sources yet")).toBeInTheDocument();
    expect(screen.getByText("rampart ingest --fixtures")).toBeInTheDocument();
    expect(screen.getByText("No uploads yet.")).toBeInTheDocument();
  });

  it("checks type and size before sending a file", async () => {
    const fetchMock = mockBackend({ status: knowledgeStatus({ max_upload_bytes: 1024 }) });
    const user = userEvent.setup({ applyAccept: false });
    renderWithProviders(<KnowledgePage />);
    await screen.findByText("Hybrid search");
    const input = screen.getByLabelText("Choose a file");
    expect(input).toHaveAttribute("accept", ".pdf,.md,.markdown,.txt");

    await user.upload(input, new File(["MZ"], "tool.exe"));
    expect(screen.getByRole("alert")).toHaveTextContent("tool.exe is not a supported file type");

    await user.upload(input, new File(["x".repeat(2048)], "big.md"));
    expect(screen.getByRole("alert")).toHaveTextContent("big.md is 2 KB; the limit is 1 KB.");

    expect(callsTo(fetchMock, "/api/knowledge/uploads")).toHaveLength(0);
  });

  it("sends a dropped file and shows the server's detail when it refuses", async () => {
    const fetchMock = mockBackend({ upload: () => jsonResponse(409, { detail: "You already uploaded this file" }) });
    renderWithProviders(<KnowledgePage />);
    await screen.findByText("Hybrid search");

    const file = new File(["# Threat model"], "threat-model.md", { type: "text/markdown" });
    fireEvent.drop(screen.getByRole("group", { name: "Upload a file" }), { dataTransfer: { files: [file] } });

    expect(await screen.findByRole("alert")).toHaveTextContent("You already uploaded this file");
    const [post] = callsTo(fetchMock, "/api/knowledge/uploads", "POST");
    expect((post.body as FormData).get("file")).toBe(file);
    expect(new Headers(post.headers).get("X-CSRF-Token")).toBe("csrf-token-1");
  });

  it("uploads a chosen file and refreshes the lists", async () => {
    const created = source({ id: "s-new", title: "notes.txt", source_type: "upload", mine: true, passage_count: 2 });
    const fetchMock = mockBackend({ upload: () => jsonResponse(201, created) });
    const user = userEvent.setup();
    renderWithProviders(<KnowledgePage />);
    await screen.findByText("Hybrid search");

    await user.upload(screen.getByLabelText("Choose a file"), new File(["plain notes"], "notes.txt"));

    await waitFor(() => expect(callsTo(fetchMock, "/api/knowledge/uploads", "POST")).toHaveLength(1));
    await waitFor(() => expect(callsTo(fetchMock, "/api/knowledge/sources")).toHaveLength(2));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("deletes an upload after confirmation", async () => {
    const fetchMock = mockBackend();
    const user = userEvent.setup();
    renderWithProviders(<KnowledgePage />);

    await user.click(await screen.findByRole("button", { name: "Delete threat-model.md" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Delete threat-model.md?");
    await user.click(within(dialog).getByRole("button", { name: "Delete upload" }));

    await waitFor(() => expect(callsTo(fetchMock, "/api/knowledge/sources/s-up", "DELETE")).toHaveLength(1));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});
