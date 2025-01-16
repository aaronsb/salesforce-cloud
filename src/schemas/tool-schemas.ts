export const toolSchemas = {
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
