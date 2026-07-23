import { createRoot } from 'react-dom/client';
import { AppRouter } from './Router.js';
import './styles.css';
import './dashboard.css';

const root = createRoot(document.getElementById('root')!);
root.render(<AppRouter />);
