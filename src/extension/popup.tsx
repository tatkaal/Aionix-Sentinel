import { createRoot } from 'react-dom/client';
import '../shared/brand/tokens.css';
import { AonixLogo } from '../shared/brand/AonixLogo';

createRoot(document.getElementById('root')!).render(
  <div className="flex items-center gap-2 p-4">
    <AonixLogo />
    <span className="font-display font-semibold">Aonix Sentinel</span>
  </div>,
);
