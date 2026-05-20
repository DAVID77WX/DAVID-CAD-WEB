// @ts-ignore
import pythonCode from '../simulation/automation.py?raw';

export interface AutomationState {
  grid_voltage: number;
  grid_frequency: number;
  total_power: number;
  alarm_active: boolean;
  alarm_message: string;
  plc_logic_enabled: boolean;
  [key: string]: any; // Allow custom component values (speeds, temps, etc.)
}

export interface TelemetryData {
  state: AutomationState;
  logs: string[];
  plcCode: string;
  energizedNodes: { [nodeId: string]: string }; // Maps node ID to electrical potential (L1, L2, L3, N, PE, +, -)
  activeComponents: { [compId: string]: boolean }; // Indicates if coils, lamps, motors, etc. are energized
  shortCircuited: boolean;
}

class PyodideService {
  private pyodide: any = null;
  private isLoaded = false;
  private listeners: ((data: TelemetryData) => void)[] = [];
  private tickInterval: any = null;
  private lastTelemetry: TelemetryData | null = null;

  async init(onProgress: (msg: string) => void) {
    if (this.isLoaded) return;
    
    try {
      onProgress("Carregando Pyodide WebAssembly...");
      // @ts-ignore
      this.pyodide = await window.loadPyodide();
      
      onProgress("Carregando Bibliotecas Standard...");
      await this.pyodide.loadPackage("micropip");
      
      onProgress("Instanciando Simulação Elétrica em Python...");
      // Executa o script python no contexto global do Pyodide
      await this.pyodide.runPythonAsync(pythonCode);
      
      this.isLoaded = true;
      onProgress("Simulação Pronta!");
      
      // Inicia o timer da simulação física (roda a cada 500ms)
      this.startTicker();
    } catch (error) {
      console.error("Falha ao inicializar o Pyodide WASM:", error);
      onProgress("Falha ao inicializar o interpretador Python WASM.");
      throw error;
    }
  }

  private startTicker() {
    if (this.tickInterval) clearInterval(this.tickInterval);
    
    this.tickInterval = setInterval(async () => {
      if (!this.isLoaded) return;
      try {
        // Atualiza a simulação física rodando o loop no Python
        this.pyodide.runPython("sys.update_simulation()");
        
        // Notifica listeners
        const data = await this.getTelemetry();
        this.lastTelemetry = data;
        this.listeners.forEach(cb => cb(data));
      } catch (err) {
        console.error("Erro no loop de simulação Python:", err);
      }
    }, 500); // 500ms ticks for interactive responsiveness
  }

  subscribe(callback: (data: TelemetryData) => void) {
    this.listeners.push(callback);
    // Trigger immediate call with last telemetry if available
    if (this.lastTelemetry) {
      callback(this.lastTelemetry);
    }
    return () => {
      this.listeners = this.listeners.filter(cb => cb !== callback);
    };
  }

  async getTelemetry(): Promise<TelemetryData> {
    if (!this.isLoaded) throw new Error("Pyodide WASM não carregado.");
    const jsonStr = this.pyodide.runPython('sys.handle_request("/api/wasm/telemetry", "GET", None)');
    return JSON.parse(jsonStr);
  }

  async handleRequest(path: string, method: string, params: any = {}): Promise<string> {
    if (!this.isLoaded) {
      return `<div class="p-4 text-rose-400 bg-rose-950/40 border border-rose-900 rounded-lg">Erro: Interpretador Python WASM ainda não inicializado.</div>`;
    }
    
    try {
      const paramsJson = JSON.stringify(params);
      // Escapa aspas e barras para passar para o Python
      const escapedJson = paramsJson.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      const pythonCommand = `sys.handle_request("${path}", "${method}", '${escapedJson}')`;
      const htmlResponse = this.pyodide.runPython(pythonCommand);
      
      // Força uma atualização imediata para os inscritos após um comando de escrita
      if (method === "POST") {
        const data = await this.getTelemetry();
        this.lastTelemetry = data;
        this.listeners.forEach(cb => cb(data));
      }
      
      return htmlResponse;
    } catch (error: any) {
      console.error(`Erro ao processar requisição WASM no caminho ${path}:`, error);
      return `<div class="p-4 text-rose-400 bg-rose-950/40 border border-rose-900 rounded-lg">
        <strong>Erro no Python WASM:</strong>
        <pre class="mt-2 text-xs font-mono whitespace-pre-wrap">${error.message}</pre>
      </div>`;
    }
  }

  async uploadSchematic(components: any[], wires: any[]): Promise<void> {
    await this.handleRequest("/api/wasm/schematic/update", "POST", { components, wires });
  }

  getPlcCode(): string {
    if (!this.isLoaded) return "";
    return this.pyodide.runPython("sys.plc_code");
  }
}

export const pyodideService = new PyodideService();
