import { pyodideService } from './pyodideService';

// Função para converter urlencoded form body em objeto JS
function parseFormBody(body: any): any {
  if (!body) return {};
  if (typeof body === 'string') {
    const params: any = {};
    const urlParams = new URLSearchParams(body);
    urlParams.forEach((val, key) => {
      params[key] = val;
    });
    return params;
  }
  return body;
}

export function setupHtmxWasmBridge() {
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  const originalSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;

  // Sobrescreve o método Open
  XMLHttpRequest.prototype.open = function(
    method: string,
    url: string | URL,
    async?: boolean,
    username?: string | null,
    password?: string | null
  ) {
    // Guarda URL e Método na instância
    (this as any)._method = method;
    (this as any)._url = url.toString();
    (this as any)._headers = {};
    
    // @ts-ignore
    return originalOpen.apply(this, [method, url, async !== false, username, password]);
  };

  // Sobrescreve o SetRequestHeader
  XMLHttpRequest.prototype.setRequestHeader = function(header: string, value: string) {
    (this as any)._headers = (this as any)._headers || {};
    (this as any)._headers[header.toLowerCase()] = value;
    // @ts-ignore
    return originalSetRequestHeader.apply(this, [header, value]);
  };

  // Sobrescreve o método Send
  XMLHttpRequest.prototype.send = function(body?: any) {
    const url = (this as any)._url || '';
    const method = (this as any)._method || 'GET';

    // Intercepta requisições direcionadas à nossa API Python WASM
    if (url.startsWith('/api/wasm')) {
      const urlObj = new URL(url, window.location.origin);
      const path = urlObj.pathname;
      
      // Converte parâmetros da QueryString
      let params: any = {};
      urlObj.searchParams.forEach((val, key) => {
        params[key] = val;
      });

      // Converte parâmetros do Body se for POST/PUT
      if (body && (method === 'POST' || method === 'PUT')) {
        const parsedBody = parseFormBody(body);
        params = { ...params, ...parsedBody };
      }

      // Executa de forma assíncrona para simular delay de rede real e não travar o loop de render
      setTimeout(async () => {
        try {
          const htmlResponse = await pyodideService.handleRequest(path, method, params);
          
          // Sobrescreve as propriedades de resposta do XHR
          Object.defineProperties(this, {
            status: { value: 200, writable: false },
            statusText: { value: 'OK', writable: false },
            readyState: { value: 4, writable: false },
            responseText: { value: htmlResponse, writable: false },
            response: { value: htmlResponse, writable: false },
            getResponseHeader: { 
              value: (headerName: string) => {
                if (headerName.toLowerCase() === 'content-type') return 'text/html';
                return null;
              }, 
              writable: false 
            },
            getAllResponseHeaders: {
              value: () => 'content-type: text/html\r\n',
              writable: false
            }
          });

          // Dispara os eventos de conclusão do XHR
          if (typeof this.onreadystatechange === 'function') {
            this.onreadystatechange({} as Event);
          }
          if (typeof this.onload === 'function') {
            this.onload({} as ProgressEvent);
          }
          
          this.dispatchEvent(new Event('readystatechange'));
          this.dispatchEvent(new Event('load'));
        } catch (err: any) {
          console.error("Erro na interceptação do XHR para o WASM:", err);
          
          Object.defineProperties(this, {
            status: { value: 500, writable: false },
            statusText: { value: 'Internal Server Error', writable: false },
            readyState: { value: 4, writable: false },
            responseText: { value: `<div class="p-4 text-rose-500 bg-rose-950/20 border border-rose-900 rounded-lg">Erro na ponte WASM: ${err.message}</div>`, writable: false }
          });

          if (typeof this.onreadystatechange === 'function') {
            this.onreadystatechange({} as Event);
          }
          if (typeof this.onerror === 'function') {
            this.onerror({} as ProgressEvent);
          }
          this.dispatchEvent(new Event('readystatechange'));
          this.dispatchEvent(new Event('error'));
        }
      }, 50); // Delay simulado de 50ms para fidelidade visual
      
      return;
    }

    // Se não for uma requisição para o WASM, segue o fluxo de rede padrão
    return originalSend.apply(this, [body]);
  };
}
