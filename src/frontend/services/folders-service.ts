import { apiGet, apiPost, apiDelete } from './api-client.js';
import type { FoldersListResponse, Folder } from '../types.js';

export async function fetchFolders(): Promise<FoldersListResponse> {
  return apiGet<FoldersListResponse>('/folders');
}

export async function createFolder(name: string): Promise<Folder> {
  return apiPost<Folder>('/folders', { name });
}

export async function deleteFolder(folderId: string): Promise<void> {
  return apiDelete(`/folders/${encodeURIComponent(folderId)}`);
}
