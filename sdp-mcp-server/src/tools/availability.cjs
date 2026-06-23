'use strict';

function makeImplementations(sdpClient) {
  return {

    async list_technician_unavailability(params) {
      const { limit = 25, technician_id } = params;
      const result = await sdpClient.availability.listUnavailability({
        limit,
        technicianId: technician_id
      });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },

    async get_technician_unavailability(params) {
      const { unavailability_id } = params;
      if (!unavailability_id) throw new Error('unavailability_id is required');
      const record = await sdpClient.availability.getUnavailability(unavailability_id);
      return { content: [{ type: 'text', text: JSON.stringify(record, null, 2) }] };
    }

  };
}

const schemas = [
  {
    name: 'list_technician_unavailability',
    description: 'List technician unavailability/leave periods. Use to check if a technician is on leave before assigning a request.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Maximum number of records to return (max 100)', default: 25, maximum: 100 },
        technician_id: { type: 'string', description: 'Filter by technician ID to check a specific person\'s availability' }
      }
    }
  },
  {
    name: 'get_technician_unavailability',
    description: 'Get details of a specific unavailability/leave record by its ID',
    inputSchema: {
      type: 'object',
      properties: {
        unavailability_id: { type: 'string', description: 'The ID of the unavailability record' }
      },
      required: ['unavailability_id']
    }
  }
];

module.exports = { makeImplementations, schemas };
