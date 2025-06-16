export const toolSchemas = {
  analyze_conversation: {
    name: 'analyze_conversation',
    description: 'Analyze conversation activity and engagement patterns for an opportunity. Extracts insights from Gong calls, emails, and other activities to provide engagement recommendations.',
    inputSchema: {
      type: 'object',
      properties: {
        opportunityId: {
          type: 'string',
          description: 'The ID of the Salesforce opportunity to analyze conversation activity for',
        }
      },
      required: ['opportunityId'],
    },
  },
  generate_business_case: {
    name: 'generate_business_case',
    description: 'Generate a professional business case document for an opportunity. Returns step-by-step instructions for gathering Salesforce data and using TeXFlow MCP server to create a formatted business case document.',
    inputSchema: {
      type: 'object',
      properties: {
        opportunityId: {
          type: 'string',
          description: 'The ID of the Salesforce opportunity to generate a business case for',
        },
        clientName: {
          type: 'string',
          description: 'Optional client name to include in the business case title',
        },
        outputFormat: {
          type: 'string',
          description: 'Output format for the business case document',
          enum: ['pdf', 'docx', 'markdown']
        }
      },
      required: ['opportunityId'],
    },
  },
  enrich_opportunity: {
    name: 'enrich_opportunity',
    description: 'Enrich an opportunity with market intelligence, industry insights, and strategic recommendations based on similar deal patterns and best practices.',
    inputSchema: {
      type: 'object',
      properties: {
        opportunityId: {
          type: 'string',
          description: 'The ID of the Salesforce opportunity to enrich with intelligence',
        },
        includeCompetitiveIntel: {
          type: 'boolean',
          description: 'Whether to include competitive intelligence analysis (default: false)',
        },
        includeBestPractices: {
          type: 'boolean',
          description: 'Whether to include industry-specific best practices (default: true)',
        }
      },
      required: ['opportunityId'],
    },
  },
  find_similar_opportunities: {
    name: 'find_similar_opportunities',
    description: 'Find opportunities similar to a reference opportunity or based on specific criteria. Includes pattern analysis and similarity scoring to identify market trends and success patterns.',
    inputSchema: {
      type: 'object',
      properties: {
        referenceOpportunityId: {
          type: 'string',
          description: 'Optional reference opportunity ID to find similar deals based on its characteristics',
        },
        industry: {
          type: 'string',
          description: 'Filter by industry (e.g., "Information Technology & Services")',
        },
        minAmount: {
          type: 'number',
          description: 'Minimum opportunity amount',
        },
        maxAmount: {
          type: 'number',
          description: 'Maximum opportunity amount',
        },
        stage: {
          type: 'string',
          description: 'Filter by opportunity stage (e.g., "Closed Won", "Proposal")',
        },
        isWon: {
          type: 'boolean',
          description: 'Filter by won/lost status',
        },
        closeDateStart: {
          type: 'string',
          description: 'Start date for close date range (YYYY-MM-DD)',
        },
        closeDateEnd: {
          type: 'string',
          description: 'End date for close date range (YYYY-MM-DD)',
        },
        includeAnalysis: {
          type: 'boolean',
          description: 'Whether to include pattern analysis and insights (default: true)',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results to return (default: 50)',
        }
      }
    },
  },
  opportunity_insights: {
    name: 'opportunity_insights',
    description: 'Generate detailed insights and analytics from opportunity data including pipeline health, performance metrics, industry trends, and strategic recommendations.',
    inputSchema: {
      type: 'object',
      properties: {
        timeframe: {
          type: 'string',
          description: 'Time period for analysis',
          enum: ['current_quarter', 'last_quarter', 'current_year', 'last_year', 'all_time']
        },
        includeStageAnalysis: {
          type: 'boolean',
          description: 'Include stage distribution and conversion analysis (default: true)',
        },
        includeOwnerPerformance: {
          type: 'boolean',
          description: 'Include individual owner performance metrics (default: true)',
        },
        includeIndustryTrends: {
          type: 'boolean',
          description: 'Include industry-specific performance trends (default: true)',
        },
        includePipelineHealth: {
          type: 'boolean',
          description: 'Include pipeline health and timing analysis (default: true)',
        },
        includeConversionRates: {
          type: 'boolean',
          description: 'Include stage conversion rate analysis (default: true)',
        },
        minAmount: {
          type: 'number',
          description: 'Minimum opportunity amount for analysis',
        },
        maxAmount: {
          type: 'number',
          description: 'Maximum opportunity amount for analysis',
        },
        industry: {
          type: 'string',
          description: 'Filter analysis to specific industry',
        },
        owner: {
          type: 'string',
          description: 'Filter analysis to specific owner',
        }
      }
    },
  },
  get_opportunity_details: {
    name: 'get_opportunity_details',
    description: 'Get detailed information about a Salesforce opportunity including all available fields (both standard and custom), related records, and metadata',
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
    description: 'Search for Salesforce opportunities by name, account, and stage. Returns matching opportunities ordered by close date. Results include both standard and custom fields.',
    inputSchema: {
      type: 'object',
      properties: {
        namePattern: {
          type: 'string',
          description: 'Pattern to match in Opportunity Name. Example: "Github" will match "Github Migration" or "My Github Project".',
        },
        accountNamePattern: {
          type: 'string',
          description: 'Pattern to match in Account Name. Example: "Ford" will match opportunities for "Ford" or "Ford Motor Company".',
        },
        stage: {
          type: 'string',
          description: 'Exact match for opportunity stage. Common values: "Proposal", "Qualification", "Negotiation", "Closed Won", "Closed Lost".',
        },
        pageSize: {
          type: 'number',
          description: 'Number of records per page (default: 25)',
        },
        pageNumber: {
          type: 'number',
          description: 'Page number to retrieve (default: 1)',
        }
      }
    },
  },
  execute_soql: {
    name: 'execute_soql',
    description: 'Execute a SOQL query. Supports querying both standard and custom fields (custom fields end with __c in their API names). Use describe_object first to discover available fields.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'SOQL query to execute. For custom fields, use the API name (e.g., Project_Status__c)',
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
    description: 'Get metadata about a Salesforce object, including both standard and custom fields when includeFields is true. Use this to discover available fields and their API names, especially useful for finding custom fields (ending in __c)',
    inputSchema: {
      type: 'object',
      properties: {
        objectName: {
          type: 'string',
          description: 'API name of the Salesforce object',
        },
        includeFields: {
          type: 'boolean',
          description: 'Whether to include field metadata (default: false). When true, returns all available fields including custom fields, their types, and relationships.',
        },
        pageSize: {
          type: 'number',
          description: 'Number of fields per page when includeFields is true (default: 50)',
        },
        pageNumber: {
          type: 'number',
          description: 'Page number to retrieve when includeFields is true (default: 1)',
        }
      },
      required: ['objectName'],
    },
  },
  create_record: {
    name: 'create_record',
    description: 'Create a new record in Salesforce. Supports both standard and custom fields in the data object.',
    inputSchema: {
      type: 'object',
      properties: {
        objectName: {
          type: 'string',
          description: 'API name of the Salesforce object',
        },
        data: {
          type: 'object',
          description: 'Record data as key-value pairs. For custom fields, use the API name with __c suffix (e.g., { "Name": "Test", "Custom_Field__c": "Value" })',
        },
      },
      required: ['objectName', 'data'],
    },
  },
  update_record: {
    name: 'update_record',
    description: 'Update an existing record in Salesforce. Supports updating both standard and custom fields.',
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
          description: 'Record data to update as key-value pairs. For custom fields, use the API name with __c suffix (e.g., { "Custom_Field__c": "New Value" })',
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
    description: 'List all available Salesforce objects, including both standard and custom objects',
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
