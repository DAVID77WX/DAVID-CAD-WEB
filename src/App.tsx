import React, { useEffect, useState, useRef } from 'react';
import { pyodideService, TelemetryData } from './wasm/pyodideService';
import { 
  Zap, 
  Settings, 
  AlertTriangle, 
  Play, 
  Square, 
  RefreshCw, 
  Plus, 
  Trash2, 
  RotateCw, 
  Maximize, 
  Grid, 
  Download, 
  Upload, 
  FileText, 
  BookOpen, 
  Layers 
} from 'lucide-react';

interface ComponentItem {
  id: string;
  type: string;
  x: number;
  y: number;
  rotation: number; // 0, 90, 180, 270
  label: string;
  value?: string;
}

interface WireItem {
  id: string;
  fromComponentId: string;
  fromTerminalId: string;
  toComponentId: string;
  toTerminalId: string;
  wireType: 'phase' | 'neutral' | 'ground' | 'dc_pos' | 'dc_neg';
}

const getComponentTerminals = (c: ComponentItem | { type: string }) => {
  const ctype = c.type;
  if (ctype.startsWith('source_')) return ['1'];
  if (ctype === 'breaker_3p' || ctype === 'contactor_contacts_no_power') return ['1', '2', '3', '4', '5', '6'];
  if (ctype === 'motor_3ph') return ['U', 'V', 'W', 'PE'];
  if (ctype === 'motor_1ph') return ['U', 'N', 'PE'];
  if (ctype === 'pushbutton_no') return ['3', '4'];
  if (ctype === 'pushbutton_nc') return ['1', '2'];
  if (ctype === 'selector_switch_no') return ['3', '4'];
  if (ctype === 'contactor_contacts_no') return ['13', '14'];
  if (ctype === 'contactor_contacts_nc') return ['11', '12'];
  if (ctype === 'overload_relay_contacts_nc') return ['95', '96'];
  if (ctype === 'overload_relay_contacts_no') return ['97', '98'];
  if (ctype === 'timer_contacts_no') return ['15', '18'];
  if (ctype === 'timer_contacts_nc') return ['15', '16'];
  if (ctype === 'contactor_coil' || ctype === 'relay_coil' || ctype === 'timer_coil') return ['A1', 'A2'];
  if (ctype === 'lamp' || ctype === 'buzzer') return ['X1', 'X2'];
  if (ctype === 'plc_input') return ['IN', 'COM'];
  if (ctype === 'plc_output') return ['1', '2'];
  return ['1', '2'];
};

export default function App() {
  const [loading, setLoading] = useState(true);
  const [loadMessage, setLoadMessage] = useState("Inicializando interpretador...");
  const [telemetry, setTelemetry] = useState<TelemetryData | null>(null);
  
  // CAD State
  const [components, setComponents] = useState<ComponentItem[]>([]);
  const [wires, setWires] = useState<WireItem[]>([]);
  const [isSimulating, setIsSimulating] = useState(false);
  
  // Editor Viewport
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [gridVisible, setGridVisible] = useState(true);
  const [snapToGrid, setSnapToGrid] = useState(true);
  const [activeTool, setActiveTool] = useState<'select' | 'wire' | string>('select');
  const [wireType, setWireType] = useState<'phase' | 'neutral' | 'ground' | 'dc_pos' | 'dc_neg'>('phase');
  
  // Selection
  const [selectedComponentId, setSelectedComponentId] = useState<string | null>(null);
  const [selectedWireId, setSelectedWireId] = useState<string | null>(null);
  const [draggedComponentId, setDraggedComponentId] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  
  // Wiring Temporary State
  const [wireStart, setWireStart] = useState<{ componentId: string; terminalId: string; x: number; y: number } | null>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [hoveredTerminal, setHoveredTerminal] = useState<{ componentId: string; terminalId: string; x: number; y: number } | null>(null);
  
  // AutoCAD Command Prompt
  const [cmdInput, setCmdInput] = useState("");
  const [commandHistory, setCommandHistory] = useState<string[]>([
    "--- CAD DAVID v2.0 SYSTEM INITIALIZED ---",
    "Digite HELP para listar os comandos AutoCAD disponíveis no simulador."
  ]);
  
  // PLC Script IDE
  const [plcCode, setPlcCode] = useState("");
  
  const canvasRef = useRef<SVGSVGElement>(null);
  const cliHistoryEndRef = useRef<HTMLDivElement>(null);

  // Initialize Pyodide
  useEffect(() => {
    pyodideService.init((msg) => {
      setLoadMessage(msg);
      if (msg === "Simulação Pronta!") {
        setTimeout(() => {
          setLoading(false);
          setPlcCode(pyodideService.getPlcCode());
          // Load default direct starter schematic
          loadPreset("direct_online");
        }, 600);
      }
    });

    const unsubscribe = pyodideService.subscribe((data) => {
      setTelemetry(data);
    });

    return () => {
      unsubscribe();
    };
  }, []);

  // Sync schematic components and wires with Pyodide on change when simulating
  useEffect(() => {
    if (!loading) {
      pyodideService.uploadSchematic(components, wires);
    }
  }, [components, wires, loading]);

  // Command History Auto-scroll
  useEffect(() => {
    if (cliHistoryEndRef.current) {
      cliHistoryEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [commandHistory]);

  // Terminal Snap bounds helper
  const getTerminalPos = (comp: ComponentItem, termId: string) => {
    // Relative coordinates based on rotation
    let rx = 0;
    let ry = 0;
    
    // Relative terminal layouts of symbols
    const ctype = comp.type;
    if (ctype.startsWith('source_')) {
      ry = 20;
    } else if (ctype === 'breaker_3p' || ctype === 'contactor_contacts_no_power') {
      const mapping: { [key: string]: { x: number; y: number } } = {
        '1': { x: -30, y: -20 }, '2': { x: -30, y: 20 },
        '3': { x: 0, y: -20 }, '4': { x: 0, y: 20 },
        '5': { x: 30, y: -20 }, '6': { x: 30, y: 20 }
      };
      rx = mapping[termId]?.x || 0;
      ry = mapping[termId]?.y || 0;
    } else if (ctype === 'motor_3ph') {
      const mapping: { [key: string]: { x: number; y: number } } = {
        'U': { x: -20, y: -30 }, 'V': { x: 0, y: -30 }, 'W': { x: 20, y: -30 }, 'PE': { x: 0, y: 30 }
      };
      rx = mapping[termId]?.x || 0;
      ry = mapping[termId]?.y || 0;
    } else if (ctype === 'motor_1ph') {
      const mapping: { [key: string]: { x: number; y: number } } = {
        'U': { x: -15, y: -30 }, 'N': { x: 15, y: -30 }, 'PE': { x: 0, y: 30 }
      };
      rx = mapping[termId]?.x || 0;
      ry = mapping[termId]?.y || 0;
    } else if (ctype === 'contactor_contacts_no') {
      rx = 0; ry = termId === '13' ? -20 : 20;
    } else if (ctype === 'contactor_contacts_nc') {
      rx = 0; ry = termId === '11' ? -20 : 20;
    } else if (ctype === 'overload_relay_contacts_nc') {
      rx = 0; ry = termId === '95' ? -20 : 20;
    } else if (ctype === 'overload_relay_contacts_no') {
      rx = 0; ry = termId === '97' ? -20 : 20;
    } else if (ctype === 'timer_contacts_no') {
      rx = 0; ry = termId === '15' ? -20 : 20;
    } else if (ctype === 'timer_contacts_nc') {
      rx = 0; ry = termId === '15' ? -20 : 20;
    } else if (ctype === 'pushbutton_no' || ctype === 'selector_switch_no') {
      rx = 0; ry = termId === '3' ? -20 : 20;
    } else if (ctype === 'pushbutton_nc') {
      rx = 0; ry = termId === '1' ? -20 : 20;
    } else if (ctype in ['contactor_coil', 'relay_coil', 'timer_coil']) {
      rx = 0; ry = termId === 'A1' ? -20 : 20;
    } else if (ctype in ['lamp', 'buzzer']) {
      rx = 0; ry = termId === 'X1' ? -20 : 20;
    } else if (ctype === 'plc_input') {
      rx = 0; ry = termId === 'IN' ? -20 : 20;
    } else if (ctype === 'plc_output') {
      rx = 0; ry = termId === '1' ? -20 : 20;
    } else {
      // standard 2 terminals
      rx = 0; ry = termId === '1' ? -20 : 20;
    }
    
    // Rotate relative terminal positions
    let rxRot = rx;
    let ryRot = ry;
    const rad = (comp.rotation * Math.PI) / 180;
    rxRot = rx * Math.cos(rad) - ry * Math.sin(rad);
    ryRot = rx * Math.sin(rad) + ry * Math.cos(rad);
    
    return {
      x: comp.x + rxRot,
      y: comp.y + ryRot
    };
  };

  // Manhattan wire routing helper
  const getWirePath = (w: WireItem) => {
    const fromComp = components.find(c => c.id === w.fromComponentId);
    const toComp = components.find(c => c.id === w.toComponentId);
    if (!fromComp || !toComp) return "";
    
    const start = getTerminalPos(fromComp, w.fromTerminalId);
    const end = getTerminalPos(toComp, w.toTerminalId);
    
    // Smooth orthogonal routing
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    
    if (Math.abs(dx) > Math.abs(dy)) {
      const midX = start.x + dx / 2;
      return `M ${start.x} ${start.y} L ${midX} ${start.y} L ${midX} ${end.y} L ${end.x} ${end.y}`;
    } else {
      const midY = start.y + dy / 2;
      return `M ${start.x} ${start.y} L ${start.x} ${midY} L ${end.x} ${midY} L ${end.x} ${end.y}`;
    }
  };

  // Snap position to 20px CAD grid
  const snapToGridVal = (val: number) => {
    if (!snapToGrid) return val;
    return Math.round(val / 20) * 20;
  };

  // Canvas interaction handlers
  const handleCanvasMouseDown = (e: React.MouseEvent<SVGSVGElement>) => {
    if (activeTool === 'select') {
      const target = e.target as SVGElement;
      const compId = target.getAttribute('data-component-id');
      const wireId = target.getAttribute('data-wire-id');
      
      if (compId) {
        setSelectedComponentId(compId);
        setSelectedWireId(null);
        setDraggedComponentId(compId);
        const comp = components.find(c => c.id === compId)!;
        
        // Calculate click coordinates in scaled view
        const rect = canvasRef.current!.getBoundingClientRect();
        const clientX = (e.clientX - rect.left - pan.x) / zoom;
        const clientY = (e.clientY - rect.top - pan.y) / zoom;
        
        setDragOffset({
          x: clientX - comp.x,
          y: clientY - comp.y
        });
      } else if (wireId) {
        setSelectedWireId(wireId);
        setSelectedComponentId(null);
      } else {
        setSelectedComponentId(null);
        setSelectedWireId(null);
      }
    } else if (activeTool === 'wire') {
      if (hoveredTerminal) {
        if (!wireStart) {
          setWireStart(hoveredTerminal);
        } else {
          // Connect terminals
          if (wireStart.componentId !== hoveredTerminal.componentId || wireStart.terminalId !== hoveredTerminal.terminalId) {
            const newWire: WireItem = {
              id: `wire_${Date.now()}`,
              fromComponentId: wireStart.componentId,
              fromTerminalId: wireStart.terminalId,
              toComponentId: hoveredTerminal.componentId,
              toTerminalId: hoveredTerminal.terminalId,
              wireType: wireType
            };
            setWires(prev => [...prev, newWire]);
            setCommandHistory(prev => [...prev, `Condutor conectado: ${wireStart.componentId}:${wireStart.terminalId} -> ${hoveredTerminal.componentId}:${hoveredTerminal.terminalId}`]);
          }
          setWireStart(null);
          setActiveTool('select');
        }
      } else {
        // Clicked in empty space, cancel line
        setWireStart(null);
      }
    } else {
      // Placer mode: click to add component
      const rect = canvasRef.current!.getBoundingClientRect();
      const x = snapToGridVal((e.clientX - rect.left - pan.x) / zoom);
      const y = snapToGridVal((e.clientY - rect.top - pan.y) / zoom);
      
      const newLabel = generateTag(activeTool);
      const newComp: ComponentItem = {
        id: `comp_${Date.now()}`,
        type: activeTool,
        x,
        y,
        rotation: 0,
        label: newLabel,
        value: activeTool === 'timer_coil' ? '5s' : ''
      };
      
      setComponents(prev => [...prev, newComp]);
      setActiveTool('select');
      setCommandHistory(prev => [...prev, `Componente ${newLabel} (${activeTool}) adicionado em (${x}, ${y}).`]);
    }
  };

  const handleCanvasMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const x = (e.clientX - rect.left - pan.x) / zoom;
    const y = (e.clientY - rect.top - pan.y) / zoom;
    
    setMousePos({ x, y });
    
    // Component drag update
    if (draggedComponentId) {
      const snappedX = snapToGridVal(x - dragOffset.x);
      const snappedY = snapToGridVal(y - dragOffset.y);
      setComponents(prev => prev.map(c => c.id === draggedComponentId ? { ...c, x: snappedX, y: snappedY } : c));
    }
    
    // Snapping to terminal dots
    let snapFound = false;
    for (const c of components) {
      const terms = getComponentTerminals(c);
      for (const t of terms) {
        const tpos = getTerminalPos(c, t);
        const dist = Math.hypot(tpos.x - x, tpos.y - y);
        if (dist < 12) { // 12px snap radius
          setHoveredTerminal({ componentId: c.id, terminalId: t, x: tpos.x, y: tpos.y });
          snapFound = true;
          break;
        }
      }
      if (snapFound) break;
    }
    if (!snapFound) {
      setHoveredTerminal(null);
    }
  };

  const handleCanvasMouseUp = () => {
    setDraggedComponentId(null);
  };

  // Generate standard component tag sequence
  const generateTag = (type: string) => {
    const counts = components.filter(c => c.type === type).length + 1;
    if (type.startsWith('source_')) return type.replace('source_', '').toUpperCase();
    if (type.startsWith('breaker_')) return `Q${counts}`;
    if (type === 'fuse') return `F${counts}`;
    if (type.startsWith('pushbutton_')) return `S${counts}`;
    if (type === 'selector_switch_no') return `S${counts}`;
    if (type === 'contactor_coil') return `KM${counts}`;
    if (type === 'relay_coil') return `KA${counts}`;
    if (type === 'timer_coil') return `KT${counts}`;
    if (type.startsWith('motor_')) return `M${counts}`;
    if (type === 'lamp') return `H${counts}`;
    if (type === 'buzzer') return `HA${counts}`;
    if (type === 'plc_input') return `I${counts-1}`;
    if (type === 'plc_output') return `Q${counts-1}`;
    return `K${counts}`;
  };

  // Keyboard handlers
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Delete') {
      triggerErase();
    }
  };

  const triggerErase = () => {
    if (selectedComponentId) {
      const comp = components.find(c => c.id === selectedComponentId);
      setComponents(prev => prev.filter(c => c.id !== selectedComponentId));
      // Delete wires connected to deleted component
      setWires(prev => prev.filter(w => w.fromComponentId !== selectedComponentId && w.toComponentId !== selectedComponentId));
      setSelectedComponentId(null);
      setCommandHistory(prev => [...prev, `Componente ${comp?.label || selectedComponentId} apagado.`]);
    } else if (selectedWireId) {
      setWires(prev => prev.filter(w => w.id !== selectedWireId));
      setSelectedWireId(null);
      setCommandHistory(prev => [...prev, "Condutor apagado."]);
    }
  };

  const rotateSelectedComponent = () => {
    if (selectedComponentId) {
      setComponents(prev => prev.map(c => c.id === selectedComponentId ? { ...c, rotation: (c.rotation + 90) % 360 } : c));
      setCommandHistory(prev => [...prev, "Componente rotacionado em 90 graus."]);
    }
  };

  // AutoCAD Command Prompt Interpreter
  const handleCommandExecute = (e: React.FormEvent) => {
    e.preventDefault();
    const cmd = cmdInput.trim();
    if (!cmd) return;
    
    setCommandHistory(prev => [...prev, `Comando: ${cmd}`]);
    setCmdInput("");
    
    const parts = cmd.toUpperCase().split(/\s+/);
    const primary = parts[0];
    
    switch (primary) {
      case 'HELP':
      case 'HELP?':
      case 'AJUDA':
        setCommandHistory(prev => [
          ...prev,
          "Comandos suportados pelo CAD DAVID CLI:",
          "  L / LINE / FIO - Desenhar fiação",
          "  ADD <tipo> [tag] - Adicionar componente (ex: ADD MOTOR_3PH M1)",
          "  DEL / ERASE - Apagar elemento selecionado",
          "  ROTATE / R - Girar componente selecionado (90°)",
          "  GRID - Esconder ou mostrar o grid quadriculado",
          "  SNAP - Alternar encaixe magnético no grid (20px)",
          "  RUN / SIM - Iniciar simulação elétrica e CLP",
          "  STOP / PARAR - Parar a simulação física",
          "  RESET - Rearmar relés e limpar alarmes",
          "  CLEAR / LIMPAR - Apagar todo o projeto atual"
        ]);
        break;
      case 'L':
      case 'LINE':
      case 'FIO':
        setActiveTool('wire');
        setCommandHistory(prev => [...prev, "Modo de fiação LINE ativado. Aproxime-se dos terminais para conectar."]);
        break;
      case 'ADD':
        if (parts.length < 2) {
          setCommandHistory(prev => [...prev, "Erro: especifique o tipo. Ex: ADD MOTOR_3PH"]);
        } else {
          const type = parts[1].toLowerCase();
          const label = parts[2] || type.toUpperCase();
          const newComp: ComponentItem = {
            id: `comp_${Date.now()}`,
            type: type,
            x: 200,
            y: 200,
            rotation: 0,
            label: label
          };
          setComponents(prev => [...prev, newComp]);
          setCommandHistory(prev => [...prev, `Adicionado ${label} em (200, 200). Use arrastar para posicionar.`]);
        }
        break;
      case 'DEL':
      case 'ERASE':
      case 'APAGAR':
        triggerErase();
        break;
      case 'R':
      case 'ROTATE':
      case 'GIRAR':
        rotateSelectedComponent();
        break;
      case 'GRID':
        setGridVisible(!gridVisible);
        setCommandHistory(prev => [...prev, `Grid ${!gridVisible ? 'Visível' : 'Oculto'}.`]);
        break;
      case 'SNAP':
        setSnapToGrid(!snapToGrid);
        setCommandHistory(prev => [...prev, `Encaixe magnético ${!snapToGrid ? 'Ligado' : 'Desligado'}.`]);
        break;
      case 'RUN':
      case 'SIM':
        setIsSimulating(true);
        setCommandHistory(prev => [...prev, "Simulação e CLP ativados."]);
        break;
      case 'STOP':
      case 'PARAR':
        setIsSimulating(false);
        setCommandHistory(prev => [...prev, "Simulação parada."]);
        break;
      case 'RESET':
        pyodideService.handleRequest("/api/wasm/alarm/reset", "POST");
        setCommandHistory(prev => [...prev, "Alarmes e trips de sobrecarga rearmados."]);
        break;
      case 'CLEAR':
      case 'LIMPAR':
        setComponents([]);
        setWires([]);
        setSelectedComponentId(null);
        setSelectedWireId(null);
        setCommandHistory(prev => [...prev, "Tela limpa."]);
        break;
      default:
        setCommandHistory(prev => [...prev, `Comando inválido "${primary}". Digite HELP para auxílio.`]);
    }
  };

  // Compile PLC python logic
  const handlePlcSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await pyodideService.handleRequest("/api/wasm/plc/update", "POST", { plcCode });
  };

  // Toggles component button/switches manually when clicked in SIM mode
  const handleComponentClick = async (comp: ComponentItem) => {
    if (!isSimulating) {
      setSelectedComponentId(comp.id);
      setSelectedWireId(null);
      return;
    }
    
    if (['pushbutton_no', 'pushbutton_nc', 'selector_switch_no'].includes(comp.type)) {
      await pyodideService.handleRequest("/api/wasm/component/toggle", "POST", { componentId: comp.id });
    } else {
      setSelectedComponentId(comp.id);
      setSelectedWireId(null);
    }
  };

  // Preset Loaders
  const loadPreset = (presetName: string) => {
    setSelectedComponentId(null);
    setSelectedWireId(null);
    setWireStart(null);
    
    if (presetName === 'direct_online') {
      // 1. Direct Online Starter Components
      const newComps: ComponentItem[] = [
        // Power sources
        { id: 'l1', type: 'source_l1', x: 80, y: 40, rotation: 0, label: 'L1' },
        { id: 'l2', type: 'source_l2', x: 120, y: 40, rotation: 0, label: 'L2' },
        { id: 'l3', type: 'source_l3', x: 160, y: 40, rotation: 0, label: 'L3' },
        { id: 'pe_power', type: 'source_pe', x: 200, y: 40, rotation: 0, label: 'PE' },
        
        // 3-pole breaker
        { id: 'q1', type: 'breaker_3p', x: 120, y: 120, rotation: 0, label: 'Q1' },
        
        // 3-pole contactor contact
        { id: 'km1_power', type: 'contactor_contacts_no_power', x: 120, y: 220, rotation: 0, label: 'KM1', value: 'KM1' },
        
        // 3-phase motor
        { id: 'm1', type: 'motor_3ph', x: 120, y: 340, rotation: 0, label: 'M1' },
        
        // CONTROL CIRCUIT
        // Sources
        { id: 'ctrl_l1', type: 'source_l1', x: 320, y: 40, rotation: 0, label: 'L1' },
        { id: 'ctrl_n', type: 'source_n', x: 320, y: 460, rotation: 0, label: 'N' },
        
        // Overload NC
        { id: 'f1_thermal', type: 'overload_relay_contacts_nc', x: 320, y: 100, rotation: 0, label: 'F1', value: 'M1' },
        
        // Push buttons
        { id: 's0_stop', type: 'pushbutton_nc', x: 320, y: 180, rotation: 0, label: 'S0_STOP' },
        { id: 's1_start', type: 'pushbutton_no', x: 320, y: 260, rotation: 0, label: 'S1_START' },
        
        // Contactor holding NO contact
        { id: 'km1_aux', type: 'contactor_contacts_no', x: 420, y: 260, rotation: 0, label: 'KM1', value: 'KM1' },
        
        // Contactor Coil
        { id: 'km1_coil', type: 'contactor_coil', x: 320, y: 360, rotation: 0, label: 'KM1' },
        
        // Indicator Lamp
        { id: 'h1_lamp', type: 'lamp', x: 420, y: 360, rotation: 0, label: 'H1', value: 'green' }
      ];

      // 2. Direct Online Starter Wires
      const newWires: WireItem[] = [
        // Power Circuit
        { id: 'w1', fromComponentId: 'l1', fromTerminalId: '1', toComponentId: 'q1', toTerminalId: '1', wireType: 'phase' },
        { id: 'w2', fromComponentId: 'l2', fromTerminalId: '1', toComponentId: 'q1', toTerminalId: '3', wireType: 'phase' },
        { id: 'w3', fromComponentId: 'l3', fromTerminalId: '1', toComponentId: 'q1', toTerminalId: '5', wireType: 'phase' },
        
        { id: 'w4', fromComponentId: 'q1', fromTerminalId: '2', toComponentId: 'km1_power', toTerminalId: '1', wireType: 'phase' },
        { id: 'w5', fromComponentId: 'q1', fromTerminalId: '4', toComponentId: 'km1_power', toTerminalId: '3', wireType: 'phase' },
        { id: 'w6', fromComponentId: 'q1', fromTerminalId: '6', toComponentId: 'km1_power', toTerminalId: '5', wireType: 'phase' },
        
        { id: 'w7', fromComponentId: 'km1_power', fromTerminalId: '2', toComponentId: 'm1', toTerminalId: 'U', wireType: 'phase' },
        { id: 'w8', fromComponentId: 'km1_power', fromTerminalId: '4', toComponentId: 'm1', toTerminalId: 'V', wireType: 'phase' },
        { id: 'w9', fromComponentId: 'km1_power', fromTerminalId: '6', toComponentId: 'm1', toTerminalId: 'W', wireType: 'phase' },
        { id: 'w10', fromComponentId: 'pe_power', fromTerminalId: '1', toComponentId: 'm1', toTerminalId: 'PE', wireType: 'ground' },
        
        // Control Circuit
        { id: 'wc1', fromComponentId: 'ctrl_l1', fromTerminalId: '1', toComponentId: 'f1_thermal', toTerminalId: '95', wireType: 'phase' },
        { id: 'wc2', fromComponentId: 'f1_thermal', fromTerminalId: '96', toComponentId: 's0_stop', toTerminalId: '1', wireType: 'phase' },
        { id: 'wc3', fromComponentId: 's0_stop', fromTerminalId: '2', toComponentId: 's1_start', toTerminalId: '3', wireType: 'phase' },
        { id: 'wc4', fromComponentId: 's0_stop', fromTerminalId: '2', toComponentId: 'km1_aux', toTerminalId: '13', wireType: 'phase' },
        
        { id: 'wc5', fromComponentId: 's1_start', fromTerminalId: '4', toComponentId: 'km1_coil', toTerminalId: 'A1', wireType: 'phase' },
        { id: 'wc6', fromComponentId: 'km1_aux', fromTerminalId: '14', toComponentId: 'km1_coil', toTerminalId: 'A1', wireType: 'phase' },
        { id: 'wc7', fromComponentId: 'km1_aux', fromTerminalId: '14', toComponentId: 'h1_lamp', toTerminalId: 'X1', wireType: 'phase' },
        
        { id: 'wc8', fromComponentId: 'km1_coil', fromTerminalId: 'A2', toComponentId: 'ctrl_n', toTerminalId: '1', wireType: 'neutral' },
        { id: 'wc9', fromComponentId: 'h1_lamp', fromTerminalId: 'X2', toComponentId: 'ctrl_n', toTerminalId: '1', wireType: 'neutral' }
      ];
      
      setComponents(newComps);
      setWires(newWires);
      setCommandHistory(prev => [...prev, "Carregado Preset: Partida Direta Trifásica"]);
      
      setPlcCode(`# Código CLP - CAD DAVID\n# I0 = S1 (Liga)\n# I1 = S0 (Desliga)\n# Q0 = KM1 (Coil)\n\n# (Lógica física em relés operada em paralelo)`);
      
    } else if (presetName === 'star_delta') {
      // Automatic Star-Delta Starter
      const newComps: ComponentItem[] = [
        { id: 'l1', type: 'source_l1', x: 80, y: 40, rotation: 0, label: 'L1' },
        { id: 'l2', type: 'source_l2', x: 120, y: 40, rotation: 0, label: 'L2' },
        { id: 'l3', type: 'source_l3', x: 160, y: 40, rotation: 0, label: 'L3' },
        
        { id: 'q1', type: 'breaker_3p', x: 120, y: 120, rotation: 0, label: 'Q1' },
        { id: 'km1', type: 'contactor_contacts_no_power', x: 120, y: 220, rotation: 0, label: 'KM1', value: 'KM1' },
        { id: 'm1', type: 'motor_3ph', x: 120, y: 340, rotation: 0, label: 'M1' },
        
        // Control Circuit
        { id: 'l_ctrl', type: 'source_l1', x: 300, y: 40, rotation: 0, label: 'L1' },
        { id: 'n_ctrl', type: 'source_n', x: 300, y: 440, rotation: 0, label: 'N' },
        
        { id: 's0', type: 'pushbutton_nc', x: 300, y: 100, rotation: 0, label: 'S0' },
        { id: 's1', type: 'pushbutton_no', x: 300, y: 180, rotation: 0, label: 'S1' },
        { id: 'km1_aux', type: 'contactor_contacts_no', x: 380, y: 180, rotation: 0, label: 'KM1', value: 'KM1' },
        
        { id: 'kt1_coil', type: 'timer_coil', x: 300, y: 260, rotation: 0, label: 'KT1', value: '3s' },
        { id: 'km1_coil', type: 'contactor_coil', x: 380, y: 260, rotation: 0, label: 'KM1' },
        
        { id: 'kt1_nc', type: 'timer_contacts_nc', x: 300, y: 340, rotation: 0, label: 'KT1', value: 'KT1' },
        { id: 'kt1_no', type: 'timer_contacts_no', x: 380, y: 340, rotation: 0, label: 'KT1', value: 'KT1' },
        
        { id: 'km2_coil', type: 'contactor_coil', x: 300, y: 400, rotation: 0, label: 'KM2' }, // Star contactor
        { id: 'km3_coil', type: 'contactor_coil', x: 380, y: 400, rotation: 0, label: 'KM3' }  // Delta contactor
      ];
      
      const newWires: WireItem[] = [
        { id: 'w1', fromComponentId: 'l1', fromTerminalId: '1', toComponentId: 'q1', toTerminalId: '1', wireType: 'phase' },
        { id: 'w2', fromComponentId: 'l2', fromTerminalId: '1', toComponentId: 'q1', toTerminalId: '3', wireType: 'phase' },
        { id: 'w3', fromComponentId: 'l3', fromTerminalId: '1', toComponentId: 'q1', toTerminalId: '5', wireType: 'phase' },
        { id: 'w4', fromComponentId: 'q1', fromTerminalId: '2', toComponentId: 'km1', toTerminalId: '1', wireType: 'phase' },
        { id: 'w5', fromComponentId: 'q1', fromTerminalId: '4', toComponentId: 'km1', toTerminalId: '3', wireType: 'phase' },
        { id: 'w6', fromComponentId: 'q1', fromTerminalId: '6', toComponentId: 'km1', toTerminalId: '5', wireType: 'phase' },
        { id: 'w7', fromComponentId: 'km1', fromTerminalId: '2', toComponentId: 'm1', toTerminalId: 'U', wireType: 'phase' },
        { id: 'w8', fromComponentId: 'km1', fromTerminalId: '4', toComponentId: 'm1', toTerminalId: 'V', wireType: 'phase' },
        { id: 'w9', fromComponentId: 'km1', fromTerminalId: '6', toComponentId: 'm1', toTerminalId: 'W', wireType: 'phase' },
        
        { id: 'wc1', fromComponentId: 'l_ctrl', fromTerminalId: '1', toComponentId: 's0', toTerminalId: '1', wireType: 'phase' },
        { id: 'wc2', fromComponentId: 's0', fromTerminalId: '2', toComponentId: 's1', toTerminalId: '3', wireType: 'phase' },
        { id: 'wc3', fromComponentId: 's0', fromTerminalId: '2', toComponentId: 'km1_aux', toTerminalId: '13', wireType: 'phase' },
        { id: 'wc4', fromComponentId: 's1', fromTerminalId: '4', toComponentId: 'km1_coil', toTerminalId: 'A1', wireType: 'phase' },
        { id: 'wc5', fromComponentId: 'km1_aux', fromTerminalId: '14', toComponentId: 'km1_coil', toTerminalId: 'A1', wireType: 'phase' },
        { id: 'wc6', fromComponentId: 's1', fromTerminalId: '4', toComponentId: 'kt1_coil', toTerminalId: 'A1', wireType: 'phase' },
        
        { id: 'wc7', fromComponentId: 'km1_coil', fromTerminalId: 'A1', toComponentId: 'kt1_nc', toTerminalId: '15', wireType: 'phase' },
        { id: 'wc8', fromComponentId: 'km1_coil', fromTerminalId: 'A1', toComponentId: 'kt1_no', toTerminalId: '15', wireType: 'phase' },
        { id: 'wc9', fromComponentId: 'kt1_nc', fromTerminalId: '16', toComponentId: 'km2_coil', toTerminalId: 'A1', wireType: 'phase' },
        { id: 'wc10', fromComponentId: 'kt1_no', fromTerminalId: '18', toComponentId: 'km3_coil', toTerminalId: 'A1', wireType: 'phase' },
        
        { id: 'wc11', fromComponentId: 'kt1_coil', fromTerminalId: 'A2', toComponentId: 'n_ctrl', toTerminalId: '1', wireType: 'neutral' },
        { id: 'wc12', fromComponentId: 'km1_coil', fromTerminalId: 'A2', toComponentId: 'n_ctrl', toTerminalId: '1', wireType: 'neutral' },
        { id: 'wc13', fromComponentId: 'km2_coil', fromTerminalId: 'A2', toComponentId: 'n_ctrl', toTerminalId: '1', wireType: 'neutral' },
        { id: 'wc14', fromComponentId: 'km3_coil', fromTerminalId: 'A2', toComponentId: 'n_ctrl', toTerminalId: '1', wireType: 'neutral' }
      ];
      
      setComponents(newComps);
      setWires(newWires);
      setCommandHistory(prev => [...prev, "Carregado Preset: Partida Estrela-Triângulo com Temporizador"]);
      
      setPlcCode(`# Lógica CLP do David para comutação rápida`);
    } else if (presetName === 'reversing') {
      // Reversing Starter Preset
      const newComps: ComponentItem[] = [
        { id: 'l1', type: 'source_l1', x: 80, y: 40, rotation: 0, label: 'L1' },
        { id: 'l2', type: 'source_l2', x: 120, y: 40, rotation: 0, label: 'L2' },
        { id: 'l3', type: 'source_l3', x: 160, y: 40, rotation: 0, label: 'L3' },
        
        { id: 'q1', type: 'breaker_3p', x: 120, y: 120, rotation: 0, label: 'Q1' },
        { id: 'km1_p', type: 'contactor_contacts_no_power', x: 80, y: 220, rotation: 0, label: 'KM1', value: 'KM1' },
        { id: 'km2_p', type: 'contactor_contacts_no_power', x: 180, y: 220, rotation: 0, label: 'KM2', value: 'KM2' },
        { id: 'm1', type: 'motor_3ph', x: 120, y: 340, rotation: 0, label: 'M1' }
      ];
      
      // Simple power reversing wires
      const newWires: WireItem[] = [
        { id: 'w1', fromComponentId: 'l1', fromTerminalId: '1', toComponentId: 'q1', toTerminalId: '1', wireType: 'phase' },
        { id: 'w2', fromComponentId: 'l2', fromTerminalId: '1', toComponentId: 'q1', toTerminalId: '3', wireType: 'phase' },
        { id: 'w3', fromComponentId: 'l3', fromTerminalId: '1', toComponentId: 'q1', toTerminalId: '5', wireType: 'phase' }
      ];
      setComponents(newComps);
      setWires(newWires);
      setCommandHistory(prev => [...prev, "Carregado Preset: Partida Reversora (Esboço de Potência)"]);
    } else if (presetName === 'plc_starter') {
      // PLC Control Preset
      const newComps: ComponentItem[] = [
        { id: 'v24', type: 'source_dc_pos', x: 60, y: 60, rotation: 0, label: '24V' },
        { id: 'v0', type: 'source_dc_neg', x: 300, y: 420, rotation: 0, label: '0V' },
        
        // Push buttons
        { id: 's1', type: 'pushbutton_no', x: 60, y: 160, rotation: 0, label: 'S1_LIGA' },
        { id: 's2', type: 'pushbutton_no', x: 160, y: 160, rotation: 0, label: 'S2_DESLIGA' },
        
        // PLC inputs
        { id: 'plc_i0', type: 'plc_input', x: 60, y: 260, rotation: 0, label: 'I0' },
        { id: 'plc_i1', type: 'plc_input', x: 160, y: 260, rotation: 0, label: 'I1' },
        
        // PLC output
        { id: 'plc_q0', type: 'plc_output', x: 300, y: 160, rotation: 0, label: 'Q0' },
        
        // Load contactor
        { id: 'km1', type: 'contactor_coil', x: 300, y: 300, rotation: 0, label: 'KM1' }
      ];
      
      const newWires: WireItem[] = [
        { id: 'w1', fromComponentId: 'v24', fromTerminalId: '1', toComponentId: 's1', toTerminalId: '3', wireType: 'dc_pos' },
        { id: 'w2', fromComponentId: 'v24', fromTerminalId: '1', toComponentId: 's2', toTerminalId: '3', wireType: 'dc_pos' },
        { id: 'w3', fromComponentId: 's1', fromTerminalId: '4', toComponentId: 'plc_i0', toTerminalId: 'IN', wireType: 'dc_pos' },
        { id: 'w4', fromComponentId: 's2', fromTerminalId: '4', toComponentId: 'plc_i1', toTerminalId: 'IN', wireType: 'dc_pos' },
        
        // PLC Input commons
        { id: 'w5', fromComponentId: 'plc_i0', fromTerminalId: 'COM', toComponentId: 'v0', toTerminalId: '1', wireType: 'dc_neg' },
        { id: 'w6', fromComponentId: 'plc_i1', fromTerminalId: 'COM', toComponentId: 'v0', toTerminalId: '1', wireType: 'dc_neg' },
        
        // PLC output side
        { id: 'w7', fromComponentId: 'v24', fromTerminalId: '1', toComponentId: 'plc_q0', toTerminalId: '1', wireType: 'dc_pos' },
        { id: 'w8', fromComponentId: 'plc_q0', fromTerminalId: '2', toComponentId: 'km1', toTerminalId: 'A1', wireType: 'dc_pos' },
        { id: 'w9', fromComponentId: 'km1', fromTerminalId: 'A2', toComponentId: 'v0', toTerminalId: '1', wireType: 'dc_neg' }
      ];
      
      setComponents(newComps);
      setWires(newWires);
      setCommandHistory(prev => [...prev, "Carregado Preset: Partida Controlada por CLP"]);
      
      setPlcCode(`# Código CLP - CAD DAVID\n# I0 = S1 (Botão Liga)\n# I1 = S2 (Botão Desliga)\n# Q0 = Relé de Saída (Liga Contator KM1)\n\nif I0:\n    Q0 = True\nelif I1:\n    Q0 = False\n`);
    }
  };

  const handleExport = () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify({ components, wires, plcCode }));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", "cad_david_schematic.json");
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
    setCommandHistory(prev => [...prev, "Esquemático exportado com sucesso."]);
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileReader = new FileReader();
    if (e.target.files && e.target.files[0]) {
      fileReader.readAsText(e.target.files[0], "UTF-8");
      fileReader.onload = e => {
        try {
          const parsed = JSON.parse(e.target!.result as string);
          if (parsed.components && parsed.wires) {
            setComponents(parsed.components);
            setWires(parsed.wires);
            if (parsed.plcCode) setPlcCode(parsed.plcCode);
            setCommandHistory(prev => [...prev, "Esquemático importado com sucesso."]);
          }
        } catch (err) {
          setCommandHistory(prev => [...prev, "Erro ao importar arquivo JSON."]);
        }
      };
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#04060b] flex flex-col items-center justify-center p-6 industrial-grid relative">
        <div className="absolute inset-0 bg-gradient-to-t from-[#04060b] via-transparent to-transparent pointer-events-none"></div>
        <div className="z-10 text-center max-w-md w-full bg-[#0b101d]/90 border border-[#1b2a47]/50 rounded-3xl p-8 shadow-2xl backdrop-blur-md relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-cyan-500 via-amber-500 to-rose-500 animate-pulse"></div>
          
          <div className="mb-6 inline-flex p-4 rounded-2xl bg-cyan-950/40 text-cyan-400 border border-cyan-800/40 shadow-glow-cyan animate-pulse">
            <Zap size={40} className="stroke-[1.5]" />
          </div>
          
          <h1 className="text-2xl font-black tracking-wider text-slate-100 mb-2">CAD DAVID <span className="text-cyan-400">v2.0</span></h1>
          <p className="text-xs text-cyan-500/80 font-mono tracking-widest uppercase mb-8">SIMULADOR ELÉTRICO & CLP WASM</p>
          
          <div className="space-y-4">
            <div className="w-full bg-slate-950 h-1.5 rounded-full overflow-hidden border border-slate-900">
              <div className="h-full bg-cyan-500 shadow-glow-cyan animate-pulse rounded-full" style={{ width: '80%' }}></div>
            </div>
            <p className="text-xs font-mono text-slate-400 text-center mt-3 animate-pulse">{loadMessage}</p>
          </div>
        </div>
      </div>
    );
  }

  // Active status cache
  const activeComponents = telemetry?.activeComponents || {};
  const energizedNodes = telemetry?.energizedNodes || {};
  const logs = telemetry?.logs || [];
  const state = (telemetry?.state || { grid_voltage: 380, grid_frequency: 60, total_power: 0, alarm_active: false, alarm_message: "" }) as any;

  return (
    <div className="min-h-screen bg-[#04060b] text-slate-200 flex flex-col font-sans" onKeyDown={handleKeyDown}>
      {/* Header Premium */}
      <header className="border-b border-[#131d31] bg-[#070b14]/90 backdrop-blur-md px-6 h-14 flex items-center justify-between shrink-0 z-40">
        <div className="flex items-center gap-3">
          <div className="bg-cyan-950/60 p-1.5 rounded-lg border border-cyan-800/60 text-cyan-400">
            <Zap size={18} className="animate-pulse" />
          </div>
          <div>
            <h1 className="text-sm font-black tracking-wider text-slate-100 flex items-center gap-2">
              CAD DAVID <span className="text-cyan-400 text-[10px] px-1.5 py-0.5 rounded bg-cyan-950 border border-cyan-800/80 font-mono">WASM SIMULATOR</span>
            </h1>
          </div>
        </div>

        {/* Preset Selector & Quick Commands */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5 bg-slate-950/60 border border-slate-800 rounded-xl px-2 py-1">
            <BookOpen size={12} className="text-slate-400" />
            <span className="text-[10px] font-mono text-slate-400 mr-1 uppercase">Preset:</span>
            <select 
              onChange={(e) => loadPreset(e.target.value)}
              className="bg-transparent text-[11px] font-semibold text-slate-200 focus:outline-none cursor-pointer"
              defaultValue="direct_online"
            >
              <option value="direct_online">Partida Direta</option>
              <option value="star_delta">Estrela-Triângulo</option>
              <option value="reversing">Partida Reversora</option>
              <option value="plc_starter">Controle CLP</option>
            </select>
          </div>

          <div className="flex items-center gap-1.5">
            <button 
              onClick={() => {
                setComponents([]);
                setWires([]);
                setSelectedComponentId(null);
                setSelectedWireId(null);
                setCommandHistory(prev => [...prev, "Área de desenho limpa."]);
              }}
              className="p-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-slate-400 hover:text-slate-200 transition-colors"
              title="Novo Projeto"
            >
              <Plus size={14} />
            </button>
            
            <button 
              onClick={handleExport}
              className="p-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-slate-400 hover:text-slate-200 transition-colors"
              title="Exportar Projeto"
            >
              <Download size={14} />
            </button>

            <label className="p-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-slate-400 hover:text-slate-200 transition-colors cursor-pointer" title="Importar Projeto">
              <Upload size={14} />
              <input type="file" onChange={handleImport} accept=".json" className="hidden" />
            </label>
          </div>

          {/* Simulation Toggle */}
          <div className="h-6 w-[1px] bg-slate-800 mx-2"></div>
          
          <button
            onClick={() => {
              setIsSimulating(!isSimulating);
              setCommandHistory(prev => [...prev, isSimulating ? "Simulação suspensa." : "Simulação iniciada."]);
            }}
            className={`px-4 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all duration-300 ${
              isSimulating 
                ? "bg-rose-500 text-white shadow-glow-red hover:bg-rose-600" 
                : "bg-emerald-500 text-slate-950 shadow-glow-green hover:bg-emerald-400"
            }`}
          >
            {isSimulating ? (
              <>
                <Square size={12} fill="currentColor" /> PARAR SIM
              </>
            ) : (
              <>
                <Play size={12} fill="currentColor" /> SIMULAR (RUN)
              </>
            )}
          </button>
        </div>
      </header>

      {/* Main CAD Workspace Layout */}
      <div className="flex-1 flex overflow-hidden">
        
        {/* SIDEBAR TOOLBOX (Col 1) */}
        <div className="w-56 bg-[#070a13] border-r border-[#131d31] flex flex-col overflow-y-auto shrink-0 select-none">
          <div className="p-3 border-b border-[#131d31] flex items-center gap-1 text-[11px] font-bold text-slate-400 tracking-wider uppercase font-mono">
            <Layers size={14} className="text-cyan-400" />
            Biblioteca de Símbolos
          </div>

          <div className="p-3 space-y-4">
            
            {/* Category: Fontes */}
            <div>
              <h4 className="text-[10px] font-bold text-slate-400 font-mono tracking-wider uppercase mb-1.5">1. Fontes de Tensão</h4>
              <div className="grid grid-cols-2 gap-1.5">
                {[
                  { type: 'source_l1', name: 'Fase L1' },
                  { type: 'source_l2', name: 'Fase L2' },
                  { type: 'source_l3', name: 'Fase L3' },
                  { type: 'source_n', name: 'Neutro N' },
                  { type: 'source_pe', name: 'Aterram. PE' },
                  { type: 'source_dc_pos', name: 'DC +24V' },
                  { type: 'source_dc_neg', name: 'DC 0V' }
                ].map(item => (
                  <button
                    key={item.type}
                    onClick={() => setActiveTool(item.type)}
                    className={`p-1.5 text-[10px] font-medium text-left border rounded-lg transition-all duration-200 ${
                      activeTool === item.type 
                        ? 'bg-cyan-950/40 text-cyan-400 border-cyan-500/80 shadow-glow-cyan' 
                        : 'bg-slate-900/50 text-slate-300 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    {item.name}
                  </button>
                ))}
              </div>
            </div>

            {/* Category: Manobra/Protecao */}
            <div>
              <h4 className="text-[10px] font-bold text-slate-400 font-mono tracking-wider uppercase mb-1.5">2. Proteção & Manobra</h4>
              <div className="grid grid-cols-2 gap-1.5">
                {[
                  { type: 'breaker_1p', name: 'Disjuntor 1P' },
                  { type: 'breaker_3p', name: 'Disjuntor 3P' },
                  { type: 'fuse', name: 'Fusível' },
                  { type: 'pushbutton_no', name: 'Botoeira NA' },
                  { type: 'pushbutton_nc', name: 'Botoeira NF' },
                  { type: 'selector_switch_no', name: 'Chave Seletora' }
                ].map(item => (
                  <button
                    key={item.type}
                    onClick={() => setActiveTool(item.type)}
                    className={`p-1.5 text-[10px] font-medium text-left border rounded-lg transition-all duration-200 ${
                      activeTool === item.type 
                        ? 'bg-cyan-950/40 text-cyan-400 border-cyan-500/80 shadow-glow-cyan' 
                        : 'bg-slate-900/50 text-slate-300 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    {item.name}
                  </button>
                ))}
              </div>
            </div>

            {/* Category: Contatos Auxiliares */}
            <div>
              <h4 className="text-[10px] font-bold text-slate-400 font-mono tracking-wider uppercase mb-1.5">3. Contatos Relés/KM</h4>
              <div className="grid grid-cols-1 gap-1.5">
                {[
                  { type: 'contactor_contacts_no', name: 'Contato Auxiliar NA (13-14)' },
                  { type: 'contactor_contacts_nc', name: 'Contato Auxiliar NF (11-12)' },
                  { type: 'contactor_contacts_no_power', name: 'Contatos de Carga 3P (1-6)' },
                  { type: 'overload_relay_contacts_nc', name: 'Contato Térmico NF (95-96)' },
                  { type: 'overload_relay_contacts_no', name: 'Contato Térmico NA (97-98)' },
                  { type: 'timer_contacts_no', name: 'Contato Temporizado NA' },
                  { type: 'timer_contacts_nc', name: 'Contato Temporizado NF' }
                ].map(item => (
                  <button
                    key={item.type}
                    onClick={() => setActiveTool(item.type)}
                    className={`p-1.5 text-[10px] font-medium text-left border rounded-lg transition-all duration-200 ${
                      activeTool === item.type 
                        ? 'bg-cyan-950/40 text-cyan-400 border-cyan-500/80 shadow-glow-cyan' 
                        : 'bg-slate-900/50 text-slate-300 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    {item.name}
                  </button>
                ))}
              </div>
            </div>

            {/* Category: Bobinas e Sinalização */}
            <div>
              <h4 className="text-[10px] font-bold text-slate-400 font-mono tracking-wider uppercase mb-1.5">4. Bobinas e Alarme</h4>
              <div className="grid grid-cols-2 gap-1.5">
                {[
                  { type: 'contactor_coil', name: 'Bobina KM' },
                  { type: 'relay_coil', name: 'Bobina KA' },
                  { type: 'timer_coil', name: 'Bobina Temp' },
                  { type: 'lamp', name: 'Lâmpada' },
                  { type: 'buzzer', name: 'Sirene' }
                ].map(item => (
                  <button
                    key={item.type}
                    onClick={() => setActiveTool(item.type)}
                    className={`p-1.5 text-[10px] font-medium text-left border rounded-lg transition-all duration-200 ${
                      activeTool === item.type 
                        ? 'bg-cyan-950/40 text-cyan-400 border-cyan-500/80 shadow-glow-cyan' 
                        : 'bg-slate-900/50 text-slate-300 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    {item.name}
                  </button>
                ))}
              </div>
            </div>

            {/* Category: Motores */}
            <div>
              <h4 className="text-[10px] font-bold text-slate-400 font-mono tracking-wider uppercase mb-1.5">5. Motores Elétricos</h4>
              <div className="grid grid-cols-1 gap-1.5">
                {[
                  { type: 'motor_3ph', name: 'Motor Trifásico 380V AC' },
                  { type: 'motor_1ph', name: 'Motor Monofásico 220V AC' }
                ].map(item => (
                  <button
                    key={item.type}
                    onClick={() => setActiveTool(item.type)}
                    className={`p-1.5 text-[10px] font-medium text-left border rounded-lg transition-all duration-200 ${
                      activeTool === item.type 
                        ? 'bg-cyan-950/40 text-cyan-400 border-cyan-500/80 shadow-glow-cyan' 
                        : 'bg-slate-900/50 text-slate-300 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    {item.name}
                  </button>
                ))}
              </div>
            </div>

            {/* Category: CLP */}
            <div>
              <h4 className="text-[10px] font-bold text-slate-400 font-mono tracking-wider uppercase mb-1.5">6. CLP Módulos</h4>
              <div className="grid grid-cols-2 gap-1.5">
                {[
                  { type: 'plc_input', name: 'Entrada CLP' },
                  { type: 'plc_output', name: 'Saída CLP' }
                ].map(item => (
                  <button
                    key={item.type}
                    onClick={() => setActiveTool(item.type)}
                    className={`p-1.5 text-[10px] font-medium text-left border rounded-lg transition-all duration-200 ${
                      activeTool === item.type 
                        ? 'bg-cyan-950/40 text-cyan-400 border-cyan-500/80 shadow-glow-cyan' 
                        : 'bg-slate-900/50 text-slate-300 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    {item.name}
                  </button>
                ))}
              </div>
            </div>

            {/* Category: Condutor */}
            <div className="border-t border-slate-800 pt-3">
              <h4 className="text-[10px] font-bold text-slate-400 font-mono tracking-wider uppercase mb-1.5">Ferramentas de Tração</h4>
              <button
                onClick={() => setActiveTool('wire')}
                className={`w-full p-2 text-xs font-bold text-center border rounded-xl flex items-center justify-center gap-1.5 transition-all duration-200 ${
                  activeTool === 'wire' 
                    ? 'bg-amber-950/40 text-amber-400 border-amber-500/80 shadow-glow-amber' 
                    : 'bg-zinc-900 text-slate-200 border-zinc-800 hover:border-zinc-700'
                }`}
              >
                <RefreshCw size={12} className="animate-spin" style={{ animationDuration: '6s' }} />
                Desenhar Condutor (L)
              </button>

              {activeTool === 'wire' && (
                <div className="mt-2 bg-slate-950/80 p-2 rounded-lg border border-slate-800 space-y-2">
                  <span className="text-[9px] font-mono text-slate-500 uppercase block">Tipo do Cabo:</span>
                  <div className="grid grid-cols-2 gap-1">
                    {[
                      { type: 'phase', name: 'Fase AC', color: 'bg-amber-500' },
                      { type: 'neutral', name: 'Neutro N', color: 'bg-blue-500' },
                      { type: 'ground', name: 'Terra PE', color: 'bg-green-500' },
                      { type: 'dc_pos', name: 'DC +24V', color: 'bg-red-500' },
                      { type: 'dc_neg', name: 'DC 0V', color: 'bg-slate-400' }
                    ].map(c => (
                      <button
                        key={c.type}
                        onClick={() => setWireType(c.type as any)}
                        className={`p-1 text-[8px] font-mono rounded flex items-center gap-1 ${
                          wireType === c.type ? 'bg-slate-800 text-slate-200' : 'text-slate-500'
                        }`}
                      >
                        <span className={`w-1.5 h-1.5 rounded-full ${c.color}`}></span>
                        {c.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

          </div>
        </div>

        {/* CAD WORKSPACE CANVAS (Col 2) */}
        <div className="flex-1 flex flex-col bg-[#050811] relative overflow-hidden">
          
          {/* Canvas Sub-toolbar */}
          <div className="h-10 bg-[#080c18] border-b border-[#131d31] px-4 flex items-center justify-between text-xs text-slate-400 select-none">
            <div className="flex items-center gap-4">
              <button 
                onClick={() => setGridVisible(!gridVisible)}
                className={`flex items-center gap-1.5 hover:text-slate-200 transition-colors ${gridVisible ? 'text-cyan-400' : ''}`}
                title="Mostrar/Esconder Grade (GRID)"
              >
                <Grid size={12} />
                <span>GRID</span>
              </button>
              <button 
                onClick={() => setSnapToGrid(!snapToGrid)}
                className={`flex items-center gap-1.5 hover:text-slate-200 transition-colors ${snapToGrid ? 'text-cyan-400' : ''}`}
                title="Encaixe Magnético no Grid (SNAP)"
              >
                <Maximize size={12} className="rotate-45" />
                <span>SNAP (20px)</span>
              </button>
              <button
                onClick={() => {
                  setPan({ x: 0, y: 0 });
                  setZoom(1);
                }}
                className="hover:text-slate-200"
              >
                ENQUADRAR VISTA
              </button>
            </div>
            
            <div className="flex items-center gap-4 font-mono text-[10px]">
              <span>FERRAMENTA ATIVA: <strong className="text-cyan-400">{activeTool.toUpperCase()}</strong></span>
              <span>X: {Math.round(mousePos.x)} | Y: {Math.round(mousePos.y)}</span>
            </div>
          </div>

          {/* SVG INTERACTIVE CANVAS */}
          <div className="flex-1 overflow-hidden relative select-none cad-crosshair">
            
            {/* Pulsing Alarm banner */}
            {state.alarm_active && (
              <div className="absolute top-4 left-4 z-20 bg-rose-950/80 border border-rose-800/80 text-rose-300 text-xs px-4 py-2.5 rounded-xl flex items-center gap-3 shadow-glow-red animate-pulse">
                <AlertTriangle size={16} className="text-rose-400 animate-pulse-glow" />
                <div>
                  <h4 className="font-extrabold uppercase tracking-wide">FALHA: {state.alarm_message}</h4>
                  <p className="text-[10px] text-rose-400/90 font-mono mt-0.5">Dispositivos de proteção atuaram.</p>
                </div>
                <button 
                  onClick={() => pyodideService.handleRequest("/api/wasm/alarm/reset", "POST")}
                  className="ml-3 bg-rose-900/60 hover:bg-rose-800 text-rose-200 px-3 py-1 rounded-lg text-[10px] font-bold border border-rose-700 transition-all duration-300"
                >
                  Rearmar
                </button>
              </div>
            )}

            <svg
              ref={canvasRef}
              className={`w-full h-full ${gridVisible ? 'industrial-grid' : 'bg-[#050811]'}`}
              onMouseDown={handleCanvasMouseDown}
              onMouseMove={handleCanvasMouseMove}
              onMouseUp={handleCanvasMouseUp}
            >
              <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
                
                {/* 1. Draw Wires */}
                {wires.map(w => {
                  const path = getWirePath(w);
                  const isSelected = selectedWireId === w.id;
                  
                  // Live current state simulation
                  const potential = energizedNodes[w.id];
                  let strokeColor = '#475569'; // Slate-600 default (cold wire)
                  let isHot = false;
                  
                  if (potential) {
                    isHot = true;
                    if (potential === 'L1' || potential === 'L2' || potential === 'L3') {
                      strokeColor = '#eab308'; // Amber-500 phase glow
                    } else if (potential === 'N') {
                      strokeColor = '#3b82f6'; // Blue-500 neutral
                    } else if (potential === '+') {
                      strokeColor = '#ef4444'; // Red-500 DC+
                    } else if (potential === '-') {
                      strokeColor = '#64748b'; // Slate DC-
                    } else if (potential === 'PE') {
                      strokeColor = '#22c55e'; // Green PE
                    }
                  }
                  
                  return (
                    <g key={w.id} className="group">
                      {/* Wide clickable overlay for wires */}
                      <path
                        d={path}
                        data-wire-id={w.id}
                        fill="none"
                        stroke="transparent"
                        strokeWidth="12"
                        className="cursor-pointer"
                      />
                      
                      {/* Visible wire path */}
                      <path
                        d={path}
                        fill="none"
                        stroke={strokeColor}
                        strokeWidth={isSelected ? "3.5" : "2"}
                        className={`transition-colors duration-300 pointer-events-none ${
                          isSelected ? 'stroke-cyan-400' : ''
                        } ${isHot ? 'current-flow-line' : ''}`}
                        style={{
                          filter: isHot ? `drop-shadow(0 0 3px ${strokeColor}cc)` : 'none'
                        }}
                      />
                      
                      {/* Connection Joint dots */}
                      {isHot && (
                        <circle cx={mousePos.x} cy={mousePos.y} r="0" className="hidden" />
                      )}
                    </g>
                  );
                })}

                {/* 2. Draw Wire drawing guide line (preview) */}
                {activeTool === 'wire' && wireStart && (
                  <line
                    x1={wireStart.x}
                    y1={wireStart.y}
                    x2={hoveredTerminal ? hoveredTerminal.x : mousePos.x}
                    y2={hoveredTerminal ? hoveredTerminal.y : mousePos.y}
                    stroke="#f59e0b"
                    strokeWidth="1.5"
                    strokeDasharray="4 3"
                    className="pointer-events-none animate-pulse"
                  />
                )}

                {/* 3. Render Components */}
                {components.map(c => {
                  const isSelected = selectedComponentId === c.id;
                  const isActive = activeComponents[c.id] || false;
                  
                  // Compute dynamic details if motor
                  let motorSpeed = 0;
                  let motorTemp = 24.0;
                  let timerVal = 0;
                  
                  if (c.type === 'motor_3ph' || c.type === 'motor_1ph') {
                    const params = telemetry?.state?.motor_parameters?.[c.id] || { speed: 0, temp: 24 };
                    motorSpeed = params.speed || 0;
                    motorTemp = params.temp || 24;
                  }
                  if (c.type === 'timer_coil') {
                    timerVal = telemetry?.state?.timers?.[c.id] || 0;
                  }
                  
                  return (
                    <g
                      key={c.id}
                      transform={`translate(${c.x}, ${c.y}) rotate(${c.rotation})`}
                      className="cursor-pointer"
                      onClick={() => handleComponentClick(c)}
                    >
                      {/* Hitbox bounding box */}
                      <rect
                        x="-30"
                        y="-30"
                        width="60"
                        height="60"
                        fill="transparent"
                        data-component-id={c.id}
                      />

                      {/* Selected visual frame */}
                      {isSelected && (
                        <rect
                          x="-32"
                          y="-32"
                          width="64"
                          height="64"
                          fill="none"
                          stroke="#22d3ee"
                          strokeWidth="1"
                          strokeDasharray="3 2"
                          className="animate-pulse"
                        />
                      )}

                      {/* Component Symbols Drawing */}
                      {renderComponentSymbol(c.type, isActive, c.label, motorSpeed, c.value)}

                      {/* Terminals Dots for wiring */}
                      {getComponentTerminals(c).map((t: string) => {
                        // Helper to find exact relative coordinates for snap dots
                        const isHovered = hoveredTerminal?.componentId === c.id && hoveredTerminal?.terminalId === t;
                        let tx = 0;
                        let ty = 0;
                        
                        const ctype = c.type;
                        if (ctype.startsWith('source_')) {
                          ty = 20;
                        } else if (ctype === 'breaker_3p' || ctype === 'contactor_contacts_no_power') {
                          const mapping: any = {
                            '1': { x: -30, y: -20 }, '2': { x: -30, y: 20 },
                            '3': { x: 0, y: -20 }, '4': { x: 0, y: 20 },
                            '5': { x: 30, y: -20 }, '6': { x: 30, y: 20 }
                          };
                          tx = mapping[t]?.x || 0;
                          ty = mapping[t]?.y || 0;
                        } else if (ctype === 'motor_3ph') {
                          const mapping: any = {
                            'U': { x: -20, y: -30 }, 'V': { x: 0, y: -30 }, 'W': { x: 20, y: -30 }, 'PE': { x: 0, y: 30 }
                          };
                          tx = mapping[t]?.x || 0;
                          ty = mapping[t]?.y || 0;
                        } else if (ctype === 'motor_1ph') {
                          const mapping: any = {
                            'U': { x: -15, y: -30 }, 'N': { x: 15, y: -30 }, 'PE': { x: 0, y: 30 }
                          };
                          tx = mapping[t]?.x || 0;
                          ty = mapping[t]?.y || 0;
                        } else if (ctype === 'contactor_contacts_no') {
                          ty = t === '13' ? -20 : 20;
                        } else if (ctype === 'contactor_contacts_nc') {
                          ty = t === '11' ? -20 : 20;
                        } else if (ctype === 'overload_relay_contacts_nc') {
                          ty = t === '95' ? -20 : 20;
                        } else if (ctype === 'overload_relay_contacts_no') {
                          ty = t === '97' ? -20 : 20;
                        } else if (ctype === 'timer_contacts_no') {
                          ty = t === '15' ? -20 : 20;
                        } else if (ctype === 'timer_contacts_nc') {
                          ty = t === '15' ? -20 : 20;
                        } else if (ctype === 'pushbutton_no' || ctype === 'selector_switch_no') {
                          ty = t === '3' ? -20 : 20;
                        } else if (ctype === 'pushbutton_nc') {
                          ty = t === '1' ? -20 : 20;
                        } else if (ctype in ['contactor_coil', 'relay_coil', 'timer_coil']) {
                          ty = t === 'A1' ? -20 : 20;
                        } else if (ctype in ['lamp', 'buzzer']) {
                          ty = t === 'X1' ? -20 : 20;
                        } else if (ctype === 'plc_input') {
                          ty = t === 'IN' ? -20 : 20;
                        } else if (ctype === 'plc_output') {
                          ty = t === '1' ? -20 : 20;
                        } else {
                          ty = t === '1' ? -20 : 20;
                        }
                        
                        return (
                          <circle
                            key={t}
                            cx={tx}
                            cy={ty}
                            r={isHovered ? "5" : "2.5"}
                            fill={isHovered ? "#22d3ee" : "#475569"}
                            stroke={isHovered ? "#0891b2" : "transparent"}
                            strokeWidth="1"
                            className="transition-all"
                          />
                        );
                      })}

                      {/* Component Floating Text Tags (Rendered upright) */}
                      <g transform={`rotate(${-c.rotation})`}>
                        <text
                          x="0"
                          y="-35"
                          textAnchor="middle"
                          fill="#f8fafc"
                          fontSize="9"
                          fontWeight="bold"
                          fontFamily="monospace"
                        >
                          {c.label}
                        </text>
                        
                        {/* Render Motor Speed/Temp overlay details */}
                        {(c.type === 'motor_3ph' || c.type === 'motor_1ph') && (
                          <g transform="translate(35, 10)">
                            <rect x="-5" y="-12" width="70" height="28" fill="#020617/90" stroke="#1e293b" rx="4" />
                            <text x="0" y="0" fill="#22d3ee" fontSize="7" fontFamily="monospace">{motorSpeed} RPM</text>
                            <text x="0" y="10" fill={motorTemp > 70 ? "#ef4444" : "#10b981"} fontSize="7" fontFamily="monospace">{motorTemp} °C</text>
                          </g>
                        )}
                        
                        {/* Render Timer overlay details */}
                        {c.type === 'timer_coil' && timerVal > 0 && (
                          <g transform="translate(15, 10)">
                            <rect x="-5" y="-7" width="30" height="14" fill="#020617/90" stroke="#1e293b" rx="3" />
                            <text x="0" y="3" fill="#22d3ee" fontSize="7" fontFamily="monospace">{timerVal.toFixed(1)}s</text>
                          </g>
                        )}
                      </g>
                    </g>
                  );
                })}

                {/* 4. Crosshairs for placement preview */}
                {activeTool !== 'select' && activeTool !== 'wire' && (
                  <g transform={`translate(${snapToGridVal(mousePos.x)}, ${snapToGridVal(mousePos.y)})`}>
                    <circle cx="0" cy="0" r="10" fill="transparent" stroke="#eab308" strokeWidth="1" strokeDasharray="3 3" />
                    {renderComponentSymbol(activeTool, false, "PREVIEW", 0)}
                  </g>
                )}
              </g>

              {/* AutoCAD crosshair fullscreen guides */}
              <line x1="0" y1={mousePos.y * zoom + pan.y} x2="100%" y2={mousePos.y * zoom + pan.y} stroke="rgba(6, 182, 212, 0.15)" strokeWidth="0.5" pointerEvents="none" />
              <line x1={mousePos.x * zoom + pan.x} y1="0" x2={mousePos.x * zoom + pan.x} y2="100%" stroke="rgba(6, 182, 212, 0.15)" strokeWidth="0.5" pointerEvents="none" />
            </svg>
          </div>

          {/* AUTOCAD COMMAND LINE CONSOLE (CLI) */}
          <div className="h-44 bg-[#05080e] border-t border-[#131d31] flex flex-col shrink-0">
            {/* Top row: History and Logs side-by-side */}
            <div className="flex-1 flex min-h-0">
              {/* Left: CLI Command history */}
              <div className="flex-1 p-3 overflow-y-auto border-r border-[#131d31]/50 font-mono text-xs text-emerald-400 space-y-1 scrollbar-thin select-text">
                <span className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Histórico de Comandos</span>
                {commandHistory.map((h, i) => {
                  let colorClass = "text-emerald-500/80";
                  if (h.startsWith("Comando:")) colorClass = "text-cyan-400 font-semibold";
                  if (h.includes("Erro") || h.includes("inválido")) colorClass = "text-rose-400 font-bold";
                  if (h.includes("inicializado") || h.includes("Preset:")) colorClass = "text-amber-400 font-bold";
                  
                  return (
                    <div key={i} className={colorClass}>
                      <span className="text-emerald-600 select-none mr-2">&gt;&gt;</span>
                      <span>{h}</span>
                    </div>
                  );
                })}
                <div ref={cliHistoryEndRef} />
              </div>

              {/* Right: Python Simulator telemetry logs */}
              <div className="w-80 p-3 overflow-y-auto font-mono text-xs text-amber-400/90 space-y-1 bg-slate-950/20 scrollbar-thin select-text">
                <span className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Status da Simulação</span>
                {logs.length === 0 ? (
                  <div className="text-slate-600 italic">Nenhum evento registrado. Rode a simulação.</div>
                ) : (
                  logs.map((l, i) => (
                    <div key={i} className="text-slate-300">
                      <span className="text-cyan-500/60 select-none mr-2">⚡</span>
                      <span>{l}</span>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* CLI Input form */}
            <form onSubmit={handleCommandExecute} className="h-9 bg-[#0b0f19] border-t border-[#131d31] flex items-center px-3 gap-2 shrink-0">
              <span className="text-xs font-bold text-cyan-400 font-mono select-none">Comando:</span>
              <input
                type="text"
                value={cmdInput}
                onChange={e => setCmdInput(e.target.value)}
                placeholder="Digite LINE, ADD, DEL, ROTATE, GRID ou HELP..."
                className="flex-1 bg-transparent border-none text-xs text-slate-100 font-mono focus:outline-none focus:ring-0 placeholder-slate-600"
              />
            </form>
          </div>

        </div>

        {/* RIGHT CONTROL PANEL & IDE (Col 3) */}
        <div className="w-80 bg-[#070a13] border-l border-[#131d31] flex flex-col overflow-y-auto shrink-0 select-none">
          
          {/* Section 1: Properties Inspector */}
          <div className="p-4 border-b border-[#131d31]">
            <h2 className="text-xs font-black tracking-wider text-slate-400 font-mono uppercase mb-3 flex items-center gap-1.5">
              <FileText size={14} className="text-cyan-400" />
              Inspetor de Propriedades
            </h2>

            {selectedComponentId ? (() => {
              const comp = components.find(c => c.id === selectedComponentId);
              if (!comp) return null;
              return (
                <div className="space-y-3">
                  <div>
                    <span className="text-[9px] font-mono text-slate-500 uppercase">Tipo:</span>
                    <div className="text-xs font-bold text-slate-300 font-mono uppercase">{comp.type.replace('_', ' ')}</div>
                  </div>

                  <div>
                    <label className="text-[9px] font-mono text-slate-500 uppercase block mb-1">Tag / Nome do Bloco:</label>
                    <input
                      type="text"
                      value={comp.label}
                      onChange={e => setComponents(prev => prev.map(c => c.id === comp.id ? { ...c, label: e.target.value.toUpperCase() } : c))}
                      className="w-full bg-[#050811] text-xs font-mono text-slate-200 border border-slate-800 rounded px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-cyan-500/50"
                    />
                  </div>

                  {comp.type === 'timer_coil' && (
                    <div>
                      <label className="text-[9px] font-mono text-slate-500 uppercase block mb-1">Ajuste de Tempo (s):</label>
                      <input
                        type="text"
                        value={comp.value || "5s"}
                        onChange={e => setComponents(prev => prev.map(c => c.id === comp.id ? { ...c, value: e.target.value } : c))}
                        placeholder="Ex: 5s, 10s"
                        className="w-full bg-[#050811] text-xs font-mono text-slate-200 border border-slate-800 rounded px-2.5 py-1.5 focus:outline-none"
                      />
                    </div>
                  )}

                  {['contactor_contacts_no', 'contactor_contacts_nc', 'contactor_contacts_no_power', 'timer_contacts_no', 'timer_contacts_nc', 'overload_relay_contacts_nc', 'overload_relay_contacts_no'].includes(comp.type) && (
                    <div>
                      <label className="text-[9px] font-mono text-slate-500 uppercase block mb-1">Coil / Tag de Referência:</label>
                      <input
                        type="text"
                        value={comp.value || ""}
                        onChange={e => setComponents(prev => prev.map(c => c.id === comp.id ? { ...c, value: e.target.value.toUpperCase() } : c))}
                        placeholder="Ex: KM1, KT1, M1"
                        className="w-full bg-[#050811] text-xs font-mono text-slate-200 border border-slate-800 rounded px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-cyan-500/50"
                      />
                      <span className="text-[8px] font-mono text-slate-500 mt-1 block">* Vincula o acionamento do contato a este componente</span>
                    </div>
                  )}

                  <div className="flex gap-2 pt-2">
                    <button
                      onClick={rotateSelectedComponent}
                      className="flex-1 py-1.5 bg-zinc-900 border border-zinc-800 text-slate-300 hover:text-white rounded-lg text-xs font-bold flex items-center justify-center gap-1 transition-colors"
                    >
                      <RotateCw size={12} />
                      Rotacionar (R)
                    </button>
                    <button
                      onClick={triggerErase}
                      className="py-1.5 px-3 bg-rose-950/40 border border-rose-900/60 text-rose-400 hover:bg-rose-900 hover:text-white rounded-lg text-xs font-bold transition-colors"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              );
            })() : selectedWireId ? (
              <div>
                <span className="text-[10px] font-mono text-slate-500 uppercase block">Condutor Selecionado</span>
                <p className="text-xs font-mono text-slate-300 mt-1">ID: {selectedWireId}</p>
                <p className="text-xs font-mono text-slate-400 mt-1">Potencial Ativo: <span className="text-cyan-400 font-bold">{energizedNodes[selectedWireId] || "Sem Carga"}</span></p>
                <button
                  onClick={triggerErase}
                  className="mt-3 w-full py-1.5 bg-rose-950/30 border border-rose-900/50 text-rose-400 hover:bg-rose-900 hover:text-white rounded-lg text-xs font-bold flex items-center justify-center gap-1 transition-colors"
                >
                  <Trash2 size={12} /> Apagar Condutor
                </button>
              </div>
            ) : (
              <p className="text-xs text-slate-500 font-mono text-center py-4">Selecione um elemento ou fio no canvas para visualizar propriedades.</p>
            )}
          </div>

          {/* Section 2: PLC Programming Console */}
          <div className="p-4 border-b border-[#131d31]">
            <h2 className="text-xs font-black tracking-wider text-slate-400 font-mono uppercase mb-3 flex items-center gap-1.5">
              <Settings size={14} className="text-cyan-400" />
              Lógica LADDER / CLP (Python)
            </h2>

            <form onSubmit={handlePlcSubmit} className="space-y-3">
              <div className="border border-slate-800 rounded-xl overflow-hidden">
                <div className="bg-[#0b0f19] px-3 py-1.5 border-b border-slate-800 flex justify-between items-center text-[9px] font-mono text-slate-400">
                  <span>Logic Script (.py)</span>
                  <span className="text-cyan-400 font-semibold">Python 3.11</span>
                </div>
                <textarea
                  value={plcCode}
                  onChange={e => setPlcCode(e.target.value)}
                  rows={9}
                  className="w-full bg-[#04060c] text-xs font-mono text-slate-300 p-3 focus:outline-none resize-none leading-relaxed"
                  spellCheck="false"
                />
              </div>

              <div className="flex justify-between items-center gap-2">
                <div className="flex items-center gap-2" id="plc-status-container">
                  <span className="text-[10px] font-mono text-emerald-400 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping"></span>
                    CLP ONLINE
                  </span>
                </div>
                
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs font-bold rounded-xl shadow-glow-cyan hover:shadow-cyan-400/40 flex items-center gap-1 transition-all"
                >
                  <RefreshCw size={12} /> Compilar
                </button>
              </div>
            </form>
          </div>

          {/* Section 3: Operations HTMX Panels */}
          <div className="p-4 space-y-4">
            <div>
              <h2 className="text-xs font-black tracking-wider text-slate-400 font-mono uppercase mb-2">Painel de Medição (HTMX)</h2>
              <div 
                id="component-details" 
                hx-get={selectedComponentId ? `/api/wasm/component/${selectedComponentId}` : "/api/wasm/component/transformer"}
                hx-trigger={selectedComponentId ? "load, click from:body" : "load"}
                className="transition-all duration-300"
              >
                <div className="p-4 text-center text-xs text-slate-500 font-mono">
                  Selecione um componente para monitorar medições avançadas...
                </div>
              </div>
            </div>

            <div>
              <h2 className="text-xs font-black tracking-wider text-slate-400 font-mono uppercase mb-2">Status Disjuntores (HTMX)</h2>
              <div 
                id="breakers-list" 
                hx-get="/api/wasm/breaker/toggle" 
                hx-trigger="load"
                className="space-y-2"
              >
                <div className="p-2 text-center text-xs text-slate-500 font-mono">
                  Carregando disjuntores...
                </div>
              </div>
            </div>
          </div>

        </div>

      </div>
    </div>
  );
}

// Custom electrical symbols renderer
function renderComponentSymbol(type: string, isActive: boolean, label: string, motorSpeed = 0, customVal = "") {
  const activeColor = isActive ? "#10b981" : "#475569";
  const glowClass = isActive ? "glow-green animate-pulse" : "";
  
  switch (type) {
    case 'source_l1':
      return (
        <g>
          <circle cx="0" cy="0" r="6" fill="#f59e0b" className="glow-amber" />
          <text x="0" y="3" textAnchor="middle" fill="#000" fontSize="7" fontWeight="bold">L1</text>
          <line x1="0" y1="6" x2="0" y2="20" stroke="#f59e0b" strokeWidth="2" />
        </g>
      );
    case 'source_l2':
      return (
        <g>
          <circle cx="0" cy="0" r="6" fill="#ef4444" className="glow-red" />
          <text x="0" y="3" textAnchor="middle" fill="#000" fontSize="7" fontWeight="bold">L2</text>
          <line x1="0" y1="6" x2="0" y2="20" stroke="#ef4444" strokeWidth="2" />
        </g>
      );
    case 'source_l3':
      return (
        <g>
          <circle cx="0" cy="0" r="6" fill="#10b981" className="glow-green" />
          <text x="0" y="3" textAnchor="middle" fill="#000" fontSize="7" fontWeight="bold">L3</text>
          <line x1="0" y1="6" x2="0" y2="20" stroke="#10b981" strokeWidth="2" />
        </g>
      );
    case 'source_n':
      return (
        <g>
          <circle cx="0" cy="0" r="6" fill="#3b82f6" className="glow-blue" />
          <text x="0" y="3" textAnchor="middle" fill="#000" fontSize="7" fontWeight="bold">N</text>
          <line x1="0" y1="6" x2="0" y2="20" stroke="#3b82f6" strokeWidth="2" />
        </g>
      );
    case 'source_pe':
      return (
        <g>
          <polygon points="-8,0 8,0 0,12" fill="none" stroke="#22c55e" strokeWidth="1.5" />
          <line x1="-5" y1="4" x2="5" y2="4" stroke="#22c55e" strokeWidth="1" />
          <line x1="-2" y1="8" x2="2" y2="8" stroke="#22c55e" strokeWidth="1" />
          <line x1="0" y1="0" x2="0" y2="-10" stroke="#22c55e" strokeWidth="1.5" />
        </g>
      );
    case 'source_dc_pos':
      return (
        <g>
          <circle cx="0" cy="0" r="7" fill="#ef4444" className="glow-red" />
          <text x="0" y="3.5" textAnchor="middle" fill="#fff" fontSize="8" fontWeight="bold">+</text>
          <line x1="0" y1="7" x2="0" y2="20" stroke="#ef4444" strokeWidth="2" />
        </g>
      );
    case 'source_dc_neg':
      return (
        <g>
          <circle cx="0" cy="0" r="7" fill="#64748b" />
          <text x="0" y="3.5" textAnchor="middle" fill="#fff" fontSize="8" fontWeight="bold">-</text>
          <line x1="0" y1="7" x2="0" y2="20" stroke="#64748b" strokeWidth="2" />
        </g>
      );
    case 'breaker_1p':
      return (
        <g>
          <line x1="0" y1="-20" x2="0" y2="-10" stroke="#94a3b8" strokeWidth="2" />
          {/* Lever */}
          <line x1="0" y1="-10" x2={isActive ? "0" : "12"} y2={isActive ? "10" : "8"} stroke={activeColor} strokeWidth="2.5" />
          <circle cx="0" cy="-10" r="2" fill="#64748b" />
          <circle cx="0" cy="10" r="2" fill="#64748b" />
          <line x1="0" y1="10" x2="0" y2="20" stroke="#94a3b8" strokeWidth="2" />
        </g>
      );
    case 'breaker_3p':
      return (
        <g>
          {/* Draw 3 parallel levers */}
          {[-15, 0, 15].map((dx, i) => (
            <g key={i} transform={`translate(${dx}, 0)`}>
              <line x1="0" y1="-20" x2="0" y2="-10" stroke="#94a3b8" strokeWidth="2" />
              <line x1="0" y1="-10" x2={isActive ? "0" : "12"} y2={isActive ? "10" : "8"} stroke={activeColor} strokeWidth="2.5" />
              <circle cx="0" cy="-10" r="1.5" fill="#64748b" />
              <circle cx="0" cy="10" r="1.5" fill="#64748b" />
              <line x1="0" y1="10" x2="0" y2="20" stroke="#94a3b8" strokeWidth="2" />
            </g>
          ))}
          {/* Dashed linkage bar */}
          <line x1="-15" y1="0" x2="15" y2="0" stroke="#f59e0b" strokeWidth="1" strokeDasharray="2 2" />
        </g>
      );
    case 'fuse':
      return (
        <g>
          <line x1="0" y1="-20" x2="0" y2="20" stroke="#94a3b8" strokeWidth="1.5" />
          <rect x="-4" y="-12" width="8" height="24" fill="#020617" stroke="#64748b" strokeWidth="1.5" />
        </g>
      );
    case 'pushbutton_no':
      return (
        <g>
          <circle cx="-5" cy="10" r="2" fill="#94a3b8" />
          <circle cx="5" cy="10" r="2" fill="#94a3b8" />
          <line x1="-5" y1="-20" x2="-5" y2="10" stroke="#64748b" strokeWidth="1.5" />
          <line x1="5" y1="-20" x2="5" y2="10" stroke="#64748b" strokeWidth="1.5" />
          
          {/* Plunger Actuator */}
          <line x1="-10" y1={isActive ? "10" : "3"} x2="10" y2={isActive ? "10" : "3"} stroke="#ef4444" strokeWidth="2.5" />
          <line x1="0" y1={isActive ? "10" : "3"} x2="0" y2="-10" stroke="#ef4444" strokeWidth="1.5" />
          <rect x="-5" y="-12" width="10" height="3" fill="#ef4444" />
        </g>
      );
    case 'pushbutton_nc':
      return (
        <g>
          <circle cx="-5" cy="10" r="2" fill="#94a3b8" />
          <circle cx="5" cy="10" r="2" fill="#94a3b8" />
          <line x1="-5" y1="-20" x2="-5" y2="10" stroke="#64748b" strokeWidth="1.5" />
          <line x1="5" y1="-20" x2="5" y2="10" stroke="#64748b" strokeWidth="1.5" />
          
          {/* Plunger NC resting */}
          <line x1="-10" y1={isActive ? "18" : "10"} x2="10" y2={isActive ? "18" : "10"} stroke="#ef4444" strokeWidth="2.5" />
          <line x1="0" y1={isActive ? "18" : "10"} x2="0" y2="-10" stroke="#ef4444" strokeWidth="1.5" />
          <rect x="-5" y="-12" width="10" height="3" fill="#ef4444" />
        </g>
      );
    case 'selector_switch_no':
      return (
        <g>
          <line x1="0" y1="-20" x2="0" y2="-10" stroke="#94a3b8" strokeWidth="1.5" />
          <line x1="0" y1="-10" x2={isActive ? "0" : "8"} y2={isActive ? "10" : "8"} stroke={activeColor} strokeWidth="2" />
          <circle cx="0" cy="-10" r="1.5" fill="#64748b" />
          <circle cx="0" cy="10" r="1.5" fill="#64748b" />
          <line x1="0" y1="10" x2="0" y2="20" stroke="#94a3b8" strokeWidth="1.5" />
          <circle cx="6" cy="0" r="1.5" fill="none" stroke="#f59e0b" strokeWidth="0.8" />
        </g>
      );
    case 'contactor_contacts_no':
      return (
        <g>
          <line x1="0" y1="-20" x2="0" y2="-10" stroke="#94a3b8" strokeWidth="1.5" />
          <line x1="0" y1="-10" x2={isActive ? "0" : "9"} y2={isActive ? "10" : "8"} stroke={activeColor} strokeWidth="2" />
          <line x1="0" y1="10" x2="0" y2="20" stroke="#94a3b8" strokeWidth="1.5" />
          <circle cx="0" cy="-10" r="1.5" fill="#64748b" />
          <circle cx="0" cy="10" r="1.5" fill="#64748b" />
        </g>
      );
    case 'contactor_contacts_nc':
      return (
        <g>
          <line x1="0" y1="-20" x2="0" y2="-10" stroke="#94a3b8" strokeWidth="1.5" />
          <line x1="0" y1="-10" x2={isActive ? "8" : "0"} y2={isActive ? "8" : "10"} stroke={activeColor} strokeWidth="2" />
          <line x1="0" y1="10" x2="0" y2="20" stroke="#94a3b8" strokeWidth="1.5" />
          {/* NC Slash line */}
          <line x1="-6" y1="5" x2="6" y2="-5" stroke="#ef4444" strokeWidth="1" />
          <circle cx="0" cy="-10" r="1.5" fill="#64748b" />
          <circle cx="0" cy="10" r="1.5" fill="#64748b" />
        </g>
      );
    case 'contactor_contacts_no_power':
      return (
        <g>
          {[-15, 0, 15].map((dx, i) => (
            <g key={i} transform={`translate(${dx}, 0)`}>
              <line x1="0" y1="-20" x2="0" y2="-10" stroke="#94a3b8" strokeWidth="1.5" />
              <line x1="0" y1="-10" x2={isActive ? "0" : "9"} y2={isActive ? "10" : "8"} stroke={activeColor} strokeWidth="2" />
              <line x1="0" y1="10" x2="0" y2="20" stroke="#94a3b8" strokeWidth="1.5" />
              <circle cx="0" cy="-10" r="1.5" fill="#64748b" />
              <circle cx="0" cy="10" r="1.5" fill="#64748b" />
            </g>
          ))}
          <line x1="-15" y1="0" x2="15" y2="0" stroke="#64748b" strokeWidth="1" strokeDasharray="2 2" />
        </g>
      );
    case 'overload_relay_contacts_nc':
      return (
        <g>
          <line x1="0" y1="-20" x2="0" y2="-10" stroke="#94a3b8" strokeWidth="1.5" />
          <line x1="0" y1="-10" x2={isActive ? "9" : "0"} y2={isActive ? "8" : "10"} stroke={activeColor} strokeWidth="2" />
          <line x1="0" y1="10" x2="0" y2="20" stroke="#94a3b8" strokeWidth="1.5" />
          {/* Thermal square bracket */}
          <path d="-6 10 L -6 4 L -1 4" fill="none" stroke="#f59e0b" strokeWidth="1" />
          <circle cx="0" cy="-10" r="1.5" fill="#64748b" />
          <circle cx="0" cy="10" r="1.5" fill="#64748b" />
        </g>
      );
    case 'overload_relay_contacts_no':
      return (
        <g>
          <line x1="0" y1="-20" x2="0" y2="-10" stroke="#94a3b8" strokeWidth="1.5" />
          <line x1="0" y1="-10" x2={isActive ? "0" : "9"} y2={isActive ? "10" : "8"} stroke={activeColor} strokeWidth="2" />
          <line x1="0" y1="10" x2="0" y2="20" stroke="#94a3b8" strokeWidth="1.5" />
          <path d="-6 10 L -6 4 L -1 4" fill="none" stroke="#f59e0b" strokeWidth="1" />
          <circle cx="0" cy="-10" r="1.5" fill="#64748b" />
          <circle cx="0" cy="10" r="1.5" fill="#64748b" />
        </g>
      );
    case 'timer_contacts_no':
      return (
        <g>
          <line x1="0" y1="-20" x2="0" y2="-10" stroke="#94a3b8" strokeWidth="1.5" />
          <line x1="0" y1="-10" x2={isActive ? "0" : "9"} y2={isActive ? "10" : "8"} stroke={activeColor} strokeWidth="2" />
          <line x1="0" y1="10" x2="0" y2="20" stroke="#94a3b8" strokeWidth="1.5" />
          {/* Delay cup/arc */}
          <path d="2 -4 A 6 6 0 0 1 8 4" fill="none" stroke="#22d3ee" strokeWidth="1" />
          <circle cx="0" cy="-10" r="1.5" fill="#64748b" />
          <circle cx="0" cy="10" r="1.5" fill="#64748b" />
        </g>
      );
    case 'timer_contacts_nc':
      return (
        <g>
          <line x1="0" y1="-20" x2="0" y2="-10" stroke="#94a3b8" strokeWidth="1.5" />
          <line x1="0" y1="-10" x2={isActive ? "9" : "0"} y2={isActive ? "8" : "10"} stroke={activeColor} strokeWidth="2" />
          <line x1="0" y1="10" x2="0" y2="20" stroke="#94a3b8" strokeWidth="1.5" />
          <path d="2 -4 A 6 6 0 0 1 8 4" fill="none" stroke="#22d3ee" strokeWidth="1" />
          <circle cx="0" cy="-10" r="1.5" fill="#64748b" />
          <circle cx="0" cy="10" r="1.5" fill="#64748b" />
        </g>
      );
    case 'contactor_coil':
      return (
        <g>
          <line x1="0" y1="-20" x2="0" y2="-15" stroke="#94a3b8" strokeWidth="1.5" />
          <rect x="-8" y="-15" width="16" height="30" fill={isActive ? "#064e3b" : "#0f172a"} stroke={activeColor} strokeWidth="2" className={glowClass} />
          <text x="0" y="4" textAnchor="middle" fill="#94a3b8" fontSize="8" fontFamily="monospace">KM</text>
          <line x1="0" y1="15" x2="0" y2="20" stroke="#94a3b8" strokeWidth="1.5" />
        </g>
      );
    case 'relay_coil':
      return (
        <g>
          <line x1="0" y1="-20" x2="0" y2="-15" stroke="#94a3b8" strokeWidth="1.5" />
          <rect x="-8" y="-15" width="16" height="30" fill={isActive ? "#064e3b" : "#0f172a"} stroke={activeColor} strokeWidth="2" />
          <text x="0" y="4" textAnchor="middle" fill="#94a3b8" fontSize="8" fontFamily="monospace">KA</text>
          <line x1="0" y1="15" x2="0" y2="20" stroke="#94a3b8" strokeWidth="1.5" />
        </g>
      );
    case 'timer_coil':
      return (
        <g>
          <line x1="0" y1="-20" x2="0" y2="-15" stroke="#94a3b8" strokeWidth="1.5" />
          <rect x="-8" y="-15" width="16" height="30" fill={isActive ? "#064e3b" : "#0f172a"} stroke={activeColor} strokeWidth="2" />
          {/* Clock icon or cross block */}
          <line x1="-8" y1="-15" x2="-2" y2="-8" stroke={activeColor} strokeWidth="1" />
          <line x1="-8" y1="-8" x2="-2" y2="-15" stroke={activeColor} strokeWidth="1" />
          <line x1="-8" y1="-8" x2="8" y2="-8" stroke={activeColor} strokeWidth="1" />
          <text x="0" y="7" textAnchor="middle" fill="#94a3b8" fontSize="8" fontFamily="monospace">KT</text>
          <line x1="0" y1="15" x2="0" y2="20" stroke="#94a3b8" strokeWidth="1.5" />
        </g>
      );
    case 'lamp':
      return (
        <g>
          <line x1="0" y1="-20" x2="0" y2="-15" stroke="#94a3b8" strokeWidth="1.5" />
          
          {/* Bulb */}
          <circle cx="0" cy="0" r="14" fill={isActive ? (customVal === 'green' ? '#047857' : '#b91c1c') : '#0f172a'} stroke={activeColor} strokeWidth="2" className={glowClass} />
          
          {/* Inner X */}
          <line x1="-9" y1="-9" x2="9" y2="9" stroke={isActive ? "#fff" : "#475569"} strokeWidth="1.5" />
          <line x1="-9" y1="9" x2="9" y2="-9" stroke={isActive ? "#fff" : "#475569"} strokeWidth="1.5" />
          
          <line x1="0" y1="14" x2="0" y2="20" stroke="#94a3b8" strokeWidth="1.5" />
        </g>
      );
    case 'buzzer':
      return (
        <g>
          <line x1="0" y1="-20" x2="0" y2="-12" stroke="#94a3b8" strokeWidth="1.5" />
          
          {/* Bell housing */}
          <path d="M-10-12 L 10-12 L 14 0 L -14 0 Z" fill={isActive ? "#78350f" : "#0f172a"} stroke={activeColor} strokeWidth="2" />
          {/* Speaker lines */}
          {isActive && (
            <g className="animate-pulse">
              <path d="M-18 6 A 12 12 0 0 1 -18 -6" fill="none" stroke="#f59e0b" strokeWidth="1" />
              <path d="M18 6 A 12 12 0 0 0 18 -6" fill="none" stroke="#f59e0b" strokeWidth="1" />
            </g>
          )}
          
          <line x1="0" y1="0" x2="0" y2="20" stroke="#94a3b8" strokeWidth="1.5" />
        </g>
      );
    case 'motor_3ph':
      return (
        <g>
          <circle cx="0" cy="0" r="28" fill="#0f172a" stroke={activeColor} strokeWidth="2.5" />
          <text x="0" y="3" textAnchor="middle" fill="#f8fafc" fontSize="10" fontWeight="bold" fontFamily="monospace">M 3~</text>
          
          {/* Rotating fan indicator */}
          {motorSpeed > 0 && (
            <circle
              cx="0"
              cy="0"
              r="22"
              fill="none"
              stroke="#06b6d4"
              strokeWidth="1"
              strokeDasharray="6 4"
              className={motorSpeed > 1000 ? "animate-spin-custom-fast" : "animate-spin-custom"}
              style={{ transformOrigin: '0px 0px' }}
            />
          )}
        </g>
      );
    case 'motor_1ph':
      return (
        <g>
          <circle cx="0" cy="0" r="24" fill="#0f172a" stroke={activeColor} strokeWidth="2" />
          <text x="0" y="3" textAnchor="middle" fill="#f8fafc" fontSize="9" fontWeight="bold" fontFamily="monospace">M 1~</text>
          
          {/* Rotating fan */}
          {motorSpeed > 0 && (
            <circle
              cx="0"
              cy="0"
              r="18"
              fill="none"
              stroke="#06b6d4"
              strokeWidth="1"
              strokeDasharray="5 3"
              className="animate-spin-custom"
              style={{ transformOrigin: '0px 0px' }}
            />
          )}
        </g>
      );
    case 'plc_input':
      return (
        <g>
          <rect x="-16" y="-16" width="32" height="32" fill="#1e293b" stroke={activeColor} strokeWidth="1.5" rx="3" />
          <text x="0" y="1" textAnchor="middle" fill="#f1f5f9" fontSize="8" fontWeight="bold" fontFamily="monospace">IN</text>
          <text x="0" y="9" textAnchor="middle" fill="#94a3b8" fontSize="7" fontFamily="monospace">{label}</text>
          {isActive && (
            <circle cx="0" cy="-10" r="2" fill="#10b981" className="glow-green animate-pulse" />
          )}
        </g>
      );
    case 'plc_output':
      return (
        <g>
          <rect x="-16" y="-16" width="32" height="32" fill="#1e293b" stroke={activeColor} strokeWidth="1.5" rx="3" />
          <text x="0" y="1" textAnchor="middle" fill="#f1f5f9" fontSize="8" fontWeight="bold" fontFamily="monospace">OUT</text>
          <text x="0" y="9" textAnchor="middle" fill="#94a3b8" fontSize="7" fontFamily="monospace">{label}</text>
          {isActive && (
            <circle cx="0" cy="-10" r="2" fill="#10b981" className="glow-green animate-pulse" />
          )}
        </g>
      );
    default:
      return (
        <g>
          <rect x="-15" y="-15" width="30" height="30" fill="#1e293b" stroke="#475569" strokeWidth="2" />
          <text x="0" y="4" textAnchor="middle" fill="#fff" fontSize="8">??</text>
        </g>
      );
  }
}
