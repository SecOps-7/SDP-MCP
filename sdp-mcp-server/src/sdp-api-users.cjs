/**
 * Service Desk Plus API Users/Technicians Module
 * Handles user and technician lookups
 */

const axios = require('axios');

class SDPUsersAPI {
  constructor(client, metadata) {
    this.client = client;
    this.metadata = metadata;
  }

  /**
   * List technicians
   */
  async listTechnicians(options = {}) {
    const { limit = 25, offset = 0, searchTerm } = options;

    const rowCount = Math.min(limit, 100);

    const listInfo = {
      row_count: String(rowCount),
      start_index: String(offset + 1),
      sort_field: 'name',
      sort_order: 'asc',
      get_total_count: true
    };

    if (searchTerm) {
      listInfo.search_fields = { name: searchTerm };
    }

    const params = {
      input_data: JSON.stringify({ list_info: listInfo })
    };

    try {
      const response = await this.client.get('/technicians', { params });
      const technicians = response.data.technicians || [];
      return {
        technicians,
        total_count: response.data.list_info?.total_count || technicians.length,
        has_more: response.data.list_info?.has_more_rows || false
      };
    } catch (error) {
      console.error('Failed to list technicians:', error.message);
      throw error;
    }
  }

  /**
   * Get technician details
   */
  async getTechnician(technicianId) {
    try {
      const response = await this.client.get(`/technicians/${technicianId}`);
      return response.data.technician;
    } catch (error) {
      console.error('Failed to get technician:', error.message);
      throw error;
    }
  }

  /**
   * List requesters
   */
  async listUsers(options = {}) {
    const { limit = 25, offset = 0, searchTerm, includeInactive = false } = options;

    const rowCount = Math.min(limit, 100);

    const listInfo = {
      row_count: String(rowCount),
      start_index: String(offset + 1),
      sort_field: 'name',
      sort_order: 'asc',
      get_total_count: true
    };

    if (searchTerm) {
      listInfo.search_fields = { name: searchTerm };
    }

    const params = {
      input_data: JSON.stringify({ list_info: listInfo })
    };

    const response = await this.client.get('/requesters', { params });

    let users = response.data.requesters || [];
    if (!includeInactive) {
      users = users.filter(user => user.is_active !== false);
    }

    return {
      users,
      total_count: users.length,
      has_more: response.data.list_info?.has_more_rows || false
    };
  }

  /**
   * Get requester details
   */
  async getUser(userId) {
    const response = await this.client.get(`/requesters/${userId}`);
    return response.data.requester;
  }

  /**
   * Search for technician by name or email
   */
  async findTechnician(searchTerm) {
    try {
      const isEmail = searchTerm.includes('@');
      const listInfo = {
        row_count: '10',
        start_index: '1',
        get_total_count: true,
        search_fields: isEmail
          ? { email_id: searchTerm }
          : { name: searchTerm }
      };

      const params = {
        input_data: JSON.stringify({ list_info: listInfo })
      };

      const response = await this.client.get('/technicians', { params });
      const technicians = response.data.technicians || [];

      if (technicians.length > 0) {
        const exactMatch = technicians.find(
          t => t.email_id?.toLowerCase() === searchTerm.toLowerCase() ||
               t.name?.toLowerCase() === searchTerm.toLowerCase()
        );
        return exactMatch || technicians[0];
      }
    } catch (error) {
      console.error('Failed to find technician:', error.message);
    }

    return null;
  }

  /**
   * Get current user (the API user)
   */
  async getCurrentUser() {
    try {
      // This endpoint might vary by SDP version
      const response = await this.client.get('/users/me');
      return response.data.user;
    } catch (error) {
      console.error('Failed to get current user:', error.message);
      // Fallback: try to get from technicians list
      const techs = await this.listTechnicians({ limit: 1 });
      return techs.technicians[0] || null;
    }
  }
}

module.exports = { SDPUsersAPI };