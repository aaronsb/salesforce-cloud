export interface PaginationParams {
  pageSize?: number;
  pageNumber?: number;
}

export interface SimplifiedObject {
  name: string;
  label: string;
  custom: boolean;
  createable: boolean;
  updateable: boolean;
  deletable: boolean;
  queryable: boolean;
  fields?: Array<{
    name: string;
    label: string;
    type: string;
    custom: boolean;
    required: boolean;
  }>;
}

export interface PaginatedSimplifiedObject extends Omit<SimplifiedObject, 'fields'> {
  fields?: Array<{
    name: string;
    label: string;
    type: string;
    custom: boolean;
    required: boolean;
  }>;
  totalFields?: number;
  pageInfo?: {
    currentPage: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
}

export interface SimplifiedUserInfo {
  id: string;
  username: string;
  displayName: string;
  email: string;
  organizationId: string;
}
