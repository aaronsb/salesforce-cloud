declare module 'jsforce' {
  export interface OAuth2Config {
    clientId: string;
    clientSecret: string;
    loginUrl?: string;
  }

  export interface ConnectionConfig {
    loginUrl: string;
    oauth2?: OAuth2Config;
  }

  export interface SObjectCRUD {
    create(data: any): Promise<any>;
    update(data: any): Promise<any>;
    destroy(id: string): Promise<any>;
  }

  export interface ConnectionInterface {
    login(username: string, password: string): Promise<any>;
    query(soql: string): Promise<any>;
    describe(objectName: string): Promise<any>;
    identity(): Promise<any>;
    describeGlobal(): Promise<any>;
    sobject(objectName: string): SObjectCRUD;
  }

  export class Connection implements ConnectionInterface {
    constructor(config: ConnectionConfig);
    login(username: string, password: string): Promise<any>;
    authorize(params: { grant_type: string }): Promise<any>;
    query(soql: string): Promise<any>;
    describe(objectName: string): Promise<any>;
    identity(): Promise<any>;
    describeGlobal(): Promise<any>;
    sobject(objectName: string): SObjectCRUD;
  }
}
