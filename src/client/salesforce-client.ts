import jsforce from 'jsforce';
import { PaginationParams, SimplifiedObject, SimplifiedUserInfo } from '../types/index.js';
import { paginateResults, simplifyObjectMetadata, simplifyUserInfo, addPaginationToQuery } from '../utils/index.js';

export class SalesforceClient {
  private SF_CLIENT_ID: string;
  private SF_CLIENT_SECRET: string;
  private SF_USERNAME: string;
  private SF_PASSWORD: string;
  private SF_LOGIN_URL: string;
  private conn!: jsforce.Connection;

  constructor() {
    this.SF_CLIENT_ID = process.env.SF_CLIENT_ID || '';
    this.SF_CLIENT_SECRET = process.env.SF_CLIENT_SECRET || '';
    this.SF_USERNAME = process.env.SF_USERNAME || '';
    this.SF_PASSWORD = process.env.SF_PASSWORD || '';
    this.SF_LOGIN_URL = process.env.SF_LOGIN_URL || 'https://login.salesforce.com';

    this.conn = new jsforce.Connection({
      loginUrl: this.SF_LOGIN_URL
    });
  }

  async initialize() {
    if (!this.SF_CLIENT_ID || !this.SF_CLIENT_SECRET || !this.SF_USERNAME || !this.SF_PASSWORD) {
      throw new Error('Missing required Salesforce environment variables');
    }
    try {
      await this.conn.login(this.SF_USERNAME, this.SF_PASSWORD);
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
        result.sobjects.map((obj: any) => simplifyObjectMetadata(obj)),
        pagination || {}
      );
    } catch (error: any) {
      throw new Error(`List objects failed: ${error?.message || 'Unknown error'}`);
    }
  }
}
