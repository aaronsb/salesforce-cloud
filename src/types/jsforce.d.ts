declare module 'jsforce' {
  export interface Connection {
    login(username: string, password: string): Promise<any>;
    query(soql: string): Promise<any>;
    describe(objectName: string): Promise<any>;
    identity(): Promise<any>;
    describeGlobal(): Promise<any>;
    sobject(objectName: string): {
      create(data: any): Promise<any>;
      update(data: any): Promise<any>;
      destroy(id: string): Promise<any>;
    };
  }

  export class Connection {
    constructor(config: { loginUrl: string });
  }
}
