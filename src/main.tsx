import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { setupHtmxWasmBridge } from './wasm/htmxWasmBridge';

// Inicializa a interceptação de requisições do HTMX para rodar localmente no Python WASM
setupHtmxWasmBridge();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
