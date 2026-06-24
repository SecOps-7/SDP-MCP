/**
 * Service Desk Plus API Client v2
 * Uses proper IDs for priorities, statuses, and categories
 */

const axios = require('axios');
const { SDPOAuthClient } = require('./sdp-oauth-client.cjs');
const { SDPMetadataClient } = require('./sdp-api-metadata.cjs');
const { SDPUsersAPI } = require('./sdp-api-users.cjs');
const { SDPAvailabilityAPI } = require('./sdp-api-availability.cjs');
const errorLogger = require('./utils/error-logger.cjs');

// Canonical priority name map for this SDP instance.
// 'z - Medium' is the actual name configured in this tenant — do not change to '2 - Medium'.
const PRIORITY_NAMES = {
  'low':    '1 - Low',
  'medium': 'z - Medium',
  'high':   '3 - High',
  'urgent': '4 - Critical'
};

class SDPAPIClientV2 {
  constructor(config = {}) {
    // Configuration
    this.portalName = config.portalName || process.env.SDP_PORTAL_NAME;
    this.dataCenter = config.dataCenter || process.env.SDP_DATA_CENTER || 'US';
    this.customDomain = config.customDomain || process.env.SDP_BASE_URL;
    this.instanceName = config.instanceName || process.env.SDP_PORTAL_NAME;

    // Initialize clients (use singleton OAuth client)
    this.oauth = SDPOAuthClient.getInstance(config);
    this.metadata = new SDPMetadataClient(config);

    // Create axios instance
    // Check if we should use mock API for testing
    const useMock = process.env.SDP_USE_MOCK === 'true' || process.env.SDP_USE_MOCK_API === 'true';
    const baseURL = useMock
      ? `${process.env.SDP_BASE_URL || 'http://localhost:3457'}/api/v3`
      : (() => {
          const domain = this.customDomain || 'https://sdpondemand.manageengine.com';
          const portal = process.env.SDP_INSTANCE_NAME || process.env.SDP_PORTAL_NAME;
          // If domain already contains /app/ the portal path is embedded — don't add it again
          if (domain.includes('/app/')) return `${domain}/api/v3`;
          return portal ? `${domain}/app/${portal}/api/v3` : `${domain}/api/v3`;
        })();
    
    console.error(`SDP API baseURL: ${baseURL}`);
    if (useMock) {
      console.error('🧪 Using MOCK Service Desk Plus API:', baseURL);
    }
    
    this.useMockAPI = useMock;
    
    this.client = axios.create({
      baseURL,
      timeout: 30000,
      headers: {
        'Accept': 'application/vnd.manageengine.sdp.v3+json',
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      paramsSerializer: {
        serialize: (params) => Object.entries(params)
          .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
          .join('&')
      }
    });
    
    // Auth interceptor
    this.client.interceptors.request.use(
      async (config) => {
        // Skip OAuth for mock API
        if (!this.useMockAPI) {
          const token = await this.oauth.getAccessToken();
          config.headers['Authorization'] = `Zoho-oauthtoken ${token}`;
        } else {
          // Mock API doesn't need auth
          config.headers['Authorization'] = 'Zoho-oauthtoken MOCK_TOKEN';
        }
        console.error(`API Request: ${config.method.toUpperCase()} ${config.url}`);
        if (config.params?.input_data) {
          console.error('Payload:', JSON.stringify(JSON.parse(config.params.input_data), null, 2));
          const encodedQS = `input_data=${encodeURIComponent(String(config.params.input_data))}`;
          console.error(`Full URL: ${config.baseURL}${config.url}?${encodedQS}`);
        }
        return config;
      },
      (error) => Promise.reject(error)
    );
    
    // Response interceptor
    this.client.interceptors.response.use(
      (response) => {
        // Log response summary for list endpoints so empty-result searches are visible
        if (response.data?.list_info !== undefined) {
          const li = response.data.list_info;
          const itemCount = li.total_count ??
            response.data.requests?.length ?? response.data.notes?.length ??
            response.data.technicians?.length ?? response.data.problems?.length ?? 'n/a';
          console.error(`API Response: ${response.status} — total_count=${itemCount} has_more=${li.has_more_rows ?? false} start_index=${li.start_index ?? 'n/a'}`);
          const hasResults = response.data.requests?.length || response.data.notes?.length ||
            response.data.technicians?.length || response.data.problems?.length;
          if ((li.total_count === 0 || !hasResults) && response.config?.params?.input_data) {
            console.error('Empty result — search_criteria sent:', JSON.stringify(
              JSON.parse(response.config.params.input_data)?.list_info?.search_criteria ?? 'none'
            ));
          }
        }
        // Some responses have response_status array instead of object
        if (Array.isArray(response.data?.response_status)) {
          return response;
        }
        return response;
      },
      async (error) => {
        // Log the actual error status first
        if (error.response) {
          console.error(`API returned status ${error.response.status} for ${error.config.method.toUpperCase()} ${error.config.url}`);
        }
        
        // Only refresh on actual 401 Unauthorized errors with token issues
        if (error.response?.status === 401) {
          // IMPORTANT: Check if it's HTML error page (endpoint doesn't exist)
          const errorData = error.response?.data;
          
          // If we get HTML back, it's a 404/missing endpoint, not auth issue
          if (typeof errorData === 'string' && errorData.includes('<html')) {
            console.error('Got 401 with HTML response - endpoint does not exist, skipping token refresh');
            return Promise.reject(error);
          }
          
          const errorMessage = errorData?.response_status?.messages?.[0]?.message || 
                              errorData?.message || 
                              JSON.stringify(errorData);
          
          // Don't refresh for missing endpoints or scope issues
          // Check for specific status codes that indicate non-token issues
          const statusCode = errorData?.response_status?.status_code;
          
          // Skip refresh for these status codes (not token-related)
          const skipRefreshCodes = [
            4002, // Forbidden - permission issue
            4007, // Resource not found
            7001  // License issue
          ];
          
          if (skipRefreshCodes.includes(statusCode)) {
            console.error(`Got 401 with status code ${statusCode}, skipping token refresh`);
            return Promise.reject(error);
          }
          
          // Also check message patterns
          const skipRefreshPatterns = [
            'endpoint not found',
            'resource not found',
            'scope',
            'permission',
            'access denied'
          ];
          
          const shouldSkipRefresh = skipRefreshPatterns.some(pattern => 
            errorMessage.toLowerCase().includes(pattern)
          );
          
          // Log the actual 401 response body to diagnose auth failures
          console.error('401 response body:', JSON.stringify(errorData));

          if (!shouldSkipRefresh) {
            // Guard against infinite retry loop — only retry once per request
            if (error.config._retry) {
              console.error('Got 401 again after token refresh — token is valid but API still rejects. Check portal name and scopes.');
              return Promise.reject(error);
            }
            error.config._retry = true;
            console.error('Got 401 Unauthorized, attempting token refresh...');
            try {
              await this.oauth.refreshAccessToken();
              const token = await this.oauth.getAccessToken();
              error.config.headers['Authorization'] = `Zoho-oauthtoken ${token}`;
              return this.client(error.config);
            } catch (refreshError) {
              console.error('Token refresh failed:', refreshError.message);
              return Promise.reject(error);
            }
          } else {
            console.error(`Got 401 but skipping refresh (likely missing scope/endpoint): ${errorMessage}`);
          }
        }
        
        // Handle 400 errors with HTML (non-existent endpoints)
        if (error.response?.status === 400) {
          const errorData = error.response?.data;
          if (typeof errorData === 'string' && errorData.includes('<html')) {
            console.error('Got 400 with HTML response - endpoint does not exist');
            error.message = 'API endpoint does not exist';
          }
        }
        
        if (error.response) {
          // Don't log full HTML responses
          const data = typeof error.response.data === 'string' && error.response.data.includes('<html>') 
            ? 'HTML error page' 
            : error.response.data;
            
          console.error('API Error:', JSON.stringify({
            status: error.response.status,
            data: data
          }, null, 2));
          
          // Log detailed error messages with status codes
          if (error.response.data?.response_status) {
            const status = error.response.data.response_status;
            console.error(`API Status Code: ${status.status_code} - ${status.status}`);
            
            if (status.messages) {
              console.error('Error details:');
              status.messages.forEach(msg => {
                if (msg.fields) {
                  console.error(`  - Missing mandatory fields: ${msg.fields.join(', ')}`);
                } else {
                  console.error(`  - ${msg.field || 'General'}: ${msg.message}`);
                }
              });
            }
          }
        }
        
        // Log error with status codes
        const formattedError = this.formatError(error);
        errorLogger.logApiError(formattedError, {
          endpoint: error.config?.url,
          method: error.config?.method,
          requestData: error.config?.data
        });
        
        return Promise.reject(formattedError);
      }
    );
    
    // Initialize metadata on first use
    this.metadataInitialized = false;
    
    // Initialize users API
    this.users = new SDPUsersAPI(this.client, this.metadata);
    this.availability = new SDPAvailabilityAPI(this.client);
  }
  
  /**
   * Ensure metadata is loaded
   */
  async ensureMetadata() {
    if (!this.metadataInitialized) {
      console.error('Loading SDP metadata...');
      await this.metadata.getAllMetadata();
      this.metadataInitialized = true;
      console.error('Metadata loaded successfully');
    }
  }
  
  /**
   * Format errors
   */
  formatError(error) {
    if (error.response?.data?.response_status) {
      const status = error.response.data.response_status;
      const messages = status.messages || [];
      
      // Build detailed error info
      const errorInfo = {
        code: status.status_code,
        httpStatus: error.response.status,
        message: messages.map(m => m.message).join('; ') || 'API Error',
        details: error.response.data,
        // Add specific field information
        fields: messages.filter(m => m.fields).flatMap(m => m.fields),
        fieldErrors: messages.filter(m => m.field).map(m => ({
          field: m.field,
          message: m.message
        }))
      };
      
      // Log status codes for debugging
      console.error(`API Error - Status Code: ${status.status_code}, HTTP: ${error.response.status}`);
      
      return errorInfo;
    }
    
    return {
      code: error.response?.status || 'UNKNOWN',
      httpStatus: error.response?.status,
      message: error.message,
      details: error.response?.data
    };
  }
  
  /**
   * Get metadata
   */
  async getMetadata() {
    await this.ensureMetadata();
    return this.metadata.getAllMetadata();
  }
  
  /**
   * List requests
   */
  async listRequests(options = {}) {
    const { limit = 10, offset = 0, status, priority, sortBy = 'created_time', sortOrder = 'desc' } = options;

    await this.ensureMetadata();

    // Enforce API maximum of 100 rows per request
    const rowCount = Math.min(limit, 100);

    const listInfo = {
      row_count: rowCount,
      start_index: offset,
      sort_field: sortBy,
      sort_order: sortOrder,
      get_total_count: true
    };

    // Add filters - try filter_by for simple filters first
    if (status && !priority) {
      // Single status filter - use filter_by
      const statusMap = {
        'open': 'Open',
        'closed': 'Closed',
        'pending': 'On Hold',
        'resolved': 'Resolved',
        'in progress': 'In Progress'
      };
      const statusName = statusMap[status.toLowerCase()] || status;
      listInfo.filter_by = {
        name: 'status.name',
        value: statusName
      };
    } else if (priority && !status) {
      // Single priority filter - use filter_by
      const priorityName = PRIORITY_NAMES[priority.toLowerCase()] || priority;
      listInfo.filter_by = {
        name: 'priority.name',
        value: priorityName
      };
    } else if (status && priority) {
      // Multiple filters — use children nested format (flat array causes Tomcat 400)
      const statusMap = {
        'open': 'open', 'closed': 'closed', 'pending': 'on hold',
        'resolved': 'resolved', 'in progress': 'in progress'
      };
      const statusName = statusMap[status.toLowerCase()] || status.toLowerCase();
      const priorityName = PRIORITY_NAMES[priority.toLowerCase()] || priority;
      listInfo.search_criteria = {
        field: 'status.name',
        condition: 'is',
        value: statusName,
        children: [{ field: 'priority.name', condition: 'is', value: priorityName, logical_operator: 'AND' }]
      };
    }
    
    const params = {
      input_data: JSON.stringify({ list_info: listInfo })
    };
    
    const response = await this.client.get('/requests', { params });
    return {
      requests: response.data.requests || [],
      total_count: response.data.list_info?.total_count || 0,
      has_more: response.data.list_info?.has_more_rows || false
    };
  }
  
  /**
   * Get request
   */
  async getRequest(requestId) {
    const response = await this.client.get(`/requests/${requestId}`);
    return response.data.request;
  }
  
  /**
   * Create request with proper IDs
   * 
   * @param {Object} requestData - Request creation data
   * @param {string} requestData.subject - Subject of the request (required, max 250 chars)
   * @param {string} requestData.description - Description of the request (HTML supported)
   * @param {string} requestData.priority - Priority level (low, medium, high, urgent)
   * @param {string} requestData.category - Category name
   * @param {string} requestData.subcategory - Subcategory name
   * @param {Object} requestData.requester - Requester object with email_id
   * @param {string} requestData.requester_email - Requester email address
   * @param {string} requestData.requester_name - Requester name
   * @param {string} requestData.technician_id - Technician ID for assignment
   * @param {string} requestData.technician_email - Technician email for assignment
   * @param {string} requestData.impact_details - Impact description (max 250 chars)
   * @param {Array} requestData.email_ids_to_notify - Email addresses to notify
   * @param {string} requestData.urgency - Urgency level
   * @param {string} requestData.impact - Impact level
   * @param {string} requestData.level - Support level
   * @param {string} requestData.mode - Creation mode
   * @param {string} requestData.request_type - Type of request
   * @param {Object} requestData.due_by_time - Due date/time
   * @param {Object} requestData.first_response_due_by_time - First response due time
   * @param {Array} requestData.assets - Associated assets
   * @param {Array} requestData.configuration_items - Configuration items
   * @param {Object} requestData.udf_fields - User-defined fields
   * @param {Object} requestData.template - Template to use
   * @param {Object} requestData.site - Associated site
   * @param {Object} requestData.group - Assigned group
   * @param {Object} requestData.service_category - Service category
   * @param {Object} requestData.service_approvers - Service approval configuration
   * @param {Object} requestData.resources - Service catalog resources
   * @returns {Promise<Object>} The created request object
   */
  async createRequest(requestData) {
    const { 
      subject,
      description,
      priority,
      category, 
      subcategory, 
      requester, 
      requester_email, 
      requester_name, 
      technician_id, 
      technician_email,
      impact_details,
      email_ids_to_notify,
      urgency,
      impact,
      level,
      mode,
      request_type,
      due_by_time,
      first_response_due_by_time,
      assets,
      configuration_items,
      udf_fields,
      template,
      site,
      group,
      service_category,
      service_approvers,
      resources
    } = requestData;
    
    if (!subject) {
      throw new Error('Subject is required');
    }
    
    // Validate subject length
    if (subject.length > 250) {
      throw new Error('Subject must be 250 characters or less');
    }
    
    // Validate impact_details length
    if (impact_details && impact_details.length > 250) {
      throw new Error('Impact details must be 250 characters or less');
    }
    
    await this.ensureMetadata();
    
    // Only include fields that were explicitly provided — let SDP apply its own
    // template defaults rather than injecting values that may be wrong for this instance.
    const request = { subject };

    if (description)              request.description   = description;
    if (mode)                     request.mode          = { name: mode };
    if (request_type)             request.request_type  = { name: request_type };
    if (urgency)                  request.urgency       = { name: urgency };
    if (level)                    request.level         = { name: level };
    if (impact)                   request.impact        = { name: impact };
    if (impact_details)           request.impact_details = impact_details;
    if (due_by_time)              request.due_by_time   = due_by_time;
    if (first_response_due_by_time) request.first_response_due_by_time = first_response_due_by_time;
    if (assets?.length)           request.assets        = assets;
    if (configuration_items?.length) request.configuration_items = configuration_items;
    if (udf_fields)               request.udf_fields    = udf_fields;
    if (template)                 request.template      = typeof template === 'string' ? { name: template } : template;
    if (site)                     request.site          = typeof site === 'string' ? { name: site } : site;
    if (group)                    request.group         = typeof group === 'string' ? { name: group } : group;
    if (service_category)         request.service_category = typeof service_category === 'string' ? { name: service_category } : service_category;
    if (service_approvers)        request.service_approvers = service_approvers;
    if (resources)                request.resources     = resources;
    if (email_ids_to_notify?.length) request.email_ids_to_notify = email_ids_to_notify;

    if (priority) {
      request.priority = { name: PRIORITY_NAMES[priority.toLowerCase()] || priority };
    }

    if (category) {
      if (typeof category === 'object' && category.id) {
        request.category = category;
      } else {
        const categoryId = this.metadata.getCategoryId(category);
        request.category = (categoryId && categoryId !== category) ? { id: categoryId } : { name: category };
      }
    }

    if (subcategory) {
      request.subcategory = typeof subcategory === 'object' ? subcategory : { name: subcategory };
    }

    if (requester_email) {
      request.requester = { email_id: requester_email.toLowerCase() };
    } else if (requester_name) {
      request.requester = { name: requester_name };
    } else if (requester) {
      request.requester = typeof requester === 'string' ? { name: requester } : requester;
    }

    if (technician_id) {
      request.technician = { id: technician_id };
    } else if (technician_email) {
      request.technician = { email_id: technician_email.toLowerCase() };
    }

    const params = {
      input_data: JSON.stringify({ request })
    };

    try {
      const response = await this.client.post('/requests', null, { params });
      return response.data.request;
    } catch (error) {
      // Log the full error details for debugging
      console.error('Create request failed with payload:', JSON.stringify(request, null, 2));
      if (error.response?.data?.response_status?.messages) {
        const messages = error.response.data.response_status.messages;
        console.error('API Error Messages:', messages);
        // Throw a more specific error
        const fieldErrors = messages.map(m => `${m.field || 'Field'}: ${m.message}`).join(', ');
        throw new Error(`API validation failed: ${fieldErrors}`);
      }
      throw error;
    }
  }
  
  /**
   * Update request with proper IDs
   * 
   * @param {string} requestId - ID of the request to update
   * @param {Object} updates - Fields to update
   * @param {string} updates.subject - Updated subject (max 250 chars)
   * @param {string} updates.description - Updated description (HTML supported)
   * @param {string} updates.status - New status
   * @param {string} updates.priority - New priority level
   * @param {string} updates.category - New category
   * @param {string} updates.subcategory - New subcategory
   * @param {string} updates.technician_id - New technician ID
   * @param {string} updates.technician_email - New technician email
   * @param {string} updates.urgency - New urgency level
   * @param {string} updates.impact - New impact level
   * @param {string} updates.level - New support level
   * @param {Object} updates.due_by_time - New due date/time
   * @param {Object} updates.first_response_due_by_time - New first response due time
   * @param {string} updates.update_reason - Reason for the update
   * @param {string} updates.status_change_comments - Comments for status change
   * @param {string} updates.impact_details - Impact description (max 250 chars)
   * @param {Array} updates.email_ids_to_notify - Email addresses to notify
   * @param {Array} updates.assets - Associated assets
   * @param {Array} updates.configuration_items - Configuration items
   * @param {Object} updates.udf_fields - User-defined fields
   * @param {Object} updates.template - Template to use
   * @param {Object} updates.site - Associated site
   * @param {Object} updates.group - Assigned group
   * @param {Object} updates.service_category - Service category
   * @param {Object} updates.service_approvers - Service approval configuration
   * @param {Object} updates.resources - Service catalog resources
   * @param {Object} updates.resolution - Resolution details
   * @param {Object} updates.closure_info - Closure information
   * @param {Object} updates.scheduled_start_time - Scheduled start time
   * @param {Object} updates.scheduled_end_time - Scheduled end time
   * @returns {Promise<Object>} The updated request object
   */
  async updateRequest(requestId, updates) {
    await this.ensureMetadata();
    
    const request = {};
    
    // Validate field lengths
    if (updates.subject && updates.subject.length > 250) {
      throw new Error('Subject must be 250 characters or less');
    }
    
    if (updates.impact_details && updates.impact_details.length > 250) {
      throw new Error('Impact details must be 250 characters or less');
    }
    
    // Basic fields
    if (updates.subject) request.subject = updates.subject;
    if (updates.description) request.description = updates.description;
    if (updates.impact_details) request.impact_details = updates.impact_details;
    
    // Update reason and comments
    if (updates.update_reason) request.update_reason = updates.update_reason;
    if (updates.status_change_comments) request.status_change_comments = updates.status_change_comments;
    
    // Date/time fields
    if (updates.due_by_time) request.due_by_time = updates.due_by_time;
    if (updates.first_response_due_by_time) request.first_response_due_by_time = updates.first_response_due_by_time;
    if (updates.scheduled_start_time) request.scheduled_start_time = updates.scheduled_start_time;
    if (updates.scheduled_end_time) request.scheduled_end_time = updates.scheduled_end_time;
    
    // Array fields
    if (updates.email_ids_to_notify && Array.isArray(updates.email_ids_to_notify)) {
      request.email_ids_to_notify = updates.email_ids_to_notify;
    }
    
    if (updates.assets && Array.isArray(updates.assets)) {
      request.assets = updates.assets;
    }
    
    if (updates.configuration_items && Array.isArray(updates.configuration_items)) {
      request.configuration_items = updates.configuration_items;
    }
    
    // Object fields
    if (updates.udf_fields && typeof updates.udf_fields === 'object') {
      request.udf_fields = updates.udf_fields;
    }
    
    if (updates.template) {
      request.template = typeof updates.template === 'string' ? { name: updates.template } : updates.template;
    }
    
    if (updates.site) {
      request.site = typeof updates.site === 'string' ? { name: updates.site } : updates.site;
    }
    
    if (updates.group) {
      request.group = typeof updates.group === 'string' ? { name: updates.group } : updates.group;
    }
    
    if (updates.service_category) {
      request.service_category = typeof updates.service_category === 'string' ? { name: updates.service_category } : updates.service_category;
    }
    
    if (updates.service_approvers) {
      request.service_approvers = updates.service_approvers;
    }
    
    if (updates.resources) {
      request.resources = updates.resources;
    }
    
    if (updates.resolution) {
      request.resolution = typeof updates.resolution === 'string'
        ? { content: updates.resolution }
        : updates.resolution;
    }
    
    if (updates.closure_info) {
      request.closure_info = updates.closure_info;
    }
    
    // Handle urgency field
    if (updates.urgency) {
      request.urgency = { name: updates.urgency };
    }
    
    // Handle level field
    if (updates.level) {
      request.level = { name: updates.level };
    }
    
    // Handle impact field
    if (updates.impact) {
      request.impact = { name: updates.impact };
    }
    
    if (updates.status) {
      // For statuses, always use name format since we don't have IDs
      const statusName = this.metadata.getStatusId(updates.status);
      if (statusName) {
        request.status = { name: statusName };
      } else {
        // Try to map common status names
        const statusMap = {
          'pending': 'On Hold',
          'onhold': 'On Hold',
          'on hold': 'On Hold',
          'inprogress': 'In Progress',
          'in progress': 'In Progress',
          'resolved': 'Resolved',
          'closed': 'Closed',
          'cancelled': 'Cancelled',
          'open': 'Open'
        };
        const mappedStatus = statusMap[updates.status.toLowerCase()] || updates.status;
        request.status = { name: mappedStatus };
        console.error(`Using status name: "${mappedStatus}"`);
      }
    }
    
    if (updates.status_change_comments) {
      const resolvedStatus = request.status?.name?.toLowerCase();
      if (resolvedStatus === 'on hold') {
        request.onhold_scheduler = { comments: updates.status_change_comments };
      } else {
        request.status_change_comments = updates.status_change_comments;
      }
    }

    if (updates.priority) {
      const priorityName = PRIORITY_NAMES[updates.priority.toLowerCase()] || updates.priority;
      request.priority = { name: priorityName };
    }

    if (updates.category) {
      const categoryId = this.metadata.getCategoryId(updates.category);
      if (categoryId && categoryId !== updates.category) {
        request.category = { id: categoryId };
      } else {
        console.error(`Warning: Could not find category ID for "${updates.category}"`);
        request.category = { name: updates.category };
      }
    }
    
    if (updates.subcategory) {
      request.subcategory = { name: updates.subcategory };
    }
    
    // Handle technician assignment
    if (updates.technician_id) {
      request.technician = { id: updates.technician_id };
    } else if (updates.technician_email) {
      console.error(`Using technician email directly: ${updates.technician_email}`);
      request.technician = { email_id: updates.technician_email.toLowerCase() };
    }
    
    const params = {
      input_data: JSON.stringify({ request })
    };
    
    const response = await this.client.put(`/requests/${requestId}`, null, { params });
    return response.data.request;
  }
  
  /**
   * Add note - use correct v3 API format
   * 
   * @param {string} requestId - ID of the request to add note to
   * @param {string} noteContent - Content of the note
   * @param {boolean} isPublic - Whether the note is visible to requester (default: true)
   * @param {boolean} notifyTechnician - Whether to notify technician (default: false)
   * @param {boolean} addToLinkedRequests - Whether to add to linked requests (default: false)
   * @param {boolean} markFirstResponse - Whether to mark as first response (default: false)
   * @returns {Promise<Object>} The created note object
   */
  async addNote(requestId, noteContent, isPublic = true, notifyTechnician = false, addToLinkedRequests = false, markFirstResponse = false) {
    try {
      const request_note = {
        description: noteContent,
        notify_technician: notifyTechnician,
        show_to_requester: isPublic,
        add_to_linked_requests: addToLinkedRequests,
        mark_first_response: markFirstResponse
      };
      
      const params = {
        input_data: JSON.stringify({ request_note })
      };
      
      const response = await this.client.post(`/requests/${requestId}/notes`, null, { params });
      return response.data.request_note;
    } catch (error) {
      console.error('Failed to add note:', error.message);
      throw error;
    }
  }
  
  /**
   * Reply to requester via email
   * This sends an email reply that appears in the ticket conversation
   * 
   * @param {string} requestId - ID of the request to reply to
   * @param {string} replyMessage - The reply message content
   * @param {boolean} markFirstResponse - Whether to mark as first response (default: false)
   * @returns {Promise<Object>} The created reply note object
   */
  async replyToRequester(requestId, replyMessage, markFirstResponse = false) {
    try {
      const request_note = {
        description: replyMessage,
        show_to_requester: true,       // This makes it visible to requester and sends email
        notify_technician: false,      // Don't notify technician
        add_to_linked_requests: false, // Don't add to linked requests
        mark_first_response: markFirstResponse
      };
      
      const params = {
        input_data: JSON.stringify({ request_note })
      };
      
      console.error(`Replying to requester for request ${requestId}`);
      const response = await this.client.post(`/requests/${requestId}/notes`, null, { params });
      return response.data.request_note;
    } catch (error) {
      console.error('Failed to reply to requester:', error.message);
      throw error;
    }
  }
  
  /**
   * Send private note to technician (not visible to requester)
   * 
   * @param {string} requestId - ID of the request
   * @param {string} noteContent - The note content
   * @param {boolean} notifyTechnician - Whether to notify technician (default: true)
   * @returns {Promise<Object>} The created private note object
   */
  async addPrivateNote(requestId, noteContent, notifyTechnician = true) {
    try {
      const request_note = {
        description: noteContent,
        show_to_requester: false,      // Private - not visible to requester
        notify_technician: notifyTechnician,
        add_to_linked_requests: false,
        mark_first_response: false
      };
      
      const params = {
        input_data: JSON.stringify({ request_note })
      };
      
      console.error(`Adding private note for request ${requestId}`);
      const response = await this.client.post(`/requests/${requestId}/notes`, null, { params });
      return response.data.request_note;
    } catch (error) {
      console.error('Failed to add private note:', error.message);
      throw error;
    }
  }
  
  /**
   * Send first response to requester
   * This marks the note as the first response and sends email to requester
   * 
   * @param {string} requestId - ID of the request
   * @param {string} responseMessage - The first response message
   * @returns {Promise<Object>} The created first response note object
   */
  async sendFirstResponse(requestId, responseMessage) {
    try {
      const request_note = {
        description: responseMessage,
        show_to_requester: true,       // Visible to requester and sends email
        notify_technician: false,      // Don't notify technician
        add_to_linked_requests: false, // Don't add to linked requests
        mark_first_response: true      // Mark as first response
      };
      
      const params = {
        input_data: JSON.stringify({ request_note })
      };
      
      console.error(`Sending first response for request ${requestId}`);
      const response = await this.client.post(`/requests/${requestId}/notes`, null, { params });
      return response.data.request_note;
    } catch (error) {
      console.error('Failed to send first response:', error.message);
      throw error;
    }
  }
  
  /**
   * Get all notes/conversation for a request
   * 
   * @param {string} requestId - ID of the request
   * @returns {Promise<Array>} Array of notes/conversation entries
   */
  async getRequestConversation(requestId) {
    try {
      const params = {
        input_data: JSON.stringify({ list_info: { row_count: '100', sort_field: 'created_time', sort_order: 'asc' } })
      };
      const response = await this.client.get(`/requests/${requestId}/notes`, { params });
      return response.data.notes || [];
    } catch (error) {
      console.error('Failed to get request conversation:', error.message);
      throw error;
    }
  }
  
  /**
   * Close request
   * 
   * @param {string} requestId - ID of the request to close
   * @param {Object} closeData - Closure data
   * @param {string} closeData.closure_comments - Comments for closure
   * @param {string} closeData.closure_code - Optional closure code
   * @param {string} closeData.status - Status to set (default: 'Closed')
   * @param {Object} closeData.resolution - Resolution details
   * @returns {Promise<Object>} The closed request object
   */
  async closeRequest(requestId, closeData) {
    const { resolution, closure_code } = closeData;

    // PUT /requests/{id} rejects closure_code as a field — use it to
    // determine the target status instead of sending it directly
    const STATUS_FROM_CLOSURE = {
      'Resolved':  'Resolved',
      'Cancelled': 'Cancelled',
      'Duplicate': 'Closed',
      'Closed':    'Closed',
      'On Hold':   'On Hold',
      'Open':      'Open'
    };
    const statusName = STATUS_FROM_CLOSURE[closure_code] || 'Closed';

    // closure_comments is plain text only — strip HTML tags, then truncate to 250 chars
    const MAX_CLOSURE_COMMENTS = 250;
    let safeClosureComments = (resolution || 'Request closed')
      .replace(/<[^>]*>/g, '')   // strip tags
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
      .trim();
    if (safeClosureComments.length > MAX_CLOSURE_COMMENTS) {
      console.error(`Warning: closure_comments truncated from ${safeClosureComments.length} to ${MAX_CLOSURE_COMMENTS} chars`);
      safeClosureComments = safeClosureComments.substring(0, MAX_CLOSURE_COMMENTS - 3) + '...';
    }

    const request = {
      closure_info: { closure_comments: safeClosureComments },
      status: { name: statusName }
    };

    if (resolution) {
      request.resolution = { content: resolution };
    }

    const params = {
      input_data: JSON.stringify({ request })
    };

    const response = await this.client.put(`/requests/${requestId}`, null, { params });
    return response.data.request;
  }

  async setResolution(requestId, resolutionText) {
    const params = {
      input_data: JSON.stringify({
        request: {
          resolution: { content: resolutionText }
        }
      })
    };
    const response = await this.client.put(`/requests/${requestId}`, null, { params });
    return response.data.request;
  }

  async updateStatus(requestId, statusName, comments) {
    const request = { status: { name: statusName } };
    if (comments) {
      // On Hold uses onhold_scheduler.comments; other status changes use status_change_comments
      if (statusName.toLowerCase() === 'on hold') {
        request.onhold_scheduler = { comments };
      } else {
        request.status_change_comments = comments;
      }
    }
    const params = { input_data: JSON.stringify({ request }) };
    const response = await this.client.put(`/requests/${requestId}`, null, { params });
    return response.data.request;
  }
  
  /**
   * Test connectivity to the SDP API and return tenant/instance info.
   * Makes a minimal GET /priorities call (1 row) to verify auth and reachability.
   *
   * @returns {Promise<Object>} { success, instance, baseUrl, dataCenter, message, error? }
   */
  async testConnection() {
    const instance = this.instanceName || '(not set)';
    const baseUrl = this.customDomain || 'https://sdpondemand.manageengine.com';
    const dataCenter = this.dataCenter || 'US';

    try {
      const token = await this.oauth.getAccessToken();
      if (!token) throw new Error('No access token returned');
      return {
        success: true,
        instance,
        baseUrl,
        dataCenter,
        message: `OAuth token obtained successfully for "${instance}" at ${baseUrl}`
      };
    } catch (error) {
      return {
        success: false,
        instance,
        baseUrl,
        dataCenter,
        message: `Failed to obtain OAuth token for "${instance}" at ${baseUrl}`,
        error: error.message
      };
    }
  }

  /**
   * Delete a request permanently
   *
   * @param {string} requestId - ID of the request to delete
   * @returns {Promise<Object>} API response status
   */
  async deleteRequest(requestId) {
    const response = await this.client.delete(`/requests/${requestId}`);
    return response.data;
  }

  /**
   * Add a file attachment to a request
   *
   * @param {string} requestId - ID of the request
   * @param {string} filePath - Absolute path to the file on the server filesystem
   * @param {string} [fileName] - Display name for the attachment (defaults to basename of filePath)
   * @returns {Promise<Object>} API response with attachment details
   */
  async addAttachment(requestId, filePath, fileName) {
    const fs = require('fs');
    const path = require('path');

    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const resolvedName = fileName || path.basename(filePath);
    const boundary = `----SDPBoundary${Date.now()}`;
    const fileData = fs.readFileSync(filePath);

    const body = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${resolvedName}"\r\nContent-Type: application/octet-stream\r\n\r\n`
      ),
      fileData,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);

    const response = await this.client.post(
      `/requests/${requestId}/attachments`,
      body,
      {
        headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
        maxBodyLength: Infinity,
      }
    );
    return response.data;
  }

  /**
   * Search requests with proper format
   * 
   * @param {string} query - Search query string
   * @param {Object} options - Search options
   * @param {number} options.limit - Maximum number of results (default: 10, max: 100)
   * @param {number} options.offset - Starting offset for pagination (default: 0)
   * @param {string} options.searchIn - Field to search in (default: 'subject')
   * @param {string} options.sortBy - Field to sort by (default: 'created_time')
   * @param {string} options.sortOrder - Sort order 'asc' or 'desc' (default: 'desc')
   * @param {boolean} options.getTotalCount - Whether to get total count (default: true)
   * @returns {Promise<Object>} Search results with requests array and pagination info
   */
  async searchRequests(query, options = {}) {
    const { 
      limit = 10, 
      offset = 0, 
      searchIn = 'subject', 
      sortBy = 'created_time', 
      sortOrder = 'desc',
      getTotalCount = true 
    } = options;
    
    // Enforce API maximum of 100 rows per request
    const rowCount = Math.min(limit, 100);
    
    // Use search_criteria for searching (object format, not array)
    // Service Desk Plus requires object format for single criteria
    const listInfo = {
      row_count: String(rowCount),
      start_index: String(offset + 1),
      sort_field: sortBy,
      sort_order: sortOrder,
      get_total_count: getTotalCount,
      search_criteria: {
        field: searchIn,
        condition: 'contains',
        value: query
      }
    };

    
    const params = {
      input_data: JSON.stringify({ list_info: listInfo })
    };
    
    const response = await this.client.get('/requests', { params });
    return {
      requests: response.data.requests || [],
      total_count: response.data.list_info?.total_count || 0,
      has_more: response.data.list_info?.has_more_rows || false
    };
  }
  
  /**
   * Advanced search with multiple criteria
   * 
   * @param {Object|Array} criteria - Search criteria object or array
   * @param {Object} options - Search options
   * @param {number} options.limit - Maximum number of results (default: 10, max: 100)
   * @param {number} options.page - Page number for pagination (default: 1)
   * @param {string} options.sortBy - Field to sort by (default: 'created_time')
   * @param {string} options.sortOrder - Sort order 'asc' or 'desc' (default: 'desc')
   * @param {boolean} options.getTotalCount - Whether to get total count (default: true)
   * @returns {Promise<Object>} Search results with requests array and pagination info
   */
  async advancedSearchRequests(criteria, options = {}) {
    const {
      limit = 10,
      page = 1,
      sortBy = 'created_time',
      sortOrder = 'desc',
      getTotalCount = true
    } = options;

    const rowCount = Math.min(limit, 100);

    // Normalise criteria — single object passed directly; array uses children nested format.
    // Flat array format causes Tomcat 400 on this instance.
    let normalisedCriteria;
    if (Array.isArray(criteria)) {
      if (criteria.length === 1) {
        const { logical_operator, ...rest } = criteria[0];
        normalisedCriteria = rest;
      } else {
        const [first, ...rest] = criteria;
        normalisedCriteria = {
          ...first,
          children: rest.map(c => ({ ...c, logical_operator: 'AND' }))
        };
      }
    } else {
      normalisedCriteria = criteria;
    }

    const listInfo = {
      row_count: String(rowCount),
      start_index: String((page - 1) * rowCount + 1),
      sort_field: sortBy,
      sort_order: sortOrder,
      get_total_count: getTotalCount,
      search_criteria: normalisedCriteria
    };

    const params = {
      input_data: JSON.stringify({ list_info: listInfo })
    };

    console.error(`advancedSearchRequests: sending search_criteria=${JSON.stringify(normalisedCriteria)}`);
    const response = await this.client.get('/requests', { params });
    console.error(`advancedSearchRequests: HTTP ${response.status}, response_code=${response.data?.response_status?.status_code}, requests=${response.data?.requests?.length ?? 0}, total_count=${response.data?.list_info?.total_count}`);
    if (response.data?.response_status?.status_code !== 2000 && response.data?.response_status?.messages) {
      console.error(`advancedSearchRequests: API messages: ${JSON.stringify(response.data.response_status.messages)}`);
    }
    return {
      requests: response.data.requests || [],
      total_count: response.data.list_info?.total_count || 0,
      has_more: response.data.list_info?.has_more_rows || false,
      start_index: response.data.list_info?.start_index
    };
  }

  async searchRequestsFlat(filters = {}, options = {}) {
    const {
      technician_email, requester_email, subject_contains,
      category, group,
      created_after, created_before, due_before,
      status, priority
    } = filters;

    const { limit = 10, page = 1, sortBy = 'created_time', sortOrder = 'desc' } = options;

    const rowCount = Math.min(limit, 100);
    const listInfo = {
      row_count: String(rowCount),
      start_index: String((page - 1) * rowCount + 1),
      sort_field: sortBy,
      sort_order: sortOrder,
      get_total_count: true
    };

    const STATUS_MAP = {
      'open': 'open', 'closed': 'closed', 'pending': 'on hold',
      'resolved': 'resolved', 'cancelled': 'cancelled',
      'in progress': 'in progress', 'on hold': 'on hold'
    };

    // Build search_criteria using nested children format:
    // { field:A, condition, value, children: [{ field:B, condition, value, logical_operator:"AND" }] }
    // The first criterion is the parent object; all additional criteria go in children[].
    const criteriaList = [];
    if (technician_email)  criteriaList.push({ field: 'technician.email_id', condition: 'is',           value: technician_email.toLowerCase() });
    if (requester_email)   criteriaList.push({ field: 'requester.email_id',  condition: 'is',           value: requester_email.toLowerCase() });
    if (subject_contains)  criteriaList.push({ field: 'subject',             condition: 'contains',     value: subject_contains });
    if (category)          criteriaList.push({ field: 'category.name',       condition: 'is',           value: category });
    if (group)             criteriaList.push({ field: 'group.name',          condition: 'is',           value: group });
    if (created_after)     criteriaList.push({ field: 'created_time',        condition: 'greater than', value: created_after });
    if (created_before)    criteriaList.push({ field: 'created_time',        condition: 'less than',    value: created_before });
    if (due_before)        criteriaList.push({ field: 'due_by_time',         condition: 'less than',    value: due_before });
    if (status)            criteriaList.push({ field: 'status.name',         condition: 'is',           value: STATUS_MAP[status.toLowerCase()] || status });
    if (priority)          criteriaList.push({ field: 'priority.name',       condition: 'is',           value: PRIORITY_NAMES[priority.toLowerCase()] || priority });

    if (criteriaList.length === 1) {
      listInfo.search_criteria = criteriaList[0];
    } else if (criteriaList.length > 1) {
      const [first, ...rest] = criteriaList;
      listInfo.search_criteria = {
        ...first,
        children: rest.map(c => ({ ...c, logical_operator: 'AND' }))
      };
    }

    console.error(`searchRequestsFlat: list_info=${JSON.stringify(listInfo)}`);
    const params = { input_data: JSON.stringify({ list_info: listInfo }) };
    const response = await this.client.get('/requests', { params });
    console.error(`searchRequestsFlat: HTTP ${response.status}, requests=${response.data?.requests?.length ?? 0}, total=${response.data?.list_info?.total_count}`);
    if (response.data?.response_status?.status_code !== 2000 && response.data?.response_status?.messages) {
      console.error(`searchRequestsFlat: API error: ${JSON.stringify(response.data.response_status.messages)}`);
    }
    return {
      requests: response.data.requests || [],
      total_count: response.data.list_info?.total_count || 0,
      has_more: response.data.list_info?.has_more_rows || false
    };
  }
  
  /**
   * Add email notifications to a request
   * 
   * @param {string} requestId - ID of the request
   * @param {Array<string>} emailList - Array of email addresses to notify
   * @returns {Promise<Object>} The updated request object
   */
  async addEmailNotifications(requestId, emailList) {
    if (!Array.isArray(emailList)) {
      throw new Error('Email list must be an array');
    }
    
    // Validate email formats
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const validEmails = emailList.filter(email => emailRegex.test(email));
    
    if (validEmails.length === 0) {
      throw new Error('No valid email addresses provided');
    }
    
    const request = {
      email_ids_to_notify: validEmails
    };
    
    return await this.updateRequest(requestId, request);
  }
  
  /**
   * Get email addresses associated with a request
   * 
   * @param {string} requestId - ID of the request
   * @returns {Promise<Object>} Object containing email addresses
   */
  async getRequestEmailAddresses(requestId) {
    const request = await this.getRequest(requestId);
    return {
      email_to: request.email_to || [],
      email_cc: request.email_cc || [],
      email_bcc: request.email_bcc || [],
      email_ids_to_notify: request.email_ids_to_notify || []
    };
  }
  
  /**
   * Create request with email mode
   * 
   * @param {Object} requestData - Request data with email-specific fields
   * @param {Array<string>} requestData.notify_emails - Emails to notify
   * @returns {Promise<Object>} The created request object
   */
  async createEmailRequest(requestData) {
    const emailRequestData = {
      ...requestData,
      mode: 'E-Mail',
      email_ids_to_notify: requestData.notify_emails || []
    };
    
    return await this.createRequest(emailRequestData);
  }
  
  /**
   * Set requester by email address
   * 
   * @param {string} requestId - ID of the request
   * @param {string} emailAddress - Email address of the requester
   * @param {string} name - Optional name of the requester
   * @returns {Promise<Object>} The updated request object
   */
  async setRequesterByEmail(requestId, emailAddress, name) {
    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(emailAddress)) {
      throw new Error('Invalid email address format');
    }
    
    const request = {
      requester: { 
        email_id: emailAddress,
        ...(name && { name })
      }
    };
    
    return await this.updateRequest(requestId, request);
  }
  
  /**
   * Assign technician by email address
   * 
   * @param {string} requestId - ID of the request
   * @param {string} technicianEmail - Email address of the technician
   * @returns {Promise<Object>} The updated request object
   */
  async assignTechnicianByEmail(requestId, technicianEmail) {
    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!technicianEmail || !emailRegex.test(technicianEmail)) {
      throw new Error('Valid technician email address is required');
    }
    
    const request = {
      technician: { email_id: technicianEmail }
    };
    
    return await this.updateRequest(requestId, request);
  }
  
  /**
   * Search requests by requester email
   * 
   * @param {string} requesterEmail - Email address of the requester
   * @param {Object} options - Search options
   * @returns {Promise<Object>} Search results
   */
  async searchRequestsByRequesterEmail(requesterEmail, options = {}) {
    const criteria = {
      field: 'requester.email_id',
      condition: 'is',
      value: requesterEmail.toLowerCase()
    };
    
    return await this.advancedSearchRequests(criteria, options);
  }
  
  /**
   * Search requests by technician email
   * 
   * @param {string} technicianEmail - Email address of the technician
   * @param {Object} options - Search options
   * @returns {Promise<Object>} Search results
   */
  async searchRequestsByTechnicianEmail(technicianEmail, options = {}) {
    const criteria = {
      field: 'technician.email_id',
      condition: 'is',
      value: technicianEmail.toLowerCase()
    };
    
    return await this.advancedSearchRequests(criteria, options);
  }
  
  /**
   * Helper to build search criteria for common queries
   */
  static buildSearchCriteria = {
    // Search for open tickets created in last N days
    openTicketsCreatedSince(daysAgo) {
      const timestamp = Date.now() - (daysAgo * 24 * 60 * 60 * 1000);
      return {
        field: 'status.name',
        condition: 'is',
        value: 'Open',
        children: [{
          field: 'created_time',
          condition: 'greater than',
          value: timestamp.toString(),
          logical_operator: 'AND'
        }]
      };
    },
    
    // Search for high priority or urgent tickets
    highPriorityTickets() {
      return [{
        field: 'priority.name',
        condition: 'is',
        values: ['3 - High', '4 - Critical'],
        logical_operator: 'OR'
      }];
    },
    
    // Search by requester email
    byRequesterEmail(email) {
      return {
        field: 'requester.email_id',
        condition: 'is',
        value: email
      };
    },
    
    // Search tickets assigned to a technician
    assignedTo(technicianName) {
      return {
        field: 'technician.name',
        condition: 'contains',
        value: technicianName
      };
    },
    
    // Combine multiple criteria with AND
    and(...criteria) {
      return criteria.map((criterion, index) => ({
        ...criterion,
        logical_operator: index === 0 ? undefined : 'AND'
      }));
    },
    
    // Combine multiple criteria with OR
    or(...criteria) {
      return criteria.map((criterion, index) => ({
        ...criterion,
        logical_operator: index === 0 ? undefined : 'OR'
      }));
    }
  };
}

module.exports = { SDPAPIClientV2 };