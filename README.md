# 🌩️ Salesforce MCP Server

This MCP (Model Context Protocol) server provides AI-powered tools for interacting with Salesforce, featuring opportunity intelligence, conversation analysis, business case generation, and standard CRUD operations. Built with pagination support and optimized response structures for AI workflows.

## 🎯 What This Means for You

Imagine having a sales expert that instantly knows everything about your deals and can give you winning strategies. That's what this AI does with your Salesforce data.

### 💬 Just Chat Naturally - No Technical Skills Needed

**You say:** *"Show me all Microsoft deals over $100K in the proposal stage"*  
**AI does:** Searches your entire Salesforce database and returns matching opportunities

**You say:** *"How's the engagement on the Acme deal? Are we talking to the right people?"*  
**AI does:** Analyzes all your calls, emails, and activities to give engagement insights

**You say:** *"Find me deals similar to this opportunity that we won"*  
**AI does:** Scans your database for similar successful deals and success patterns

**You say:** *"Create a business case document for this opportunity"*  
**AI does:** Generates a professional PDF ready for executives

### 🚀 Real Conversation Examples

**Scenario:** *"I'm struggling with the Acme Corp deal. It's been stuck in negotiation for 2 months."*

**AI Response:** *"Let me analyze the Acme opportunity... I see limited engagement in the past 3 weeks. You've had 2 calls with procurement but haven't connected with the decision maker yet. Similar deals that got unstuck had executive sponsor engagement. I found 3 comparable deals where scheduling an executive briefing moved things forward. Here's a business case document you can use..."*

---

**Scenario:** *"My manager wants to know why our cloud migration deals are taking so long to close."*

**AI Response:** *"Analyzing your cloud migration opportunities... The average sales cycle is 40% longer than industry standard. The pattern shows deals stall in the technical evaluation stage. Successful cloud deals had solution architects engaged 2 weeks earlier on average. I recommend involving technical resources sooner..."*

### ✨ What You Get

- **🔍 Smart Search**: Find any opportunity with natural language
- **💬 Engagement Analysis**: Know who you're talking to and who you're missing  
- **🧠 Strategic Insights**: Get recommendations based on similar successful deals
- **📊 Pipeline Intelligence**: Understand your pipeline health and conversion patterns
- **📋 Professional Documents**: Generate business cases and executive summaries
- **📈 Performance Analytics**: See what's working and what needs attention

**The Magic:** You just chat naturally. The AI automatically connects to your Salesforce, analyzes millions of data points, finds patterns, and gives you actionable recommendations. It's like having a sales intelligence team, data analyst, and business consultant all rolled into one AI that knows your Salesforce inside and out.

### 💬 Live Chat Example

| | |
|---|---|
| **👤 You** | Can you look for any open salesforce opportunities where the solution engineer includes Aaron Rochelle? |
| **🤖 AI Assistant** | Let me help you search for Salesforce opportunities where Aaron Rochelle is involved as a Solution Engineer. I'll run a query in your Salesforce database to find opportunities matching that criteria...<br><br>**📊 Found 3 opportunities:**<br>• Cloud Migration - Acme Corp ($250K, Proposal)<br>• Digital Transformation - TechFlow ($180K, Qualification)<br>• Infrastructure Upgrade - GlobalTech ($320K, Negotiation) |

---

| | |
|---|---|
| **👤 You** | Tell me more about the Acme Corp opportunity |
| **🤖 AI Assistant** | Here are the key details for the Acme Corp Cloud Migration opportunity:<br><br>**💼 Opportunity Details:**<br>• **Account:** Acme Corp<br>• **Amount:** $250,000<br>• **Stage:** Proposal<br>• **Close Date:** 2024-03-15<br>• **Decision Maker:** Sarah Johnson (IT Director)<br><br>**🔍 Intelligence Insights:**<br>• Similar cloud deals average 45 days in proposal stage<br>• 73% win rate when executive sponsor engaged early<br>• **Competitor:** AWS (primary threat)<br>• **Next action:** Schedule technical deep-dive |

---

| | |
|---|---|
| **👤 You** | What similar deals have we won? Show me the patterns |
| **🤖 AI Assistant** | I found 8 similar cloud migration deals you've won in the past 12 months. Here are the key patterns:<br><br>**🎯 Success Patterns:**<br>• **Average deal size:** $275K (vs $250K current)<br>• **67%** had solution architect engaged by day 14<br>• **89%** included a pilot/POC phase<br>• **Executive sponsors** attended 78% of demos<br><br>**📋 Recommendation:** Schedule Aaron for a technical deep-dive with their DevOps team this week. Based on similar wins, proposing a 2-week pilot will increase close probability by 34%.<br><br>📄 Would you like me to generate a business case document for this opportunity? |

## 🤔 What is MCP?

The Model Context Protocol (MCP) is a standardized way for AI models to interact with external tools and resources. MCP servers provide specific capabilities that can be used by AI models through a consistent interface. This Salesforce MCP server allows AI models to interact with Salesforce data and operations in a structured way.

## 🚀 Installation

### Local Installation

1. Clone this repository
2. Install dependencies:
```bash
npm install
```
3. Build the server:
```bash
npm run build
```

### npm Installation

```bash
# Run directly with npx
npx salesforce-cloud

# Or install globally
npm install -g salesforce-cloud
```

### From Source

```bash
git clone https://github.com/aaronsb/salesforce-cloud.git
cd salesforce-cloud
npm install
npm run build
node build/index.js
```

## ⚙️ Configuration

The server requires configuration in your Claude desktop app's configuration file. On Linux, this is located at `~/.config/Claude/claude_desktop_config.json`. On macOS, it's at `~/Library/Application Support/Claude/claude_desktop_config.json`.

Add the following configuration to the `mcpServers` object in your config file:

```json
{
  "mcpServers": {
    "salesforce-cloud": {
      "command": "node",
      "args": ["/path/to/salesforce-cloud/build/index.js"],
      "env": {
        "SF_CLIENT_ID": "your_client_id",
        "SF_CLIENT_SECRET": "your_client_secret",
        "SF_USERNAME": "your_salesforce_username",
        "SF_PASSWORD": "your_salesforce_password",
        "SF_LOGIN_URL": "https://login.salesforce.com"
      }
    }
  }
}
```

### Required Environment Variables

- `SF_CLIENT_ID`: Your Salesforce OAuth client ID
- `SF_CLIENT_SECRET`: Your Salesforce OAuth client secret
- `SF_USERNAME`: Your Salesforce username
- `SF_PASSWORD`: Your Salesforce password
- `SF_LOGIN_URL`: Salesforce login URL (optional, defaults to https://login.salesforce.com)

To obtain these credentials:

1. Go to Setup in your Salesforce org
2. Navigate to App Manager
3. Create a new Connected App
4. Enable OAuth settings
5. Add necessary OAuth scopes
6. Save and wait for activation
7. Copy the generated Consumer Key (Client ID) and Consumer Secret (Client Secret)

## 🎯 Working with Custom Fields

When constructing queries or working with Salesforce data, it's important to understand that many fields referenced may be custom fields specific to your Salesforce instance. Here's what you need to know:

### Understanding Custom Fields
- Custom fields in Salesforce end with `__c` in their API names
- What appears as "Implementation Status" in the UI might be stored as "Implementation_Status__c"
- Custom fields can represent organization-specific business concepts

### Best Practices
1. Object Metadata Analysis:
   - Use the `describe_object` tool with `includeFields: true` to examine both standard and custom fields
   - Look for fields that match your intent in both standard and custom field lists
   - Map user-friendly field names to their actual API names

2. Field Type Consideration:
   - Custom fields can be various types (text, picklist, lookup, etc.)
   - Understanding field types helps construct appropriate queries
   - Custom fields might reference other custom objects through lookup relationships

3. Query Construction:
   - Build queries that can handle both standard and custom fields
   - Use field metadata to validate field existence before querying
   - Consider relationships between objects, especially with custom lookup fields

### Example
If searching for "Project Status":
1. First, examine the object's fields to find the actual field name:
```javascript
{
  "objectName": "Opportunity",
  "includeFields": true
}
```
2. Look for fields like "Project_Status__c" or similar custom fields that match your intent
3. Use the discovered field name in your queries:
```javascript
{
  "query": "SELECT Id, Name, Project_Status__c FROM Opportunity"
}
```

## 🛠️ Tools

### Core Salesforce Operations

#### execute_soql
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

#### describe_object
Get metadata about a Salesforce object with optional field information.
```typescript
{
  objectName: string;    // Required: API name of the Salesforce object
  includeFields?: boolean; // Optional: Whether to include field metadata (default: false)
  pageSize?: number;     // Optional: Number of fields per page (default: 50)
  pageNumber?: number;   // Optional: Page number to retrieve (default: 1)
}
```
Example:
```javascript
{
  "objectName": "Account",
  "includeFields": true
}
```

#### create_record
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

#### update_record
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

#### delete_record
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

#### get_user_info
Get information about the current user. No parameters required.
```typescript
{}
```

#### list_objects
List all available Salesforce objects with pagination support.
```typescript
{
  pageSize?: number;   // Optional: Number of objects per page (default: 25)
  pageNumber?: number; // Optional: Page number to retrieve (default: 1)
}
```

### Opportunity Management

#### search_opportunities
Search for Salesforce opportunities using flexible criteria and pattern matching.

```typescript
{
  namePattern?: string;         // Optional: Pattern to match in Opportunity Name
  accountNamePattern?: string;  // Optional: Pattern to match in Account Name
  stage?: string;              // Optional: Exact match for opportunity stage
  pageSize?: number;           // Optional: Number of records per page (default: 25)
  pageNumber?: number;         // Optional: Page number to retrieve (default: 1)
}
```

#### get_opportunity_details
Get detailed information about a specific opportunity including all available fields and related records.
```typescript
{
  opportunityId: string;   // Required: The ID of the Salesforce opportunity
}
```

### 🧠 Opportunity Intelligence

#### analyze_conversation
Analyze conversation activity and engagement patterns for an opportunity. Extracts insights from calls, emails, and other activities to provide engagement recommendations.
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

#### enrich_opportunity
Enrich an opportunity with market intelligence, industry insights, and strategic recommendations based on similar deal patterns and best practices.
```typescript
{
  opportunityId: string;              // Required: The ID of the Salesforce opportunity
  includeCompetitiveIntel?: boolean; // Optional: Include competitive analysis (default: false)
  includeBestPractices?: boolean;    // Optional: Include best practices (default: true)
}
```
Example:
```javascript
{
  "opportunityId": "006XXXXXXXXXX",
  "includeCompetitiveIntel": true,
  "includeBestPractices": true
}
```

#### find_similar_opportunities
Find opportunities similar to a reference opportunity or based on specific criteria. Includes pattern analysis and similarity scoring.
```typescript
{
  referenceOpportunityId?: string; // Optional: Reference opportunity for similarity matching
  industry?: string;               // Optional: Filter by industry
  minAmount?: number;             // Optional: Minimum opportunity amount
  maxAmount?: number;             // Optional: Maximum opportunity amount
  stage?: string;                 // Optional: Filter by opportunity stage
  isWon?: boolean;               // Optional: Filter by won/lost status
  closeDateStart?: string;       // Optional: Start date (YYYY-MM-DD)
  closeDateEnd?: string;         // Optional: End date (YYYY-MM-DD)
  includeAnalysis?: boolean;     // Optional: Include pattern analysis (default: true)
  limit?: number;                // Optional: Max results (default: 50)
}
```
Examples:

1. Find similar to a reference opportunity:
```javascript
{
  "referenceOpportunityId": "006XXXXXXXXXX",
  "includeAnalysis": true
}
```

2. Find by criteria:
```javascript
{
  "industry": "Information Technology & Services",
  "minAmount": 100000,
  "stage": "Closed Won",
  "limit": 20
}
```

#### opportunity_insights
Generate detailed insights and analytics from opportunity data including pipeline health, performance metrics, and trends.
```typescript
{
  timeframe?: string;              // Optional: 'current_quarter', 'last_quarter', etc.
  includeStageAnalysis?: boolean;  // Optional: Stage distribution analysis (default: true)
  includeOwnerPerformance?: boolean; // Optional: Owner performance metrics (default: true)
  includeIndustryTrends?: boolean; // Optional: Industry trends (default: true)
  includePipelineHealth?: boolean; // Optional: Pipeline health analysis (default: true)
  includeConversionRates?: boolean; // Optional: Conversion rates (default: true)
  minAmount?: number;             // Optional: Minimum amount filter
  maxAmount?: number;             // Optional: Maximum amount filter
  industry?: string;              // Optional: Industry filter
  owner?: string;                 // Optional: Owner filter
}
```
Example:
```javascript
{
  "timeframe": "current_quarter",
  "includeStageAnalysis": true,
  "includeOwnerPerformance": true,
  "minAmount": 50000
}
```

#### generate_business_case
Generate a professional business case document for an opportunity. Returns step-by-step instructions for creating a formatted business case using TeXFlow.
```typescript
{
  opportunityId: string;    // Required: The ID of the Salesforce opportunity
  clientName?: string;      // Optional: Client name for the document title
  outputFormat?: string;    // Optional: 'pdf', 'docx', or 'markdown' (default: 'pdf')
}
```
Example:
```javascript
{
  "opportunityId": "006XXXXXXXXXX",
  "clientName": "Acme Corporation",
  "outputFormat": "pdf"
}
```

## 📦 Response Formats

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

### Error Handling

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

## 💻 Development

To run the server locally for development:

1. Set up your environment variables in a `.env` file
2. Build the project:
```bash
npm run build
```
3. Start the server:
```bash
node build/index.js
```

## ✨ Key Features

- **🧠 AI-Powered Intelligence**: Advanced opportunity analysis, conversation insights, and market intelligence
- **📊 Pattern Recognition**: Identify similar opportunities and success patterns in your pipeline
- **📋 Business Case Generation**: Automated creation of professional business case documents using TeXFlow
- **🔍 Smart Search**: Flexible opportunity search with pattern matching and filtering
- **📈 Pipeline Analytics**: Detailed insights on pipeline health, conversion rates, and performance metrics
- **🔧 Standard Operations**: Full CRUD operations with custom field support
- **📄 Document Integration**: Seamless integration with TeXFlow MCP server for document generation
- **⚡ Optimized for AI**: Response structures designed for AI model consumption

## 🌟 Future Possibilities

The Salesforce API offers numerous expansion opportunities:

- Support for more Salesforce objects (Leads, Cases, Contacts, etc.)
- Integration with Salesforce Flow and Process Builder
- Enhanced competitive intelligence features
- Bulk API operations for large datasets
- Chatter API integration and social selling insights
- Custom report and dashboard access
- Advanced forecasting and predictive analytics

We'd love to hear your ideas about what would be most valuable to add next!

## 🤝 Contributing

We welcome contributions from the community! Whether it's adding new features, improving documentation, or reporting bugs, your input helps make this project better for everyone. Feel free to submit a Pull Request or open an Issue to start a discussion.

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
