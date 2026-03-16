---
description: Salesforce API integration patterns, custom fields, SOQL queries, API limits
vocabulary: salesforce soql custom field __c object describe query opportunity account contact lead api limit bulk
pattern: salesforce|soql|__c|jsforce
threshold: 2.0
---
# Salesforce Integration

## Custom Fields
- Business-specific fields end with `__c` — always use `describe_object` to discover them before building queries
- Never hardcode field names; discover them at runtime

## SOQL Queries
- Use `execute_soql` with pagination (`pageSize` + `pageNumber`)
- Test queries with small `pageSize` first to validate field access
- Relationship queries use dot notation: `Account.Name`, `Owner.Email`

## API Limits
- Salesforce enforces daily API call limits per org
- Prefer bulk queries over many small requests
- Cache `describe_object` results when possible — metadata changes rarely

## Authentication
- OAuth2 password flow via environment variables
- Connection is lazy-initialized on first API call
- Check `SF_LOGIN_URL` for sandbox vs production orgs
