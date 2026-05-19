'use strict';

const { readResource, listResources } = require('../mcp-resources.cjs');

function makeImplementations(sdpClient) {
  return {

    async get_metadata() {
      console.error('Fetching SDP metadata...');
      const metadata = await sdpClient.getMetadata();
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            message: 'Valid values for Service Desk Plus fields',
            priorities: metadata.priorities,
            statuses: metadata.statuses,
            categories: metadata.categories.slice(0, 20),
            templates: metadata.templates.slice(0, 10),
            usage_tips: {
              priority: 'Use values like: low, medium, high, urgent',
              status: 'Use values like: open, closed, pending, resolved',
              category: 'Use exact category names from the list above'
            }
          }, null, 2)
        }]
      };
    },

    async get_usage_guide(params) {
      const { section = 'tool-reference' } = params || {};
      const uri = `sdp://usage/${section}`;
      const resource = readResource(uri);
      if (!resource) {
        const valid = listResources().map(r => r.uri.replace('sdp://usage/', '')).join(', ');
        throw new Error(`Unknown section "${section}". Valid sections: ${valid}`);
      }
      return {
        content: [
          { type: 'text', text: `Usage guide section: ${resource.name}\n\n${resource.text}` },
          { type: 'resource', resource: { uri: resource.uri, mimeType: resource.mimeType, text: resource.text } }
        ]
      };
    },

    async claude_code_command(params) {
      const { command, project_path, args = [] } = params;
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
      let message = `To execute '${command}' in Claude Code:\n`;
      switch (command) {
        case 'open_project':    message += `1. Open Claude Code\n2. Navigate to: ${project_path || process.cwd()}\n3. The MCP server project is in the configured working directory`; break;
        case 'create_file':     message += `1. Use the 'Write' tool to create: ${args[0] || 'filename.js'}`; break;
        case 'read_file':       message += `1. Use the 'Read' tool for: ${args[0] || 'filename'}`; break;
        case 'list_files':      message += `1. Use the 'LS' tool for: ${project_path || '.'}`; break;
        case 'run_command':     message += `1. Use the 'Bash' tool\n2. Command: ${args.join(' ') || 'npm test'}`; break;
        case 'git_status':      message += `1. Use 'Bash' tool with: git status`; break;
        case 'git_commit':      message += `1. Stage files: git add .\n2. Commit: git commit -m "${args[0] || 'Update from MCP'}"`; break;
        default:                message += `Command '${command}' recognized but not implemented yet`;
      }
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ command, status: 'instructions', message, project_info: { current_directory: process.cwd() } }, null, 2)
        }]
      };
    }

  };
}

const schemas = [
  {
    name: 'get_metadata',
    description: 'Get valid values for priorities, statuses, categories, and templates. Use before create/update if unsure whether a field value is valid.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'get_usage_guide',
    description: 'Retrieve a specific section of the SDP usage guide to inform tool usage. Returns structured context about API rules, field formats, tool reference, error codes, action sequences, or the decision matrix.',
    inputSchema: {
      type: 'object',
      properties: {
        section: {
          type: 'string',
          description: 'Which section of the guide to retrieve',
          enum: ['api-rules', 'tool-reference', 'field-formats', 'error-codes', 'action-sequences', 'decision-matrix'],
          default: 'tool-reference'
        }
      },
      required: []
    }
  },
  {
    name: 'claude_code_command',
    description: 'Execute Claude Code commands or get instructions for Claude Code integration. Developer utility — do not use in request fulfilment workflows.',
    inputSchema: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'Command to execute',
          enum: ['open_project', 'create_file', 'read_file', 'write_file', 'list_files', 'run_command', 'git_status', 'git_commit']
        },
        project_path: { type: 'string', description: 'Path to project or file', default: process.cwd() },
        args: { type: 'array', items: { type: 'string' }, description: 'Additional arguments' }
      },
      required: ['command']
    }
  }
];

module.exports = { makeImplementations, schemas };
