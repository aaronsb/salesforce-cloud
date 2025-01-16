import { PaginationParams, PaginatedResponse, SimplifiedField, SimplifiedObject, SimplifiedUserInfo } from './types.js';

export function paginateResults<T>(
  records: T[],
  { pageSize = 25, pageNumber = 1 }: PaginationParams
): PaginatedResponse<T> {
  const totalSize = records.length;
  const totalPages = Math.ceil(totalSize / pageSize);
  const normalizedPage = Math.min(Math.max(1, pageNumber), totalPages);
  
  const startIndex = (normalizedPage - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, totalSize);
  
  return {
    records: records.slice(startIndex, endIndex),
    totalSize,
    pageInfo: {
      currentPage: normalizedPage,
      totalPages,
      hasNextPage: normalizedPage < totalPages,
      hasPreviousPage: normalizedPage > 1
    }
  };
}

export function simplifyObjectMetadata(metadata: any): SimplifiedObject {
  return {
    name: metadata.name,
    label: metadata.label,
    custom: metadata.custom,
    createable: metadata.createable,
    updateable: metadata.updateable,
    deletable: metadata.deletable,
    fields: metadata.fields?.map(simplifyField)
  };
}

export function simplifyField(field: any): SimplifiedField {
  return {
    name: field.name,
    label: field.label,
    type: field.type,
    required: field.required,
    updateable: field.updateable,
    defaultValue: field.defaultValue
  };
}

export function simplifyUserInfo(userInfo: any): SimplifiedUserInfo {
  return {
    id: userInfo.id,
    username: userInfo.username,
    email: userInfo.email,
    name: `${userInfo.firstName} ${userInfo.lastName}`.trim(),
    organization: {
      id: userInfo.organization_id,
      name: userInfo.organization_name
    }
  };
}

export function buildFieldList(fields?: string[]): string {
  if (!fields || fields.length === 0) {
    return 'Id, Name';  // Default fields
  }
  return fields.join(', ');
}

export function addPaginationToQuery(query: string, pagination?: PaginationParams): string {
  if (!pagination) {
    return query;
  }
  
  const { pageSize = 25, pageNumber = 1 } = pagination;
  const offset = (pageNumber - 1) * pageSize;
  
  return `${query} LIMIT ${pageSize} OFFSET ${offset}`;
}
