import jsforce from 'jsforce';
import { PaginationParams, SimplifiedObject, SimplifiedUserInfo } from '../types/index.js';
import { paginateResults, simplifyObjectMetadata, simplifyUserInfo, addPaginationToQuery } from '../utils/index.js';

// Get Salesforce credentials from environment variables
const SF_CLIENT_ID = process.env.SF_CLIENT_ID;
const SF_CLIENT_SECRET = process.env.SF_CLIENT_SECRET;
const SF_USERNAME = process.env.SF_USERNAME;
const SF_PASSWORD = process.env.SF_PASSWORD;
const SF_LOGIN_URL = process.env.SF_LOGIN_URL || 'https://login.salesforce.com';

if (!SF_CLIENT_ID || !SF_CLIENT_SECRET || !SF_USERNAME || !SF_PASSWORD) {
  throw new Error('Missing required Salesforce environment variables');
}

export class SalesforceClient {
  private conn: jsforce.Connection;

  constructor() {
    this.conn = new jsforce.Connection({
      loginUrl: SF_LOGIN_URL
    });
  }

  async initialize() {
    try {
      await this.conn.login(SF_USERNAME!, SF_PASSWORD!);
    } catch (error: any) {
      throw new Error(`Salesforce login failed: ${error?.message || 'Unknown error'}`);
    }
  }

  async executeQuery(soql: string, pagination?: PaginationParams) {
    try {
      const paginatedQuery = addPaginationToQuery(soql, pagination);
      const result = await this.conn.query(paginatedQuery);
      return paginateResults(result.records, pagination || {});
    } catch (error: any) {
      throw new Error(`SOQL query failed: ${error?.message || 'Unknown error'}`);
    }
  }

  async describeObject(objectName: string, includeFields: boolean = false): Promise<SimplifiedObject> {
    try {
      const metadata = await this.conn.describe(objectName);
      return simplifyObjectMetadata({
        ...metadata,
        fields: includeFields ? metadata.fields : undefined
      });
    } catch (error: any) {
      throw new Error(`Object describe failed: ${error?.message || 'Unknown error'}`);
    }
  }

  async createRecord(objectName: string, data: Record<string, any>) {
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
    try {
      const userInfo = await this.conn.identity();
      return simplifyUserInfo(userInfo);
    } catch (error: any) {
      throw new Error(`Get user info failed: ${error?.message || 'Unknown error'}`);
    }
  }

  async listObjects(pagination?: PaginationParams) {
    try {
      const result = await this.conn.describeGlobal();
      return paginateResults(
        result.sobjects.map(obj => simplifyObjectMetadata(obj)),
        pagination || {}
      );
    } catch (error: any) {
      throw new Error(`List objects failed: ${error?.message || 'Unknown error'}`);
    }
  }
}
