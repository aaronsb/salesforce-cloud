import jsforce from 'jsforce';
import { PaginationParams, SimplifiedObject, SimplifiedUserInfo, PaginatedSimplifiedObject } from '../types/index.js';
import { paginateResults, simplifyObjectMetadata, simplifyUserInfo, addPaginationToQuery, validateSalesforceId } from '../utils/index.js';
import type { FieldDiscovery } from './field-discovery.js';

export class SalesforceClient {
  private SF_CLIENT_ID: string;
  private SF_CLIENT_SECRET: string;
  private SF_USERNAME: string;
  private SF_PASSWORD: string;
  private SF_LOGIN_URL: string;
  private conn!: jsforce.Connection;
  private initPromise: Promise<void> | null = null;

  constructor() {
    // Resolve env vars, treating uninterpolated mcpb template strings
    // and common placeholder values as empty
    const resolve = (val: string | undefined): string =>
      val && !val.startsWith('${') && !val.startsWith('YOUR_') ? val : '';

    this.SF_CLIENT_ID = resolve(process.env.SF_CLIENT_ID);
    this.SF_CLIENT_SECRET = resolve(process.env.SF_CLIENT_SECRET);
    this.SF_USERNAME = resolve(process.env.SF_USERNAME);
    this.SF_PASSWORD = resolve(process.env.SF_PASSWORD);
    this.SF_LOGIN_URL = resolve(process.env.SF_LOGIN_URL) || 'https://login.salesforce.com';

    this.conn = new jsforce.Connection({
      loginUrl: this.SF_LOGIN_URL,
      oauth2: {
        clientId: this.SF_CLIENT_ID,
        clientSecret: this.SF_CLIENT_SECRET,
        loginUrl: this.SF_LOGIN_URL,
      },
    });
  }

  /** Kick off auth eagerly. Does not block; call ensureInitialized() to await. */
  warmup() {
    if (!this.initPromise) {
      this.initPromise = this.initialize();
      // Log warmup failures but don't swallow — ensureInitialized() will
      // see the rejection and initPromise is already nulled in initialize().
      this.initPromise.catch((err) => {
        console.error('Warmup auth failed, will retry on first tool call:', err.message);
      });
    }
  }

  /** Get the underlying jsforce Connection (must be initialized first). */
  getConnection(): jsforce.Connection {
    return this.conn;
  }

  /** Ensure authenticated before making API calls. Safe to call multiple times. */
  async ensureInitialized() {
    if (!this.initPromise) {
      this.initPromise = this.initialize();
    }
    try {
      await this.initPromise;
    } catch {
      // initPromise was nulled by initialize() on failure; retry
      this.initPromise = this.initialize();
      await this.initPromise;
    }
  }

  async initialize() {
    const hasClientCreds = this.SF_CLIENT_ID && this.SF_CLIENT_SECRET;
    const hasUserCreds = this.SF_USERNAME && this.SF_PASSWORD;

    console.error(`SF auth config: client_id=${this.SF_CLIENT_ID ? this.SF_CLIENT_ID.substring(0, 8) + '...' : '<empty>'}, login_url=${this.SF_LOGIN_URL}, flow=${hasUserCreds ? 'password' : 'client_credentials'}`);

    if (!hasClientCreds) {
      throw new Error('Missing required Salesforce environment variables: SF_CLIENT_ID and SF_CLIENT_SECRET');
    }

    try {
      if (hasUserCreds) {
        // Password flow: client ID + secret + username + password
        await this.conn.login(this.SF_USERNAME, this.SF_PASSWORD);
        console.error('Authenticated via password flow');
      } else {
        // Client credentials flow: client ID + secret only
        // Requires My Domain URL (e.g. https://yourcompany.my.salesforce.com)
        if (this.SF_LOGIN_URL === 'https://login.salesforce.com') {
          console.error('Warning: Client credentials flow typically requires a My Domain URL, not login.salesforce.com');
          console.error('Set SF_LOGIN_URL=https://yourcompany.my.salesforce.com');
        }
        await this.conn.authorize({ grant_type: 'client_credentials' });
        console.error('Authenticated via client credentials flow');
      }
    } catch (error: any) {
      this.initPromise = null;
      const detail = error?.message || 'Unknown error';
      const flow = hasUserCreds ? 'password' : 'client_credentials';
      console.error(`Auth failed (${flow} flow, login URL: ${this.SF_LOGIN_URL}): ${detail}`);
      if (error?.errorCode) console.error(`Salesforce error code: ${error.errorCode}`);
      throw new Error(
        `Salesforce login failed (${flow} flow): ${detail}` +
        (flow === 'client_credentials' && this.SF_LOGIN_URL === 'https://login.salesforce.com'
          ? '. Client credentials flow requires SF_LOGIN_URL set to your My Domain (e.g. https://company.my.salesforce.com)'
          : '')
      );
    }
  }

  async executeQuery(soql: string, pagination?: PaginationParams) {
    await this.ensureInitialized();
    try {
      const paginatedQuery = addPaginationToQuery(soql, pagination);
      const result = await this.conn.query(paginatedQuery);
      return paginateResults(result.records, pagination || {});
    } catch (error: any) {
      throw new Error(`SOQL query failed: ${error?.message || 'Unknown error'}`);
    }
  }

  async describeObject(
    objectName: string,
    includeFields: boolean = false,
    pagination?: PaginationParams
  ): Promise<SimplifiedObject | PaginatedSimplifiedObject> {
    await this.ensureInitialized();
    try {
      const metadata = await this.conn.describe(objectName);
      
      if (!includeFields) {
        return simplifyObjectMetadata({
          ...metadata,
          fields: undefined
        });
      }

      // If pagination is provided and fields are requested, paginate the fields
      if (pagination && (pagination.pageSize || pagination.pageNumber)) {
        const pageSize = pagination.pageSize || 50;
        const pageNumber = pagination.pageNumber || 1;
        const totalFields = metadata.fields?.length || 0;
        const totalPages = Math.ceil(totalFields / pageSize);
        const startIndex = (pageNumber - 1) * pageSize;
        const endIndex = startIndex + pageSize;
        
        const paginatedFields = metadata.fields?.slice(startIndex, endIndex) || [];
        
        const simplified = simplifyObjectMetadata({
          ...metadata,
          fields: paginatedFields
        });

        return {
          ...simplified,
          totalFields,
          pageInfo: {
            currentPage: pageNumber,
            totalPages,
            hasNextPage: pageNumber < totalPages,
            hasPreviousPage: pageNumber > 1
          }
        };
      }

      // Return all fields if no pagination
      return simplifyObjectMetadata({
        ...metadata,
        fields: metadata.fields
      });
    } catch (error: any) {
      throw new Error(`Object describe failed: ${error?.message || 'Unknown error'}`);
    }
  }

  async createRecord(objectName: string, data: Record<string, any>) {
    await this.ensureInitialized();
    try {
      const result = await this.conn.sobject(objectName).create(data);
      return {
        success: result.success,
        id: result.id,
        errors: result.errors
      };
    } catch (error: any) {
      throw new Error(`Record creation failed: ${error?.message || 'Unknown error'}`);
    }
  }

  async updateRecord(objectName: string, id: string, data: Record<string, any>) {
    await this.ensureInitialized();
    try {
      const result = await this.conn.sobject(objectName).update({ Id: id, ...data });
      return {
        success: result.success,
        errors: result.errors
      };
    } catch (error: any) {
      throw new Error(`Record update failed: ${error?.message || 'Unknown error'}`);
    }
  }

  async deleteRecord(objectName: string, id: string) {
    await this.ensureInitialized();
    try {
      const result = await this.conn.sobject(objectName).destroy(id);
      return {
        success: result.success,
        errors: result.errors
      };
    } catch (error: any) {
      throw new Error(`Record deletion failed: ${error?.message || 'Unknown error'}`);
    }
  }

  async getUserInfo(): Promise<SimplifiedUserInfo> {
    await this.ensureInitialized();
    try {
      const userInfo = await this.conn.identity();
      return simplifyUserInfo(userInfo);
    } catch (error: any) {
      throw new Error(`Get user info failed: ${error?.message || 'Unknown error'}`);
    }
  }

  /**
   * Download a file's binary content from Salesforce ContentVersion.
   * Returns the file buffer along with metadata (filename, mime type, size).
   *
   * Accepts either a ContentVersionId or ContentDocumentId.
   * If a ContentDocumentId is given, resolves the latest published version first.
   *
   * When fieldDiscovery is provided, resolves the "latest version" boolean field
   * dynamically (ADR-300). Falls back to CreatedDate ordering if not available.
   */
  async downloadFile(id: string, fieldDiscovery?: FieldDiscovery): Promise<{
    buffer: Buffer;
    filename: string;
    mimeType: string;
    contentSize: number;
    versionId: string;
    documentId: string;
  }> {
    await this.ensureInitialized();

    // Defense in depth: validate ID format at the query site, not just in the handler.
    // Prevents SOQL injection if called from a different code path without handler validation.
    validateSalesforceId(id, 'contentId');

    let versionId = id;
    let versionRecord: Record<string, any>;

    // ContentDocument IDs start with '069', ContentVersion IDs start with '068'
    // If it looks like a ContentDocumentId, resolve the latest version
    const prefix = id.substring(0, 3);
    if (prefix === '069') {
      // ADR-300: resolve the "latest version" boolean field dynamically.
      // Falls back to CreatedDate ordering if discovery isn't available.
      const latestField = fieldDiscovery?.resolveWellKnown('ContentVersion', 'isLatestVersion');
      const latestFilter = latestField
        ? `AND ${latestField} = true`
        : 'ORDER BY CreatedDate DESC';
      const result = await this.conn.query(
        `SELECT Id, Title, FileExtension, ContentSize, FileType, ContentDocumentId ` +
        `FROM ContentVersion WHERE ContentDocumentId = '${id}' ${latestFilter} LIMIT 1`
      );
      if (!result.records || result.records.length === 0) {
        throw new Error(`No ContentVersion found for ContentDocumentId: ${id}`);
      }
      versionRecord = result.records[0];
      versionId = versionRecord.Id;
    } else {
      // Fetch version metadata
      const result = await this.conn.query(
        `SELECT Id, Title, FileExtension, ContentSize, FileType, ContentDocumentId ` +
        `FROM ContentVersion WHERE Id = '${versionId}' LIMIT 1`
      );
      if (!result.records || result.records.length === 0) {
        throw new Error(`ContentVersion not found: ${versionId}`);
      }
      versionRecord = result.records[0];
    }

    // Build filename from Title + FileExtension
    const title = versionRecord.Title || 'unnamed';
    const ext = versionRecord.FileExtension ? `.${versionRecord.FileExtension}` : '';
    const filename = title.endsWith(ext) ? title : `${title}${ext}`;

    // Map Salesforce FileType to MIME type
    const mimeType = sfFileTypeToMime(versionRecord.FileType, versionRecord.FileExtension);

    // Download binary content directly via fetch — jsforce v3's request()
    // parses all responses as text/JSON, corrupting binary data.
    const apiVersion = this.conn.version || '59.0';
    const blobUrl = `${this.conn.instanceUrl}/services/data/v${apiVersion}/sobjects/ContentVersion/${versionId}/VersionData`;
    const fetchResponse = await fetch(blobUrl, {
      headers: { Authorization: `Bearer ${this.conn.accessToken}` },
    });
    if (!fetchResponse.ok) {
      throw new Error(`File download failed: ${fetchResponse.status} ${fetchResponse.statusText}`);
    }
    const buffer = Buffer.from(await fetchResponse.arrayBuffer());

    return {
      buffer,
      filename,
      mimeType,
      contentSize: versionRecord.ContentSize || buffer.length,
      versionId,
      documentId: versionRecord.ContentDocumentId,
    };
  }

  async listObjects(pagination?: PaginationParams) {
    await this.ensureInitialized();
    try {
      const result = await this.conn.describeGlobal();
      return paginateResults(
        result.sobjects.map((obj: any) => simplifyObjectMetadata(obj)),
        pagination || {}
      );
    } catch (error: any) {
      throw new Error(`List objects failed: ${error?.message || 'Unknown error'}`);
    }
  }
}

/** Map Salesforce FileType codes to MIME types. */
function sfFileTypeToMime(fileType?: string, fileExtension?: string): string {
  const ext = (fileExtension || '').toLowerCase();
  const type = (fileType || '').toUpperCase();

  const mimeMap: Record<string, string> = {
    PDF: 'application/pdf',
    WORD: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    WORD_X: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    EXCEL: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    EXCEL_X: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    POWER_POINT: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    POWER_POINT_X: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    CSV: 'text/csv',
    TEXT: 'text/plain',
    JSON: 'application/json',
    XML: 'application/xml',
    HTML: 'text/html',
    PNG: 'image/png',
    JPG: 'image/jpeg',
    JPEG: 'image/jpeg',
    GIF: 'image/gif',
    SVG: 'image/svg+xml',
    ZIP: 'application/zip',
    MP4: 'video/mp4',
    MOV: 'video/quicktime',
  };

  if (mimeMap[type]) return mimeMap[type];

  // Fallback: guess from extension
  const extMap: Record<string, string> = {
    pdf: 'application/pdf', doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    csv: 'text/csv', txt: 'text/plain', json: 'application/json',
    xml: 'application/xml', html: 'text/html', htm: 'text/html',
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
    gif: 'image/gif', svg: 'image/svg+xml', zip: 'application/zip',
    mp4: 'video/mp4', mov: 'video/quicktime',
  };

  return extMap[ext] || 'application/octet-stream';
}
