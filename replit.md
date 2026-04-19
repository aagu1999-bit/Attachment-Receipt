# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)
- **Real-time**: Socket.io (server) + socket.io-client (frontend)

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

## Artifacts

### Slice — Bill Splitter (artifacts/slice-app)
A collaborative real-time bill-splitting web app.
- **Frontend**: React + Vite at `/` (previewPath)
- **Backend**: Express API at `/api`
- **Real-time**: Socket.io mounted at `/api/socket.io`

### API Server (artifacts/api-server)
- Serves all REST endpoints and Socket.io
- Port: 8080, paths: `/api`

## Application Architecture

### Session Lifecycle
1. `POST /api/sessions` — Host creates session (status: `pending`), gets `hostToken`
2. `POST /api/sessions/:code/receipt` — Host uploads receipt for OCR (Mindee API v2 or mock fallback)
3. `PUT /api/sessions/:code/items` — Host edits parsed items (requires `hostToken`)
4. `POST /api/sessions/:code/start` — Host opens session (status: `open`)
5. `POST /api/sessions/:code/join` — Participants join by name
6. `POST /api/sessions/:code/select` — Participants claim items (live WebSocket updates)
7. `POST /api/sessions/:code/submit` — Participant locks in selections
8. `POST /api/sessions/:code/finalize` — Host finalizes (status: `closed`), runs split algorithm
9. `GET /api/sessions/:code/results` — Returns final per-person amounts

### Split Algorithm
- Food cost: per-person based on what they claimed
- Fees (tax + tip + otherFees): split evenly by headcount
- Returns: itemsEaten[], foodSubtotal, feesShare, totalOwed per participant + settlement instructions

### Database Schema (lib/db/src/schema/)
- `sessions` — code (UPPERCASE), hostToken, merchantName, tax, tip, otherFees, payerName, hostName, status
- `participants` — sessionId, name, submitted
- `receipt_items` — sessionId, name, unitPrice (text), quantity
- `selections` — participantId, itemId, quantity

### Session Codes
Session codes are UPPERCASE hex format: `XXXX-XXXX-XXXX` (e.g., `21D0-AE96-3E9E`)

### Frontend State
- `localStorage["slice_host_${code}"]` — hostToken for host authentication
- `localStorage["slice_participant_${code}"]` — participantId for participant flows

### WebSocket Events
- `join:session` (emit) — join room by code
- `selection:updated` — another participant updated item claims
- `participant:joined` — new participant joined
- `participant:submitted` — participant locked in order
- `session:started` — host opened session (pending → open)
- `session:finalized` — host finalized (navigate to results)

## Frontend Pages (artifacts/slice-app/src/pages/)
- `home.tsx` — Landing: "Start splitting" + "Join a session" by code
- `host-setup.tsx` — Multi-step: name/payer → receipt upload/skip → item review → start session
- `host-lobby.tsx` — Shows shareable link, participant status, item claim progress, finalize button
- `join.tsx` — Participant entry: enter name, wait for open session
- `select.tsx` — Real-time item claiming with +/- controls, Submit Order
- `results.tsx` — Final breakdown per person with settlement instructions
- `not-found.tsx` — 404 page

### OCR Service (artifacts/api-server/src/lib/ocrService.ts)
- Uses **Mindee API v2** (`api-v2.mindee.net`) for real receipt scanning
- Requires two env vars: `MINDEE_API_KEY` (from app.mindee.com) and `MINDEE_MODEL_ID` (UUID of the expense receipts model in the Mindee account)
- Falls back to a mock receipt if the API key/model ID is missing or if the API call fails
- Flow: enqueue image via JSON `file_base64` → poll job until processed → fetch result → parse fields
- Mapped fields: `supplier_name` → merchantName, `line_items` → items, `total_tax` → tax, `tips_gratuity` → tip

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
