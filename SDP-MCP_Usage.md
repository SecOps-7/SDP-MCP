# SDP-MCP Usage Guide
## Service Desk Plus MCP Server — AI Context Reference

This document is intended as context for AI agents using the SDP-MCP server
to interact with Service Desk Plus Cloud. It covers all available tools, when
to use them, required field formats, and known API behaviours.

---

## Critical API Rules

These apply to every tool call without exception.

- **All reference fields must be objects**, never plain strings.
  Correct: `{ "name": "Hardware" }` — Wrong: `"Hardware"`
- **Resolution field format**: `{ "content": "your text here" }`
- **Closure code format**: `{ "name": "Resolved" }` (not a plain string)
- **Authorization header**: `Zoho-oauthtoken <token>` — NOT `Bearer`
- **input_data** is sent as a URL query parameter on all methods
- **start_index** is 0-based for pagination
- **row_count** maximum is 100 per request
- **Subject** field: 250 character maximum
- **impact_details** field: 250 character maximum
- You cannot update a closed ticket — always check status first with `get_request`

---

## Tool Reference

### 1. `get_request`
**Purpose:** Retrieve full details of a single request by ID.

**When to use:**
- Before executing any action sequence to confirm the request exists and is not already closed
- When you need current field values before an update
- To verify the requester, status, or assigned technician

**Required fields:**
- `request_id` — the numeric SDP request ID

**Important:** Always call this first. Never assume a request is open.

---

### 2. `list_requests`
**Purpose:** List requests with optional filters and pagination.

**When to use:**
- Browsing open requests for a technician or site
- Checking recent activity
- Fetching requests by status

**Key parameters:**
- `status` — e.g. `"Open"`, `"In Progress"`, `"Resolved"`, `"Closed"`
- `technician_email` — filter by assigned technician
- `row_count` — max 100 per page
- `start_index` — 0-based page offset
- `sort_by` / `sort_order` — field name and `"asc"` or `"desc"`

**Note:** Statuses `"Cancelled"`, `"Closed"`, and `"Resolved"` are all treated
as closed by the API.

---

### 3. `search_requests`
**Purpose:** Search requests using simple criteria.

**When to use:**
- Finding requests by requester, subject keyword, or category
- Narrower than list_requests but less complex than advanced_search_requests

**Key parameters:**
- `search_fields` — object with field/value pairs to match
- `row_count`, `start_index` — pagination

---

### 4. `advanced_search_requests`
**Purpose:** Complex multi-field search with logical operators.

**When to use:**
- Queries that require AND/OR logic across multiple fields
- Filtering by requester AND date range AND priority in a single call
- Any search that list_requests or search_requests cannot express

**Key parameters:**
- `criteria` — array of `{ field, condition, value, logical_operator }` objects
- `limit`, `page`, `sort_by`, `sort_order`

**Example criteria:**
```json
[
  { "field": "status.name", "condition": "is", "value": "Open", "logical_operator": "AND" },
  { "field": "technician.email_id", "condition": "is", "value": "jthomas@gmfus.org" }
]
```

---

### 5. `create_request`
**Purpose:** Create a new service desk request.

**When to use:**
- Only when creating a brand new ticket, not for updates

**Required fields:**
- `subject` — max 250 characters

**Optional but recommended:**
- `description` — HTML supported
- `requester_email` or `requester_name`
- `category` — as `{ "name": "..." }`
- `subcategory` — as `{ "name": "..." }` — omit if unknown, SDP applies defaults
- `site` — as `{ "name": "..." }`
- `technician` — as `{ "email_id": "..." }`
- `priority` — as `{ "name": "..." }` — valid names: `"1 - Low"`, `"z - Medium"`, `"3 - High"`, `"4 - Critical"`
- `urgency`, `impact`, `level`, `group`, `mode`, `request_type`

---

### 6. `update_request`
**Purpose:** Update fields on an existing open request.

**When to use:**
- Changing category, subcategory, site, technician, or status
- Any field update that is not a closure or a reply

**Required fields:**
- `request_id`

**Updatable fields (all as objects):**
- `category` → `{ "name": "Software / Platform" }`
- `subcategory` → `{ "name": "MS Office" }`
- `site` → `{ "name": "Berlin" }`
- `technician` → `{ "email_id": "jthomas@gmfus.org" }`
- `status` → `{ "name": "In Progress" }`
- `priority` → `{ "name": "3 - High" }`
- `group`, `urgency`, `impact`, `level` — all as `{ "name": "..." }`

**Known limitation:** Priority updates may return 403 in some SDP configurations.
This is an API-level restriction, not a bug.

**Do not use update_request to set the resolution field before closing.**
Pass resolution directly to `close_request` instead.

---

### 7. `close_request`
**Purpose:** Close a request with a resolution and closure code.

**When to use:**
- Only when response_type is `"solution"` and the fix is self-service
- Never use if response_type is `"follow_up"` or `"escalate"`

**Required fields:**
- `request_id`
- `resolution` → `{ "content": "one-sentence summary of resolution" }`
- `closure_code` → `{ "name": "Resolved" }`

**Available closure codes:** `"Resolved"`, `"Cancelled"`, `"Duplicate"`,
`"Closed"`, `"On Hold"`, `"Open"`

**Sequence:** `close_request` handles both the resolution and closure in a
single API call (`POST /api/v3/requests/{id}/close`). Do not call
`update_request` first to set resolution separately.

---

### 8. `delete_request`
**Purpose:** Permanently delete a request.

**When to use:**
- Only when explicitly instructed. This is irreversible.
- Never use as part of a standard action sequence.

**Required fields:**
- `request_id`

---

### 9. `reply_to_requester`
**Purpose:** Send an email reply to the requester that appears in the
ticket conversation thread.

**When to use:**
- ALWAYS use this tool when responding to a requester — not `add_note`
- `add_note` does NOT send an email. `reply_to_requester` does.

**Required fields:**
- `request_id`
- `reply_content` — the message body (HTML supported)

---

### 10. `send_first_response`
**Purpose:** Send the first formal response on a ticket with email notification.

**When to use:**
- Only for the very first response on a brand new ticket where SLA
  first-response time is being tracked
- For all subsequent replies use `reply_to_requester` instead

**Required fields:**
- `request_id`
- `response_content`

---

### 11. `add_note`
**Purpose:** Add a public note to a request visible to the requester.

**When to use:**
- Adding a visible note to the ticket record without sending an email
- If you need to email the requester, use `reply_to_requester` instead

**Required fields:**
- `request_id`
- `note_content`

---

### 12. `add_private_note`
**Purpose:** Add an internal note to a request that is NOT visible to the requester.

**When to use:**
- Recording escalation reasons
- Adding technician-facing context (e.g. internal_note from upstream agent)
- Any note that should not be seen by the requester

**Required fields:**
- `request_id`
- `note_content`

---

### 13. `get_request_conversation`
**Purpose:** Retrieve the full conversation history of a request including
all replies and notes.

**When to use:**
- Reviewing prior communication before responding
- Checking whether a requester has already been contacted

**Required fields:**
- `request_id`

---

### 14. `list_technicians`
**Purpose:** List all available technicians.

**When to use:**
- Browsing available technicians when no specific assignment is known

---

### 15. `get_technician`
**Purpose:** Get detailed information about a specific technician by ID.

**When to use:**
- When you have a technician ID and need their full profile

**Required fields:**
- `technician_id`

---

### 16. `find_technician`
**Purpose:** Look up a technician by name or email address.

**When to use:**
- When you need to resolve a name or email to a technician ID
- Not required if the upstream agent already supplies `assigned_technician_email`
  and the API accepts email directly

**Required fields:**
- `name` or `email`

---

### 17. `get_metadata`
**Purpose:** Retrieve valid dropdown values for SDP fields such as category,
subcategory, status, priority, closure codes, and sites.

**When to use:**
- Before calling `update_request` or `create_request` if you are unsure
  whether a field value is valid for this SDP instance
- To validate category/subcategory combinations before writing

---

### 18. `add_attachment`
**Purpose:** Attach a file to an existing request.

**When to use:**
- Only when explicitly instructed to attach a file

**Required fields:**
- `request_id`
- `file_path` — path to the file on the server

**Optional:**
- `file_name` — display name for the attachment

---

### 19. `claude_code_command`
**Purpose:** Execute a Claude Code command on the MCP server host.

**When to use:**
- Never use this tool as part of any request fulfilment workflow.
  It is a developer utility only.

---

## Tool Decision Matrix

| Task | Tool to use |
|---|---|
| Check if a request exists / get current state | `get_request` |
| Update category, subcategory, site, technician | `update_request` |
| Send a reply the requester receives by email | `reply_to_requester` |
| Add an internal note for the technician only | `add_private_note` |
| Add a note visible to the requester (no email) | `add_note` |
| Close a resolved ticket | `close_request` |
| Find requests matching criteria | `search_requests` or `advanced_search_requests` |
| Validate a field value before writing | `get_metadata` |
| Check prior communication | `get_request_conversation` |

---

## Common Action Sequences

### Standard Solution
```
get_request → update_request → reply_to_requester → close_request
```

### Follow-Up Question
```
get_request → update_request → reply_to_requester
```

### Escalation
```
get_request → update_request (reassign technician) → add_private_note → reply_to_requester
```

---

## Error Code Reference

| Code | Meaning | Action |
|---|---|---|
| 401 / UNAUTHORISED | OAuth token invalid or expired | Token refresh handled automatically |
| 403 | Permission denied (e.g. priority update blocked) | API limitation, skip the field |
| 400 / 4012 | Mandatory field missing | Check required fields for the operation |
| 4000 | General failure | Read the `error_messages` array for detail |
| 4002 | Unauthorised | Verify portal name, instance name, and custom domain |

---

## Field Format Reference

| Field | Correct format |
|---|---|
| Category | `{ "name": "Software / Platform" }` |
| Subcategory | `{ "name": "MS Office" }` |
| Site | `{ "name": "Berlin" }` |
| Technician | `{ "email_id": "jthomas@gmfus.org" }` |
| Status | `{ "name": "In Progress" }` |
| Priority | `{ "name": "z - Medium" }` |
| Closure code | `{ "name": "Resolved" }` |
| Resolution | `{ "content": "Issue resolved by resetting the user's password." }` |

### Priority Name Map
| Level | API value |
|---|---|
| Low | `1 - Low` |
| Medium | `z - Medium` |
| High | `3 - High` |
| Critical | `4 - Critical` |

---

## Out of Scope Tools

Never call the following tools as part of a request fulfilment workflow:

- `claude_code_command` — developer utility only
- `delete_request` — irreversible, requires explicit instruction
- `send_first_response` — only for first response SLA tracking, not general replies
- `create_request` — fulfilment agents do not create tickets
