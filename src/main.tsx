import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerServiceWorker } from './audio/offline';
import { preloadSelected } from './audio/sound';
import { App } from './app/App';
import './app/styles.css';

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// 畫面出來之後才做：註冊離線快取、在空檔預載吉他取樣
window.addEventListener('load', () => {
  void registerServiceWorker();
  preloadSelected();
});
