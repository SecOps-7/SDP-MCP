'use strict';

const SDP_RESOURCES = {
  'sdp://usage/api-rules': {
    uri: 'sdp://usage/api-rules',
    name: 'Critical API Rules',
    description: 'Mandatory rules that apply to every SDP tool call — field object formats, character limits, and constraints',
    mimeType: 'text/plain',
    text: `CRITICAL API RULES — apply to every tool call without exception

REQUEST ID — CRITICAL:
- ALWAYS use the full internal ID (e.g. 97837000038081358) — never the short display ID (e.g. 29257)
- The display ID is the short number shown in the SDP portal — it is NOT the request_id field
- Obtain the internal ID from get_request or list_requests before calling any mutating tool
- If you only have a display ID, call get_request first (it resolves display IDs automatically)

FIELD FORMATS:
- All reference fields must be objects, never plain strings.
  Correct: { "name": "Hardware" }  Wrong: "Hardware"
- Resolution field format: { "content": "your text here" }
- Closure code format: { "name": "Resolved" } (not a plain string)
- Authorization header: Zoho-oauthtoken <token> — NOT Bearer
- input_data is sent as a URL query parameter on all methods
- start_index is 1-based for pagination
- row_count maximum is 100 per request
- Subject field: 250 character maximum
- impact_details field: 250 character maximum
- You cannot update a closed request — always check status first with get_request

STATUS CHANGE COMMENTS:
- Setting status to "On Hold" or "Cancelled" requires status_change_comments — always include it`
  },

  'sdp://usage/field-formats': {
    uri: 'sdp://usage/field-formats',
    name: 'Field Format Reference',
    description: 'Correct object format for every SDP field, including priority name map and closure codes',
    mimeType: 'text/plain',
    text: `FIELD FORMAT REFERENCE

REQUEST ID
- Full internal ID: 97837000038081358  ← use this in all request_id fields
- Short display ID: 29257              ← shown in portal, NEVER pass as request_id
- If you only have a display ID, call get_request first to resolve it

Field        | Correct format
-------------|------------------------------------------------
request_id   | "97837000038081358"  (17-digit internal ID)
Category     | { "name": "Software / Platform" }
Subcategory  | { "name": "MS Office" }
Site         | { "name": "Berlin" }
Technician   | { "email_id": "jthomas@example.com" }
Status       | { "name": "In Progress" }
Priority     | { "name": "z - Medium" }
Closure code | { "name": "Resolved" }
Resolution   | { "content": "Issue resolved by resetting the user's password." }

PRIORITY NAME MAP
Low      → "1 - Low"
Medium   → "z - Medium"
High     → "3 - High"
Critical → "4 - Critical"

AVAILABLE CLOSURE CODES: Resolved, Cancelled, Duplicate, Closed, On Hold, Open

STATUS CHANGE COMMENTS
- "On Hold" and "Cancelled" statuses require status_change_comments in the same call`
  },

  'sdp://usage/tool-reference': {
    uri: 'sdp://usage/tool-reference',
    name: 'Tool Reference',
    description: 'All SDP tools with purpose, when-to-use guidance, and required fields',
    mimeType: 'text/plain',
    text: `SDP TOOL REFERENCE

get_request — Retrieve full details of a single request by ID.
  Required: request_id (full internal ID preferred; display IDs are resolved automatically)
  Use: Before any action sequence. Always use the returned .id value as request_id in subsequent calls.
  IMPORTANT: The id field in the response is the internal ID to use — not display_id.

list_requests — List requests with optional filters and pagination.
  Params: status, technician_email, row_count (max 100), start_index, sort_by, sort_order

search_requests — Search requests using simple criteria.
  Params: query (keyword string), limit

advanced_search_requests — Complex multi-field search with AND/OR logic.
  Params: criteria array of { field, condition, value, logical_operator }

create_request — Create a new service desk request.
  Required: subject (max 250 chars)
  Optional: description, requester_email, category, subcategory, site, technician, priority

update_request — Update fields on an existing open request.
  Required: request_id (full internal ID — NOT the display ID)
  Updatable: category, subcategory, site, technician, status, priority, group, urgency, impact, level
  Note: status "On Hold" or "Cancelled" also requires status_change_comments

close_request — Close a request with resolution and closure code.
  Required: request_id, resolution { "content": "..." }, closure_code { "name": "Resolved" }
  Note: Handles both resolution and closure in one call. Do not call update_request first.

delete_request — Permanently delete a request. Irreversible. Explicit instruction only.
  Required: request_id

reply_to_requester — Send email reply visible in the request conversation thread.
  Required: request_id, reply_message
  Note: ALWAYS use this to email the requester — not add_note.

send_first_response — First formal response for SLA first-response tracking.
  Required: request_id, response_message
  Note: Only for the very first response. Use reply_to_requester for all subsequent replies.

add_note — Add a public note visible to the requester (no email sent).
  Required: request_id, note_content

add_private_note — Add an internal note NOT visible to the requester.
  Required: request_id, note_content

get_request_conversation — Retrieve full conversation history.
  Required: request_id

list_technicians — List all available technicians.

get_technician — Get detailed technician information by ID.
  Required: technician_id

find_technician — Look up a technician by name or email.
  Required: search_term

get_metadata — Retrieve valid dropdown values for SDP fields.
  Use: Before create/update if unsure whether a field value is valid.

add_attachment — Attach a file to an existing request.
  Required: request_id, file_path

get_usage_guide — Retrieve a specific section of the SDP usage guide as context.
  Params: section (api-rules | tool-reference | field-formats | error-codes | action-sequences | decision-matrix)`
  },

  'sdp://usage/error-codes': {
    uri: 'sdp://usage/error-codes',
    name: 'Error Code Reference',
    description: 'SDP API error codes and recommended actions',
    mimeType: 'text/plain',
    text: `ERROR CODE REFERENCE

Code             | Meaning                               | Action
-----------------|---------------------------------------|----------------------------------
401/UNAUTHORISED | OAuth token invalid or expired        | Token refresh handled automatically
403              | Permission denied (e.g. priority)     | API limitation — skip the field
400/4012         | Mandatory field missing               | Check required fields for the operation
4000             | General failure                       | Read the error_messages array for detail
4002             | Unauthorised                          | Verify portal name, instance name, and domain`
  },

  'sdp://usage/action-sequences': {
    uri: 'sdp://usage/action-sequences',
    name: 'Common Action Sequences',
    description: 'Standard tool call sequences for typical ITSM workflows',
    mimeType: 'text/plain',
    text: `COMMON ACTION SEQUENCES

Standard Solution:
  get_request → update_request → reply_to_requester → close_request

Follow-Up Question:
  get_request → update_request → reply_to_requester

Escalation:
  get_request → update_request (reassign technician) → add_private_note → reply_to_requester`
  },

  'sdp://usage/decision-matrix': {
    uri: 'sdp://usage/decision-matrix',
    name: 'Tool Decision Matrix',
    description: 'Which tool to use for each ITSM task, including out-of-scope tools to avoid',
    mimeType: 'text/plain',
    text: `TOOL DECISION MATRIX

Task                                              | Tool
--------------------------------------------------|---------------------------
Check if a request exists / get current state     | get_request
Update category, subcategory, site, technician    | update_request
Send a reply the requester receives by email      | reply_to_requester
Add an internal note for the technician only      | add_private_note
Add a note visible to the requester (no email)    | add_note
Close a resolved request                          | close_request
Find requests matching criteria                   | search_requests or advanced_search_requests
Validate a field value before writing             | get_metadata
Check prior communication                         | get_request_conversation

OUT OF SCOPE — never call as part of request fulfilment:
- claude_code_command — developer utility only
- delete_request — irreversible, requires explicit instruction
- send_first_response — only for first-response SLA tracking
- create_request — fulfilment agents do not create requests`
  }
};

function listResources() {
  return Object.values(SDP_RESOURCES).map(r => ({
    uri: r.uri,
    name: r.name,
    description: r.description,
    mimeType: r.mimeType
  }));
}

function readResource(uri) {
  return SDP_RESOURCES[uri] || null;
}

module.exports = { SDP_RESOURCES, listResources, readResource };
