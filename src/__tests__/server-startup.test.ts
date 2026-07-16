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

  // The resource list is built before discovery can have run, so every catalog
  // in it is described as "in progress". Clients cache that listing at connect
  // and have no reason to refetch — without a notification the labels stay
  // wrong for the whole session while the resources themselves read fine.
  describe('resource list notification', () => {
    it('tells clients to refetch once discovery settles', async () => {
      const server = new SalesforceServer();
      jest.spyOn(server['fieldDiscovery'], 'startAsync').mockImplementation(() => {});
      jest.spyOn(server['fieldDiscovery'], 'whenSettled').mockResolvedValue(undefined);
      const notify = jest.spyOn(server['server'], 'sendResourceListChanged').mockResolvedValue(undefined);

      await server.startBackgroundInit();

      expect(notify).toHaveBeenCalledTimes(1);
    });

    it('waits for discovery rather than announcing immediately', async () => {
      const server = new SalesforceServer();
      let settle: () => void = () => {};
      jest.spyOn(server['fieldDiscovery'], 'startAsync').mockImplementation(() => {});
      jest.spyOn(server['fieldDiscovery'], 'whenSettled')
        .mockReturnValue(new Promise<void>(res => { settle = res; }));
      const notify = jest.spyOn(server['server'], 'sendResourceListChanged').mockResolvedValue(undefined);

      const init = server.startBackgroundInit();
      await new Promise(process.nextTick);
      expect(notify).not.toHaveBeenCalled();

      settle();
      await init;
      expect(notify).toHaveBeenCalledTimes(1);
    });

    it('does not announce when auth failed and discovery never ran', async () => {
      conn.login.mockRejectedValue(new Error('bad credentials'));
      const server = new SalesforceServer();
      const notify = jest.spyOn(server['server'], 'sendResourceListChanged').mockResolvedValue(undefined);

      await server.startBackgroundInit();

      expect(notify).not.toHaveBeenCalled();
    });

    it('survives a client that has gone away', async () => {
      const server = new SalesforceServer();
      jest.spyOn(server['fieldDiscovery'], 'startAsync').mockImplementation(() => {});
      jest.spyOn(server['fieldDiscovery'], 'whenSettled').mockResolvedValue(undefined);
      jest.spyOn(server['server'], 'sendResourceListChanged')
        .mockRejectedValue(new Error('Not connected'));

      await expect(server.startBackgroundInit()).resolves.toBeUndefined();
    });

    it('declares the listChanged capability so clients act on the notification', () => {
      const server = new SalesforceServer();

      expect(server['server']['_capabilities'].resources).toMatchObject({ listChanged: true });
    });
  });
});
