'use strict';

class SDPAvailabilityAPI {
  constructor(client) {
    this.client = client;
  }

  async listUnavailability(options = {}) {
    const { limit = 25, offset = 0, technicianId } = options;
    const rowCount = Math.min(limit, 100);

    const listInfo = {
      row_count: String(rowCount),
      start_index: String(offset + 1),
      get_total_count: true
    };

    if (technicianId) {
      listInfo.search_criteria = [{ field: 'user.id', condition: 'is', value: String(technicianId) }];
    }

    const params = {
      input_data: JSON.stringify({ list_info: listInfo })
    };

    const response = await this.client.get('/unavailability', { params });
    const unavailability = response.data.unavailability || [];

    return {
      unavailability,
      total_count: response.data.list_info?.total_count || unavailability.length,
      has_more: response.data.list_info?.has_more_rows || false
    };
  }

  async getUnavailability(unavailabilityId) {
    const response = await this.client.get(`/unavailability/${unavailabilityId}`);
    return response.data.unavailability;
  }
}

module.exports = { SDPAvailabilityAPI };
