/// <reference types="jest" />

import { SalesforceClient } from '../client/salesforce-client';
import type { FieldDiscovery } from '../client/field-discovery';

// ── jsforce mock ─────────────────────────────────────────────────────
// A single shared connection object so tests can reconfigure per-case.

const conn = {
  login: jest.fn().mockResolvedValue(undefined),
  authorize: jest.fn().mockResolvedValue(undefined),
  query: jest.fn(),
  describe: jest.fn(),
  describeGlobal: jest.fn(),
  identity: jest.fn(),
  sobject: jest.fn(),
  instanceUrl: 'https://example.my.salesforce.com',
  accessToken: 'test-token',
  version: '59.0',
};

jest.mock('jsforce', () => ({
  Connection: jest.fn().mockImplementation(() => conn),
}));

// ── Helpers ──────────────────────────────────────────────────────────

/** A ContentVersion record as returned by the metadata query. */
function versionRecord(overrides: Record<string, any> = {}) {
  return {
    Id: '068000000000000AAA',
    Title: 'Quarterly Report',
    FileExtension: 'pdf',
    ContentSize: 1024,
    FileType: 'PDF',
    ContentDocumentId: '069000000000000AAA',
    ...overrides,
  };
}

function mockFetchOk(body = 'file-bytes') {
  const fetchMock = jest.fn().mockResolvedValue({
    ok: true,
    arrayBuffer: async () => new TextEncoder().encode(body).buffer,
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

async function newClient() {
  const client = new SalesforceClient();
  await client.initialize();
  return client;
}

let errSpy: jest.SpyInstance;
const originalEnv = process.env;
const originalFetch = global.fetch;

beforeEach(() => {
  errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
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
  global.fetch = originalFetch;
  errSpy.mockRestore();
  jest.clearAllMocks();
});

// ── Tests ────────────────────────────────────────────────────────────

describe('SalesforceClient record operations', () => {
  describe('createRecord', () => {
    it('creates a record and returns the new id', async () => {
      const create = jest.fn().mockResolvedValue({ success: true, id: '001xx', errors: [] });
      conn.sobject.mockReturnValue({ create });
      const client = await newClient();

      const result = await client.createRecord('Account', { Name: 'Acme' });

      expect(conn.sobject).toHaveBeenCalledWith('Account');
      expect(create).toHaveBeenCalledWith({ Name: 'Acme' });
      expect(result).toEqual({ success: true, id: '001xx', errors: [] });
    });

    it('wraps a failure in a descriptive error', async () => {
      conn.sobject.mockReturnValue({ create: jest.fn().mockRejectedValue(new Error('field missing')) });
      const client = await newClient();

      await expect(client.createRecord('Account', {})).rejects.toThrow('Record creation failed: field missing');
    });
  });

  describe('updateRecord', () => {
    it('merges the id into the payload', async () => {
      const update = jest.fn().mockResolvedValue({ success: true, errors: [] });
      conn.sobject.mockReturnValue({ update });
      const client = await newClient();

      const result = await client.updateRecord('Account', '001xx', { Name: 'New Name' });

      expect(update).toHaveBeenCalledWith({ Id: '001xx', Name: 'New Name' });
      expect(result).toEqual({ success: true, errors: [] });
    });

    it('wraps a failure in a descriptive error', async () => {
      conn.sobject.mockReturnValue({ update: jest.fn().mockRejectedValue(new Error('read only')) });
      const client = await newClient();

      await expect(client.updateRecord('Account', '001xx', {})).rejects.toThrow('Record update failed: read only');
    });
  });

  describe('deleteRecord', () => {
    it('destroys the record by id', async () => {
      const destroy = jest.fn().mockResolvedValue({ success: true, errors: [] });
      conn.sobject.mockReturnValue({ destroy });
      const client = await newClient();

      const result = await client.deleteRecord('Account', '001xx');

      expect(destroy).toHaveBeenCalledWith('001xx');
      expect(result).toEqual({ success: true, errors: [] });
    });

    it('wraps a failure in a descriptive error', async () => {
      conn.sobject.mockReturnValue({ destroy: jest.fn().mockRejectedValue(new Error('no perms')) });
      const client = await newClient();

      await expect(client.deleteRecord('Account', '001xx')).rejects.toThrow('Record deletion failed: no perms');
    });
  });

  describe('getUserInfo', () => {
    it('simplifies the identity payload', async () => {
      conn.identity.mockResolvedValue({
        user_id: '005xx', username: 'a@b.com', display_name: 'Ada',
        email: 'a@b.com', organization_id: '00Dxx',
      });
      const client = await newClient();

      await expect(client.getUserInfo()).resolves.toEqual({
        id: '005xx', username: 'a@b.com', displayName: 'Ada',
        email: 'a@b.com', organizationId: '00Dxx',
      });
    });

    it('wraps a failure in a descriptive error', async () => {
      conn.identity.mockRejectedValue(new Error('session expired'));
      const client = await newClient();

      await expect(client.getUserInfo()).rejects.toThrow('Get user info failed: session expired');
    });
  });

  describe('listObjects', () => {
    it('simplifies and paginates the global describe', async () => {
      conn.describeGlobal.mockResolvedValue({
        sobjects: [
          { name: 'Account', label: 'Account', custom: false },
          { name: 'Contact', label: 'Contact', custom: false },
        ],
      });
      const client = await newClient();

      const result: any = await client.listObjects({ pageSize: 1, pageNumber: 2 });

      expect(result.totalCount).toBe(2);
      expect(result.totalPages).toBe(2);
      expect(result.results).toHaveLength(1);
      expect(result.results[0].name).toBe('Contact');
    });

    it('wraps a failure in a descriptive error', async () => {
      conn.describeGlobal.mockRejectedValue(new Error('api limit'));
      const client = await newClient();

      await expect(client.listObjects()).rejects.toThrow('List objects failed: api limit');
    });
  });

  describe('describeObject', () => {
    it('omits fields unless they are requested', async () => {
      conn.describe.mockResolvedValue({
        name: 'Account', label: 'Account',
        fields: [{ name: 'Name', type: 'string' }],
      });
      const client = await newClient();

      const result: any = await client.describeObject('Account');

      expect(result.name).toBe('Account');
      expect(result.fields).toBeUndefined();
    });

    it('includes fields when asked', async () => {
      conn.describe.mockResolvedValue({
        name: 'Account', label: 'Account',
        fields: [{ name: 'Name', type: 'string' }, { name: 'Industry', type: 'picklist' }],
      });
      const client = await newClient();

      const result: any = await client.describeObject('Account', true);

      expect(result.fields).toHaveLength(2);
      expect(result.fields[0].name).toBe('Name');
    });

    it('paginates fields and reports page info', async () => {
      conn.describe.mockResolvedValue({
        name: 'Account', label: 'Account',
        fields: Array.from({ length: 10 }, (_, i) => ({ name: `F${i}`, type: 'string' })),
      });
      const client = await newClient();

      const result: any = await client.describeObject('Account', true, { pageSize: 4, pageNumber: 2 });

      expect(result.totalFields).toBe(10);
      expect(result.fields).toHaveLength(4);
      expect(result.fields[0].name).toBe('F4');
      expect(result.pageInfo).toEqual({
        currentPage: 2, totalPages: 3, hasNextPage: true, hasPreviousPage: true,
      });
    });

    it('reports the last page correctly', async () => {
      conn.describe.mockResolvedValue({
        name: 'Account', label: 'Account',
        fields: Array.from({ length: 10 }, (_, i) => ({ name: `F${i}`, type: 'string' })),
      });
      const client = await newClient();

      const result: any = await client.describeObject('Account', true, { pageSize: 4, pageNumber: 3 });

      expect(result.fields).toHaveLength(2);
      expect(result.pageInfo).toEqual({
        currentPage: 3, totalPages: 3, hasNextPage: false, hasPreviousPage: true,
      });
    });

    it('wraps a failure in a descriptive error', async () => {
      conn.describe.mockRejectedValue(new Error('no such sobject'));
      const client = await newClient();

      await expect(client.describeObject('Ghost')).rejects.toThrow('Object describe failed: no such sobject');
    });
  });

  describe('executeQuery', () => {
    it('wraps a failure in a descriptive error', async () => {
      conn.query.mockRejectedValue(new Error('MALFORMED_QUERY'));
      const client = await newClient();

      await expect(client.executeQuery('SELECT bogus FROM Account')).rejects.toThrow(
        'SOQL query failed: MALFORMED_QUERY',
      );
    });
  });
});

describe('SalesforceClient.downloadFile', () => {
  it('rejects an id that is not a valid Salesforce id before querying', async () => {
    const client = await newClient();

    await expect(client.downloadFile("068' OR Id != '")).rejects.toThrow('Invalid Salesforce contentId');
    expect(conn.query).not.toHaveBeenCalled();
  });

  it('rejects an id of the wrong length', async () => {
    const client = await newClient();

    await expect(client.downloadFile('068tooshort')).rejects.toThrow('Invalid Salesforce contentId');
    expect(conn.query).not.toHaveBeenCalled();
  });

  it('downloads a ContentVersion id directly', async () => {
    conn.query.mockResolvedValue({ records: [versionRecord()] });
    const fetchMock = mockFetchOk('pdf-bytes');
    const client = await newClient();

    const result = await client.downloadFile('068000000000000AAA');

    expect(result.filename).toBe('Quarterly Report.pdf');
    expect(result.mimeType).toBe('application/pdf');
    expect(result.versionId).toBe('068000000000000AAA');
    expect(result.documentId).toBe('069000000000000AAA');
    expect(result.buffer.toString()).toBe('pdf-bytes');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.my.salesforce.com/services/data/v59.0/sobjects/ContentVersion/068000000000000AAA/VersionData',
      { headers: { Authorization: 'Bearer test-token' } },
    );
  });

  it('resolves a ContentDocument id via CreatedDate when discovery is unavailable', async () => {
    conn.query.mockResolvedValue({ records: [versionRecord()] });
    mockFetchOk();
    const client = await newClient();

    await client.downloadFile('069000000000000AAA');

    const soql = conn.query.mock.calls[0][0] as string;
    expect(soql).toContain("ContentDocumentId = '069000000000000AAA'");
    expect(soql).toContain('ORDER BY CreatedDate DESC');
  });

  it('resolves a ContentDocument id via the discovered latest-version field', async () => {
    conn.query.mockResolvedValue({ records: [versionRecord()] });
    mockFetchOk();
    const discovery = {
      resolveWellKnown: jest.fn().mockReturnValue('IsLatest__c'),
    } as unknown as FieldDiscovery;
    const client = await newClient();

    await client.downloadFile('069000000000000AAA', discovery);

    expect(discovery.resolveWellKnown).toHaveBeenCalledWith('ContentVersion', 'isLatestVersion');
    const soql = conn.query.mock.calls[0][0] as string;
    expect(soql).toContain('AND IsLatest__c = true');
    expect(soql).not.toContain('ORDER BY CreatedDate DESC');
  });

  it('throws when a ContentDocument id resolves to no versions', async () => {
    conn.query.mockResolvedValue({ records: [] });
    const client = await newClient();

    await expect(client.downloadFile('069000000000000AAA')).rejects.toThrow(
      'No ContentVersion found for ContentDocumentId: 069000000000000AAA',
    );
  });

  it('throws when a ContentVersion id is not found', async () => {
    conn.query.mockResolvedValue({ records: [] });
    const client = await newClient();

    await expect(client.downloadFile('068000000000000AAA')).rejects.toThrow(
      'ContentVersion not found: 068000000000000AAA',
    );
  });

  it('surfaces a failed blob download with its status', async () => {
    conn.query.mockResolvedValue({ records: [versionRecord()] });
    global.fetch = jest.fn().mockResolvedValue({
      ok: false, status: 404, statusText: 'Not Found',
    }) as unknown as typeof fetch;
    const client = await newClient();

    await expect(client.downloadFile('068000000000000AAA')).rejects.toThrow(
      'File download failed: 404 Not Found',
    );
  });

  it('does not double-append an extension the title already carries', async () => {
    conn.query.mockResolvedValue({ records: [versionRecord({ Title: 'Report.pdf' })] });
    mockFetchOk();
    const client = await newClient();

    const result = await client.downloadFile('068000000000000AAA');

    expect(result.filename).toBe('Report.pdf');
  });

  it('falls back to a placeholder name when the title is missing', async () => {
    conn.query.mockResolvedValue({ records: [versionRecord({ Title: null, FileExtension: null })] });
    mockFetchOk();
    const client = await newClient();

    const result = await client.downloadFile('068000000000000AAA');

    expect(result.filename).toBe('unnamed');
  });

  it('falls back to the response size when ContentSize is absent', async () => {
    conn.query.mockResolvedValue({ records: [versionRecord({ ContentSize: null })] });
    mockFetchOk('12345');
    const client = await newClient();

    const result = await client.downloadFile('068000000000000AAA');

    expect(result.contentSize).toBe(5);
  });

  describe('MIME type resolution', () => {
    it.each([
      ['PDF', 'pdf', 'application/pdf'],
      ['CSV', 'csv', 'text/csv'],
      ['PNG', 'png', 'image/png'],
      ['EXCEL_X', 'xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    ])('maps FileType %s to %s', async (fileType, ext, expected) => {
      conn.query.mockResolvedValue({ records: [versionRecord({ FileType: fileType, FileExtension: ext })] });
      mockFetchOk();
      const client = await newClient();

      const result = await client.downloadFile('068000000000000AAA');

      expect(result.mimeType).toBe(expected);
    });

    it('guesses from the extension when FileType is unrecognized', async () => {
      conn.query.mockResolvedValue({
        records: [versionRecord({ FileType: 'SOMETHING_NEW', FileExtension: 'docx' })],
      });
      mockFetchOk();
      const client = await newClient();

      const result = await client.downloadFile('068000000000000AAA');

      expect(result.mimeType).toBe(
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      );
    });

    it('falls back to octet-stream when nothing matches', async () => {
      conn.query.mockResolvedValue({
        records: [versionRecord({ FileType: 'MYSTERY', FileExtension: 'zzz' })],
      });
      mockFetchOk();
      const client = await newClient();

      const result = await client.downloadFile('068000000000000AAA');

      expect(result.mimeType).toBe('application/octet-stream');
    });
  });
});

describe('SalesforceClient auth lifecycle', () => {
  it('authenticates lazily on first use, then reuses the session', async () => {
    conn.describeGlobal.mockResolvedValue({ sobjects: [] });
    const client = new SalesforceClient();

    expect(conn.login).not.toHaveBeenCalled();
    await client.listObjects();
    await client.listObjects();

    expect(conn.login).toHaveBeenCalledTimes(1);
  });

  it('reuses the warmed-up session instead of re-authenticating', async () => {
    conn.describeGlobal.mockResolvedValue({ sobjects: [] });
    const client = new SalesforceClient();

    client.warmup();
    await client.listObjects();

    expect(conn.login).toHaveBeenCalledTimes(1);
  });

  it('retries authentication on the next call after a failed login', async () => {
    conn.login.mockRejectedValueOnce(new Error('bad password'));
    const client = new SalesforceClient();

    await expect(client.initialize()).rejects.toThrow('Salesforce login failed (password flow): bad password');

    conn.describeGlobal.mockResolvedValue({ sobjects: [] });
    await expect(client.listObjects()).resolves.toBeDefined();
    expect(conn.login).toHaveBeenCalledTimes(2);
  });

  it('warmup kicks off auth without throwing on failure', async () => {
    conn.login.mockRejectedValueOnce(new Error('network down'));
    const client = new SalesforceClient();

    expect(() => client.warmup()).not.toThrow();
    await new Promise(process.nextTick);

    expect(conn.login).toHaveBeenCalled();
  });

  it('warmup is idempotent', async () => {
    const client = new SalesforceClient();

    client.warmup();
    client.warmup();
    await new Promise(process.nextTick);

    expect(conn.login).toHaveBeenCalledTimes(1);
  });

  it('advises a My Domain URL when client credentials are used against login.salesforce.com', async () => {
    delete process.env.SF_USERNAME;
    delete process.env.SF_PASSWORD;
    process.env.SF_LOGIN_URL = 'https://login.salesforce.com';
    conn.authorize.mockRejectedValueOnce(new Error('invalid_client'));
    const client = new SalesforceClient();

    await expect(client.initialize()).rejects.toThrow(/requires SF_LOGIN_URL set to your My Domain/);
  });

  it('exposes the underlying connection', async () => {
    const client = await newClient();

    expect(client.getConnection()).toBe(conn);
  });
});
