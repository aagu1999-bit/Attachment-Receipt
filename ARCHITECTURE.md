# Slice — Architecture & State of Completion

A collaborative bill-splitting web app. Host scans a receipt, guests join by code/link, each guest claims the items they ate, fees split evenly by headcount, results page shows who owes whom.

This doc is the shared map: how the pieces fit, where the friction is, and what's left to do.

---

## 1. Stack & repo layout

pnpm workspaces monorepo, TypeScript 5.9, Node 24.

```
artifacts/
  api-server/       Express 5 + Socket.IO backend, /api routes
  slice-app/        React 19 + Vite + Wouter + TanStack Query frontend (the user-facing app)
  mockup-sandbox/   Component preview sandbox (dev-only, not shipped)
lib/
  db/               Drizzle ORM schema + migrations (Postgres)
  api-spec/         OpenAPI spec — single source of truth for the API
  api-zod/          Generated Zod schemas (orval, from api-spec)
  api-client-react/ Generated React Query hooks (orval, from api-spec)
scripts/            Placeholder build scripts (unused)
attached_assets/    Design reference images + original brief (reference only)
```

The OpenAPI → Zod → React Query codegen pipeline (orval) is the spine: API shape changes start in `lib/api-spec`, regen flows out from there with `pnpm --filter @workspace/api-spec run codegen`.

---

## 2. Session lifecycle (the state machine)

```
pending ──(host: POST /sessions/:code/start)──► open ──(host: POST /sessions/:code/finalize)──► closed
```

- **pending**: host is editing items, guests cannot join
- **open**: guests can join, claim items, submit; host can finalize
- **closed**: read-only results page

Status transitions are enforced in route handlers ([artifacts/api-server/src/routes/sessions.ts](artifacts/api-server/src/routes/sessions.ts) and [participants.ts](artifacts/api-server/src/routes/participants.ts)). Guests get rejected if they try to join a `pending` or `closed` session.

---

## 3. Endpoint reference

All endpoints under `/api`. Session code format: `XXXX-XXXX-XXXX` uppercase hex.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `POST` | `/sessions` | none | Host creates session. Returns `hostToken` + auto-enrolls host as a participant. |
| `GET` | `/sessions/:code` | none | Fetch session + items (with `claimedQuantity`) + participants. |
| `POST` | `/sessions/:code/receipt` | none | OCR receipt image via Mindee v2. Returns parsed items but **does not persist**. |
| `PUT` | `/sessions/:code/items` | `hostToken` | Host writes the reviewed item list + tax/tip/fees. Status must be `pending`. |
| `POST` | `/sessions/:code/start` | `hostToken` | `pending` → `open`. Emits `session:started`. |
| `POST` | `/sessions/:code/join` | none | Guest joins. Returns `participantToken`. Emits `participant:joined`. |
| `GET` | `/sessions/:code/participants` | none | All participants + their selections. |
| `GET` | `/sessions/:code/participants/:id` | `participantToken` query | Re-validate stored guest credentials on page reload. |
| `POST` | `/sessions/:code/select` | `participantToken` | Guest updates their claims (transactional, locks items). Emits `selection:updated`. |
| `POST` | `/sessions/:code/submit` | `participantToken` | Guest locks order. Emits `participant:submitted`. |
| `POST` | `/sessions/:code/unsubmit` | `participantToken` | Guest re-opens their order. |
| `PATCH` | `/sessions/:code/headcount` | `hostToken` | Adjust fee-split divisor (1–50). Emits `session:headcount_updated`. |
| `POST` | `/sessions/:code/finalize` | `hostToken` | `open` → `closed`, runs split algorithm. Emits `session:finalized` w/ full result. |
| `GET` | `/sessions/:code/results` | none | Public read of the finalized split. |

**Auth model:**
- `hostToken` (UUID, 48 chars) — set on session create, stored in `localStorage[slice_host_${code}]`
- `participantToken` (48 hex) — set on join, stored in `localStorage[slice_participant_${code}]` + `localStorage[slice_token_${code}]`
- Host is also auto-enrolled as a participant on session create, so the host has *both* tokens.

---

## 4. OCR pipeline ([ocrService.ts](artifacts/api-server/src/lib/ocrService.ts))

**Provider: Google Gemini 2.0 Flash.** Single-call vision model — image in, structured JSON out.

1. **Build the request**: detect mime type from base64 magic bytes (JPEG / PNG / WebP), instantiate the Gemini client with `responseMimeType: "application/json"` and `temperature: 0` for deterministic parsing.
2. **Send**: one call to `model.generateContent([{ inlineData }, EXTRACTION_PROMPT])`. The prompt instructs the model to extract `merchantName`, `items[]`, `tax`, `tip`, `otherFees` with explicit rules — strip leading quantity from item names, divide line totals by qty for unit price, skip POS branding (Toast/Square/Clover) in favor of the real restaurant name, treat auto-gratuity as tip, etc.
3. **Parse** ([parseGeminiResponse](artifacts/api-server/src/lib/ocrService.ts#L100)): strip optional markdown fences, `JSON.parse`, normalize money fields to 2-decimal strings, coerce quantities to positive integers.

**Required env var**: `GEMINI_API_KEY` (single key, no model ID setup like Mindee required). Free tier: ~1500 requests/day.

**Mock fallback** triggers on missing key, API error, or JSON parse failure. Returns "The Hungry Fork Restaurant" with 6 items + `usedMock: true` so the frontend can show the amber "Couldn't auto-read" banner.

**Real-world timing**: ~1-3s. Much faster than the prior Mindee enqueue+poll flow because Gemini is synchronous.

**Previous provider**: Mindee v2 was used until commit `4b8b1cc`. Their free trial expired and the cheapest paid plan was $44/mo — not viable for a personal tool.

---

## 5. Split algorithm ([splitAlgorithm.ts](artifacts/api-server/src/lib/splitAlgorithm.ts))

```ts
feesPerPerson = (tax + tip + otherFees) / max(headcount, 1)
foodSubtotal[p] = sum over selections of (unitPrice * quantity)
totalOwed[p]    = foodSubtotal[p] + feesPerPerson
```

Notes:
- **Fees divide by `headcount`, not by `participants.length`** — this lets a 7th person at the table (who didn't use the app) still get represented in the split.
- **Multi-claim items split by unit, not by share**: if "Beer ×2" exists and Alice claims 1 and Bob claims 1, each is charged the full unit price. No proportional discount.
- **Settlement model is payer-collects-from-others**: every settlement string is `"X owes ${payerName} $Y"`. No P2P optimization (intentional — keeps it simple).

---

## 6. Database schema ([lib/db/src/schema/](lib/db/src/schema/))

Four tables. **All money is `text`** (preserves OCR strings exactly, parsed to float only at compute time). No DB-level foreign keys — referential integrity is enforced in app code.

- **sessions**: `id, code (uniq), merchantName, tax, tip, otherFees, payerName, hostName, hostToken, headcount, status, createdAt`
- **participants**: `id, sessionId, name, participantToken, submitted, createdAt`
- **receipt_items**: `id, sessionId, name, unitPrice, quantity, createdAt`
- **selections**: `id, participantId, itemId, quantity` — UNIQUE(participantId, itemId)

The `select` endpoint uses Postgres `FOR UPDATE` row locks to safely validate that `othersClaimed + myClaim ≤ item.quantity` under concurrent claims (sessions.ts ~line 350).

---

## 7. WebSocket layer ([socketServer.ts](artifacts/api-server/src/lib/socketServer.ts))

Socket.IO mounted at `/api/socket.io`. Single room pattern: `session:${code}`.

| Event | Direction | Payload |
|---|---|---|
| `join:session` | client → server | `code: string` |
| `leave:session` | client → server | `code: string` |
| `session:started` | server → room | full session |
| `session:finalized` | server → room | full split result |
| `session:headcount_updated` | server → room | `{ headcount }` |
| `participant:joined` | server → room | participant |
| `participant:submitted` | server → room | `{ id, name, submitted }` |
| `selection:updated` | server → room | `{ participantId, participantName, selections[], itemsRemaining[] }` |

Frontend hook ([use-socket.ts](artifacts/slice-app/src/hooks/use-socket.ts)) invalidates the session query on every event so React Query refetches — simple, reliable, slightly wasteful.

---

## 8. Frontend pages ([artifacts/slice-app/src/pages/](artifacts/slice-app/src/pages/))

| Page | Route | What happens |
|---|---|---|
| [home.tsx](artifacts/slice-app/src/pages/home.tsx) | `/` | Branding + "Start splitting" + "Join by code" entry. |
| [host-setup.tsx](artifacts/slice-app/src/pages/host-setup.tsx) | `/host` | 3-step wizard: details → receipt upload (or skip) → review items / tax / tip → "Open Session". |
| [host-lobby.tsx](artifacts/slice-app/src/pages/host-lobby.tsx) | `/host/:code` | Live lobby: copy-link, participant status, item claim progress, host's own item-picker, headcount ±, "Calculate Totals". |
| [join.tsx](artifacts/slice-app/src/pages/join.tsx) | `/join/:code` | Guest enters name → joins → if session not yet open, waits for `session:started` socket event then auto-navigates to `/select`. |
| [select.tsx](artifacts/slice-app/src/pages/select.tsx) | `/select/:code` | Guest claims items (checkbox for qty=1, ± controls for qty>1), sees live "X of Y available", Submit Order → confirmation w/ Edit. |
| [results.tsx](artifacts/slice-app/src/pages/results.tsx) | `/results/:code` | "Your share" card, settlements list, full breakdown table, "Copy Results Link". |

LocalStorage keys (per session):
- `slice_host_${code}` — host token
- `slice_participant_${code}` — participant ID
- `slice_token_${code}` — participant token

---

## 9. Friction analysis — where the 5–10 minutes goes

Walking the happy path for a 5-person table:

| Step | Time | Why |
|---|---|---|
| Host fills name + headcount | ~10s | 2 inputs, no defaults |
| Host snaps + uploads receipt | ~5s | Camera flow |
| **OCR polling (Mindee)** | **5–10s** | Network-bound, can't shortcut |
| Host reviews/edits items + tax/tip | ~15s | Necessary; OCR is imperfect |
| Host starts session, copies link | ~5s | One tap |
| **Sharing link to each guest** | **20–40s** | Group iMessage / AirDrop / typing the code |
| **Each guest opens link, types name** | **N × ~15s** | Sequential; nobody starts until they get the message |
| Each guest claims items | N × ~15s | Mostly happens in parallel after join |
| Each guest submits | N × ~3s | One tap |
| Host finalizes | ~2s | Instant |
| **Out-of-band Venmo/CashApp dance** | **60–120s** | Type recipient, type amount, type note, repeat per guest |
| **Total** | **3–6 min** for 5 guests | |

### The four costliest steps and how to crush them

1. **Link distribution → QR code on host-lobby** (~30s saved per table)
   - Host holds up phone, table scans with native camera, done.
   - Add `qrcode` package, render a big QR on [host-lobby.tsx](artifacts/slice-app/src/pages/host-lobby.tsx) next to the existing "Copy Link" card.
   - Effort: ~1 hr.

2. **Out-of-band settlement → Venmo/CashApp/Zelle deep links** (~60–120s saved per table)
   - On [results.tsx](artifacts/slice-app/src/pages/results.tsx), each settlement row gets buttons: `venmo://paycharge?txn=pay&recipients={payer}&amount={x}&note=Slice` etc.
   - Payer's handles are entered once during host-setup (Venmo `@`, CashApp `$`, Zelle phone/email).
   - Effort: ~3 hrs (handle entry UI + URI building + per-platform testing).

3. **OCR wait → kick off in parallel + skeleton review** (~5–10s perceived)
   - Today: host clicks "Continue" → OCR is foreground-blocking → review screen.
   - Better: when the host hits "Take photo", upload immediately while they fill in tax/tip from memory; review screen pre-renders skeleton rows that get filled in as OCR resolves.
   - Effort: ~half day (state machine in host-setup gets meaningfully more complex).

4. **Each-guest-types-name → "Quick add" preset names from host's contacts/prior sessions** (~10s saved per guest)
   - Out of scope for v1 — needs auth or address-book access. Skip for now.

The combined wins of #1 + #2 alone take a 5-person split from ~4 minutes to **~90s**. Adding #3 takes it to **~60s**. Hitting "couple of seconds" would require eliminating the per-guest item-claiming step entirely — and that's the whole *point* of this app (per-person item review), so we shouldn't kill it.

**Realistic target**: 60–90s for a 5-person dinner. That's a 4–6× improvement, and it's mostly UX polish, not architectural change.

---

## 10. State of completion

### Built and working
- Full session lifecycle (create → open → close)
- Mindee v2 OCR with mock fallback
- Real-time multi-device collaboration via Socket.IO
- Concurrent-claim safety via transactional row locks
- Headcount-based fee splitting
- Edit-after-submit flow (unsubmit + reselect)
- Public results page with identity picker (anyone with code can view, no login)
- Guest session recovery (closes tab → reopens → still in)

### Missing / incomplete (high-impact, ordered by value-per-hour)
1. **QR code on host-lobby** — biggest UX win, smallest effort. **~1 hr.**
2. **Payment deep links on results** — second biggest UX win, completes the "dinner table → done" loop. **~3 hrs.**
3. **OCR perceived-latency improvement** — parallel upload + skeleton. **~half day.**
4. **`otherFees` extraction from OCR** — currently always `0`; service charges and delivery fees go uncounted. **~2 hrs.**
5. **No duplicate-name handling** — two "Mike"s collide on results page. **~1 hr.**
6. **No client-side image size validation** — 10MB server limit silently rejects bigger files. **~30 min.**

### Missing (lower-priority, infra)
- Zero tests (no `.test.ts` / `.spec.ts` anywhere — split algorithm especially needs unit tests)
- No CI/CD (no `.github/workflows`)
- No analytics / error monitoring (no Sentry-style integration)
- No session expiry / cleanup job

### Verdict
**This is a near-complete MVP, not an unfinished project.** Core math is correct, real-time works, the UX flows make sense, recent commits are polish (session resumption, live status strips, copy-fix). The path from "working today" to "delightful at the dinner table" is the friction list in §9 — primarily QR + payment deep links. **Both are additive features, not refactors.**

---

## 11. Where to look first when changing things

- **Adding an API endpoint**: edit [lib/api-spec/](lib/api-spec/) OpenAPI → run `pnpm --filter @workspace/api-spec run codegen` → implement in [artifacts/api-server/src/routes/](artifacts/api-server/src/routes/) → use new generated hook in slice-app.
- **Changing split logic**: [splitAlgorithm.ts](artifacts/api-server/src/lib/splitAlgorithm.ts) — pure function, no I/O, easy to unit-test (once tests exist).
- **Tweaking OCR field mapping**: [parseMindeeV2Result()](artifacts/api-server/src/lib/ocrService.ts#L225).
- **Adding a real-time event**: emit from a route via `emitToSession()` in [socketServer.ts](artifacts/api-server/src/lib/socketServer.ts), listen in [use-socket.ts](artifacts/slice-app/src/hooks/use-socket.ts).
- **Auth on a guest action**: validate `participantToken` against `participants.participantToken` for the given `participantId` + `sessionId` (pattern in [participants.ts](artifacts/api-server/src/routes/participants.ts)).
- **Auth on a host action**: validate `hostToken` against `sessions.hostToken` for the given `code`.

---

*Generated 2026-05-12. Update this file when the architecture changes — it's the contract between conversations.*
