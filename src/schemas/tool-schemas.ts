export const toolSchemas = {
  get_opportunity_details: {
    name: 'get_opportunity_details',
    description: 'Get detailed information about a Salesforce opportunity including all available fields, related records, and metadata',
    inputSchema: {
      type: 'object',
      properties: {
        opportunityId: {
          type: 'string',
          description: 'The ID of the Salesforce opportunity to retrieve details for',
        }
      },
      required: ['opportunityId'],
    },
  },
  search_opportunities: {
    name: 'search_opportunities',
    description: 'Search for Salesforce opportunities with flexible filtering. The search uses SOQL queries to find opportunities matching any of the provided criteria. All parameters are optional and can be combined.',
    inputSchema: {
      type: 'object',
      properties: {
        searchTerm: {
          type: 'string',
          description: 'Case-insensitive search term that matches against both Opportunity Name and Account Name. For example, "Ford" will find opportunities named "Ford Project" and opportunities belonging to "Ford Motor Company".',
        },
        stage: {
          type: 'string',
          description: 'Exact match filter for opportunity stage. Common values include: "Qualification", "Proposal", "Negotiation", "Closed Won", "Closed Lost". Example: "Qualification"',
        },
        minAmount: {
          type: 'number',
          description: 'Minimum opportunity amount. Will return opportunities with Amount >= this value. Example: 50000 for opportunities worth $50,000 or more',
        },
        maxAmount: {
          type: 'number',
          description: 'Maximum opportunity amount. Will return opportunities with Amount <= this value. Example: 100000 for opportunities up to $100,000',
        },
        closeDateStart: {
          type: 'string',
          description: 'Start date for close date range in YYYY-MM-DD format. Will return opportunities closing on or after this date. Example: "2024-01-01"',
        },
        closeDateEnd: {
          type: 'string',
          description: 'End date for close date range in YYYY-MM-DD format. Will return opportunities closing on or before this date. Example: "2024-12-31"',
        },
        pageSize: {
          type: 'number',
          description: 'Number of records to return per page. Default: 25, Maximum: 100. Example: 50 to get 50 records per page',
        },
        pageNumber: {
          type: 'number',
          description: 'Page number to retrieve for paginated results. Starts at 1. Example: 2 to get the second page of results',
        }
      }
    },
  },
  execute_soql: {
    name: 'execute_soql',
    description: 'Execute a SOQL query',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'SOQL query to execute',
        },
        pageSize: {
          type: 'number',
          description: 'Number of records per page (default: 25)',
        },
        pageNumber: {
          type: 'number',
          description: 'Page number to retrieve (default: 1)',
        }
      },
      required: ['query'],
    },
  },
  describe_object: {
    name: 'describe_object',
    description: 'Get metadata about a Salesforce object',
    inputSchema: {
      type: 'object',
      properties: {
        objectName: {
          type: 'string',
          description: 'API name of the Salesforce object',
        },
        includeFields: {
          type: 'boolean',
          description: 'Whether to include field metadata (default: false)',
        }
      },
      required: ['objectName'],
    },
  },
  create_record: {
    name: 'create_record',
    description: 'Create a new record in Salesforce',
    inputSchema: {
      type: 'object',
      properties: {
        objectName: {
          type: 'string',
          description: 'API name of the Salesforce object',
        },
        data: {
          type: 'object',
          description: 'Record data as key-value pairs',
        },
      },
      required: ['objectName', 'data'],
    },
  },
  update_record: {
    name: 'update_record',
    description: 'Update an existing record in Salesforce',
    inputSchema: {
      type: 'object',
      properties: {
        objectName: {
          type: 'string',
          description: 'API name of the Salesforce object',
        },
        recordId: {
          type: 'string',
          description: 'ID of the record to update',
        },
        data: {
          type: 'object',
          description: 'Record data as key-value pairs',
        },
      },
      required: ['objectName', 'recordId', 'data'],
    },
  },
  delete_record: {
    name: 'delete_record',
    description: 'Delete a record from Salesforce',
    inputSchema: {
      type: 'object',
      properties: {
        objectName: {
          type: 'string',
          description: 'API name of the Salesforce object',
        },
        recordId: {
          type: 'string',
          description: 'ID of the record to delete',
        },
      },
      required: ['objectName', 'recordId'],
    },
  },
  get_user_info: {
    name: 'get_user_info',
    description: 'Get information about the current user',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  list_objects: {
    name: 'list_objects',
    description: 'List all available Salesforce objects',
    inputSchema: {
      type: 'object',
      properties: {
        pageSize: {
          type: 'number',
          description: 'Number of objects per page (default: 25)',
        },
        pageNumber: {
          type: 'number',
          description: 'Page number to retrieve (default: 1)',
        }
      },
    },
  },
};
