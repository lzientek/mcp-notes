import { useState, useCallback } from 'react';

interface SearchBarProps {
  onSearch: (query: string) => void;
}

export function SearchBar({ onSearch }: SearchBarProps) {
  const [query, setQuery] = useState('');

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      onSearch(query);
    },
    [query, onSearch],
  );

  const handleClear = useCallback(() => {
    setQuery('');
    onSearch('');
  }, [onSearch]);

  return (
    <form className="search-bar" onSubmit={handleSubmit} role="search">
      <input
        type="search"
        placeholder="Rechercher dans vos notes..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Rechercher dans vos notes"
      />
      <button type="submit" aria-label="Lancer la recherche">
        🔍
      </button>
      {query && (
        <button type="button" onClick={handleClear} aria-label="Effacer la recherche">
          ✕
        </button>
      )}
    </form>
  );
}
