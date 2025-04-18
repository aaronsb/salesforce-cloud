declare module 'jsforce' {
  export interface ConnectionConfig {
    loginUrl: string;
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
    query(soql: string): Promise<any>;
    describe(objectName: string): Promise<any>;
    identity(): Promise<any>;
    describeGlobal(): Promise<any>;
    sobject(objectName: string): SObjectCRUD;
  }
}
