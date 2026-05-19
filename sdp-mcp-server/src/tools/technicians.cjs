'use strict';

function makeImplementations(sdpClient) {
  return {

    async list_technicians(params) {
      const { limit = 25, offset = 0, search_term } = params;
      const result = await sdpClient.users.listTechnicians({ limit, offset, searchTerm: search_term });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },

    async get_technician(params) {
      const { technician_id } = params;
      if (!technician_id) throw new Error('technician_id is required');
      const technician = await sdpClient.users.getTechnician(technician_id);
      return { content: [{ type: 'text', text: JSON.stringify(technician, null, 2) }] };
    },

    async find_technician(params) {
      const { search_term } = params;
      if (!search_term) throw new Error('search_term is required');
      const clean = search_term.replace(/^mailto:/i, '');
      const technician = await sdpClient.users.findTechnician(clean);
      return { content: [{ type: 'text', text: JSON.stringify({ found: !!technician, technician: technician || null }, null, 2) }] };
    }

  };
}

const schemas = [
  {
    name: 'list_technicians',
    description: 'List available technicians for request assignment',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Maximum number of technicians to return (max 100)', default: 25, maximum: 100 },
        search_term: { type: 'string', description: 'Filter by name or email' }
      }
    }
  },
  {
    name: 'get_technician',
    description: 'Get detailed information about a specific technician by ID',
    inputSchema: {
      type: 'object',
      properties: {
        technician_id: { type: 'string', description: 'The ID of the technician' }
      },
      required: ['technician_id']
    }
  },
  {
    name: 'find_technician',
    description: 'Find a technician by name or email address (returns best match)',
    inputSchema: {
      type: 'object',
      properties: {
        search_term: { type: 'string', description: 'Name or email to search for' }
      },
      required: ['search_term']
    }
  }
];

module.exports = { makeImplementations, schemas };
