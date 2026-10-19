import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../app/styles.css';
import './lab.css';
import { LabApp } from './LabApp';

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <LabApp />
  </StrictMode>,
);
