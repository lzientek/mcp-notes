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

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <a href="/" aria-label="Retour à la liste des notes">
          <img src="/static/notlai_logo_text_right.png" alt="Notlai" className="logo" />
        </a>
      </header>
      <NoteDetail noteId={noteId} onBack={handleBack} />
    </div>
  );
}
