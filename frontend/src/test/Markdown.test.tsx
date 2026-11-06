import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Markdown } from "@/components/conversation/Markdown";

describe("Markdown", () => {
  it("renders GFM tables and fenced code with a copy button", () => {
    const { container } = render(
      <Markdown content={"| a | b |\n|---|---|\n| 1 | 2 |\n\n```python\nprint('hi')\n```"} />,
    );
    expect(container.querySelector("table")).not.toBeNull();
    expect(container.querySelector("pre code")).toHaveTextContent("print('hi')");
    expect(screen.getByText("python")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy code" })).toBeInTheDocument();
  });

  it("never renders raw HTML or javascript links, and does not load images", () => {
    const { container } = render(
      <Markdown
        content={
          'before <script>window.pwned = true</script> <img src="https://x.test/t.png" onerror="alert(1)"> after\n\n' +
          "[click](javascript:alert(1))\n\n![diagram](https://x.test/d.png)"
        }
      />,
    );
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("before");
    expect(container.textContent).toContain("after");
    const link = screen.getByText("click");
    expect(link.getAttribute("href") ?? "").not.toMatch(/^javascript:/i);
    expect(screen.getByText("[image: diagram]")).toHaveAttribute("href", "https://x.test/d.png");
  });
});
