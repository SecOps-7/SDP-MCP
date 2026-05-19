'use strict';

const PROMPTS = [
  {
    name: 'resolve_request',
    description: 'Guide through the full resolution workflow for a Service Desk request: retrieve current state, update fields, send a reply to the requester, then close with a resolution.',
    arguments: [
      { name: 'request_id', description: 'The SDP request ID to resolve', required: true },
      { name: 'resolution_summary', description: 'One-sentence summary of how the request was resolved', required: true }
    ]
  },
  {
    name: 'triage_request',
    description: 'Guide through request triage: retrieve the request, fetch valid field values, assign a technician and category, then send an acknowledgement reply to the requester.',
    arguments: [
      { name: 'request_id', description: 'The SDP request ID to triage', required: true }
    ]
  },
  {
    name: 'escalate_request',
    description: 'Guide through escalating a request: retrieve current state, reassign to a new technician or group, add an internal private note with escalation context, then send a reply to the requester.',
    arguments: [
      { name: 'request_id', description: 'The SDP request ID to escalate', required: true },
      { name: 'escalation_reason', description: 'Reason for escalation (used in the private note)', required: true }
    ]
  },
  {
    name: 'follow_up_request',
    description: 'Guide through following up on a request: retrieve the conversation history to review prior communication, then send a follow-up reply to the requester.',
    arguments: [
      { name: 'request_id', description: 'The SDP request ID to follow up on', required: true }
    ]
  }
];

function listPrompts() {
  return PROMPTS;
}

function getPrompt(name, args = {}) {
  const prompt = PROMPTS.find(p => p.name === name);
  if (!prompt) return null;

  const messages = {
    resolve_request: () => [{
      role: 'user',
      content: {
        type: 'text',
        text: `Resolve Service Desk request #${args.request_id}.

Step 1 — Call get_request with request_id="${args.request_id}" to confirm it is open and retrieve current field values.
Step 2 — Call update_request if any fields need correcting (category, subcategory, technician, site).
Step 3 — Call reply_to_requester with a clear explanation of the resolution: "${args.resolution_summary || 'Issue has been resolved.'}"
Step 4 — Call close_request with:
  - resolution: { "content": "${args.resolution_summary || 'Issue has been resolved.'}" }
  - closure_code: { "name": "Resolved" }

Do not call update_request to set the resolution field separately — pass it directly to close_request.`
      }
    }],

    triage_request: () => [{
      role: 'user',
      content: {
        type: 'text',
        text: `Triage Service Desk request #${args.request_id}.

Step 1 — Call get_request with request_id="${args.request_id}" to review the subject, description, and current field values.
Step 2 — Call get_metadata to retrieve valid categories, priorities, and technician options if needed.
Step 3 — Call update_request to set the appropriate category, subcategory, priority, and assigned technician based on the request content.
Step 4 — Call reply_to_requester to send an acknowledgement to the requester confirming the request has been received and is being worked on.`
      }
    }],

    escalate_request: () => [{
      role: 'user',
      content: {
        type: 'text',
        text: `Escalate Service Desk request #${args.request_id}.

Escalation reason: ${args.escalation_reason || '(not specified)'}

Step 1 — Call get_request with request_id="${args.request_id}" to confirm current assignee and status.
Step 2 — Call find_technician or list_technicians to identify the correct escalation target.
Step 3 — Call update_request to reassign the technician and/or group to the escalation target.
Step 4 — Call add_private_note with the escalation context: "${args.escalation_reason || 'Escalated due to complexity or urgency.'}" — this note is NOT visible to the requester.
Step 5 — Call reply_to_requester to inform the requester that their request has been escalated and is receiving priority attention.`
      }
    }],

    follow_up_request: () => [{
      role: 'user',
      content: {
        type: 'text',
        text: `Follow up on Service Desk request #${args.request_id}.

Step 1 — Call get_request_conversation with request_id="${args.request_id}" to review all prior communication and notes.
Step 2 — Review the conversation to understand what has already been communicated and what outstanding questions exist.
Step 3 — Call reply_to_requester with a follow-up message that addresses any outstanding items or provides a status update.

Do not repeat information already communicated. Keep the reply concise and action-oriented.`
      }
    }]
  };

  const messageFn = messages[name];
  if (!messageFn) return null;

  return {
    description: prompt.description,
    messages: messageFn()
  };
}

module.exports = { listPrompts, getPrompt };
