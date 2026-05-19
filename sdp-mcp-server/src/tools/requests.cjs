'use strict';

const VALID_CLOSURE_CODES = new Set(['Resolved', 'Cancelled', 'Duplicate', 'Closed', 'On Hold', 'Open']);

function validateRequestId(request_id) {
  if (!request_id) throw new Error('request_id is required');
}

function validateSubject(subject) {
  if (!subject) throw new Error('subject is required');
  if (subject.length > 250) throw new Error(`subject exceeds 250 character limit (${subject.length} chars)`);
}

function validateImpactDetails(impact_details) {
  if (impact_details && impact_details.length > 250) {
    throw new Error(`impact_details exceeds 250 character limit (${impact_details.length} chars)`);
  }
}

function validateClosureCode(closure_code) {
  if (!closure_code) return;
  const name = typeof closure_code === 'object' ? closure_code?.name : closure_code;
  if (name && !VALID_CLOSURE_CODES.has(name)) {
    throw new Error(`Invalid closure_code "${name}". Valid values: ${[...VALID_CLOSURE_CODES].join(', ')}`);
  }
}

function makeImplementations(sdpClient) {
  return {

    async list_requests(params) {
      const { limit = 10, status, priority, sort_by, sort_order } = params;
      const result = await sdpClient.listRequests({ limit, status, priority, sortBy: sort_by, sortOrder: sort_order });
      const requests = result.requests.map(req => ({
        id: req.id,
        subject: req.subject,
        status: req.status?.name,
        priority: req.priority?.name,
        requester: req.requester?.name || req.requester?.email_id,
        created_time: req.created_time?.display_value,
        due_date: req.due_by_time?.display_value,
        category: req.category?.name,
        subcategory: req.subcategory?.name,
        technician: req.technician?.name
      }));
      return { content: [{ type: 'text', text: JSON.stringify({ requests, total_count: result.total_count, has_more: result.has_more }, null, 2) }] };
    },

    async get_request(params) {
      const { request_id } = params;
      validateRequestId(request_id);
      console.error(`Fetching request: ${request_id}`);
      const req = await sdpClient.getRequest(request_id);
      const formatted = {
        id: req.id,
        subject: req.subject,
        description: req.description,
        status: req.status?.name,
        priority: req.priority?.name,
        requester: { name: req.requester?.name, email: req.requester?.email_id, phone: req.requester?.phone },
        category: req.category?.name,
        subcategory: req.subcategory?.name,
        item: req.item?.name,
        technician: req.technician?.name,
        group: req.group?.name,
        created_time: req.created_time?.display_value,
        due_date: req.due_by_time?.display_value,
        completed_time: req.completed_time?.display_value,
        time_elapsed: req.time_elapsed,
        resolution: req.resolution?.content,
        closure_info: req.closure_info,
        has_notes: req.has_notes,
        has_attachments: req.has_attachments
      };
      return { content: [{ type: 'text', text: JSON.stringify(formatted, null, 2) }] };
    },

    async create_request(params) {
      const { subject, description, priority, category, subcategory, requester_email, technician_id, technician_email, impact_details } = params;
      validateSubject(subject);
      validateImpactDetails(impact_details);
      console.error(`Creating request: ${subject}`);
      const data = { subject, description: description || '' };
      if (priority) data.priority = priority;
      if (category) data.category = category;
      if (subcategory) data.subcategory = subcategory;
      if (requester_email) data.requester_email = requester_email;
      if (technician_id) data.technician_id = technician_id;
      if (technician_email) data.technician_email = technician_email;
      if (impact_details) data.impact_details = impact_details;
      // Pass through any remaining optional params
      const extra = ['requester_name', 'urgency', 'impact', 'level', 'mode', 'request_type', 'group', 'site', 'template', 'due_by_time', 'email_ids_to_notify'];
      extra.forEach(k => { if (params[k] !== undefined) data[k] = params[k]; });
      const req = await sdpClient.createRequest(data);
      return {
        content: [{ type: 'text', text: JSON.stringify({
          success: true, request_id: req.id, subject: req.subject,
          status: req.status?.name, message: `Request #${req.id} created successfully`
        }, null, 2) }]
      };
    },

    async update_request(params) {
      const { request_id, ...updates } = params;
      validateRequestId(request_id);
      if (updates.subject !== undefined) validateSubject(updates.subject);
      if (updates.impact_details !== undefined) validateImpactDetails(updates.impact_details);
      console.error(`Updating request ${request_id}`);
      const req = await sdpClient.updateRequest(request_id, updates);
      return {
        content: [{ type: 'text', text: JSON.stringify({
          success: true, request_id: req.id,
          updated_fields: Object.keys(updates), message: `Request #${req.id} updated successfully`
        }, null, 2) }]
      };
    },

    async close_request(params) {
      const { request_id, resolution, closure_code = 'Resolved' } = params;
      validateRequestId(request_id);
      validateClosureCode(closure_code);
      console.error(`Closing request ${request_id}`);
      const req = await sdpClient.closeRequest(request_id, {
        resolution: resolution || 'Request resolved',
        closure_code
      });
      return {
        content: [{ type: 'text', text: JSON.stringify({
          success: true, request_id: req?.id, status: req?.status?.name,
          closed_time: req?.completed_time?.display_value, message: `Request #${request_id} closed successfully`
        }, null, 2) }]
      };
    },

    async closure_resolution(params) {
      const { request_id, resolution } = params;
      validateRequestId(request_id);
      if (!resolution) throw new Error('resolution is required');
      console.error(`Setting resolution on request ${request_id}`);
      const req = await sdpClient.setResolution(request_id, resolution);
      return {
        content: [{ type: 'text', text: JSON.stringify({
          success: true, request_id: req?.id, message: `Resolution set on request #${request_id}`
        }, null, 2) }]
      };
    },

    async update_status(params) {
      const { request_id, status } = params;
      validateRequestId(request_id);
      if (!status) throw new Error('status is required');
      console.error(`Updating status of request ${request_id} to "${status}"`);
      const req = await sdpClient.updateStatus(request_id, status);
      return {
        content: [{ type: 'text', text: JSON.stringify({
          success: true, request_id: req?.id, status: req?.status?.name,
          message: `Status updated to "${status}" on request #${request_id}`
        }, null, 2) }]
      };
    },

    async add_note(params) {
      const { request_id, note_content, is_public = true } = params;
      validateRequestId(request_id);
      if (!note_content) throw new Error('note_content is required');
      console.error(`Adding note to request ${request_id}`);
      const note = await sdpClient.addNote(request_id, note_content, is_public);
      return {
        content: [{ type: 'text', text: JSON.stringify({
          success: true, note_id: note.id, request_id,
          added_time: note.created_time?.display_value, message: `Note added to request #${request_id}`
        }, null, 2) }]
      };
    },

    async add_private_note(params) {
      const { request_id, note_content, notify_technician = true } = params;
      validateRequestId(request_id);
      if (!note_content) throw new Error('note_content is required');
      console.error(`Adding private note to request ${request_id}`);
      const note = await sdpClient.addPrivateNote(request_id, note_content, notify_technician);
      return {
        content: [{ type: 'text', text: JSON.stringify({
          success: true, note_id: note.id, request_id, is_private: true,
          technician_notified: notify_technician, message: `Private note added to request #${request_id}`
        }, null, 2) }]
      };
    },

    async reply_to_requester(params) {
      const { request_id, reply_message, mark_first_response = false } = params;
      validateRequestId(request_id);
      if (!reply_message) throw new Error('reply_message is required');
      console.error(`Replying to requester for request ${request_id}`);
      const note = await sdpClient.replyToRequester(request_id, reply_message, mark_first_response);
      return {
        content: [{ type: 'text', text: JSON.stringify({
          success: true, note_id: note.id, request_id, reply_sent: true,
          first_response: mark_first_response, message: `Email reply sent to requester for request #${request_id}`
        }, null, 2) }]
      };
    },

    async send_first_response(params) {
      const { request_id, response_message } = params;
      validateRequestId(request_id);
      if (!response_message) throw new Error('response_message is required');
      console.error(`Sending first response for request ${request_id}`);
      const note = await sdpClient.sendFirstResponse(request_id, response_message);
      return {
        content: [{ type: 'text', text: JSON.stringify({
          success: true, note_id: note.id, request_id, first_response: true,
          email_sent: true, message: `First response sent to requester for request #${request_id}`
        }, null, 2) }]
      };
    },

    async get_request_conversation(params) {
      const { request_id } = params;
      validateRequestId(request_id);
      console.error(`Getting conversation for request ${request_id}`);
      const conversation = await sdpClient.getRequestConversation(request_id);
      const formatted = conversation.map(note => ({
        id: note.id,
        content: note.description,
        created_time: note.created_time?.display_value,
        author: note.added_by?.name || note.added_by?.email_id,
        visible_to_requester: note.show_to_requester,
        is_first_response: note.mark_first_response
      }));
      return {
        content: [{ type: 'text', text: JSON.stringify({
          request_id, conversation: formatted, total_notes: conversation.length,
          message: `Retrieved ${conversation.length} conversation entries for request #${request_id}`
        }, null, 2) }]
      };
    },

    async search_requests(params) {
      const { query, limit = 10 } = params;
      if (!query) throw new Error('query is required');
      console.error(`Searching requests: ${query}`);
      const result = await sdpClient.searchRequests(query, { limit });
      const requests = result.requests.map(req => ({
        id: req.id, subject: req.subject, status: req.status?.name,
        priority: req.priority?.name, requester: req.requester?.name || req.requester?.email_id,
        created_time: req.created_time?.display_value
      }));
      return { content: [{ type: 'text', text: JSON.stringify({ query, results: requests, total_count: result.total_count }, null, 2) }] };
    },

    async advanced_search_requests(params) {
      const { criteria, limit = 10, page = 1, sort_by = 'created_time', sort_order = 'desc' } = params;
      if (!criteria || !Array.isArray(criteria) || criteria.length === 0) {
        throw new Error('criteria array is required and must not be empty');
      }
      const result = await sdpClient.advancedSearchRequests(criteria, { limit, page, sortBy: sort_by, sortOrder: sort_order });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },

    async delete_request(params) {
      const { request_id } = params;
      validateRequestId(request_id);
      console.error(`Deleting request ${request_id}`);
      await sdpClient.deleteRequest(request_id);
      return {
        content: [{ type: 'text', text: JSON.stringify({
          success: true, request_id, message: `Request #${request_id} permanently deleted`
        }, null, 2) }]
      };
    },

    async add_attachment(params) {
      const { request_id, file_path, file_name } = params;
      validateRequestId(request_id);
      if (!file_path) throw new Error('file_path is required');
      console.error(`Attaching "${file_path}" to request ${request_id}`);
      await sdpClient.addAttachment(request_id, file_path, file_name);
      return {
        content: [{ type: 'text', text: JSON.stringify({
          success: true, request_id,
          file_name: file_name || require('path').basename(file_path),
          message: `File attached to request #${request_id}`
        }, null, 2) }]
      };
    }

  };
}

const schemas = [
  {
    name: 'list_requests',
    description: 'List service desk requests with optional filters',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Maximum number of requests to return (max 100)', default: 10, maximum: 100 },
        status: { type: 'string', description: 'Filter by status', enum: ['open', 'closed', 'pending', 'resolved', 'cancelled'] },
        priority: { type: 'string', description: 'Filter by priority', enum: ['low', 'medium', 'high', 'urgent'] },
        sort_by: { type: 'string', enum: ['created_time', 'due_by_time', 'subject', 'priority'], default: 'created_time' },
        sort_order: { type: 'string', enum: ['asc', 'desc'], default: 'desc' }
      }
    }
  },
  {
    name: 'get_request',
    description: 'Get detailed information about a specific service desk request',
    inputSchema: {
      type: 'object',
      properties: {
        request_id: { type: 'string', description: 'The ID of the request to retrieve' }
      },
      required: ['request_id']
    }
  },
  {
    name: 'create_request',
    description: 'Create a new service desk request',
    inputSchema: {
      type: 'object',
      properties: {
        subject: { type: 'string', description: 'Subject of the request (max 250 chars)' },
        description: { type: 'string', description: 'Detailed description (HTML supported)' },
        priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'], default: 'medium' },
        category: { type: 'string', description: 'Category name' },
        subcategory: { type: 'string', description: 'Subcategory name' },
        requester_email: { type: 'string', description: 'Email of the requester' },
        requester_name: { type: 'string', description: 'Name of the requester' },
        technician_id: { type: 'string', description: 'ID of technician to assign' },
        technician_email: { type: 'string', description: 'Email of technician to assign' },
        urgency: { type: 'string', description: 'Urgency level (e.g., "2 - General Concern")' },
        impact: { type: 'string', description: 'Impact level (e.g., "1 - Affects User")' },
        level: { type: 'string', description: 'Support level (e.g., "1 - Frontline")' },
        mode: { type: 'string', description: 'Creation mode (e.g., "Web Form", "Email")' },
        request_type: { type: 'string', description: 'Type of request (e.g., "Incident", "Service Request")' },
        group: { type: 'string', description: 'Group name to assign the request to' },
        site: { type: 'string', description: 'Site name for the request' },
        template: { type: 'string', description: 'Template name to use' },
        due_by_time: { type: 'object', description: 'Due date/time as { value: <epoch_ms> }' },
        impact_details: { type: 'string', description: 'Impact description (max 250 chars)' },
        email_ids_to_notify: { type: 'array', items: { type: 'string' }, description: 'Additional email addresses to notify' }
      },
      required: ['subject']
    }
  },
  {
    name: 'update_request',
    description: 'Update fields on an existing open service desk request',
    inputSchema: {
      type: 'object',
      properties: {
        request_id: { type: 'string', description: 'ID of the request to update' },
        subject: { type: 'string', description: 'New subject (max 250 chars)' },
        description: { type: 'string', description: 'New description' },
        status: { type: 'string', enum: ['open', 'pending', 'resolved', 'closed', 'in progress', 'on hold'] },
        priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'] },
        category: { type: 'string', description: 'New category' },
        subcategory: { type: 'string', description: 'New subcategory' },
        technician_id: { type: 'string', description: 'ID of technician to assign' },
        technician_email: { type: 'string', description: 'Email of technician to assign' },
        resolution: { type: 'string', description: 'Resolution text' },
        update_reason: { type: 'string', description: 'Reason for this update' },
        due_by_time: { type: 'object', description: 'New due date/time as { value: <epoch_ms> }' },
        urgency: { type: 'string', description: 'New urgency level' },
        impact: { type: 'string', description: 'New impact level' },
        impact_details: { type: 'string', description: 'New impact details (max 250 chars)' },
        level: { type: 'string', description: 'New support level' },
        group: { type: 'string', description: 'New group name' },
        site: { type: 'string', description: 'New site name' },
        scheduled_start_time: { type: 'object', description: 'Scheduled start time as { value: <epoch_ms> }' },
        scheduled_end_time: { type: 'object', description: 'Scheduled end time as { value: <epoch_ms> }' }
      },
      required: ['request_id']
    }
  },
  {
    name: 'close_request',
    description: 'Close a request with a resolution and closure code (POST /requests/{id}/close). Handles both resolution and closure in a single call.',
    inputSchema: {
      type: 'object',
      properties: {
        request_id: { type: 'string', description: 'ID of the request to close' },
        resolution: { type: 'string', description: 'Resolution summary (what was done to fix the issue)' },
        closure_code: {
          type: 'string',
          description: 'Closure code',
          enum: ['Resolved', 'Cancelled', 'Duplicate', 'Closed', 'On Hold', 'Open'],
          default: 'Resolved'
        }
      },
      required: ['request_id']
    }
  },
  {
    name: 'closure_resolution',
    description: 'Set the resolution text on a request (separate from closing). Can be called before or after close_request.',
    inputSchema: {
      type: 'object',
      properties: {
        request_id: { type: 'string', description: 'ID of the request' },
        resolution: { type: 'string', description: 'Resolution text to record on the request' }
      },
      required: ['request_id', 'resolution']
    }
  },
  {
    name: 'update_status',
    description: 'Update the status of a request without closing it (e.g., set to On Hold, In Progress)',
    inputSchema: {
      type: 'object',
      properties: {
        request_id: { type: 'string', description: 'ID of the request' },
        status: { type: 'string', enum: ['Open', 'On Hold', 'In Progress', 'Resolved', 'Closed', 'Cancelled'] }
      },
      required: ['request_id', 'status']
    }
  },
  {
    name: 'add_note',
    description: 'Add a public note to a request (visible to requester, no email sent)',
    inputSchema: {
      type: 'object',
      properties: {
        request_id: { type: 'string', description: 'ID of the request' },
        note_content: { type: 'string', description: 'Content of the note' },
        is_public: { type: 'boolean', description: 'Visible to requester', default: true }
      },
      required: ['request_id', 'note_content']
    }
  },
  {
    name: 'add_private_note',
    description: 'Add an internal note to a request (NOT visible to the requester)',
    inputSchema: {
      type: 'object',
      properties: {
        request_id: { type: 'string', description: 'ID of the request' },
        note_content: { type: 'string', description: 'Content of the private note' },
        notify_technician: { type: 'boolean', description: 'Whether to notify the assigned technician', default: true }
      },
      required: ['request_id', 'note_content']
    }
  },
  {
    name: 'reply_to_requester',
    description: 'Send an email reply to the requester that appears in the request conversation thread. Always use this to email the requester — not add_note.',
    inputSchema: {
      type: 'object',
      properties: {
        request_id: { type: 'string', description: 'ID of the request' },
        reply_message: { type: 'string', description: 'The reply message to send to the requester' },
        mark_first_response: { type: 'boolean', description: 'Mark as first response for SLA tracking', default: false }
      },
      required: ['request_id', 'reply_message']
    }
  },
  {
    name: 'send_first_response',
    description: 'Send the first formal response on a request for SLA first-response tracking. Only for the very first response — use reply_to_requester for all subsequent replies.',
    inputSchema: {
      type: 'object',
      properties: {
        request_id: { type: 'string', description: 'ID of the request' },
        response_message: { type: 'string', description: 'The first response message content' }
      },
      required: ['request_id', 'response_message']
    }
  },
  {
    name: 'get_request_conversation',
    description: 'Retrieve the full conversation history of a request including all replies and notes',
    inputSchema: {
      type: 'object',
      properties: {
        request_id: { type: 'string', description: 'ID of the request' }
      },
      required: ['request_id']
    }
  },
  {
    name: 'search_requests',
    description: 'Search requests by keyword',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        limit: { type: 'number', description: 'Maximum results (max 100)', default: 10, maximum: 100 }
      },
      required: ['query']
    }
  },
  {
    name: 'advanced_search_requests',
    description: 'Search requests using structured field criteria with AND/OR logic (e.g., by requester, technician, date range, priority)',
    inputSchema: {
      type: 'object',
      properties: {
        criteria: {
          type: 'array',
          description: 'Array of search criteria objects',
          items: {
            type: 'object',
            properties: {
              field: { type: 'string', description: 'Field name (e.g., "status.name", "priority.name", "requester.name")' },
              condition: { type: 'string', description: 'Condition (e.g., "is", "is not", "contains", "greater than")' },
              value: { description: 'Value to match against' },
              logical_operator: { type: 'string', enum: ['AND', 'OR'], description: 'Logical join with previous criterion (omit for first)' }
            },
            required: ['field', 'condition', 'value']
          }
        },
        limit: { type: 'number', description: 'Maximum results (max 100)', default: 10, maximum: 100 },
        page: { type: 'number', description: 'Page number (1-based)', default: 1 },
        sort_by: { type: 'string', description: 'Field to sort by', default: 'created_time' },
        sort_order: { type: 'string', enum: ['asc', 'desc'], default: 'desc' }
      },
      required: ['criteria']
    }
  },
  {
    name: 'delete_request',
    description: 'Permanently delete a service desk request. This action is irreversible — only use when explicitly instructed.',
    inputSchema: {
      type: 'object',
      properties: {
        request_id: { type: 'string', description: 'ID of the request to permanently delete' }
      },
      required: ['request_id']
    }
  },
  {
    name: 'add_attachment',
    description: 'Attach a file to a service desk request',
    inputSchema: {
      type: 'object',
      properties: {
        request_id: { type: 'string', description: 'ID of the request' },
        file_path: { type: 'string', description: 'Absolute path to the file on the server' },
        file_name: { type: 'string', description: 'Display name for the attachment (defaults to filename from file_path)' }
      },
      required: ['request_id', 'file_path']
    }
  }
];

module.exports = { makeImplementations, schemas };
