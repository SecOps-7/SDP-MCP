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
];

module.exports = { makeImplementations, schemas };
