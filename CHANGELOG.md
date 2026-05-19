# Changelog

All notable changes to the SDP MCP Server are documented here.

## [Unreleased] — 2026-05-19 (session 4)

### Bug Fixes
- **Fixed `advancedSearchRequests` criteria normalisation** (`sdp-api-client-v2.cjs`) — four
  issues corrected against the SDP v3 API documentation:
  1. Single-element criteria array now unwrapped to a plain object before sending — the API
     expects an object for single criteria, not a one-element array.
  2. `logical_operator` is now stripped from the first criterion in multi-element arrays —
     the API rejects queries where the first item carries `logical_operator`.
  3. `page` parameter replaced with `start_index: (page-1) * rowCount` — aligns with
     `listRequests` and the primary documented pagination parameter.
  4. `display_id` lookup in `get_request` now passes the value as an integer (`parseInt`) —
     `display_id` is type `long` in the API; sending a string caused a type mismatch.

## [Unreleased] — 2026-05-19 (session 3)

### New Features
- **`get_request` accepts display_id** (`src/tools/requests.cjs`) — the tool now resolves
  short human-readable ticket numbers (e.g. `31230`) to the internal 17-digit ID
  automatically via `advanced_search_requests` before fetching full details. IDs of 10
  digits or fewer are treated as display_ids; longer IDs are passed directly as before.
  The schema description is updated to document both formats.

## [Unreleased] — 2026-05-19 (session 2)

### Refactoring
- **Modularised `working-sse-server.cjs`** — slimmed from 1769 to 246 lines using a factory
  function pattern (`makeImplementations(sdpClient)`). Tool implementations extracted into
  three focused modules:
  - `src/tools/requests.cjs` — 16 request tools (list, get, create, update, close, notes,
    replies, search, delete, attachment, conversation)
  - `src/tools/technicians.cjs` — 3 technician tools (list, get, find)
  - `src/tools/metadata.cjs` — get_metadata, get_usage_guide, claude_code_command
- **Extracted MCP Resources** into `src/mcp-resources.cjs` — server now uses
  `listResources()` / `readResource()` from this module; `metadata.cjs` uses the same
  module for `get_usage_guide`, eliminating the inline `SDP_RESOURCES` constant.

### New Features
- **MCP Prompts** (`src/mcp-prompts.cjs`) — four prompt templates wired to `prompts/list`
  and `prompts/get` protocol handlers; `prompts: {}` declared in `initialize` capabilities:
  - `resolve_request` — get → update → reply → close workflow
  - `triage_request` — get → get_metadata → update → reply workflow
  - `escalate_request` — get → find_technician → update → add_private_note → reply workflow
  - `follow_up_request` — get_request_conversation → reply workflow
  All templates use "request" terminology throughout (not "ticket").
- **Input validation at tool layer** (`src/tools/requests.cjs`) — three validators applied
  before any API call:
  - `subject` truncation prevented: error thrown if > 250 characters
  - `impact_details` truncation prevented: error thrown if > 250 characters
  - `closure_code` validated against known enum (Resolved, Cancelled, Duplicate, Closed,
    On Hold, Open) with a clear error message listing valid values
- **Richer `/health` endpoint** — now async; performs a live OAuth token probe via
  `sdpClient.testConnection()` and returns `auth_status` (ok / failed / error /
  not_configured), `instance`, `base_url`, and `data_center` alongside existing fields.

### Dead Code Removal
- Deleted `src/sdp-api-client.cjs` — superseded by `sdp-api-client-v2.cjs`
- Deleted `src/sdp-api-client-enhanced.cjs` — no importers
- Deleted `src/simple-sse-server.cjs` — superseded by `working-sse-server.cjs`
- Deleted `src/index-sse-simple.ts` — unused TypeScript entry point
- Deleted `src/index.ts` — unused TypeScript entry point

## [Unreleased] — 2026-05-19

### Bug Fixes
- **Fixed API base URL** (`sdp-api-client-v2.cjs`, `sdp-api-metadata.cjs`) — the path
  `/app/{portalName}` was incorrectly prepended to all API calls. The SDP v3 API base path
  is `{SDP_BASE_URL}/api/v3` with no portal name segment. Corrected in both files.
- **Fixed infinite 401 retry loop** (`sdp-api-client-v2.cjs`) — the axios response
  interceptor re-entered itself on a token-refresh retry, producing an unbound loop on
  authentication failures. Fixed with an `_retry` flag on the request config that caps
  the refresh at one attempt per request.
- **Fixed `testConnection()` calling an unreachable endpoint** (`sdp-api-client-v2.cjs`)
  — startup connection test was calling `GET /priorities`, which returns a Tomcat HTML 401
  on some SDP instances. Changed to OAuth token acquisition only; if a valid token is
  returned the connection is considered healthy.

### Environment / Configuration
- **Unified `SDP_INSTANCE_NAME` into `SDP_PORTAL_NAME`** — both variables referred to the
  same value. `SDP_INSTANCE_NAME` has been removed; `SDP_PORTAL_NAME` now serves both the
  portal name and instance name roles across all three source files.
- **Corrected OAuth env var names in `.env.example` and `README.md`** — references to
  `SDP_OAUTH_CLIENT_ID`, `SDP_OAUTH_CLIENT_SECRET`, and `SDP_OAUTH_REFRESH_TOKEN` replaced
  with the correct names: `SDP_CLIENT_ID`, `SDP_CLIENT_SECRET`, `SDP_REFRESH_TOKEN`.
- **Azure / cloud deployment support** (`working-sse-server.cjs`) — server now binds to
  `process.env.PORT` so it works on Azure App Service (which injects `PORT=8080`)
  without manual configuration.
- **Added startup environment diagnostics** (`working-sse-server.cjs`) — logs
  `SDP_BASE_URL`, `SDP_PORTAL_NAME`, `SDP_CLIENT_ID` (set/not set), `SDP_REFRESH_TOKEN`
  (set/not set), and `SDP_DATA_CENTER` at boot for faster misconfiguration diagnosis.

### Documentation
- **Added `SDP-MCP_Usage.md`** — comprehensive AI context reference covering all tools,
  field formats, error codes, action sequences, and the tool decision matrix. Intended as
  a system prompt supplement for agents consuming this MCP server.
- **Updated `README.md`** — corrected environment variable names, documented the API URL
  fix, added Azure deployment troubleshooting section, updated status date.

### New Features
- **Implemented MCP Resources** (`working-sse-server.cjs`) — server now advertises six
  named resources sourced from `SDP-MCP_Usage.md`:
  - `sdp://usage/api-rules` — Critical API Rules
  - `sdp://usage/field-formats` — Field Format Reference
  - `sdp://usage/tool-reference` — Full Tool Reference
  - `sdp://usage/error-codes` — Error Code Reference
  - `sdp://usage/action-sequences` — Common Action Sequences
  - `sdp://usage/decision-matrix` — Tool Decision Matrix
  Handlers added for `resources/list` and `resources/read`. The `resources: {}`
  capability is declared in the `initialize` response.
- **Added `get_usage_guide` tool** (`working-sse-server.cjs`) — MCP tool that returns any
  of the six resource sections as both a `text` and a typed `resource` content item,
  satisfying the Microsoft Copilot Studio requirement that resources be surfaced as tool
  outputs.

## [Unreleased] — 2026-05-15

### Security
- **Removed hardcoded credentials from `CLAUDE.md`** — plaintext PostgreSQL passwords replaced with `(set via SDP_DB_PASSWORD environment variable)` and `(set via SDP_DB_ROOT_PASSWORD environment variable)`.
- **Removed hardcoded OAuth credentials from `sdp-oauth-client.cjs`** — constructor no longer contains fallback client ID/secret strings; all credential values must come from environment variables (`SDP_CLIENT_ID`, `SDP_CLIENT_SECRET`, `SDP_OAUTH_REFRESH_TOKEN`).
- **Removed hardcoded customer-specific fallback values** from `sdp-api-client-v2.cjs`, `sdp-api-metadata.cjs`, and `working-sse-server.cjs` — portal name (`kaltentech`), custom domain (`https://helpdesk.pttg.com`), and instance name (`itdesk`) are no longer hardcoded; all must be supplied via environment variables (`SDP_PORTAL_NAME`, `SDP_BASE_URL`, `SDP_INSTANCE_NAME`).
- **Removed hardcoded server IP** (`10.212.0.7`) from startup log in `working-sse-server.cjs` — replaced with `process.env.SERVER_HOST || 'localhost'`.
- **Removed hardcoded local paths** (`/Users/kalten/projects/SDP-MCP`) from `working-sse-server.cjs` claude_code_command handler — replaced with `process.cwd()`.

### Runtime
- **Updated Node.js engine requirement** in `package.json` from `>=20.0.0` to `>=22.0.0` to match the current LTS target and remove the deprecated runtime warning.
- **Updated `@types/node`** dev dependency from `^20.12.0` to `^22.0.0` to match.

### Bug Fixes
- **Fixed `closure_code` 400 error on close request** (`sdp-api-client-v2.cjs`) — the SDP v3 API requires all reference fields to be objects. `closure_code` was being sent as a plain string (`"Resolved"`); corrected to `{ name: "Resolved" }`.
- **Fixed `resolution` field format** — `resolution` was being sent as a plain string in both `updateRequest` and `closeRequest`. Corrected to always send as `{ content: "..." }` per the API spec. Normalisation applied: string input is automatically wrapped; object input is passed through unchanged.
- **Fixed `start_index` pagination** in `listRequests` and `searchRequests` — was incorrectly set to `1` when offset was `0`. The SDP v3 API uses 0-based `start_index`; corrected to pass `offset` directly.
- **Fixed priority name regression** in `listRequests` and `updateRequest` — `'z - Medium'` was incorrectly changed to `'2 - Medium'` during a prior edit. Reverted to `'z - Medium'`, which is the actual priority name configured in this SDP instance (confirmed via `sdp-api-metadata.cjs` which maps `p.name === 'z - Medium'`).

### New Features

#### API Client (`sdp-api-client-v2.cjs`)
- **Added `deleteRequest(requestId)`** — sends `DELETE /api/v3/requests/{id}`.
- **Added `addAttachment(requestId, filePath, fileName)`** — sends `POST /api/v3/requests/{id}/attachments` using a raw multipart/form-data body constructed from a file `Buffer`; no new runtime dependencies.
- **Added shared `PRIORITY_NAMES` constant** at module level — single source of truth for the priority name map (`low` → `1 - Low`, `medium` → `z - Medium`, `high` → `3 - High`, `urgent` → `4 - Critical`). All three previously duplicated inline `priorityMap` objects in `listRequests` (×2) and `updateRequest` have been replaced with references to this constant.
- **Re-enabled `requester` field on `createRequest`** — previously skipped with a comment about validation errors. Now sends `requester: { email_id }` when `requester_email` is provided, `{ name }` when `requester_name` is provided, or passes through an object directly.
- **Re-enabled `priority` on `createRequest`** — previously commented out. Now included using `PRIORITY_NAMES` lookup.
- **Removed hardcoded subcategory default** — `createRequest` previously always injected `subcategory: { name: 'Not in list' }` (with customer-specific category ID checks) when no subcategory was supplied. The field is now omitted entirely when not provided by the caller, letting SDP apply its own defaults.

#### SSE Server (`working-sse-server.cjs`)
- **Added `delete_request` tool** — exposes `deleteRequest` to MCP clients. Required field: `request_id`.
- **Added `add_attachment` tool** — exposes `addAttachment` to MCP clients. Required fields: `request_id`, `file_path`. Optional: `file_name`.
- **Added `resolution` field** to `close_request` tool schema and handler.
- **Expanded `closure_code` enum** on `close_request` — added `Closed`, `On Hold`, and `Open` to the existing `Resolved`, `Cancelled`, `Duplicate` options.
- **Wired technician tools to real `SDPUsersAPI`** — `list_technicians`, `get_technician`, and `find_technician` were returning hardcoded stub responses claiming the `/users` endpoint does not exist. They now call `sdpClient.users.listTechnicians()`, `sdpClient.users.getTechnician()`, and `sdpClient.users.findTechnician()` respectively (the `SDPUsersAPI` class in `sdp-api-users.cjs` was already fully implemented).
- **Expanded `create_request` schema** — added: `requester_name`, `urgency`, `impact`, `level`, `mode`, `request_type`, `group`, `site`, `template`, `due_by_time`, `impact_details`, `email_ids_to_notify`.
- **Expanded `update_request` schema** — added: `update_reason`, `due_by_time`, `urgency`, `impact`, `level`, `group`, `site`, `scheduled_start_time`, `scheduled_end_time`; status enum extended with `'in progress'` and `'on hold'`.
- **Added `advanced_search_requests` tool** — exposes `advancedSearchRequests` to MCP clients. Accepts a structured `criteria` array (field, condition, value, logical_operator), with `limit`, `page`, `sort_by`, and `sort_order` options. Enables complex multi-field queries (e.g., filter by requester + date range + priority in a single call).

#### Metadata Client (`sdp-api-metadata.cjs`)
- **`getStatuses()` now tries the API first** — previously always returned a hardcoded list because the endpoint was assumed to return 404. It now attempts `GET /statuses`; uses the API response when successful, falls back to the hardcoded list on error or empty response.

### API Conformance
Audited all SDP v3 API calls against the official documentation. Key findings applied:
- All reference fields (priority, status, category, subcategory, closure_code, requester, technician, mode, request_type, urgency, impact, level) are sent as objects (`{ name: "..." }` or `{ id: "..." }`), not plain strings.
- `input_data` is sent as a URL query parameter on all request methods (GET, POST, PUT, DELETE), with a `null` body on POST/PUT.
- `Authorization` header uses `Zoho-oauthtoken <token>` format (not `Bearer`).
- `start_index` is 0-based.
- `row_count` maximum is 100 per API limits.
- Close request uses `POST /api/v3/requests/{id}/close`, not PUT.
- Subject and `impact_details` fields are validated to 250-character maximum before sending.
