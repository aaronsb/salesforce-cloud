# Salesforce MCP Server

This MCP server provides tools for interacting with Salesforce, with built-in pagination and simplified data structures to manage response sizes.

## Tools

### execute_soql
Execute a SOQL query with pagination support.
```typescript
{
  query: string;      // Required: SOQL query to execute
  pageSize?: number;  // Optional: Number of records per page (default: 25)
  pageNumber?: number; // Optional: Page number to retrieve (default: 1)
}
```
Example:
```javascript
{
  "query": "SELECT Id, Name FROM Account",
  "pageSize": 10,
  "pageNumber": 1
}
```

### describe_object
Get metadata about a Salesforce object with optional field information.
```typescript
{
  objectName: string;    // Required: API name of the Salesforce object
  includeFields?: boolean; // Optional: Whether to include field metadata (default: false)
}
```
Example:
```javascript
{
  "objectName": "Account",
  "includeFields": true
}
```

### create_record
Create a new record in Salesforce.
```typescript
{
  objectName: string;           // Required: API name of the Salesforce object
  data: Record<string, any>;    // Required: Record data as key-value pairs
}
```
Example:
```javascript
{
  "objectName": "Account",
  "data": {
    "Name": "Test Account",
    "Industry": "Technology"
  }
}
```

### update_record
Update an existing record in Salesforce.
```typescript
{
  objectName: string;           // Required: API name of the Salesforce object
  recordId: string;            // Required: ID of the record to update
  data: Record<string, any>;    // Required: Record data to update
}
```
Example:
```javascript
{
  "objectName": "Account",
  "recordId": "001XXXXXXXXXXXXXXX",
  "data": {
    "Name": "Updated Account Name"
  }
}
```

### delete_record
Delete a record from Salesforce.
```typescript
{
  objectName: string;    // Required: API name of the Salesforce object
  recordId: string;     // Required: ID of the record to delete
}
```
Example:
```javascript
{
  "objectName": "Account",
  "recordId": "001XXXXXXXXXXXXXXX"
}
```

### get_user_info
Get information about the current user. No parameters required.
```typescript
{}
```

### search_opportunities
Search for Salesforce opportunities with flexible filtering.
```typescript
{
  searchTerm?: string;     // Optional: Search term matching opportunity or account name
  stage?: string;          // Optional: Exact match for opportunity stage
  minAmount?: number;      // Optional: Minimum opportunity amount
  maxAmount?: number;      // Optional: Maximum opportunity amount
  closeDateStart?: string; // Optional: Start date for close date range (YYYY-MM-DD)
  closeDateEnd?: string;   // Optional: End date for close date range (YYYY-MM-DD)
  pageSize?: number;       // Optional: Number of records per page (default: 25)
  pageNumber?: number;     // Optional: Page number to retrieve (default: 1)
}
```
Example:
```javascript
{
  "searchTerm": "Ford",
  "stage": "Proposal",
  "minAmount": 50000,
  "closeDateStart": "2024-01-01"
}
```

### get_opportunity_details
Get comprehensive details about a specific opportunity including related records and history.
```typescript
{
  opportunityId: string;   // Required: The ID of the Salesforce opportunity
}
```
Example:
```javascript
{
  "opportunityId": "006XXXXXXXXXX"
}
```
Response includes:
- Basic opportunity information (amount, stage, dates, etc.)
- Account details (name, industry, website)
- Owner information (name, email)
- Contact roles
- Field history (chronological changes)
- Related tasks
- Related notes

### list_objects
List all available Salesforce objects with pagination support.
```typescript
{
  pageSize?: number;   // Optional: Number of objects per page (default: 25)
  pageNumber?: number; // Optional: Page number to retrieve (default: 1)
}
```
Example:
```javascript
{
  "pageSize": 10,
  "pageNumber": 1
}
```

## Response Formats

### Paginated Response
Operations that return multiple records use this format:
```typescript
{
  records: T[];           // Array of records for the current page
  totalSize: number;      // Total number of records
  pageInfo: {
    currentPage: number;  // Current page number
    totalPages: number;   // Total number of pages
    hasNextPage: boolean; // Whether there are more pages after this one
    hasPreviousPage: boolean; // Whether there are pages before this one
  }
}
```

### Simplified Object
Object metadata is simplified to essential fields:
```typescript
{
  name: string;        // API name of the object
  label: string;       // Display label
  custom: boolean;     // Whether this is a custom object
  createable: boolean; // Whether new records can be created
  updateable: boolean; // Whether records can be updated
  deletable: boolean;  // Whether records can be deleted
  fields?: SimplifiedField[]; // Optional array of field metadata
}
```

### Simplified Field
Field metadata is simplified when requested:
```typescript
{
  name: string;        // API name of the field
  label: string;       // Display label
  type: string;        // Field type (string, number, etc.)
  required: boolean;   // Whether the field is required
  updateable: boolean; // Whether the field can be updated
  defaultValue?: any;  // Default value if any
}
```

## Error Handling

All tools return errors in a consistent format:
```typescript
{
  content: [{
    type: "text",
    text: "Error: [error message]"
  }],
  isError: true
}
```

## Environment Variables

The server requires the following environment variables:
- SF_CLIENT_ID: Salesforce client ID
- SF_CLIENT_SECRET: Salesforce client secret
- SF_USERNAME: Salesforce username
- SF_PASSWORD: Salesforce password
- SF_LOGIN_URL: Salesforce login URL (optional, defaults to https://login.salesforce.com)
