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
- Two flows: **client credentials** (default) or **password** (when `SF_USERNAME`/`SF_PASSWORD` are set)
- Auth starts eagerly via `warmup()` at server construction — tool calls await the in-flight promise
- If warmup fails (transient), `ensureInitialized()` retries once automatically
- `resolve()` strips `${...}` template strings and `YOUR_*` placeholders as empty
- Client credentials flow requires `SF_LOGIN_URL` set to My Domain (not `login.salesforce.com`)
