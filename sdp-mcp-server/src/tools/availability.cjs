'use strict';

function makeImplementations(sdpClient) {
  return {

    async list_technician_unavailability(params) {
      const { technician_id } = params;
      const result = await sdpClient.availability.listUnavailability({
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
    description: 'Returns technicians currently on leave right now. Use this before assigning a request to verify the technician is available today. Returns an empty list if no technicians are currently unavailable.',
    inputSchema: {
      type: 'object',
      properties: {
        technician_id: { type: 'string', description: 'Optionally scope to a single technician ID to check whether that specific person is currently unavailable' }
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
