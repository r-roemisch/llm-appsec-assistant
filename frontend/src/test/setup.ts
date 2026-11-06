import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// jsdom lacks a few browser APIs that Radix primitives and the theme store use.
if (typeof window.matchMedia !== "function") {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string): MediaQueryList => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
}

if (typeof window.ResizeObserver === "undefined") {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  Object.defineProperty(window, "ResizeObserver", { writable: true, value: ResizeObserverStub });
}

const elementPrototype = window.Element.prototype as Element & Record<string, unknown>;
if (typeof elementPrototype.scrollIntoView !== "function") {
  elementPrototype.scrollIntoView = () => undefined;
}
if (typeof elementPrototype.hasPointerCapture !== "function") {
  elementPrototype.hasPointerCapture = () => false;
  elementPrototype.setPointerCapture = () => undefined;
  elementPrototype.releasePointerCapture = () => undefined;
}
