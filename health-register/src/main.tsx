import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import './styles.css';

registerSW({ immediate: true });

// عودة من صفحة 404 في GitHub Pages: نستعيد المسار المطلوب قبل تشغيل الموجّه
const r = new URLSearchParams(location.search).get('r');
if (r !== null) history.replaceState(null, '', import.meta.env.BASE_URL + r + location.hash);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
