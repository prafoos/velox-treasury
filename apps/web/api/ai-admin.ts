import { handleAdminAiRequest } from '../server/aiRouteHandlers.js';

export default function handler(request: any, response: any): Promise<void> {
  return handleAdminAiRequest(request, response);
}
