/// <reference types="jest" />

/**
 * Guards the startup sequence in SalesforceServer.
 *
 * The server used to authenticate to Salesforce twice on every start: the
 * constructor calls warmup(), which memoises the auth, and run() then called
 * initialize() directly, which doesn't consult that memo. It shipped unnoticed
 * because nothing asserted the login count — the client-level tests all passed
 * either way, since they never exercised the startup path.
 */

const conn = {
  login: jest.fn(),
  authorize: jest.fn(),
  query: jest.fn().mockResolvedValue({ totalSize: 0, records: [] }),
  describe: jest.fn().mockResolvedValue({ name: 'Account', fields: [] }),
  describeGlobal: jest.fn().mockResolvedValue({ sobjects: [] }),
  identity: jest.fn(),
  sobject: jest.fn(),
  instanceUrl: 'https://example.my.salesforce.com',
  accessToken: 'test-token',
  version: '59.0',
};

jest.mock('jsforce', () => ({
  Connection: jest.fn().mockImplementation(() => conn),
}));

import { SalesforceServer } from '../index';

let errSpy: jest.SpyInstance;
const originalEnv = process.env;

beforeEach(() => {
  errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  conn.login.mockReset().mockResolvedValue(undefined);
  conn.authorize.mockReset().mockResolvedValue(undefined);
  process.env = {
    ...originalEnv,
    SF_CLIENT_ID: 'test-client-id',
    SF_CLIENT_SECRET: 'test-client-secret',
    SF_USERNAME: 'test@example.com',
    SF_PASSWORD: 'test-password',
    SF_LOGIN_URL: 'https://example.my.salesforce.com',
  };
});

afterEach(() => {
  process.env = originalEnv;
  errSpy.mockRestore();
  jest.clearAllMocks();
});

describe('SalesforceServer startup', () => {
  it('authenticates exactly once', async () => {
    const server = new SalesforceServer();
    jest.spyOn(server['fieldDiscovery'], 'startAsync').mockImplementation(() => {});

    await server.startBackgroundInit();

    expect(conn.login).toHaveBeenCalledTimes(1);
  });

  it('does not authenticate again when a tool call follows startup', async () => {
    const server = new SalesforceServer();
    jest.spyOn(server['fieldDiscovery'], 'startAsync').mockImplementation(() => {});
    await server.startBackgroundInit();

    // Any handler path goes through ensureInitialized(); it must reuse the session.
    await server['sfClient'].ensureInitialized();

    expect(conn.login).toHaveBeenCalledTimes(1);
  });

  it('starts field discovery once auth succeeds', async () => {
    const server = new SalesforceServer();
    // Stub it out — this asserts the wiring, not discovery itself, and letting
    // it run would leave async work in flight past the end of the test.
    const startAsync = jest.spyOn(server['fieldDiscovery'], 'startAsync').mockImplementation(() => {});

    await server.startBackgroundInit();

    expect(startAsync).toHaveBeenCalled();
  });

  it('survives failed auth without starting discovery or throwing', async () => {
    conn.login.mockRejectedValue(new Error('bad credentials'));
    const server = new SalesforceServer();
    const startAsync = jest.spyOn(server['fieldDiscovery'], 'startAsync').mockImplementation(() => {});

    await expect(server.startBackgroundInit()).resolves.toBeUndefined();

    expect(startAsync).not.toHaveBeenCalled();
  });
});
