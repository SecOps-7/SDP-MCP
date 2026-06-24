'use strict';

class SDPAvailabilityAPI {
  constructor(client) {
    this.client = client;
  }

  async listUnavailability(options = {}) {
    const { technicianId, technicianOnly = true } = options;

    // Paginate through all records — must fetch everything to filter by current date client-side
    const allRecords = [];
    let startIndex = 1;
    let hasMore = true;

    while (hasMore) {
      const listInfo = {
        row_count: '100',
        start_index: String(startIndex),
        get_total_count: true
      };

      if (technicianId) {
        listInfo.search_criteria = [{ field: 'user.id', condition: 'is', value: String(technicianId) }];
      }

      const response = await this.client.get('/unavailability', { params: { input_data: JSON.stringify({ list_info: listInfo }) } });
      const records = response.data.unavailability || [];
      allRecords.push(...records);
      hasMore = response.data.list_info?.has_more_rows || false;
      startIndex += records.length;
      if (records.length === 0) break;
    }

    // Keep only records whose window contains right now
    const now = Date.now();
    const active = allRecords.filter(r => {
      const from = parseInt(r.from_date?.value || '0', 10);
      const to = parseInt(r.to_date?.value || '0', 10);
      return from <= now && to >= now;
    });

    // For ticket assignment purposes, non-technicians are irrelevant
    const filtered = technicianOnly ? active.filter(r => r.is_technician) : active;

    return {
      as_of: new Date().toISOString(),
      unavailable_count: filtered.length,
      unavailability: filtered
    };
  }

  async getUnavailability(unavailabilityId) {
    const response = await this.client.get(`/unavailability/${unavailabilityId}`);
    return response.data.unavailability;
  }
}

module.exports = { SDPAvailabilityAPI };
