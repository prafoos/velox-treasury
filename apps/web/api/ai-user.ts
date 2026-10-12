import { handleUserAiRequest } from './ai';

export default function handler(request: any, response: any): Promise<void> {
  return handleUserAiRequest(request, response);
}
