import { handleUserAiRequest } from '../server/aiRouteHandlers.js';

export default function handler(request: any, response: any): Promise<void> {
  return handleUserAiRequest(request, response);
}
