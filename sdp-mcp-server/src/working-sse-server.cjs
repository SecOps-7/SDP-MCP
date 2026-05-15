#!/usr/bin/env node

/**
 * MCP SSE Server with Service Desk Plus Integration
 * Full implementation with real API calls
 */

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const { SDPAPIClientV2 } = require('./sdp-api-client-v2.cjs');

const app = express();
app.use(cors());
app.use(express.json());

// Initialize SDP API client
let sdpClient;
try {
  sdpClient = new SDPAPIClientV2({
    clientId: process.env.SDP_CLIENT_ID,
    clientSecret: process.env.SDP_CLIENT_SECRET,
    refreshToken: process.env.SDP_REFRESH_TOKEN,
    portalName: process.env.SDP_PORTAL_NAME,
    customDomain: process.env.SDP_BASE_URL,
    dataCenter: process.env.SDP_DATA_CENTER || 'US'
  });
  console.error('SDP API client initialized');
} catch (error) {
  console.error('Failed to initialize SDP client:', error.message);
}

// Active SSE connections
const connections = new Map();
let sessionCounter = 0;

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    service: 'mcp-sse-sdp',
    connections: connections.size,
    sdp_configured: !!sdpClient
  });
});

// SSE endpoint
app.get('/sse', (req, res) => {
  console.error('New SSE connection established');
  
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });

  const sessionId = `session-${Date.now()}-${++sessionCounter}`;
  connections.set(sessionId, res);
  console.error(`Session created: ${sessionId}`);

  res.write(`data: ${JSON.stringify({
    type: 'connection',
    sessionId: sessionId
  })}\n\n`);

  const keepAlive = setInterval(() => {
    res.write(':keepalive\n\n');
  }, 30000);

  req.on('close', () => {
    console.error(`Session closed: ${sessionId}`);
    clearInterval(keepAlive);
    connections.delete(sessionId);
  });
});

// Tool implementations with real SDP API
const toolImplementations = {
  async claude_code_command(params) {
    try {
      const { command, project_path, args = [] } = params;
      
      console.error(`Executing Claude Code command: ${command}`);
      
      // Map of allowed Claude Code commands
      const allowedCommands = {
        'open_project': 'Open a project in Claude Code',
        'create_file': 'Create a new file',
        'read_file': 'Read file contents',
        'write_file': 'Write content to file',
        'list_files': 'List files in directory',
        'run_command': 'Run a shell command',
        'git_status': 'Check git status',
        'git_commit': 'Create a git commit'
      };
      
      if (!allowedCommands[command]) {
        throw new Error(`Unknown command: ${command}. Available: ${Object.keys(allowedCommands).join(', ')}`);
      }
      
      // For now, return instructions on how to use Claude Code
      let result = {
        command,
        status: 'instructions',
        message: `To execute '${command}' in Claude Code:
`
      };
      
      switch (command) {
        case 'open_project':
          result.message += `1. Open Claude Code
2. Navigate to: ${project_path || process.cwd()}
3. The MCP server project is in the configured working directory`;
          break;
          
        case 'create_file':
          result.message += `1. Use the 'Write' tool to create: ${args[0] || 'filename.js'}
2. Add content with the MCP integration`;
          break;
          
        case 'read_file':
          result.message += `1. Use the 'Read' tool for: ${args[0] || 'filename'}
2. The file content will be displayed`;
          break;
          
        case 'list_files':
          result.message += `1. Use the 'LS' tool for: ${project_path || '.'}
2. Shows all files and directories`;
          break;
          
        case 'run_command':
          result.message += `1. Use the 'Bash' tool
2. Command: ${args.join(' ') || 'npm test'}
3. See output in Claude Code terminal`;
          break;
          
        case 'git_status':
          result.message += `1. Use 'Bash' tool with: git status
2. Shows current git state`;
          break;
          
        case 'git_commit':
          result.message += `1. Stage files: git add .
2. Commit: git commit -m "${args[0] || 'Update from MCP'}"
3. Use Bash tool for both`;
          break;
          
        default:
          result.message = `Command '${command}' recognized but not implemented yet`;
      }
      
      // Add project context
      result.project_info = {
        current_directory: process.cwd()
      };
      
      return {
        content: [{
          type: 'text',
          text: JSON.stringify(result, null, 2)
        }]
      };
    } catch (error) {
      throw new Error(`Claude Code command failed: ${error.message}`);
    }
  },
  
  async get_metadata(params) {
    try {
      console.error('Fetching SDP metadata...');
      
      const metadata = await sdpClient.getMetadata();
      
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            message: 'Valid values for Service Desk Plus fields',
            priorities: metadata.priorities,
            statuses: metadata.statuses,
            categories: metadata.categories.slice(0, 20), // Limit for readability
            templates: metadata.templates.slice(0, 10),
            usage_tips: {
              priority: 'Use values like: low, medium, high, urgent',
              status: 'Use values like: open, closed, pending, resolved',
              category: 'Use exact category names from the list above'
            }
          }, null, 2)
        }]
      };
    } catch (error) {
      throw new Error(`Failed to get metadata: ${error.message}`);
    }
  },
  
  async list_requests(params) {
    try {
      const { limit = 10, status, priority, sort_by, sort_order } = params;
      
      console.error(`Fetching requests: limit=${limit}, status=${status}, priority=${priority}`);
      
      const result = await sdpClient.listRequests({
        limit,
        status,
        priority,
        sortBy: sort_by,
        sortOrder: sort_order
      });
      
      // Format the response
      const formattedRequests = result.requests.map(req => ({
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
      
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            requests: formattedRequests,
            total_count: result.total_count,
            has_more: result.has_more
          }, null, 2)
        }]
      };
    } catch (error) {
      throw new Error(`Failed to list requests: ${error.message}`);
    }
  },
  
  async get_request(params) {
    try {
      const { request_id } = params;
      
      if (!request_id) {
        throw new Error('request_id is required');
      }
      
      console.error(`Fetching request details for ID: ${request_id}`);
      
      const request = await sdpClient.getRequest(request_id);
      
      // Format detailed response
      const formatted = {
        id: request.id,
        subject: request.subject,
        description: request.description,
        status: request.status?.name,
        priority: request.priority?.name,
        requester: {
          name: request.requester?.name,
          email: request.requester?.email_id,
          phone: request.requester?.phone
        },
        category: request.category?.name,
        subcategory: request.subcategory?.name,
        item: request.item?.name,
        technician: request.technician?.name,
        group: request.group?.name,
        created_time: request.created_time?.display_value,
        due_date: request.due_by_time?.display_value,
        completed_time: request.completed_time?.display_value,
        time_elapsed: request.time_elapsed,
        resolution: request.resolution?.content,
        closure_info: request.closure_info,
        has_notes: request.has_notes,
        has_attachments: request.has_attachments
      };
      
      return {
        content: [{
          type: 'text',
          text: JSON.stringify(formatted, null, 2)
        }]
      };
    } catch (error) {
      throw new Error(`Failed to get request: ${error.message}`);
    }
  },
  
  async create_request(params) {
    try {
      const { subject, description, priority, category, subcategory, requester_email, technician_id, technician_email } = params;
      
      if (!subject) {
        throw new Error('subject is required');
      }
      
      console.error(`Creating new request: ${subject}`);
      
      const requestData = {
        subject,
        description: description || ''
      };
      
      // Only add optional fields if they're provided
      if (priority) requestData.priority = priority;
      if (category) requestData.category = category;
      if (subcategory) requestData.subcategory = subcategory;
      if (requester_email) requestData.requester_email = requester_email;
      if (technician_id) requestData.technician_id = technician_id;
      if (technician_email) requestData.technician_email = technician_email;
      
      const request = await sdpClient.createRequest(requestData);
      
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            request_id: request.id,
            subject: request.subject,
            status: request.status?.name,
            message: `Request #${request.id} created successfully`
          }, null, 2)
        }]
      };
    } catch (error) {
      throw new Error(`Failed to create request: ${error.message}`);
    }
  },
  
  async update_request(params) {
    try {
      const { request_id, ...updates } = params;
      
      if (!request_id) {
        throw new Error('request_id is required');
      }
      
      console.error(`Updating request ${request_id}:`, updates);
      
      const request = await sdpClient.updateRequest(request_id, updates);
      
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            request_id: request.id,
            updated_fields: Object.keys(updates),
            message: `Request #${request.id} updated successfully`
          }, null, 2)
        }]
      };
    } catch (error) {
      throw new Error(`Failed to update request: ${error.message}`);
    }
  },
  
  async close_request(params) {
    try {
      const { request_id, closure_comments, closure_code } = params;
      if (!request_id) throw new Error('request_id is required');
      console.error(`Closing request ${request_id}`);
      const request = await sdpClient.closeRequest(request_id, {
        closure_comments: closure_comments || 'Request resolved',
        closure_code: closure_code || 'Resolved'
      });
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            request_id: request?.id,
            status: request?.status?.name,
            closed_time: request?.completed_time?.display_value,
            message: `Request #${request_id} closed successfully`
          }, null, 2)
        }]
      };
    } catch (error) {
      throw new Error(`Failed to close request: ${error.message}`);
    }
  },

  async closure_resolution(params) {
    try {
      const { request_id, resolution } = params;
      if (!request_id) throw new Error('request_id is required');
      if (!resolution) throw new Error('resolution is required');
      console.error(`Setting resolution on request ${request_id}`);
      const request = await sdpClient.setResolution(request_id, resolution);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            request_id: request?.id,
            message: `Resolution set on request #${request_id}`
          }, null, 2)
        }]
      };
    } catch (error) {
      throw new Error(`Failed to set resolution: ${error.message}`);
    }
  },

  async update_status(params) {
    try {
      const { request_id, status } = params;
      if (!request_id) throw new Error('request_id is required');
      if (!status) throw new Error('status is required');
      console.error(`Updating status of request ${request_id} to "${status}"`);
      const request = await sdpClient.updateStatus(request_id, status);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            request_id: request?.id,
            status: request?.status?.name,
            message: `Status updated to "${status}" on request #${request_id}`
          }, null, 2)
        }]
      };
    } catch (error) {
      throw new Error(`Failed to update status: ${error.message}`);
    }
  },
  
  async add_note(params) {
    try {
      const { request_id, note_content, is_public = true } = params;
      
      if (!request_id || !note_content) {
        throw new Error('request_id and note_content are required');
      }
      
      console.error(`Adding note to request ${request_id}`);
      
      const note = await sdpClient.addNote(request_id, note_content, is_public);
      
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            note_id: note.id,
            request_id,
            added_time: note.created_time?.display_value,
            message: `Note added to request #${request_id}`
          }, null, 2)
        }]
      };
    } catch (error) {
      throw new Error(`Failed to add note: ${error.message}`);
    }
  },
  
  async search_requests(params) {
    try {
      const { query, limit = 10 } = params;
      
      if (!query) {
        throw new Error('query is required');
      }
      
      console.error(`Searching requests for: ${query}`);
      
      const result = await sdpClient.searchRequests(query, { limit });
      
      const formattedRequests = result.requests.map(req => ({
        id: req.id,
        subject: req.subject,
        status: req.status?.name,
        priority: req.priority?.name,
        requester: req.requester?.name || req.requester?.email_id,
        created_time: req.created_time?.display_value
      }));
      
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            query,
            results: formattedRequests,
            total_count: result.total_count
          }, null, 2)
        }]
      };
    } catch (error) {
      throw new Error(`Failed to search requests: ${error.message}`);
    }
  },
  
  async advanced_search_requests(params) {
    try {
      const { criteria, limit = 10, page = 1, sort_by = 'created_time', sort_order = 'desc' } = params;
      if (!criteria || !Array.isArray(criteria) || criteria.length === 0) {
        throw new Error('criteria array is required and must not be empty');
      }
      const result = await sdpClient.advancedSearchRequests(criteria, { limit, page, sortBy: sort_by, sortOrder: sort_order });
      return {
        content: [{
          type: 'text',
          text: JSON.stringify(result, null, 2)
        }]
      };
    } catch (error) {
      throw new Error(`Failed to run advanced search: ${error.message}`);
    }
  },

  async reply_to_requester(params) {
    try {
      const { request_id, reply_message, mark_first_response = false } = params;
      
      if (!request_id || !reply_message) {
        throw new Error('request_id and reply_message are required');
      }
      
      console.error(`Replying to requester for request ${request_id}`);
      
      const note = await sdpClient.replyToRequester(request_id, reply_message, mark_first_response);
      
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            note_id: note.id,
            request_id,
            reply_sent: true,
            first_response: mark_first_response,
            message: `Email reply sent to requester for request #${request_id}`
          }, null, 2)
        }]
      };
    } catch (error) {
      throw new Error(`Failed to reply to requester: ${error.message}`);
    }
  },
  
  async add_private_note(params) {
    try {
      const { request_id, note_content, notify_technician = true } = params;
      
      if (!request_id || !note_content) {
        throw new Error('request_id and note_content are required');
      }
      
      console.error(`Adding private note to request ${request_id}`);
      
      const note = await sdpClient.addPrivateNote(request_id, note_content, notify_technician);
      
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            note_id: note.id,
            request_id,
            is_private: true,
            technician_notified: notify_technician,
            message: `Private note added to request #${request_id}`
          }, null, 2)
        }]
      };
    } catch (error) {
      throw new Error(`Failed to add private note: ${error.message}`);
    }
  },
  
  async send_first_response(params) {
    try {
      const { request_id, response_message } = params;
      
      if (!request_id || !response_message) {
        throw new Error('request_id and response_message are required');
      }
      
      console.error(`Sending first response for request ${request_id}`);
      
      const note = await sdpClient.sendFirstResponse(request_id, response_message);
      
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            note_id: note.id,
            request_id,
            first_response: true,
            email_sent: true,
            message: `First response sent to requester for request #${request_id}`
          }, null, 2)
        }]
      };
    } catch (error) {
      throw new Error(`Failed to send first response: ${error.message}`);
    }
  },
  
  async get_request_conversation(params) {
    try {
      const { request_id } = params;
      
      if (!request_id) {
        throw new Error('request_id is required');
      }
      
      console.error(`Getting conversation for request ${request_id}`);
      
      const conversation = await sdpClient.getRequestConversation(request_id);
      
      const formattedConversation = conversation.map(note => ({
        id: note.id,
        content: note.description,
        created_time: note.created_time?.display_value,
        author: note.added_by?.name || note.added_by?.email_id,
        visible_to_requester: note.show_to_requester,
        is_first_response: note.mark_first_response
      }));
      
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            request_id,
            conversation: formattedConversation,
            total_notes: conversation.length,
            message: `Retrieved ${conversation.length} conversation entries for request #${request_id}`
          }, null, 2)
        }]
      };
    } catch (error) {
      throw new Error(`Failed to get request conversation: ${error.message}`);
    }
  },
  
  async list_technicians(params) {
    const { limit = 25, offset = 0, search_term } = params;
    const result = await sdpClient.users.listTechnicians({ limit, offset, searchTerm: search_term });
    return {
      content: [{
        type: 'text',
        text: JSON.stringify(result, null, 2)
      }]
    };
  },

  async get_technician(params) {
    const { technician_id } = params;
    if (!technician_id) throw new Error('technician_id is required');
    const technician = await sdpClient.users.getTechnician(technician_id);
    return {
      content: [{
        type: 'text',
        text: JSON.stringify(technician, null, 2)
      }]
    };
  },

  async find_technician(params) {
    const { search_term } = params;
    if (!search_term) throw new Error('search_term is required');
    const cleanSearchTerm = search_term.replace(/^mailto:/i, '');
    const technician = await sdpClient.users.findTechnician(cleanSearchTerm);
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({ found: !!technician, technician: technician || null }, null, 2)
      }]
    };
  },

  async delete_request(params) {
    try {
      const { request_id } = params;

      if (!request_id) {
        throw new Error('request_id is required');
      }

      console.error(`Deleting request ${request_id}`);

      await sdpClient.deleteRequest(request_id);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            request_id,
            message: `Request #${request_id} permanently deleted`
          }, null, 2)
        }]
      };
    } catch (error) {
      throw new Error(`Failed to delete request: ${error.message}`);
    }
  },

  async add_attachment(params) {
    try {
      const { request_id, file_path, file_name } = params;

      if (!request_id || !file_path) {
        throw new Error('request_id and file_path are required');
      }

      console.error(`Attaching file "${file_path}" to request ${request_id}`);

      await sdpClient.addAttachment(request_id, file_path, file_name);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            request_id,
            file_name: file_name || require('path').basename(file_path),
            message: `File attached to request #${request_id}`
          }, null, 2)
        }]
      };
    } catch (error) {
      throw new Error(`Failed to add attachment: ${error.message}`);
    }
  }
};

// Tool definitions
const tools = [
  {
    name: 'claude_code_command',
    description: 'Execute Claude Code commands or get instructions for Claude Code integration',
    inputSchema: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'Command to execute',
          enum: ['open_project', 'create_file', 'read_file', 'write_file', 'list_files', 'run_command', 'git_status', 'git_commit']
        },
        project_path: {
          type: 'string',
          description: 'Path to project or file',
          default: process.cwd()
        },
        args: {
          type: 'array',
          items: { type: 'string' },
          description: 'Additional arguments for the command'
        }
      },
      required: ['command']
    }
  },
  {
    name: 'get_metadata',
    description: 'Get valid values for priorities, statuses, categories, and templates',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'list_requests',
    description: 'List service desk requests with optional filters',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { 
          type: 'number', 
          description: 'Maximum number of requests to return (max 100 per API limits)',
          default: 10,
          maximum: 100
        },
        status: { 
          type: 'string',
          description: 'Filter by status (e.g., open, closed, pending)',
          enum: ['open', 'closed', 'pending', 'resolved', 'cancelled']
        },
        priority: {
          type: 'string',
          description: 'Filter by priority',
          enum: ['low', 'medium', 'high', 'urgent']
        },
        sort_by: {
          type: 'string',
          description: 'Sort field',
          enum: ['created_time', 'due_by_time', 'subject', 'priority'],
          default: 'created_time'
        },
        sort_order: {
          type: 'string',
          description: 'Sort order',
          enum: ['asc', 'desc'],
          default: 'desc'
        }
      }
    }
  },
  {
    name: 'get_request',
    description: 'Get detailed information about a specific request',
    inputSchema: {
      type: 'object',
      properties: {
        request_id: { 
          type: 'string',
          description: 'The ID of the request to retrieve'
        }
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
        subject: {
          type: 'string',
          description: 'Subject/title of the request (max 250 chars)'
        },
        description: {
          type: 'string',
          description: 'Detailed description of the request'
        },
        priority: {
          type: 'string',
          description: 'Priority level',
          enum: ['low', 'medium', 'high', 'urgent'],
          default: 'medium'
        },
        category: {
          type: 'string',
          description: 'Category of the request'
        },
        subcategory: {
          type: 'string',
          description: 'Subcategory of the request'
        },
        requester_email: {
          type: 'string',
          description: 'Email of the requester'
        },
        requester_name: {
          type: 'string',
          description: 'Name of the requester (used if email not provided)'
        },
        technician_id: {
          type: 'string',
          description: 'ID of technician to assign'
        },
        technician_email: {
          type: 'string',
          description: 'Email of technician to assign'
        },
        urgency: {
          type: 'string',
          description: 'Urgency level (e.g., "2 - General Concern")'
        },
        impact: {
          type: 'string',
          description: 'Impact level (e.g., "1 - Affects User")'
        },
        level: {
          type: 'string',
          description: 'Support level (e.g., "1 - Frontline")'
        },
        mode: {
          type: 'string',
          description: 'Creation mode (e.g., "Web Form", "Email")'
        },
        request_type: {
          type: 'string',
          description: 'Type of request (e.g., "Incident", "Service Request")'
        },
        group: {
          type: 'string',
          description: 'Group name to assign the request to'
        },
        site: {
          type: 'string',
          description: 'Site name for the request'
        },
        template: {
          type: 'string',
          description: 'Template name to use'
        },
        due_by_time: {
          type: 'object',
          description: 'Due date/time as { value: <epoch_ms> }'
        },
        impact_details: {
          type: 'string',
          description: 'Impact description (max 250 chars)'
        },
        email_ids_to_notify: {
          type: 'array',
          items: { type: 'string' },
          description: 'Additional email addresses to notify'
        }
      },
      required: ['subject']
    }
  },
  {
    name: 'update_request',
    description: 'Update an existing request',
    inputSchema: {
      type: 'object',
      properties: {
        request_id: {
          type: 'string',
          description: 'ID of the request to update'
        },
        subject: {
          type: 'string',
          description: 'New subject'
        },
        description: {
          type: 'string',
          description: 'New description'
        },
        status: {
          type: 'string',
          description: 'New status',
          enum: ['open', 'pending', 'resolved', 'closed', 'in progress', 'on hold']
        },
        priority: {
          type: 'string',
          description: 'New priority',
          enum: ['low', 'medium', 'high', 'urgent']
        },
        category: {
          type: 'string',
          description: 'New category'
        },
        subcategory: {
          type: 'string',
          description: 'New subcategory'
        },
        technician_id: {
          type: 'string',
          description: 'ID of technician to assign'
        },
        technician_email: {
          type: 'string',
          description: 'Email of technician to assign'
        },
        resolution: {
          type: 'string',
          description: 'Resolution text to set on the request'
        },
        update_reason: {
          type: 'string',
          description: 'Reason for this update'
        },
        due_by_time: {
          type: 'object',
          description: 'New due date/time as { value: <epoch_ms> }'
        },
        urgency: {
          type: 'string',
          description: 'New urgency level'
        },
        impact: {
          type: 'string',
          description: 'New impact level'
        },
        level: {
          type: 'string',
          description: 'New support level'
        },
        group: {
          type: 'string',
          description: 'New group name'
        },
        site: {
          type: 'string',
          description: 'New site name'
        },
        scheduled_start_time: {
          type: 'object',
          description: 'Scheduled start time as { value: <epoch_ms> }'
        },
        scheduled_end_time: {
          type: 'object',
          description: 'Scheduled end time as { value: <epoch_ms> }'
        }
      },
      required: ['request_id']
    }
  },
  {
    name: 'close_request',
    description: 'Close a request using the dedicated close endpoint (POST /requests/{id}/close). Use closure_resolution to set the resolution text separately.',
    inputSchema: {
      type: 'object',
      properties: {
        request_id: {
          type: 'string',
          description: 'ID of the request to close'
        },
        closure_comments: {
          type: 'string',
          description: 'Closure comments (max 250 characters; longer text will be truncated automatically)'
        },
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
    description: 'Set the resolution text on a request. Can be called before or after closing.',
    inputSchema: {
      type: 'object',
      properties: {
        request_id: {
          type: 'string',
          description: 'ID of the request'
        },
        resolution: {
          type: 'string',
          description: 'Resolution text to record on the request (no character limit)'
        }
      },
      required: ['request_id', 'resolution']
    }
  },
  {
    name: 'update_status',
    description: 'Update the status of a request without closing it (e.g., set to On Hold, In Progress, Open)',
    inputSchema: {
      type: 'object',
      properties: {
        request_id: {
          type: 'string',
          description: 'ID of the request'
        },
        status: {
          type: 'string',
          description: 'New status name',
          enum: ['Open', 'On Hold', 'In Progress', 'Resolved', 'Closed', 'Cancelled']
        }
      },
      required: ['request_id', 'status']
    }
  },
  {
    name: 'add_note',
    description: 'Add a note/comment to a request',
    inputSchema: {
      type: 'object',
      properties: {
        request_id: {
          type: 'string',
          description: 'ID of the request'
        },
        note_content: {
          type: 'string',
          description: 'Content of the note'
        },
        is_public: {
          type: 'boolean',
          description: 'Whether the note is visible to requester',
          default: true
        }
      },
      required: ['request_id', 'note_content']
    }
  },
  {
    name: 'search_requests',
    description: 'Search requests by keyword',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query'
        },
        limit: {
          type: 'number',
          description: 'Maximum results (max 100 per API limits)',
          default: 10,
          maximum: 100
        }
      },
      required: ['query']
    }
  },
  {
    name: 'advanced_search_requests',
    description: 'Search requests using structured field criteria (e.g., by requester, technician, date range, priority)',
    inputSchema: {
      type: 'object',
      properties: {
        criteria: {
          type: 'array',
          description: 'Array of search criteria objects',
          items: {
            type: 'object',
            properties: {
              field: { type: 'string', description: 'Field name (e.g., "status.name", "priority.name", "requester.name", "created_time")' },
              condition: { type: 'string', description: 'Condition (e.g., "is", "is not", "contains", "greater than", "less than")' },
              value: { description: 'Value to match against' },
              logical_operator: { type: 'string', enum: ['AND', 'OR'], description: 'Logical join with previous criterion (omit for first)' }
            },
            required: ['field', 'condition', 'value']
          }
        },
        limit: {
          type: 'number',
          description: 'Maximum results (max 100)',
          default: 10,
          maximum: 100
        },
        page: {
          type: 'number',
          description: 'Page number for pagination (1-based)',
          default: 1
        },
        sort_by: {
          type: 'string',
          description: 'Field to sort by (e.g., "created_time", "subject")',
          default: 'created_time'
        },
        sort_order: {
          type: 'string',
          enum: ['asc', 'desc'],
          default: 'desc'
        }
      },
      required: ['criteria']
    }
  },
  {
    name: 'list_technicians',
    description: 'List available technicians for ticket assignment',
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Maximum number of technicians to return (max 100 per API limits)',
          default: 25,
          maximum: 100
        },
        search_term: {
          type: 'string',
          description: 'Search by name or email'
        }
      }
    }
  },
  {
    name: 'get_technician',
    description: 'Get detailed information about a specific technician',
    inputSchema: {
      type: 'object',
      properties: {
        technician_id: {
          type: 'string',
          description: 'The ID of the technician'
        }
      },
      required: ['technician_id']
    }
  },
  {
    name: 'find_technician',
    description: 'Find a technician by name or email (returns best match)',
    inputSchema: {
      type: 'object',
      properties: {
        search_term: {
          type: 'string',
          description: 'Name or email to search for'
        }
      },
      required: ['search_term']
    }
  },
  {
    name: 'reply_to_requester',
    description: 'Send an email reply to the requester that appears in the ticket conversation',
    inputSchema: {
      type: 'object',
      properties: {
        request_id: {
          type: 'string',
          description: 'ID of the request to reply to'
        },
        reply_message: {
          type: 'string',
          description: 'The reply message content to send to the requester'
        },
        mark_first_response: {
          type: 'boolean',
          description: 'Whether to mark this as the first response to the ticket',
          default: false
        }
      },
      required: ['request_id', 'reply_message']
    }
  },
  {
    name: 'add_private_note',
    description: 'Add a private note to a request (not visible to requester)',
    inputSchema: {
      type: 'object',
      properties: {
        request_id: {
          type: 'string',
          description: 'ID of the request to add private note to'
        },
        note_content: {
          type: 'string',
          description: 'Content of the private note'
        },
        notify_technician: {
          type: 'boolean',
          description: 'Whether to notify the assigned technician',
          default: true
        }
      },
      required: ['request_id', 'note_content']
    }
  },
  {
    name: 'send_first_response',
    description: 'Send the first response to a requester (marks as first response and sends email)',
    inputSchema: {
      type: 'object',
      properties: {
        request_id: {
          type: 'string',
          description: 'ID of the request to send first response to'
        },
        response_message: {
          type: 'string',
          description: 'The first response message content'
        }
      },
      required: ['request_id', 'response_message']
    }
  },
  {
    name: 'get_request_conversation',
    description: 'Get the full conversation/notes history for a request',
    inputSchema: {
      type: 'object',
      properties: {
        request_id: {
          type: 'string',
          description: 'ID of the request to get conversation for'
        }
      },
      required: ['request_id']
    }
  },
  {
    name: 'delete_request',
    description: 'Permanently delete a service desk request. This action cannot be undone.',
    inputSchema: {
      type: 'object',
      properties: {
        request_id: {
          type: 'string',
          description: 'ID of the request to permanently delete'
        }
      },
      required: ['request_id']
    }
  },
  {
    name: 'add_attachment',
    description: 'Attach a file to a service desk request (max 50 attachments per request)',
    inputSchema: {
      type: 'object',
      properties: {
        request_id: {
          type: 'string',
          description: 'ID of the request to attach the file to'
        },
        file_path: {
          type: 'string',
          description: 'Absolute path to the file on the server filesystem'
        },
        file_name: {
          type: 'string',
          description: 'Display name for the attachment (defaults to the filename from file_path)'
        }
      },
      required: ['request_id', 'file_path']
    }
  }
];

// Handle JSON-RPC messages
function handleJsonRpcMessage(message, sseConnection) {
  const { method, params, id, jsonrpc } = message;
  const isNotification = id === undefined;
  
  console.error(`Received ${isNotification ? 'notification' : 'request'}: ${method}`);
  
  if (isNotification) {
    console.error(`Ignoring notification: ${method}`);
    return null;
  }
  
  try {
    let result;
    
    switch (method) {
      case 'initialize':
        result = {
          protocolVersion: '2024-11-05',
          capabilities: {
            tools: {}
          },
          serverInfo: {
            name: 'service-desk-plus',
            version: '2.0.0'
          }
        };
        break;
        
      case 'tools/list':
        result = { tools };
        break;
        
      case 'resources/list':
        // No resources provided by this server
        result = { resources: [] };
        break;
        
      case 'prompts/list':
        // No prompts provided by this server
        result = { prompts: [] };
        break;
        
      case 'tools/call':
        const { name, arguments: args } = params || {};
        
        if (!sdpClient) {
          throw new Error('SDP client not initialized. Please check OAuth configuration.');
        }
        
        const implementation = toolImplementations[name];
        if (!implementation) {
          throw new Error(`Unknown tool: ${name}`);
        }
        
        // Execute tool asynchronously
        return implementation(args || {}).then(toolResult => ({
          jsonrpc: '2.0',
          result: toolResult,
          id
        })).catch(error => ({
          jsonrpc: '2.0',
          error: {
            code: -32603,
            message: error.message
          },
          id
        }));
        
      default:
        return {
          jsonrpc: '2.0',
          error: {
            code: -32601,
            message: `Method not found: ${method}`
          },
          id
        };
    }
    
    return {
      jsonrpc: '2.0',
      result,
      id
    };
    
  } catch (error) {
    return {
      jsonrpc: '2.0',
      error: {
        code: -32603,
        message: error.message
      },
      id
    };
  }
}

// Message endpoint
app.post('/messages', async (req, res) => {
  const sessionId = req.query.sessionId || req.headers['x-session-id'];
  const sseConnection = connections.get(sessionId);
  
  if (!sseConnection) {
    return res.status(404).json({ error: 'Session not found' });
  }

  const responsePromise = handleJsonRpcMessage(req.body, sseConnection);
  
  if (responsePromise && responsePromise.then) {
    // Handle async response
    const response = await responsePromise;
    if (response) {
      sseConnection.write(`data: ${JSON.stringify(response)}\n\n`);
    }
  } else if (responsePromise) {
    // Handle sync response
    sseConnection.write(`data: ${JSON.stringify(responsePromise)}\n\n`);
  }
  
  res.json({ status: 'ok' });
});

// Direct POST to /sse endpoint
app.post('/sse', async (req, res) => {
  console.error('Direct SSE POST received');
  
  const responsePromise = handleJsonRpcMessage(req.body, null);
  
  if (!responsePromise) {
    return res.status(200).end();
  }
  
  if (responsePromise.then) {
    const response = await responsePromise;
    res.json(response);
  } else {
    res.json(responsePromise);
  }
});

const PORT = process.env.PORT || 3456;
app.listen(PORT, '0.0.0.0', () => {
  console.error(`MCP SSE Server with SDP Integration running on port ${PORT}`);
  console.error(`SSE endpoint: http://0.0.0.0:${PORT}/sse`);
  console.error(`Health: http://0.0.0.0:${PORT}/health`);
  console.error(`\nIntegrated Service Desk Plus tools:`);
  console.error('Request Management:');
  console.error('- list_requests: List service desk requests');
  console.error('- get_request: Get request details');
  console.error('- create_request: Create new request');
  console.error('- update_request: Update existing request');
  console.error('- close_request: Close request');
  console.error('- add_note: Add note to request');
  console.error('- search_requests: Search requests');
  console.error('\nEmail Communication:');
  console.error('- reply_to_requester: Send email reply to requester');
  console.error('- add_private_note: Add private note (not visible to requester)');
  console.error('- send_first_response: Send first response with email notification');
  console.error('- get_request_conversation: Get full conversation history');
  console.error('\nRequest Actions:');
  console.error('- delete_request: Permanently delete a request');
  console.error('- add_attachment: Attach a file to a request');
  console.error('\nUtilities:');
  console.error('- get_metadata: Get valid field values');
  console.error('- claude_code_command: Claude Code integration');
  
  console.error('\n🪟 Windows VS Code Configuration:');
  console.error('Create .vscode/mcp.json or %USERPROFILE%\\.mcp.json:');
  console.error(JSON.stringify({
    servers: {
      'service-desk-plus': {
        type: 'stdio',
        command: 'npx',
        args: ['-y', 'mcp-remote', 'http://' + (process.env.SERVER_HOST || 'localhost') + ':' + PORT + '/sse', '--allow-http']
      }
    }
  }, null, 2));
  
  if (!sdpClient) {
    console.error('\n⚠️  SDP client not initialized. Please configure OAuth credentials.');
    return;
  }

  sdpClient.testConnection().then(result => {
    if (result.success) {
      console.error('\n✅ SDP API connection successful');
      console.error(`   Instance : ${result.instance}`);
      console.error(`   URL      : ${result.baseUrl}`);
      console.error(`   Region   : ${result.dataCenter}`);
    } else {
      console.error('\n❌ SDP API connection failed');
      console.error(`   Instance : ${result.instance}`);
      console.error(`   URL      : ${result.baseUrl}`);
      console.error(`   Error    : ${result.error}`);
      console.error('   Check SDP_BASE_URL, SDP_CLIENT_ID, SDP_CLIENT_SECRET, SDP_REFRESH_TOKEN');
    }
  }).catch(err => {
    console.error('\n❌ SDP API connection test threw an unexpected error:', err.message);
  });
});