import { useState, useCallback } from 'react';
import type { Folder } from '../types.js';

interface FolderFilterProps {
  folders: Folder[];
  selectedFolderId: string | null;
  onFilterChange: (folderId: string | null) => void;
  onCreateFolder: (name: string) => void;
  onDeleteFolder: (folderId: string) => void;
}

export function FolderFilter({
  folders,
  selectedFolderId,
  onFilterChange,
  onCreateFolder,
  onDeleteFolder,
}: FolderFilterProps) {
  const [isCreating, setIsCreating] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');

  const handleCreate = useCallback(() => {
    const name = newFolderName.trim();
    if (name) {
      onCreateFolder(name);
      setNewFolderName('');
      setIsCreating(false);
    }
  }, [newFolderName, onCreateFolder]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        handleCreate();
      } else if (e.key === 'Escape') {
        setIsCreating(false);
        setNewFolderName('');
      }
    },
    [handleCreate],
  );

  return (
    <div className="folder-filter" role="group" aria-label="Filtrer par dossier">
      <div className="folder-filter-list">
        <button
          type="button"
          className={`folder-chip ${selectedFolderId === null ? 'active' : ''}`}
          onClick={() => onFilterChange(null)}
          aria-pressed={selectedFolderId === null}
        >
          Tous
        </button>
        <button
          type="button"
          className={`folder-chip ${selectedFolderId === 'root' ? 'active' : ''}`}
          onClick={() => onFilterChange('root')}
          aria-pressed={selectedFolderId === 'root'}
        >
          Sans dossier
        </button>
        {folders.map((folder) => (
          <span key={folder.folderId} className="folder-chip-wrapper">
            <button
              type="button"
              className={`folder-chip ${selectedFolderId === folder.folderId ? 'active' : ''}`}
              onClick={() => onFilterChange(folder.folderId)}
              aria-pressed={selectedFolderId === folder.folderId}
            >
              📁 {folder.name}
            </button>
            <button
              type="button"
              className="folder-delete-btn"
              onClick={(e) => {
                e.stopPropagation();
                onDeleteFolder(folder.folderId);
              }}
              aria-label={`Supprimer le dossier ${folder.name}`}
              title="Supprimer"
            >
              ×
            </button>
          </span>
        ))}
      </div>

      {isCreating ? (
        <div className="folder-create-form">
          <input
            type="text"
            className="folder-create-input"
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Nom du dossier…"
            autoFocus
            maxLength={100}
          />
          <button type="button" className="folder-create-confirm" onClick={handleCreate}>
            ✓
          </button>
          <button
            type="button"
            className="folder-create-cancel"
            onClick={() => {
              setIsCreating(false);
              setNewFolderName('');
            }}
          >
            ✕
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="folder-add-btn"
          onClick={() => setIsCreating(true)}
          aria-label="Créer un dossier"
        >
          + Dossier
        </button>
      )}
    </div>
  );
}
