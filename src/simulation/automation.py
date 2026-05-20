import json
import random

class ElectricalSystem:
    def __init__(self):
        # Schematic representation
        self.components = {} # id -> comp_dict
        self.wires = []      # list of wire_dicts
        
        # Operational States
        self.breaker_states = {}    # compId -> bool (True=Closed, False=Open)
        self.fuse_states = {}       # compId -> bool (True=OK, False=Blown)
        self.pressed_buttons = {}   # compId -> bool (True=Pressed, False=Released)
        self.toggled_switches = {}  # compId -> bool (True=Toggled ON, False=Toggled OFF)
        
        self.active_coils = {}      # coilLabel -> bool
        self.active_timers = {}     # timerLabel -> bool
        self.timers = {}            # compId -> float (elapsed time in seconds)
        self.overloads_tripped = {} # overloadLabel/motorLabel -> bool
        self.motor_parameters = {}  # compId -> { "speed": float, "temp": float, "current": float }
        
        # PLC State
        self.plc_input_states = {}  # label -> bool
        self.plc_output_states = {} # label -> bool
        self.plc_code = """# Código CLP - Intertravamento David
# I0 = Botão Liga (S1)
# I1 = Botão Desliga (S0)
# Q0 = Bobina Contator KM1

if I0:
    Q0 = True
if I1:
    Q0 = False
"""
        self.plc_logic_enabled = True
        
        # Global states
        self.short_circuited = False
        self.alarm_active = False
        self.alarm_message = ""
        self.logs = ["CAD DAVID Inicializado.", "Aguardando projeto elétrico..."]
        
        # Telemetry Cache
        self.wire_potentials = {}
        self.active_components = {}

    def log_event(self, message):
        self.logs.insert(0, message)
        if len(self.logs) > 20:
            self.logs.pop()

    def load_schematic(self, components_list, wires_list):
        self.components = {c['id']: c for c in components_list}
        self.wires = wires_list
        
        # Initialize missing states
        for c in components_list:
            cid = c['id']
            ctype = c['type']
            label = c.get('label', '')
            
            if cid not in self.breaker_states and ctype in ['breaker_1p', 'breaker_3p']:
                self.breaker_states[cid] = True # Default breakers to ON
            if cid not in self.fuse_states and ctype == 'fuse':
                self.fuse_states[cid] = True
            if cid not in self.pressed_buttons and ctype in ['pushbutton_no', 'pushbutton_nc']:
                self.pressed_buttons[cid] = False
            if cid not in self.toggled_switches and ctype == 'selector_switch_no':
                self.toggled_switches[cid] = False
                
            if ctype in ['motor_3ph', 'motor_1ph'] and cid not in self.motor_parameters:
                self.motor_parameters[cid] = { "speed": 0.0, "temp": 24.0, "current": 0.0 }
                if label:
                    self.overloads_tripped[label] = False
                    
        self.log_event("Novo esquemático carregado com sucesso no CAD.")

    def get_component_terminals(self, c):
        ctype = c['type']
        if ctype in ['source_l1', 'source_l2', 'source_l3', 'source_n', 'source_pe', 'source_dc_pos', 'source_dc_neg']:
            return ['1']
        elif ctype == 'breaker_3p':
            return ['1', '2', '3', '4', '5', '6']
        elif ctype in ['contactor_contacts_no_power']:
            return ['1', '2', '3', '4', '5', '6']
        elif ctype == 'pushbutton_no':
            return ['3', '4']
        elif ctype == 'pushbutton_nc':
            return ['1', '2']
        elif ctype == 'selector_switch_no':
            return ['3', '4']
        elif ctype == 'contactor_contacts_no':
            return ['13', '14']
        elif ctype == 'contactor_contacts_nc':
            return ['11', '12']
        elif ctype == 'overload_relay_contacts_nc':
            return ['95', '96']
        elif ctype == 'overload_relay_contacts_no':
            return ['97', '98']
        elif ctype == 'timer_contacts_no':
            return ['15', '18']
        elif ctype == 'timer_contacts_nc':
            return ['15', '16']
        elif ctype in ['contactor_coil', 'relay_coil', 'timer_coil']:
            return ['A1', 'A2']
        elif ctype in ['lamp', 'buzzer']:
            return ['X1', 'X2']
        elif ctype == 'motor_3ph':
            return ['U', 'V', 'W', 'PE']
        elif ctype == 'motor_1ph':
            return ['U', 'N', 'PE']
        elif ctype == 'plc_input':
            return ['IN', 'COM']
        elif ctype == 'plc_output':
            return ['1', '2']
        # Default fallback
        return ['1', '2']

    def connect_terms(self, adj, cid, t1, t2):
        term1 = f"{cid}:{t1}"
        term2 = f"{cid}:{t2}"
        if term1 in adj and term2 in adj:
            adj[term1].add(term2)
            adj[term2].add(term1)

    def update_simulation(self):
        if not self.components:
            return

        # Solve the circuit topically with relaxation (up to 5 iterations)
        prev_active_coils = {}
        prev_active_timers = {}
        
        for relax_iter in range(5):
            # 1. Gather all active terminals in the schematic
            terminals = set()
            for c in self.components.values():
                for term in self.get_component_terminals(c):
                    terminals.add(f"{c['id']}:{term}")
            
            # Initialize adjacency map
            adj = {t: set() for t in terminals}
            
            # 2. Add wires as graph edges
            for w in self.wires:
                t1 = f"{w['fromComponentId']}:{w['fromTerminalId']}"
                t2 = f"{w['toComponentId']}:{w['toTerminalId']}"
                if t1 in adj and t2 in adj:
                    adj[t1].add(t2)
                    adj[t2].add(t1)
            
            # 3. Add internal closed contacts as graph edges
            for c in self.components.values():
                cid = c['id']
                ctype = c['type']
                label = c.get('label', '')
                
                if ctype == 'breaker_1p':
                    if self.breaker_states.get(cid, False):
                        self.connect_terms(adj, cid, '1', '2')
                elif ctype == 'breaker_3p':
                    if self.breaker_states.get(cid, False):
                        self.connect_terms(adj, cid, '1', '2')
                        self.connect_terms(adj, cid, '3', '4')
                        self.connect_terms(adj, cid, '5', '6')
                elif ctype == 'fuse':
                    if self.fuse_states.get(cid, True):
                        self.connect_terms(adj, cid, '1', '2')
                elif ctype == 'pushbutton_no':
                    if self.pressed_buttons.get(cid, False):
                        self.connect_terms(adj, cid, '3', '4')
                elif ctype == 'pushbutton_nc':
                    if not self.pressed_buttons.get(cid, False):
                        self.connect_terms(adj, cid, '1', '2')
                elif ctype == 'selector_switch_no':
                    if self.toggled_switches.get(cid, False):
                        self.connect_terms(adj, cid, '3', '4')
                elif ctype == 'contactor_contacts_no_power':
                    ref = c.get('refTag', '')
                    if self.active_coils.get(ref, False):
                        self.connect_terms(adj, cid, '1', '2')
                        self.connect_terms(adj, cid, '3', '4')
                        self.connect_terms(adj, cid, '5', '6')
                elif ctype == 'contactor_contacts_no':
                    ref = c.get('refTag', '')
                    if self.active_coils.get(ref, False):
                        self.connect_terms(adj, cid, '13', '14')
                elif ctype == 'contactor_contacts_nc':
                    ref = c.get('refTag', '')
                    if not self.active_coils.get(ref, False):
                        self.connect_terms(adj, cid, '11', '12')
                elif ctype == 'overload_relay_contacts_nc':
                    ref = c.get('refTag', '')
                    if not self.overloads_tripped.get(ref, False):
                        self.connect_terms(adj, cid, '95', '96')
                elif ctype == 'overload_relay_contacts_no':
                    ref = c.get('refTag', '')
                    if self.overloads_tripped.get(ref, False):
                        self.connect_terms(adj, cid, '97', '98')
                elif ctype == 'timer_contacts_no':
                    ref = c.get('refTag', '')
                    if self.active_timers.get(ref, False):
                        self.connect_terms(adj, cid, '15', '18')
                elif ctype == 'timer_contacts_nc':
                    ref = c.get('refTag', '')
                    if not self.active_timers.get(ref, False):
                        self.connect_terms(adj, cid, '15', '16')
                elif ctype == 'plc_output':
                    ref = c.get('refTag', '')
                    if self.plc_output_states.get(ref, False):
                        self.connect_terms(adj, cid, '1', '2')
            
            # 4. Find connected components (DFS)
            visited = set()
            nodes = []
            for t in terminals:
                if t not in visited:
                    comp = []
                    q = [t]
                    visited.add(t)
                    while q:
                        curr = q.pop()
                        comp.append(curr)
                        for nxt in adj.get(curr, []):
                            if nxt not in visited:
                                visited.add(nxt)
                                q.append(nxt)
                    nodes.append(set(comp))
            
            # 5. Evaluate potential for each node
            terminal_potentials = {}
            self.short_circuited = False
            
            for node in nodes:
                pots = set()
                for t in node:
                    cid, term = t.split(":")
                    comp = self.components.get(cid)
                    if comp:
                        ctype = comp['type']
                        if ctype == 'source_l1': pots.add("L1")
                        elif ctype == 'source_l2': pots.add("L2")
                        elif ctype == 'source_l3': pots.add("L3")
                        elif ctype == 'source_n': pots.add("N")
                        elif ctype == 'source_pe': pots.add("PE")
                        elif ctype == 'source_dc_pos': pots.add("+")
                        elif ctype == 'source_dc_neg': pots.add("-")
                
                # Check for short-circuit conflicts
                power_pots = pots.intersection({"L1", "L2", "L3", "N", "+", "-"})
                if len(power_pots) > 1 or (("PE" in pots) and len(power_pots) > 0):
                    self.short_circuited = True
                    self.alarm_active = True
                    self.alarm_message = "CURTO-CIRCUITO DETECTADO!"
                    self.log_event(f"FALHA CRÍTICA: Curto-circuito detectado! Potenciais: {list(pots)}")
                    
                    # Trip breakers to protect the circuit
                    for bid in self.breaker_states:
                        if self.breaker_states[bid]:
                            self.breaker_states[bid] = False
                            self.log_event(f"Disjuntor de segurança {self.components[bid].get('label', bid)} desarmado.")
                    pot = None
                else:
                    pot = list(pots)[0] if pots else None
                
                for t in node:
                    terminal_potentials[t] = pot
            
            # If short-circuited, clear active components and stop relaxation
            if self.short_circuited:
                self.active_components = {}
                self.wire_potentials = {}
                self.active_coils = {}
                self.active_timers = {}
                break

            # 6. Evaluate loads (Coils, lamps, buzzers, motors)
            self.active_components = {}
            temp_active_coils = {}
            temp_active_timers = {}
            self.plc_input_states = {}
            
            for c in self.components.values():
                cid = c['id']
                ctype = c['type']
                label = c.get('label', '')
                
                if ctype in ['contactor_coil', 'relay_coil']:
                    a1 = terminal_potentials.get(f"{cid}:A1")
                    a2 = terminal_potentials.get(f"{cid}:A2")
                    # Needs Phase and Neutral or DC + and -
                    if (a1 in ["L1", "L2", "L3", "+"] and a2 in ["N", "-"]) or (a2 in ["L1", "L2", "L3", "+"] and a1 in ["N", "-"]):
                        self.active_components[cid] = True
                        if label:
                            temp_active_coils[label] = True
                            
                elif ctype == 'timer_coil':
                    a1 = terminal_potentials.get(f"{cid}:A1")
                    a2 = terminal_potentials.get(f"{cid}:A2")
                    if (a1 in ["L1", "L2", "L3", "+"] and a2 in ["N", "-"]) or (a2 in ["L1", "L2", "L3", "+"] and a1 in ["N", "-"]):
                        self.active_components[cid] = True
                        # Advance timer (0.5s per simulation tick)
                        self.timers[cid] = self.timers.get(cid, 0.0) + 0.5
                        limit = 5.0
                        try:
                            # Try to extract delay float from component value
                            limit = float(c.get('value', '5').replace('s', '').strip())
                        except:
                            pass
                        if self.timers[cid] >= limit:
                            if label:
                                temp_active_timers[label] = True
                    else:
                        self.timers[cid] = 0.0
                        
                elif ctype in ['lamp', 'buzzer']:
                    x1 = terminal_potentials.get(f"{cid}:X1")
                    x2 = terminal_potentials.get(f"{cid}:X2")
                    if (x1 in ["L1", "L2", "L3", "+"] and x2 in ["N", "-"]) or (x2 in ["L1", "L2", "L3", "+"] and x1 in ["N", "-"]):
                        self.active_components[cid] = True
                        
                elif ctype == 'plc_input':
                    inp = terminal_potentials.get(f"{cid}:IN")
                    com = terminal_potentials.get(f"{cid}:COM")
                    if (inp in ["L1", "L2", "L3", "+"] and com in ["N", "-"]) or (com in ["L1", "L2", "L3", "+"] and inp in ["N", "-"]):
                        if label:
                            self.plc_input_states[label] = True

            # Check for convergence in relaxation loop
            if temp_active_coils == self.active_coils and temp_active_timers == self.active_timers:
                break
                
            self.active_coils = temp_active_coils
            self.active_timers = temp_active_timers

        # 7. Update Motor Physics (outside the potential loop, uses final stable state)
        total_current_sum = 0.0
        for c in self.components.values():
            cid = c['id']
            ctype = c['type']
            label = c.get('label', '')
            
            if ctype == 'motor_3ph':
                u = terminal_potentials.get(f"{cid}:U")
                v = terminal_potentials.get(f"{cid}:V")
                w = terminal_potentials.get(f"{cid}:W")
                
                # Requires three distinct phases
                has_power = u in ["L1", "L2", "L3"] and v in ["L1", "L2", "L3"] and w in ["L1", "L2", "L3"] and len({u, v, w}) == 3
                
                params = self.motor_parameters.get(cid, { "speed": 0.0, "temp": 24.0, "current": 0.0 })
                
                if has_power and not self.overloads_tripped.get(label, False):
                    self.active_components[cid] = True
                    params["speed"] = round(params["speed"] + (1790.0 - params["speed"]) * 0.15, 1)
                    # Current load is nominal ~12.5A with a bit of noise
                    params["current"] = round(12.5 + random.uniform(-0.3, 0.4), 1)
                    # Heat up based on current square
                    params["temp"] = round(params["temp"] + (params["current"] * 0.02) - 0.12, 1)
                    
                    # Thermal Overload Check (Trip at 85°C)
                    if params["temp"] > 85.0:
                        self.overloads_tripped[label] = True
                        self.alarm_active = True
                        self.alarm_message = f"SOBRECARGA MOTOR {label}"
                        self.log_event(f"TRIP TÉRMICO: Motor {label} superaquecido ({params['temp']}°C). Relé térmico atuou!")
                else:
                    params["speed"] = round(params["speed"] * 0.7, 1)
                    if params["speed"] < 5.0: params["speed"] = 0.0
                    params["current"] = 0.0
                    # Cool down
                    params["temp"] = round(params["temp"] - (params["temp"] - 24.0) * 0.06, 1)
                
                self.motor_parameters[cid] = params
                total_current_sum += params["current"]
                
            elif ctype == 'motor_1ph':
                u = terminal_potentials.get(f"{cid}:U")
                n = terminal_potentials.get(f"{cid}:N")
                has_power = (u in ["L1", "L2", "L3"] and n == "N") or (n in ["L1", "L2", "L3"] and u == "N")
                
                params = self.motor_parameters.get(cid, { "speed": 0.0, "temp": 24.0, "current": 0.0 })
                
                if has_power and not self.overloads_tripped.get(label, False):
                    self.active_components[cid] = True
                    params["speed"] = round(params["speed"] + (1740.0 - params["speed"]) * 0.15, 1)
                    params["current"] = round(7.2 + random.uniform(-0.15, 0.2), 1)
                    params["temp"] = round(params["temp"] + (params["current"] * 0.015) - 0.08, 1)
                    
                    if params["temp"] > 80.0:
                        self.overloads_tripped[label] = True
                        self.alarm_active = True
                        self.alarm_message = f"SOBRECARGA MOTOR {label}"
                        self.log_event(f"TRIP TÉRMICO: Motor {label} superaquecido ({params['temp']}°C). Relé térmico atuou!")
                else:
                    params["speed"] = round(params["speed"] * 0.75, 1)
                    if params["speed"] < 5.0: params["speed"] = 0.0
                    params["current"] = 0.0
                    params["temp"] = round(params["temp"] - (params["temp"] - 24.0) * 0.05, 1)
                
                self.motor_parameters[cid] = params
                total_current_sum += params["current"]

        # Calculate Total Power
        # P = sqrt(3) * V * I * cos(phi) / 1000  (approximate active demand for 380V network)
        self.state["total_power"] = round((1.732 * 380.0 * total_current_sum * 0.85) / 1000.0, 1)

        # 8. Run PLC Logic
        if self.plc_logic_enabled and self.plc_code.strip():
            try:
                # Prepare execution context
                local_context = {
                    "log_event": self.log_event,
                    "state": self.state
                }
                
                # Bind Inputs (e.g. I0, I1)
                for out_lbl in ['I0', 'I1', 'I2', 'I3', 'I4', 'I5']:
                    local_context[out_lbl] = self.plc_input_states.get(out_lbl, False)
                    
                # Bind Outputs (e.g. Q0, Q1)
                for out_lbl in ['Q0', 'Q1', 'Q2', 'Q3', 'Q4', 'Q5']:
                    local_context[out_lbl] = self.plc_output_states.get(out_lbl, False)
                
                # Execute Python user logic
                exec(self.plc_code, globals(), local_context)
                
                # Read outputs back
                for out_lbl in ['Q0', 'Q1', 'Q2', 'Q3', 'Q4', 'Q5']:
                    if out_lbl in local_context:
                        self.plc_output_states[out_lbl] = bool(local_context[out_lbl])
            except Exception as e:
                self.alarm_active = True
                self.alarm_message = "ERRO SINTAXE CLP!"
                self.log_event(f"ERRO CLP: {str(e)}")

        # 9. Compute wire potentials to color wires on canvas
        self.wire_potentials = {}
        for w in self.wires:
            wid = w['id']
            t1 = f"{w['fromComponentId']}:{w['fromTerminalId']}"
            t2 = f"{w['toComponentId']}:{w['toTerminalId']}"
            p1 = terminal_potentials.get(t1)
            p2 = terminal_potentials.get(t2)
            pot = p1 or p2
            if pot:
                self.wire_potentials[wid] = pot

        # Global grid telemetry readings
        self.state["grid_voltage"] = 380.0 + random.uniform(-1.0, 1.0) if len(self.components) > 0 else 0.0
        self.state["grid_frequency"] = 60.0 + random.uniform(-0.05, 0.05) if len(self.components) > 0 else 0.0
        self.state["alarm_active"] = self.alarm_active
        self.state["alarm_message"] = self.alarm_message

    def handle_request(self, path, method, params_json):
        params = {}
        if params_json:
            try:
                params = json.loads(params_json)
            except Exception:
                pass

        # Trigger simulation tick before rendering/responding
        self.update_simulation()

        if path == "/api/wasm/schematic/update" and method == "POST":
            components = params.get("components", [])
            wires = params.get("wires", [])
            self.load_schematic(components, wires)
            return "OK"

        elif path == "/api/wasm/breaker/toggle" and method == "POST":
            bid = params.get("breakerId")
            if bid in self.breaker_states:
                self.breaker_states[bid] = not self.breaker_states[bid]
                status_str = "FECHADO (ON)" if self.breaker_states[bid] else "ABERTO (OFF)"
                label = self.components.get(bid, {}).get('label', bid)
                self.log_event(f"Disjuntor {label} comutado para {status_str}")
            return self.render_breakers()

        elif path == "/api/wasm/component/toggle" and method == "POST":
            cid = params.get("componentId")
            comp = self.components.get(cid)
            if comp:
                ctype = comp['type']
                label = comp.get('label', cid)
                if ctype in ['pushbutton_no', 'pushbutton_nc']:
                    self.pressed_buttons[cid] = not self.pressed_buttons.get(cid, False)
                    status_str = "Pressionado" if self.pressed_buttons[cid] else "Liberado"
                    self.log_event(f"Botoeira {label}: {status_str}")
                elif ctype == 'selector_switch_no':
                    self.toggled_switches[cid] = not self.toggled_switches.get(cid, False)
                    status_str = "LIGADA" if self.toggled_switches[cid] else "DESLIGADA"
                    self.log_event(f"Chave Seletora {label}: {status_str}")
            return "OK"

        elif path == "/api/wasm/plc/update" and method == "POST":
            new_code = params.get("plcCode", "")
            self.plc_code = new_code
            self.log_event("Novo programa CLP compilado e carregado com sucesso.")
            return self.render_plc_status(success=True)

        elif path == "/api/wasm/plc/toggle" and method == "POST":
            self.plc_logic_enabled = not self.plc_logic_enabled
            status = "ATIVADO" if self.plc_logic_enabled else "DESATIVADO"
            self.log_event(f"Modo CLP alterado: {status}")
            return self.render_plc_status()

        elif path == "/api/wasm/alarm/reset" and method == "POST":
            self.alarm_active = False
            self.alarm_message = ""
            for motor_lbl in self.overloads_tripped:
                self.overloads_tripped[motor_lbl] = False
            self.log_event("Alarmes e trips térmicos rearmados pelo operador.")
            return ""

        elif path.startswith("/api/wasm/component/"):
            comp_id = path.replace("/api/wasm/component/", "")
            return self.render_component_details(comp_id)

        elif path == "/api/wasm/telemetry" and method == "GET":
            return json.dumps({
                "state": self.state,
                "logs": self.logs,
                "plcCode": self.plc_code,
                "energizedNodes": self.wire_potentials,
                "activeComponents": self.active_components,
                "shortCircuited": self.short_circuited
            })

        return "<h1>404 - Rota WASM CAD DAVID não encontrada</h1>"

    def render_breakers(self):
        # Gather all circuit breakers in the loaded schematic
        breakers = [c for c in self.components.values() if c['type'] in ['breaker_1p', 'breaker_3p']]
        if not breakers:
            return '<div class="p-4 text-center text-xs text-slate-500 font-mono">Nenhum disjuntor no projeto.</div>'
            
        html = ""
        for b in breakers:
            bid = b['id']
            label = b.get('label', bid)
            is_on = self.breaker_states.get(bid, False)
            status_color = "bg-emerald-500 shadow-glow-green animate-pulse" if is_on else "bg-rose-500 shadow-glow-red"
            status_text = "LIGADO (FECHADO)" if is_on else "DESLIGADO (ABERTO)"
            btn_text = "Abrir" if is_on else "Fechar"
            btn_class = "px-3 py-1 rounded text-xs font-semibold transition-all duration-300 " + (
                "bg-rose-950/40 text-rose-400 border border-rose-800/40 hover:bg-rose-900/50" if is_on else 
                "bg-emerald-950/40 text-emerald-400 border border-emerald-800/40 hover:bg-emerald-900/50"
            )
            
            html += f"""
            <div class="flex items-center justify-between p-2.5 rounded-xl bg-slate-900/40 border border-slate-800/50 hover:border-slate-700 transition-all duration-300">
                <div>
                    <div class="flex items-center gap-2">
                        <span class="w-2.5 h-2.5 rounded-full {status_color}"></span>
                        <span class="font-bold text-sm text-slate-100 font-mono">{label}</span>
                    </div>
                    <span class="text-[10px] text-slate-400 mt-0.5 block">Classe: {b['type'].replace('_', ' ').upper()}</span>
                </div>
                <button hx-post="/api/wasm/breaker/toggle"
                        hx-vals='{{"breakerId": "{bid}"}}'
                        hx-target="#breakers-list"
                        hx-swap="innerHTML"
                        class="{btn_class}">
                    {btn_text}
                </button>
            </div>
            """
        return html

    def render_plc_status(self, success=False):
        status_color = "text-emerald-400" if self.plc_logic_enabled else "text-slate-500"
        status_text = "RUNNING (ATIVO)" if self.plc_logic_enabled else "STOPPED (INATIVO)"
        btn_text = "Parar CLP" if self.plc_logic_enabled else "Iniciar CLP"
        btn_class = "px-3 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-xs font-medium text-slate-200 transition-colors " + (
            "border border-zinc-700 hover:border-rose-900" if self.plc_logic_enabled else "border border-zinc-700 hover:border-emerald-900"
        )
        
        success_badge = ""
        if success:
            success_badge = '<span class="text-[10px] bg-emerald-950/80 text-emerald-400 border border-emerald-800 px-2 py-0.5 rounded animate-pulse">CLP Compilado!</span>'
            
        return f"""
        <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
                <span class="text-xs font-semibold tracking-wider text-slate-400 uppercase">Estado:</span>
                <span class="text-xs font-bold font-mono {status_color}">{status_text}</span>
                {success_badge}
            </div>
            <button hx-post="/api/wasm/plc/toggle"
                    hx-target="#plc-status-container"
                    class="{btn_class}">
                {btn_text}
            </button>
        </div>
        """

    def render_component_details(self, comp_id):
        comp = self.components.get(comp_id)
        if not comp:
            return '<div class="p-4 text-center text-xs text-slate-500 font-mono">Componente não encontrado.</div>'
            
        ctype = comp['type']
        label = comp.get('label', comp_id)
        
        if ctype in ['motor_3ph', 'motor_1ph']:
            params = self.motor_parameters.get(comp_id, { "speed": 0.0, "temp": 24.0, "current": 0.0 })
            status = "SIMULANDO" if self.active_components.get(comp_id, False) else "DESLIGADO"
            color_class = "text-emerald-400 font-bold" if status == "SIMULANDO" else "text-slate-500"
            temp_color = "text-rose-400 font-bold animate-pulse-glow" if params['temp'] > 75.0 else ("text-orange-400" if params['temp'] > 50 else "text-emerald-400")
            trip_status = "TRIP (FALHA)" if self.overloads_tripped.get(label, False) else "OPERANTE"
            trip_color = "text-rose-400 font-bold" if self.overloads_tripped.get(label, False) else "text-emerald-400"
            
            phase_type = "Trifásico 380V AC" if ctype == 'motor_3ph' else "Monofásico 220V AC"
            
            return f"""
            <div class="bg-slate-950/60 p-4 border border-slate-800 rounded-2xl">
                <div class="flex justify-between items-start mb-3 border-b border-slate-800 pb-2.5">
                    <div>
                        <h3 class="font-extrabold text-sm text-slate-100">{label}</h3>
                        <p class="text-[10px] text-slate-400 font-mono">Motor {phase_type}</p>
                    </div>
                    <span class="text-[10px] font-bold px-2 py-0.5 rounded bg-slate-900 border border-slate-800 {color_class}">{status}</span>
                </div>
                
                <table class="w-full text-[11px] font-mono text-slate-300">
                    <tbody>
                        <tr class="border-b border-slate-900/60"><td class="py-1.5 text-slate-400">Velocidade:</td><td class="text-right py-1.5 font-bold text-cyan-400">{params['speed']} RPM</td></tr>
                        <tr class="border-b border-slate-900/60"><td class="py-1.5 text-slate-400">Consumo:</td><td class="text-right py-1.5 font-bold text-cyan-400">{params['current']} A</td></tr>
                        <tr class="border-b border-slate-900/60"><td class="py-1.5 text-slate-400">Temp. Carcaça:</td><td class="text-right py-1.5 font-bold {temp_color}">{params['temp']} °C</td></tr>
                        <tr><td class="py-1.5 text-slate-400">Relé Térmico:</td><td class="text-right py-1.5 font-bold {trip_color}">{trip_status}</td></tr>
                    </tbody>
                </table>
            </div>
            """
            
        elif ctype in ['contactor_coil', 'relay_coil', 'timer_coil']:
            is_active = self.active_components.get(comp_id, False)
            status_text = "ENERGIZADA (ON)" if is_active else "DESENERGIZADA (OFF)"
            status_color = "text-emerald-400 font-bold" if is_active else "text-slate-500"
            
            extra_row = ""
            if ctype == 'timer_coil':
                elapsed = self.timers.get(comp_id, 0.0)
                limit = 5.0
                try:
                    limit = float(comp.get('value', '5').replace('s', '').strip())
                except:
                    pass
                extra_row = f"""
                <tr class="border-b border-slate-900/60">
                    <td class="py-1.5 text-slate-400">Tempo Ajustado:</td>
                    <td class="text-right py-1.5 font-bold text-cyan-400">{limit} s</td>
                </tr>
                <tr>
                    <td class="py-1.5 text-slate-400">Tempo Decorrido:</td>
                    <td class="text-right py-1.5 font-bold text-emerald-400">{round(elapsed, 1)} s</td>
                </tr>
                """
            
            return f"""
            <div class="bg-slate-950/60 p-4 border border-slate-800 rounded-2xl">
                <div class="flex justify-between items-start mb-3 border-b border-slate-800 pb-2.5">
                    <div>
                        <h3 class="font-extrabold text-sm text-slate-100">{label}</h3>
                        <p class="text-[10px] text-slate-400 font-mono">Bobina Eletromagnética</p>
                    </div>
                    <span class="text-[10px] font-bold px-2 py-0.5 rounded bg-slate-900 border border-slate-800 {status_color}">{status_text}</span>
                </div>
                <table class="w-full text-[11px] font-mono text-slate-300">
                    <tbody>
                        <tr class="border-b border-slate-900/60">
                            <td class="py-1.5 text-slate-400">TAG Referência:</td>
                            <td class="text-right py-1.5 font-bold text-slate-100">{label}</td>
                        </tr>
                        {extra_row}
                    </tbody>
                </table>
            </div>
            """
            
        elif ctype in ['breaker_1p', 'breaker_3p']:
            is_on = self.breaker_states.get(comp_id, False)
            status_text = "LIGADO (FECHADO)" if is_on else "DESLIGADO (ABERTO)"
            status_color = "text-emerald-400 font-bold" if is_on else "text-slate-500 font-bold"
            
            return f"""
            <div class="bg-slate-950/60 p-4 border border-slate-800 rounded-2xl">
                <div class="flex justify-between items-start mb-3 border-b border-slate-800 pb-2.5">
                    <div>
                        <h3 class="font-extrabold text-sm text-slate-100">{label}</h3>
                        <p class="text-[10px] text-slate-400 font-mono">Disjuntor de Proteção</p>
                    </div>
                    <span class="text-[10px] font-bold px-2 py-0.5 rounded bg-slate-900 border border-slate-800 {status_color}">{status_text}</span>
                </div>
                <div class="flex gap-2 mt-2">
                    <button hx-post="/api/wasm/breaker/toggle"
                            hx-vals='{{"breakerId": "{comp_id}"}}'
                            hx-target="#breakers-list"
                            class="w-full py-1.5 text-[11px] font-bold bg-zinc-800 hover:bg-zinc-700 text-slate-200 border border-zinc-700 rounded-lg transition-colors">
                        Inverter Disjuntor
                    </button>
                </div>
            </div>
            """

        # General component details
        return f"""
        <div class="bg-slate-950/60 p-4 border border-slate-800 rounded-2xl">
            <h3 class="font-extrabold text-sm text-slate-100 border-b border-slate-800 pb-2 mb-2">{label}</h3>
            <p class="text-[11px] text-slate-400 font-mono">Tipo: {ctype.replace('_', ' ').title()}</p>
            <p class="text-[11px] text-slate-400 font-mono mt-1">ID: {comp_id}</p>
            <p class="text-[11px] text-slate-400 font-mono mt-1">Estado: Operando Normalmente</p>
        </div>
        """

# Instanciar o sistema global
sys = ElectricalSystem()
