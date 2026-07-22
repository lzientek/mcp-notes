import { useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { NoteDetail } from '../components/NoteDetail.js';

export function NoteDetailPage() {
  const { noteId } = useParams<{ noteId: string }>();
  const navigate = useNavigate();

  const handleBack = useCallback(() => {
    navigate('/');
  }, [navigate]);

  if (!noteId) {
    navigate('/', { replace: true });
    return null;
  }

  return <NoteDetail noteId={noteId} onBack={handleBack} />;
}
