/* =========================
   Superaquecimento PWA v2.1
   - Convencional x Inverter
   - Tsat por pressão (10–200 psi, passo 1)
   - PT base: Johnstone Supply Pressure/Temperature Chart (R410A, R32, R22)
   ========================= */

const $ = (id) => document.getElementById(id);

const els = {
  btnConv: $("btnConv"),
  btnInv: $("btnInv"),
  tipoHint: $("tipoHint"),
  gas: $("gas"),
  psi: $("psi"),
  tsuc: $("tsuc"),
  tsat: $("tsat"),
  tsatAutoInfo: $("tsatAutoInfo"),
  autoTsat: $("autoTsat"),
  autoBadge: $("autoBadge"),
  btnCalc: $("btnCalc"),
  btnClear: $("btnClear"),
  shOut: $("shOut"),
  faixaOut: $("faixaOut"),
  statusOut: $("statusOut"),
  alertBox: $("alertBox"),
  alertText: $("alertText"),
  btnInstall: $("btnInstall")
};

const STORAGE_KEY = "sh_pwa_tipoSistema";
let tipoSistema = localStorage.getItem(STORAGE_KEY) || "Convencional";
let deferredPrompt = null;

function toNum(v){
  if(v===null||v===undefined) return null;
  const s = String(v).trim().replace(",", ".");
  if(!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
function round1(n){ return Math.round(n*10)/10; }
function lerp(a,b,t){ return a + (b-a)*t; }
function fToC(f){ return (f - 32) * (5/9); }

function faixaPorTipo(tipo){
  return (tipo==="Inverter") ? {min:3, max:8} : {min:6, max:12};
}

/* -------------------------
   PT raw (TempF  R410Apsig  R32psig  R22psig)
------------------------- */
const PT_RAW = `-48.0 6.0 6.2 4.8
-44.0 8.3 8.5 1.9
-40.0 10.8 11.0 0.6
-36.0 13.4 13.7 2.2
-32.0 16.3 16.6 4.0
-28.0 19.4 19.8 5.9
-24.0 22.7 23.2 8.0
-20.0 26.3 26.8 10.2
-16.0 30.2 30.7 12.6
-12.0 34.3 34.9 15.2
-8.0 38.7 39.4 17.9
-4.0 43.4 44.1 20.9
0.0 48.4 49.2 24.0
2.0 51.1 51.9 25.7
4.0 53.8 54.7 27.4
6.0 56.6 57.5 29.2
8.0 59.5 60.5 31.0
10.0 62.4 63.5 32.8
12.0 65.5 66.6 34.8
14.0 68.6 69.8 36.8
16.0 71.9 73.1 38.8
18.0 75.2 76.5 40.9
20.0 78.7 80.0 43.1
22.0 82.2 83.6 45.3
24.0 85.8 87.3 47.6
26.0 89.6 91.1 50.0
28.0 93.4 95.1 52.4
30.0 97.4 99.1 55.0
32.0 101.4 103.2 57.5
34.0 105.6 107.5 60.2
36.0 109.9 111.9 62.9
38.0 114.3 116.3 65.7
40.0 118.8 120.9 68.6
42.0 123.4 125.7 71.5
44.0 128.2 130.5 74.5
46.0 133.0 135.5 77.6
48.0 138.0 140.6 80.8
50.0 143.2 145.8 84.1
52.0 148.4 151.2 87.4
56.0 159.3 162.3 94.4
60.0 170.7 174.0 101.6
64.0 182.7 186.3 109.3
68.0 195.3 199.2 117.3
72.0 208.4 212.6 125.7
76.0 222.2 226.7 134.5
80.0 236.5 241.5 143.6
84.0 251.6 256.9 153.2
88.0 267.3 273.0 163.2
92.0 283.6 289.8 173.7
96.0 300.7 307.4 184.6
100.0 318.7 325.7 195.9
104.0 337.1 344.7 207.7
108.0 356.5 364.6 220.0
112.0 376.6 385.3 232.8`;

function parsePt() {
  const rows = PT_RAW.split("\n")
    .map(l=>l.trim())
    .filter(Boolean)
    .map(l=>l.split(/\s+/).map(Number));

  const out = { R410A: [], R32: [], R22: [] };

  for(const r of rows){
    const tempF = r[0];
    const tC = fToC(tempF);
    const p410 = r[1];
    const p32 = r[2];
    const p22 = r[3];
    if(Number.isFinite(p410)) out.R410A.push({p:p410, tC});
    if(Number.isFinite(p32)) out.R32.push({p:p32, tC});
    if(Number.isFinite(p22)) out.R22.push({p:p22, tC});
  }

  for(const k of Object.keys(out)) out[k].sort((a,b)=>a.p-b.p);
  return out;
}

const PT = parsePt();

function tsatFromPsi(gas, psi) {
  const p = Math.round(psi); // passo 1 psi
  if(p < 10 || p > 200) return null;

  const list = PT[gas];
  if(!list || list.length < 2) return null;

  for(let i=0;i<list.length-1;i++){
    const a = list[i], b = list[i+1];
    if(p >= a.p && p <= b.p){
      const t = (p - a.p) / (b.p - a.p);
      return round1(lerp(a.tC, b.tC, t));
    }
  }
  return null;
}

/* -------------------------
   UI helpers
------------------------- */
function setAlert(type, text){
  els.alertBox.className = "alert " + type;
  els.alertText.textContent = text;
}

function atualizarFaixa(){
  const {min, max} = faixaPorTipo(tipoSistema);
  els.faixaOut.textContent = (tipoSistema==="Inverter")
    ? `Faixa típica (Inverter): ${min} a ${max}°C (varia com modulação)`
    : `Faixa esperada (Convencional): ${min} a ${max}°C (ideal 8–10°C)`;

  setAlert("neutral",
    (tipoSistema==="Inverter")
      ? "Em inverter, carga correta é por PESO (etiqueta). O SH serve como conferência e varia com a modulação."
      : "Em convencional, o SH é referência principal para carga e diagnóstico (com regime estabilizado)."
  );
}

function atualizarUI_Tipo(){
  const inv = (tipoSistema==="Inverter");
  els.btnConv.classList.toggle("active", !inv);
  els.btnInv.classList.toggle("active", inv);

  els.tipoHint.textContent = inv
    ? "Inverter: confira carga por PESO (etiqueta). Use SH para validar comportamento e sensores."
    : "Convencional: SH é referência principal (com filtros limpos e condições estabilizadas).";

  atualizarFaixa();
}

function setAutoUI(){
  if(els.autoTsat.checked){
    els.autoBadge.textContent = "Auto";
    els.tsat.disabled = true;
    els.tsat.value = "";
    els.tsat.placeholder = "Automático pela pressão";
    if(els.tsatAutoInfo) els.tsatAutoInfo.style.display = "block";
  } else {
    els.autoBadge.textContent = "Manual";
    els.tsat.disabled = false;
    els.tsat.placeholder = "Ex: 5";
    if(els.tsatAutoInfo) els.tsatAutoInfo.style.display = "none";
  }
}

function diagnosticar(sh){
  const {min, max} = faixaPorTipo(tipoSistema);

  if(sh < min){
    els.statusOut.textContent = "Status: BAIXO";
    setAlert("warn",
      (tipoSistema==="Inverter")
        ? "SH abaixo da faixa típica. Pode ser modulação/EEV/sensores. Confirme estabilização, filtros, carga térmica e leituras."
        : "SH baixo. Atenção para risco de retorno de líquido. Verifique excesso de carga, fluxo de ar alto e regime."
    );
    return;
  }

  if(sh > max){
    els.statusOut.textContent = "Status: ALTO";
    setAlert("bad",
      (tipoSistema==="Inverter")
        ? "SH acima da faixa típica. Pode sugerir baixa carga, mas confirme por PESO (etiqueta) e considere modulação/condições."
        : "SH alto. Possível falta de refrigerante, restrição (capilar/filtro), baixa vazão de ar ou baixa carga térmica."
    );
    return;
  }

  els.statusOut.textContent = "Status: OK";
  setAlert("good",
    (tipoSistema==="Inverter")
      ? "Dentro do esperado. Lembrete: em inverter, ajuste de carga é por PESO (etiqueta)."
      : "Dentro do padrão. Se houver queixa, investigue fluxo de ar, limpeza, carga térmica e sensores."
  );
}

function calcular(){
  const gas = els.gas.value;
  const tsuc = toNum(els.tsuc.value);

  if(tsuc===null){
    setAlert("bad","Informe a temperatura de sucção (°C).");
    return;
  }

  let tsat = null;

  if(els.autoTsat.checked){
    const psi = toNum(els.psi.value);
    if(psi===null){
      setAlert("bad","No modo automático, informe a pressão (psi).");
      return;
    }
    if(psi < 10 || psi > 200){
      setAlert("bad","Pressão fora da tabela automática: use 10 a 200 psi.");
      return;
    }
    tsat = tsatFromPsi(gas, psi);
    if(tsat===null){
      setAlert("bad","Não consegui calcular Tsat. Confira gás e pressão.");
      return;
    }
    els.tsat.value = String(tsat);
  } else {
    tsat = toNum(els.tsat.value);
    if(tsat===null){
      setAlert("bad","Informe a temperatura de saturação (°C) ou ative o modo automático.");
      return;
    }
  }

  const sh = round1(tsuc - tsat);
  els.shOut.textContent = `${sh} °C`;
  diagnosticar(sh);
}

function limpar(){
  els.psi.value = "";
  els.tsuc.value = "";
  if(!els.autoTsat.checked) els.tsat.value = "";
  els.shOut.textContent = "— °C";
  els.statusOut.textContent = "Status: —";
  atualizarFaixa();
}

/* Eventos */
els.btnConv.addEventListener("click", () => {
  tipoSistema = "Convencional";
  localStorage.setItem(STORAGE_KEY, tipoSistema);
  atualizarUI_Tipo();
});
els.btnInv.addEventListener("click", () => {
  tipoSistema = "Inverter";
  localStorage.setItem(STORAGE_KEY, tipoSistema);
  atualizarUI_Tipo();
});

els.autoTsat.addEventListener("change", () => {
  setAutoUI();
  if(els.autoTsat.checked) els.tsat.value = "";
  atualizarFaixa();
});

els.btnCalc.addEventListener("click", calcular);
els.btnClear.addEventListener("click", limpar);

/* PWA install */
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredPrompt = e;
  els.btnInstall.hidden = false;
});
els.btnInstall.addEventListener("click", async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
  els.btnInstall.hidden = true;
});

/* Service Worker */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}

/* Init */
atualizarUI_Tipo();
setAutoUI();
