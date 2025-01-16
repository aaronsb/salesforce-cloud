import { PaginationParams, SimplifiedObject, SimplifiedUserInfo } from '../types/index.js';

export function paginateResults<T>(
  results: T[],
  { pageSize = 25, pageNumber = 1 }: PaginationParams
) {
  const startIndex = (pageNumber - 1) * pageSize;
  const endIndex = startIndex + pageSize;
  const paginatedResults = results.slice(startIndex, endIndex);

  return {
    totalCount: results.length,
    pageSize,
    pageNumber,
    totalPages: Math.ceil(results.length / pageSize),
    results: paginatedResults,
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
    queryable: metadata.queryable,
    ...(metadata.fields && {
      fields: metadata.fields.map((field: any) => ({
        name: field.name,
        label: field.label,
        type: field.type,
        custom: field.custom,
        required: !field.nillable,
      })),
    }),
  };
}

export function simplifyUserInfo(userInfo: any): SimplifiedUserInfo {
  return {
    id: userInfo.user_id,
    username: userInfo.username,
    displayName: userInfo.display_name,
    email: userInfo.email,
    organizationId: userInfo.organization_id,
  };
}

export function buildFieldList(fields?: string[]): string {
  return fields?.join(', ') || 'Id, Name';
}

export function addPaginationToQuery(query: string, pagination?: PaginationParams): string {
  if (!pagination) return query;

  const { pageSize = 25, pageNumber = 1 } = pagination;
  const offset = (pageNumber - 1) * pageSize;

  // Check if query already has LIMIT or OFFSET
  const hasLimit = /\bLIMIT\b/i.test(query);
  const hasOffset = /\bOFFSET\b/i.test(query);

  let paginatedQuery = query;

  if (!hasLimit) {
    paginatedQuery += ` LIMIT ${pageSize}`;
  }

  if (!hasOffset && offset > 0) {
    paginatedQuery += ` OFFSET ${offset}`;
  }

  return paginatedQuery;
}
