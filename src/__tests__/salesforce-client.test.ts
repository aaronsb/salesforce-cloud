/// <reference types="jest" />

import { SalesforceClient } from '../client/salesforce-client';
import jsforce from 'jsforce';

// Mock jsforce
jest.mock('jsforce', () => {
  return {
    Connection: jest.fn().mockImplementation(() => ({
      login: jest.fn().mockResolvedValue(undefined),
      authorize: jest.fn().mockResolvedValue(undefined),
      query: jest.fn().mockResolvedValue({
        records: [
          { Id: '001', Name: 'Test Account' }
        ]
      }),
      describe: jest.fn().mockResolvedValue({
        name: 'Account',
        fields: [
          { name: 'Id', type: 'id' },
          { name: 'Name', type: 'string' }
        ]
      })
    }))
  };
});

describe('SalesforceClient', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Setup test environment variables
    process.env = {
      ...originalEnv,
      SF_CLIENT_ID: 'test-client-id',
      SF_CLIENT_SECRET: 'test-client-secret',
      SF_USERNAME: 'test@example.com',
      SF_PASSWORD: 'test-password',
      SF_LOGIN_URL: 'https://test.salesforce.com'
    };
  });

  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;
    jest.clearAllMocks();
  });

  it('should initialize successfully with valid credentials', async () => {
    const client = new SalesforceClient();
    await client.initialize();
    
    expect(jsforce.Connection).toHaveBeenCalledWith({
      loginUrl: 'https://test.salesforce.com',
      oauth2: {
        clientId: 'test-client-id',
        clientSecret: 'test-client-secret',
        loginUrl: 'https://test.salesforce.com',
      },
    });
  });

  it('should execute SOQL query successfully', async () => {
    const client = new SalesforceClient();
    await client.initialize();

    const result = await client.executeQuery('SELECT Id, Name FROM Account');
    
    expect(result).toEqual({
      totalCount: 1,
      pageSize: 25,
      pageNumber: 1,
      totalPages: 1,
      results: [{ Id: '001', Name: 'Test Account' }]
    });
  });

  it('should describe object successfully', async () => {
    const client = new SalesforceClient();
    await client.initialize();

    const result = await client.describeObject('Account');
    
    expect(result).toEqual({
      name: 'Account'
    });
  });

  it('should throw error when missing required environment variables', async () => {
    process.env.SF_CLIENT_ID = '';

    const client = new SalesforceClient();
    await expect(client.initialize()).rejects.toThrow('Missing required Salesforce environment variables: SF_CLIENT_ID and SF_CLIENT_SECRET');
  });

  it('should use client credentials flow when no username/password', async () => {
    delete process.env.SF_USERNAME;
    delete process.env.SF_PASSWORD;

    const client = new SalesforceClient();
    await client.initialize();

    const connInstance = (jsforce.Connection as jest.Mock).mock.results[0].value;
    expect(connInstance.authorize).toHaveBeenCalledWith({ grant_type: 'client_credentials' });
    expect(connInstance.login).not.toHaveBeenCalled();
  });

  it('should treat YOUR_ placeholder values as empty and use client credentials flow', async () => {
    process.env.SF_USERNAME = 'YOUR_SF_USERNAME';
    process.env.SF_PASSWORD = 'YOUR_SF_PASSWORD';

    const client = new SalesforceClient();
    await client.initialize();

    const connInstance = (jsforce.Connection as jest.Mock).mock.results[0].value;
    expect(connInstance.authorize).toHaveBeenCalledWith({ grant_type: 'client_credentials' });
    expect(connInstance.login).not.toHaveBeenCalled();
  });

  it('should use password flow when username/password are provided', async () => {
    const client = new SalesforceClient();
    await client.initialize();

    const connInstance = (jsforce.Connection as jest.Mock).mock.results[0].value;
    expect(connInstance.login).toHaveBeenCalledWith('test@example.com', 'test-password');
    expect(connInstance.authorize).not.toHaveBeenCalled();
  });
});
