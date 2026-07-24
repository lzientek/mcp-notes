import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

type LLMChoice = 'claude-ext' | 'claude' | 'kiro' | 'cursor' | 'windsurf' | 'other';

interface LLMOption {
  id: LLMChoice;
  name: string;
  icon: React.ReactNode;
  description: string;
}

// SVG icons for each LLM
const ClaudeIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
    <path d="M16.5 3.5C13.5 2 10 2.5 7.5 4.5C5 6.5 3.5 9.5 4 13C4.5 16.5 7 19.5 10.5 20.5C14 21.5 17.5 20 19.5 17C21.5 14 21.5 10 19.5 7C18.5 5.5 17.5 4.5 16.5 3.5Z" fill="#D97706"/>
    <path d="M14.5 8L10 16M10 8L14.5 16" stroke="white" strokeWidth="1.5" strokeLinecap="round"/>
  </svg>
);

const KiroIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
    <rect x="3" y="3" width="18" height="18" rx="4" fill="#FF9900"/>
    <path d="M8 8L12 12L8 16M13 16H17" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

const CursorIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
    <rect x="2" y="2" width="20" height="20" rx="5" fill="#1f1f1f"/>
    <path d="M8 7V17L12 14L14 17.5L16 16.5L14 13L18 12L8 7Z" fill="white"/>
  </svg>
);

const WindsurfIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
    <rect x="2" y="2" width="20" height="20" rx="5" fill="#00C7B7"/>
    <path d="M7 16C9 14 11 13 14 13C16 13 18 14 19 15M6 12C8.5 9.5 11 9 14 9.5C16.5 10 18.5 11 20 12.5" stroke="white" strokeWidth="1.8" strokeLinecap="round"/>
  </svg>
);

const PlugIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
    <rect x="2" y="2" width="20" height="20" rx="5" fill="#6366f1"/>
    <path d="M9 5V8M15 5V8M7 10H17M7 10V14C7 16.8 9.2 19 12 19C14.8 19 17 16.8 17 14V10" stroke="white" strokeWidth="1.5" strokeLinecap="round"/>
  </svg>
);

const LLM_OPTIONS: LLMOption[] = [
  { id: 'claude-ext', name: 'Claude', icon: <ClaudeIcon />, description: 'Extension' },
  { id: 'claude', name: 'Claude', icon: <ClaudeIcon />, description: 'Manuel' },
  { id: 'kiro', name: 'Kiro', icon: <KiroIcon />, description: 'AWS' },
  { id: 'cursor', name: 'Cursor', icon: <CursorIcon />, description: 'Editor' },
  { id: 'windsurf', name: 'Windsurf', icon: <WindsurfIcon />, description: 'Codeium' },
  { id: 'other', name: 'Autre MCP', icon: <PlugIcon />, description: 'Générique' },
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
        <img src="/static/notlai_logo_text_right.png" alt="Notlai" className="setup-logo" />
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
              <span className="setup-option-icon">{opt.icon}</span>
              <span className="setup-option-name">{opt.name}</span>
              <span className="setup-option-desc">{opt.description}</span>
            </button>
          ))}
        </div>

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
