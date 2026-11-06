---
status: accepted
date: 2026-11-06
---

# React single-page app served by a FastAPI backend

The original P6 specification (version 1.0) called for a Streamlit multi-page UI, which would have put the whole application, including the security controls, behind Streamlit's session model and limited how approval cards, streaming answers and admin pages could look and behave. We decided to split the product into a FastAPI backend that owns every control (authentication, roles, the Gateway, Guards, Approvals, cost accounting) and a React single-page app (Vite, TypeScript, Tailwind CSS, shadcn/ui, React Router, TanStack Query) that is only a client of the JSON and server-sent-event API. The split costs a second toolchain, a build step and an API contract (`docs/API.md`), and it was chosen because the user wants a polished interface, because the controls must be enforced server-side regardless of the client, and because an explicit API makes the Gateway testable without a browser.

## Consequences

- Every rule is enforced in backend services; the frontend only hides what a role cannot use.
- FastAPI serves the production build and falls back to `index.html` for client routes; Vite proxies `/api` in development.
- Browser end-to-end tests are out of scope for version one; the frontend is covered by type checking, lint, a production build and a few Vitest tests, and the backend by pytest.
