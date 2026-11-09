import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { Markdown } from "@/components/conversation/Markdown";
import { MessageItem } from "@/components/conversation/MessageItem";
import { splitCitationMarkers } from "@/lib/citations";
import type { PassageOut } from "@/lib/types";
import { callsTo, citation, jsonResponse, message, mockFetch, renderWithProviders } from "@/test/helpers";

const owasp = citation({ n: 1 });
const upload = citation({
  n: 2,
  passage_id: "p-upload",
  source_id: "s-upload",
  source_title: "threat-model.md",
  source_type: "upload",
  origin: "threat-model.md",
  heading: "Retrieval",
  snippet: "Our RAG index mixes customer tickets with internal runbooks.",
  provenance: "upload",
});

const owaspPassage: PassageOut = {
  id: "p1",
  source_id: owasp.source_id,
  source_title: owasp.source_title,
  source_type: "curated",
  origin: owasp.origin,
  license_note: "CC BY-SA 4.0",
  ordinal: 3,
  heading: owasp.heading,
  text: "Constrain model behavior. Segregate external content, as noted in [1].",
  provenance: "source",
};

const uploadPassage: PassageOut = {
  ...owaspPassage,
  id: "p-upload",
  source_id: "s-upload",
  source_title: "threat-model.md",
  source_type: "upload",
  origin: "threat-model.md",
  license_note: null,
  ordinal: 0,
  heading: "Retrieval",
  text: "Our RAG index mixes customer tickets with internal runbooks.",
  provenance: "upload",
};

const answer = message({
  id: "a1",
  role: "assistant",
  content: "Delimit untrusted text [1] and keep uploads separate [2]. See also [3], and `items[1]` in code.",
  model_id: "anthropic/claude-haiku-5.5",
  citations: [owasp, upload],
  retrieval_mode: "hybrid",
});

function mockPassages() {
  return mockFetch((url) => {
    if (url === "/api/knowledge/passages/p1") return jsonResponse(200, owaspPassage);
    if (url === "/api/knowledge/passages/p-upload") return jsonResponse(200, uploadPassage);
    throw new Error(`Unexpected request: ${url}`);
  });
}

describe("splitCitationMarkers", () => {
  const known = new Map([
    [1, "first"],
    [2, "second"],
  ]);
  const lookup = (n: number) => known.get(n);

  it("splits markers that have a Citation and leaves others as text", () => {
    expect(splitCitationMarkers("See [1] and [3].", lookup)).toEqual([
      "See ",
      { raw: "[1]", items: ["first"] },
      " and [3].",
    ]);
  });

  it("links a group only when every number has a Citation", () => {
    expect(splitCitationMarkers("[1, 2] then [1,3]", lookup)).toEqual([
      { raw: "[1, 2]", items: ["first", "second"] },
      " then [1,3]",
    ]);
  });

  it("returns text without markers as one segment", () => {
    expect(splitCitationMarkers("No markers here", lookup)).toEqual(["No markers here"]);
    expect(splitCitationMarkers("[link](x) and [a]", lookup)).toEqual(["[link](x) and [a]"]);
  });
});

describe("Citations under an answer", () => {
  it("turns markers into chips, lists the Sources and leaves unknown markers and code alone", () => {
    mockPassages();
    const { container } = renderWithProviders(<MessageItem message={answer} modelName="Claude Haiku 5.5" />);

    expect(screen.getByRole("button", { name: "Citation 1: OWASP Top 10 for LLM Applications 2025" })).toHaveTextContent("1");
    expect(screen.getByRole("button", { name: "Citation 2: threat-model.md" })).toHaveTextContent("2");
    expect(screen.queryByRole("button", { name: /Citation 3/ })).not.toBeInTheDocument();
    expect(screen.getByText(/See also \[3\]/)).toBeInTheDocument();
    const code = container.querySelector("p code");
    expect(code).toHaveTextContent("items[1]");
    expect(code?.querySelector("button")).toBeNull();

    const sources = screen.getByRole("region", { name: "Sources" });
    const items = within(sources).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("OWASP Top 10 for LLM Applications 2025");
    expect(items[0]).toHaveTextContent("LLM01:2025 Prompt Injection > Prevention and Mitigation Strategies");
    expect(items[0]).toHaveTextContent("Constrain model behavior");
    expect(items[0]).not.toHaveTextContent("Your upload");
    expect(items[1]).toHaveTextContent("threat-model.md");
    expect(items[1]).toHaveTextContent("Your upload");

    // Hybrid answers carry no badge.
    expect(screen.queryByText("Keyword search only")).not.toBeInTheDocument();
  });

  it("opens the full passage from a marker, with an https origin as a safe link", async () => {
    const fetchMock = mockPassages();
    const user = userEvent.setup();
    renderWithProviders(<MessageItem message={answer} modelName="Claude Haiku 5.5" />);

    await user.click(screen.getByRole("button", { name: "Citation 1: OWASP Top 10 for LLM Applications 2025" }));

    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText(/Segregate external content/)).toBeInTheDocument();
    expect(callsTo(fetchMock, "/api/knowledge/passages/p1")).toHaveLength(1);
    const origin = within(dialog).getByRole("link", { name: /genai\.owasp\.org/ });
    expect(origin).toHaveAttribute("href", "https://genai.owasp.org/llm-top-10/");
    expect(origin).toHaveAttribute("target", "_blank");
    expect(origin).toHaveAttribute("rel", "noopener noreferrer");
    expect(within(dialog).getByText("CC BY-SA 4.0")).toBeInTheDocument();
    expect(within(dialog).getByText(/Shared Source · Curated/)).toBeInTheDocument();
    // The passage's own [1] is Source text, not a marker of this answer.
    expect(within(dialog).queryByRole("button", { name: /Citation/ })).not.toBeInTheDocument();
  });

  it("opens an upload from the Sources list, labelled as the user's own, with its origin as text", async () => {
    mockPassages();
    const user = userEvent.setup();
    renderWithProviders(<MessageItem message={answer} modelName="Claude Haiku 5.5" />);

    const sources = screen.getByRole("region", { name: "Sources" });
    await user.click(within(sources).getByRole("button", { name: /threat-model\.md/ }));

    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText("Not recorded")).toBeInTheDocument();
    expect(within(dialog).getByText("Your upload")).toBeInTheDocument();
    expect(within(dialog).queryByRole("link")).not.toBeInTheDocument();
    expect(within(dialog).getAllByText("threat-model.md").length).toBeGreaterThan(0);
  });

  it("explains a passage that is gone", async () => {
    mockFetch(() => jsonResponse(404, { detail: "Not found" }));
    const user = userEvent.setup();
    renderWithProviders(<MessageItem message={answer} modelName="Claude Haiku 5.5" />);

    await user.click(screen.getByRole("button", { name: "Citation 2: threat-model.md" }));

    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("This passage is no longer available");
    expect(within(dialog).getByText(upload.snippet)).toBeInTheDocument();
  });

  it("marks answers that used keyword search only", () => {
    renderWithProviders(
      <MessageItem message={{ ...answer, retrieval_mode: "bm25", citations: [] }} modelName="Claude Haiku 5.5" />,
    );
    expect(screen.getByText("Keyword search only")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Sources" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Citation/ })).not.toBeInTheDocument();
  });

  it("leaves markers as text in Markdown outside an answer", () => {
    render(<Markdown content={"See [1].\n\n- item [2]"} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText("See [1].")).toBeInTheDocument();
    expect(screen.getByText("item [2]")).toBeInTheDocument();
  });
});
