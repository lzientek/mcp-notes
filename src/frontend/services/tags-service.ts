import { apiGet } from './api-client.js';
import type { TagsListResponse } from '../types.js';

export async function fetchTags(): Promise<TagsListResponse> {
  return apiGet<TagsListResponse>('/tags');
}
