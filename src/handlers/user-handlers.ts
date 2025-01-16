import { SalesforceClient } from '../client/salesforce-client.js';

export async function handleGetUserInfo(client: SalesforceClient) {
  const userInfo = await client.getUserInfo();

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(userInfo, null, 2),
      },
    ],
  };
}
