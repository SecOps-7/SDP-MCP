# Changelog

All notable changes to the SDP MCP Server are documented here.

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
