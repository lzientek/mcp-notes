import { useState, useCallback } from 'react';

interface DateFilterProps {
  onFilterChange: (from: string | null, to: string | null) => void;
}

type Preset = 'all' | 'week' | 'month' | 'custom';

function getWeekStart(): string {
  const d = new Date();
  d.setDate(d.getDate() - d.getDay() + 1);
  return d.toISOString().split('T')[0];
}

function getMonthStart(): string {
  const d = new Date();
  d.setDate(1);
  return d.toISOString().split('T')[0];
}

export function DateFilter({ onFilterChange }: DateFilterProps) {
  const [preset, setPreset] = useState<Preset>('all');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');

  const handlePreset = useCallback(
    (p: Preset) => {
      setPreset(p);
      if (p === 'all') {
        onFilterChange(null, null);
      } else if (p === 'week') {
        onFilterChange(getWeekStart(), null);
      } else if (p === 'month') {
        onFilterChange(getMonthStart(), null);
      }
    },
    [onFilterChange],
  );

  const handleCustomApply = useCallback(() => {
    onFilterChange(customFrom || null, customTo || null);
  }, [customFrom, customTo, onFilterChange]);

  return (
    <div className="date-filter" role="group" aria-label="Filtrer par date">
      <div className="date-presets">
        <button
          type="button"
          className={`preset-btn ${preset === 'all' ? 'active' : ''}`}
          onClick={() => handlePreset('all')}
        >
          Tout
        </button>
        <button
          type="button"
          className={`preset-btn ${preset === 'week' ? 'active' : ''}`}
          onClick={() => handlePreset('week')}
        >
          Cette semaine
        </button>
        <button
          type="button"
          className={`preset-btn ${preset === 'month' ? 'active' : ''}`}
          onClick={() => handlePreset('month')}
        >
          Ce mois-ci
        </button>
        <button
          type="button"
          className={`preset-btn ${preset === 'custom' ? 'active' : ''}`}
          onClick={() => setPreset('custom')}
        >
          Personnalisé
        </button>
      </div>
      {preset === 'custom' && (
        <div className="date-custom">
          <label htmlFor="date-from">Du</label>
          <input
            id="date-from"
            type="date"
            value={customFrom}
            onChange={(e) => setCustomFrom(e.target.value)}
          />
          <label htmlFor="date-to">Au</label>
          <input
            id="date-to"
            type="date"
            value={customTo}
            onChange={(e) => setCustomTo(e.target.value)}
          />
          <button type="button" onClick={handleCustomApply}>
            Appliquer
          </button>
        </div>
      )}
    </div>
  );
}
