import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ModelPicker } from "@/components/conversation/ModelPicker";
import { model } from "@/test/helpers";

const models = [
  model({ id: "anthropic/claude-haiku-5.5", display_name: "Claude Haiku 5.5", tier: "cheap" }),
  model({ id: "anthropic/claude-sonnet-5", display_name: "Claude Sonnet 5", tier: "powerful", enabled: false }),
  model({ id: "openai/text-embedding-3-small", display_name: "Embedding 3 small", kind: "embedding" }),
  model({ id: "ollama/qwen3:8b", display_name: "Qwen3 8B", provider: "ollama", available: false }),
];

describe("ModelPicker", () => {
  it("lists only enabled chat Models, with Provider and Tier and an unavailable marker", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ModelPicker models={models} value="anthropic/claude-haiku-5.5" onChange={onChange} />);

    const trigger = screen.getByRole("combobox", { name: "Model" });
    expect(trigger).toHaveTextContent("Claude Haiku 5.5");
    await user.click(trigger);

    const listbox = await screen.findByRole("listbox");
    const options = within(listbox).getAllByRole("option");
    expect(options).toHaveLength(2);
    expect(options[0]).toHaveTextContent("Claude Haiku 5.5");
    expect(options[0]).toHaveTextContent("OpenRouter");
    expect(options[0]).toHaveTextContent("Cheap");
    expect(options[0]).not.toHaveTextContent("unavailable");
    expect(options[1]).toHaveTextContent("Qwen3 8B");
    expect(options[1]).toHaveTextContent("Ollama");
    expect(options[1]).toHaveTextContent("unavailable");
    expect(within(listbox).queryByText("Claude Sonnet 5")).not.toBeInTheDocument();
    expect(within(listbox).queryByText("Embedding 3 small")).not.toBeInTheDocument();

    await user.click(options[1]);
    expect(onChange).toHaveBeenCalledWith("ollama/qwen3:8b");
  });

  it("offers embedding Models when asked for that kind", async () => {
    const user = userEvent.setup();
    render(<ModelPicker models={models} kind="embedding" value={null} onChange={vi.fn()} aria-label="Embedding Model" />);

    await user.click(screen.getByRole("combobox", { name: "Embedding Model" }));
    const options = within(await screen.findByRole("listbox")).getAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual([expect.stringContaining("Embedding 3 small")]);
  });

  it("keeps a disabled current Model visible and marked", async () => {
    const user = userEvent.setup();
    render(<ModelPicker models={models} value="anthropic/claude-sonnet-5" onChange={vi.fn()} />);

    await user.click(screen.getByRole("combobox", { name: "Model" }));
    const option = within(await screen.findByRole("listbox")).getByRole("option", { name: /Claude Sonnet 5/ });
    expect(option).toHaveTextContent("disabled");
  });
});
