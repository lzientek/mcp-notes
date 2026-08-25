import { useCallback } from 'react';
import type { Tag } from '../types.js';

interface TagFilterProps {
  tags: Tag[];
  selectedTags: string[];
  onFilterChange: (selectedTags: string[]) => void;
}

export function TagFilter({ tags, selectedTags, onFilterChange }: TagFilterProps) {
  const toggleTag = useCallback(
    (tagName: string) => {
      const updated = selectedTags.includes(tagName)
        ? selectedTags.filter((t) => t !== tagName)
        : [...selectedTags, tagName];
      onFilterChange(updated);
    },
    [selectedTags, onFilterChange],
  );

  if (tags.length === 0) return null;

  return (
    <div className="tag-filter" role="group" aria-label="Filtrer par tags">
      {tags.map((tag) => (
        <button
          key={tag.tagId}
          type="button"
          className={`tag-chip ${selectedTags.includes(tag.name) ? 'active' : ''}`}
          onClick={() => toggleTag(tag.name)}
          aria-pressed={selectedTags.includes(tag.name)}
        >
          {tag.name}
        </button>
      ))}
    </div>
  );
}
