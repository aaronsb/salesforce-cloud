export interface PaginationParams {
  pageSize?: number;
  pageNumber?: number;
}

export interface PaginatedResponse<T> {
  records: T[];
  totalSize: number;
  pageInfo: {
    currentPage: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
}

export interface SimplifiedField {
  name: string;
  label: string;
  type: string;
  required: boolean;
  updateable: boolean;
  defaultValue?: any;
}

export interface SimplifiedObject {
  name: string;
  label: string;
  custom: boolean;
  createable: boolean;
  updateable: boolean;
  deletable: boolean;
  fields?: SimplifiedField[];
}

export interface SimplifiedUserInfo {
  id: string;
  username: string;
  email: string;
  name: string;
  organization: {
    id: string;
    name: string;
  };
}
