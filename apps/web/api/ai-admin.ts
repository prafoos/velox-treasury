import { handleAdminAiRequest } from './ai';

export default function handler(request: any, response: any): Promise<void> {
  return handleAdminAiRequest(request, response);
}
