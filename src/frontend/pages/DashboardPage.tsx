import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Dashboard } from '../components/Dashboard.js';

export function DashboardPage() {
  const navigate = useNavigate();

  const handleSelectNote = useCallback(
    (noteId: string) => {
      void navigate(`/notes/${noteId}`);
    },
    [navigate],
  );

  return <Dashboard onSelectNote={handleSelectNote} />;
}
