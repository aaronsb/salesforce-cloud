# Security Policy

## Supported Versions

We release patches for security vulnerabilities. Currently supported versions:

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |
| < 0.1   | :x:                |

## Reporting a Vulnerability

If you discover a security vulnerability within this project, please follow these steps:

1. **DO NOT** open a public issue
2. Email security concerns to the repository maintainer
3. Include detailed information about the vulnerability:
   - Type of issue (e.g., buffer overflow, SQL injection, cross-site scripting)
   - Full paths of source file(s) related to the issue
   - Location of affected code (tag/branch/commit or direct URL)
   - Step-by-step instructions to reproduce the issue
   - Proof-of-concept or exploit code (if possible)
   - Impact of the issue

## Security Update Process

1. Security patches are prioritized over feature development
2. Dependencies with known vulnerabilities are updated as soon as patches are available
3. Dependabot automatically creates PRs for security updates
4. Critical security updates bypass the normal review process for rapid deployment

## Security Best Practices

When contributing to this project:

- **Never commit sensitive data**: API keys, passwords, tokens, or credentials
- **Use environment variables**: All sensitive configuration should use environment variables
- **Validate input**: Always validate and sanitize user input, especially for SOQL queries
- **Follow OAuth standards**: Use proper OAuth2 flows for Salesforce authentication
- **Respect API limits**: Implement proper rate limiting and error handling
- **Secure data handling**: Never log sensitive Salesforce data in production

## Dependencies

- We use Dependabot to automatically update dependencies
- Security updates are merged with priority
- Major version updates require manual review for breaking changes

## Salesforce Security Considerations

- **Field-Level Security**: Respect Salesforce field-level security settings
- **Object Permissions**: Check object accessibility before operations
- **SOQL Injection**: Always use parameterized queries, never concatenate user input
- **API Limits**: Implement proper handling for Salesforce API limits
- **Data Privacy**: Follow GDPR/CCPA requirements when handling personal data