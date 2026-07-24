import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

type LLMChoice = 'claude-ext' | 'claude' | 'kiro' | 'cursor' | 'windsurf' | 'other';

interface LLMOption {
  id: LLMChoice;
  name: string;
  icon: string;
  description: string;
}

const LLM_OPTIONS: LLMOption[] = [
  { id: 'claude-ext', name: 'Claude', icon: '/static/logos/claude.svg', description: 'Extension' },
  { id: 'claude', name: 'Claude', icon: '/static/logos/claude.svg', description: 'Manuel' },
  { id: 'kiro', name: 'Kiro', icon: '/static/logos/kiro.png', description: 'AWS' },
  { id: 'cursor', name: 'Cursor', icon: '/static/logos/cursor.svg', description: 'Editor' },
  { id: 'windsurf', name: 'Windsurf', icon: '/static/logos/windsurf.svg', description: 'Codeium' },
  { id: 'other', name: 'Autre MCP', icon: '', description: 'Générique' },
];

function getInstructions(choice: LLMChoice): { steps: string[]; config?: string; note?: string } {
  switch (choice) {
    case 'claude-ext':
      return {
        steps: [
          'Téléchargez le fichier .mcpb depuis la dernière release GitHub',
          'Double-cliquez sur le fichier téléchargé',
          'Claude Desktop installe l\'extension automatiquement',
          'Dans Claude, demandez : "Connecte-moi à Notlai via web"',
        ],
        note: 'C\'est la méthode la plus simple — aucune configuration manuelle nécessaire.',
      };
    case 'claude':
      return {
        steps: [
          'Ouvrez votre fichier de configuration Claude Desktop',
          'Ajoutez la configuration ci-dessous',
          'Redémarrez Claude Desktop',
          'Dans Claude, demandez : "Connecte-moi à Notlai via web"',
        ],
        config: JSON.stringify({
          mcpServers: {
            notlai: {
              command: 'npx',
              args: ['-y', 'notlai-mcp'],
            },
          },
        }, null, 2),
        note: 'Fichier de config : ~/Library/Application Support/Claude/claude_desktop_config.json (macOS) ou %APPDATA%\\Claude\\claude_desktop_config.json (Windows)',
      };
    case 'kiro':
      return {
        steps: [
          'Créez ou éditez le fichier .kiro/settings/mcp.json dans votre workspace',
          'Ajoutez la configuration ci-dessous',
          'Kiro détecte automatiquement le nouveau serveur MCP',
          'Demandez à Kiro : "Connecte-moi à Notlai via web"',
        ],
        config: JSON.stringify({
          mcpServers: {
            notlai: {
              command: 'npx',
              args: ['-y', 'notlai-mcp'],
            },
          },
        }, null, 2),
        note: 'Pour un accès global (tous les workspaces) : ~/.kiro/settings/mcp.json',
      };
    case 'cursor':
      return {
        steps: [
          'Ouvrez Settings > MCP Servers > Add',
          'Ajoutez la configuration ci-dessous',
          'Redémarrez Cursor',
          'Demandez à l\'assistant : "Connecte-moi à Notlai via web"',
        ],
        config: JSON.stringify({
          notlai: {
            command: 'npx',
            args: ['-y', 'notlai-mcp'],
          },
        }, null, 2),
      };
    case 'windsurf':
      return {
        steps: [
          'Éditez ~/.codeium/windsurf/mcp_config.json',
          'Ajoutez la configuration ci-dessous',
          'Redémarrez Windsurf',
          'Demandez à l\'assistant : "Connecte-moi à Notlai via web"',
        ],
        config: JSON.stringify({
          mcpServers: {
            notlai: {
              command: 'npx',
              args: ['-y', 'notlai-mcp'],
            },
          },
        }, null, 2),
      };
    case 'other':
      return {
        steps: [
          'Configurez votre client MCP pour lancer la commande ci-dessous via stdio',
          'Le serveur communique via stdin/stdout avec le protocole MCP',
          'Une fois connecté, demandez à votre assistant : "Connecte-moi à Notlai via web"',
          'Ouvrez le lien fourni dans votre navigateur pour vous authentifier',
        ],
        config: 'npx -y notlai-mcp',
        note: 'Compatible avec tout client supportant le Model Context Protocol (MCP) via stdio.',
      };
  }
}

export function SetupPage() {
  const navigate = useNavigate();
  const [selected, setSelected] = useState<LLMChoice | null>(null);
  const [copied, setCopied] = useState(false);

  const instructions = selected ? getInstructions(selected) : null;

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="setup-page">
      <div className="setup-header">
        <a href="/" aria-label="Retour à l'accueil">
          <img src="/static/notlai_logo_text_right.png" alt="Notlai" className="setup-logo" />
        </a>
      </div>

      <div className="setup-content">
        <div className="setup-intro">
          <h1>Configurez votre assistant IA</h1>
          <p>Votre compte est prêt ! Choisissez votre assistant pour commencer à prendre des notes.</p>
        </div>

        <div className="setup-grid">
          {LLM_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              type="button"
              className={`setup-option ${selected === opt.id ? 'active' : ''}`}
              onClick={() => { setSelected(opt.id); setCopied(false); }}
            >
              {opt.icon ? (
                <img src={opt.icon} alt={opt.name} className="setup-option-icon" />
              ) : (
                <span className="setup-option-icon setup-option-icon-plug">MCP</span>
              )}
              <span className="setup-option-name">{opt.name}</span>
              <span className="setup-option-desc">{opt.description}</span>
            </button>
          ))}
        </div>

        {!instructions && (
          <div className="setup-placeholder">
            <div className="setup-placeholder-icon">👆</div>
            <p>Sélectionnez votre assistant IA pour voir les instructions d'installation</p>
          </div>
        )}

        {instructions && (
          <div className="setup-instructions">
            <h2>Étapes d'installation</h2>

            <ol className="setup-steps">
              {instructions.steps.map((step, i) => (
                <li key={i}>{step}</li>
              ))}
            </ol>

            {instructions.config && (
              <div className="setup-config">
                <div className="setup-config-header">
                  <span>Configuration</span>
                  <button
                    type="button"
                    className="setup-copy-btn"
                    onClick={() => handleCopy(instructions.config!)}
                  >
                    {copied ? '✓ Copié' : 'Copier'}
                  </button>
                </div>
                <pre><code>{instructions.config}</code></pre>
              </div>
            )}

            {selected === 'claude-ext' && (
              <a
                href="https://github.com/lzientek/notlai-mcp/releases/latest"
                target="_blank"
                rel="noopener noreferrer"
                className="setup-download-btn"
              >
                Télécharger l'extension (.mcpb)
              </a>
            )}

            {instructions.note && (
              <p className="setup-note">{instructions.note}</p>
            )}

            <div className="setup-next">
              <p>Une fois connecté, votre assistant pourra créer, rechercher et organiser vos notes automatiquement.</p>
              <button
                type="button"
                className="setup-login-btn"
                onClick={() => navigate('/login')}
              >
                Aller à la connexion web
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
