import { SalesforceClient } from '../client/salesforce-client.js';
import { simpleResponse } from '../utils/response-helper.js';

export async function handleGetUserInfo(client: SalesforceClient) {
  const userInfo = await client.getUserInfo() as unknown as Record<string, unknown>;
  const name = (userInfo.display_name || userInfo.Name || 'User') as string;

  const lines = [`# ${name}`];
  for (const [key, val] of Object.entries(userInfo)) {
    if (val != null && val !== '') {
      lines.push(`**${key}:** ${val}`);
    }
  }

  return simpleResponse(lines.join('\n'), 'get_user_info', userInfo);
}
