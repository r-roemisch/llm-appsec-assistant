# Rampart frontend

The React single-page app for Rampart, an assistant for reviewing the security of LLM applications. It is only a client of the backend's JSON and server-sent-event API; every rule is enforced server-side (see `docs/adr/0001-react-spa-on-fastapi.md`).

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Vite dev server on http://127.0.0.1:5173, proxying `/api` to the backend on http://127.0.0.1:8000 |
| `npm run build` | type check (`tsc -b`) then production build into `dist/` |
| `npm run typecheck` | `tsc -b --noEmit` |
| `npm run lint` | ESLint, zero warnings allowed |
| `npm run test` | Vitest (jsdom, Testing Library) |
| `npm run preview` | serve the production build locally |

Stack: React 19, Vite 8, TypeScript 6, Tailwind CSS 4, shadcn/ui (Radix), React Router 8, TanStack Query 5, react-markdown with remark-gfm, Vitest.

## The API contract

`docs/API.md` at the repository root is the contract. `src/lib/api.ts` is the only module that calls the backend: it sends `credentials: "same-origin"`, keeps the CSRF token from the last `SessionOut` in memory (never in storage) and attaches it as `X-CSRF-Token` to POST, PUT, PATCH and DELETE (not to login), URL-encodes Model ids, and on any 401 outside login clears the session and sends the app to `/login`. `src/lib/sse.ts` parses the event stream of `POST /api/conversations/{id}/messages`; `src/lib/live-turn.ts` drives one streaming turn and reconciles the TanStack Query cache when it ends.

In production FastAPI serves `dist/` at `/` and falls back to `index.html` for client routes. `vite.config.ts` sets `base: "/"` and `build.outDir: "dist"`.

## Routes

| Route | Who | Page |
|---|---|---|
| `/login` | anyone | `src/pages/LoginPage.tsx`, with the health footer |
| `/` | signed in | `src/pages/ConversationPage.tsx`; the first message creates the Conversation and navigates to `/c/:id` |
| `/c/:id` | signed in | the same page showing one Conversation |
| `/account` | signed in | `src/pages/AccountPage.tsx`: change password, own usage |
| `/admin` | admin | `src/pages/AdminPage.tsx`: users, Models and Slots, usage for everyone; a `user` sees "Not allowed" |

`src/App.tsx` holds the route table. `RequireSession` loads `GET /api/auth/me` once and redirects to `/login` when there is no session; `AppShell` is the sidebar layout around the signed-in pages.

## Layout of `src/`

- `lib/` – API client, SSE parser, formatters, theme store, live-turn store, types
- `hooks/` – TanStack Query hooks and small stores
- `components/ui/` – shadcn/ui components; `components/shell`, `conversation`, `admin`, `account`, `usage`, `common` – feature components
- `pages/` – one file per route
- `test/` – Vitest setup and tests

Only two things are kept in `localStorage`: the theme (`rampart.theme`) and whether the sidebar is collapsed (`rampart.sidebar`).
