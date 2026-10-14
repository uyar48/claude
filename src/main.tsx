import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { boot } from './data/runtime';
import { App } from './ui/App';
import './ui/styles.css';

const root = createRoot(document.getElementById('root')!);

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch((err) => console.warn('SW registration failed', err));
}

boot()
  .then((rt) => {
    root.render(
      <StrictMode>
        <App runtime={rt} />
      </StrictMode>,
    );
  })
  .catch((err) => {
    console.error(err);
    root.render(
      <div className="screen center">
        <h1>Uygulama açılamadı</h1>
        <p className="muted">Sayfayı yenilemeyi dene. Sorun sürerse tarayıcı verisi engelleniyor olabilir.</p>
        <pre className="small">{String(err?.message ?? err)}</pre>
      </div>,
    );
  });
