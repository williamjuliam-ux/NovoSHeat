/* =========================
   Superaquecimento PWA v2.0
   - Convencional x Inverter
   - Tsat por pressão (10–200 psi, passo 1) via tabela interna + interpolação
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

function faixaPorTipo(tipo){
  return (tipo==="Inverter") ? {min:3, max:8} : {min:6, max:12};
}

/* -------------------------
   TABELA PT (âncoras) — psi -> Tsat(°C)
   Observação: é uma tabela interna para uso de campo (offline). Se precisar casar 100% com uma tabela específica,
   dá para substituir por outra base de dados.
------------------------- */
const PT_ANCHORS = {
  // Âncoras típicas aproximadas (psig) para evaporador/saturação
  // Formato: [psi, TsatC]
  "R410A": [
    [10, -24], [20, -14], [30, -7], [40, -2], [50, 3], [60, 7], [70, 10],
    [80, 13], [90, 16], [100, 19], [110, 22], [120, 24], [130, 27], [140, 29],
    [150, 31], [160, 33], [170, 35], [180, 37], [190, 39], [200, 41]
  ],
  "R32": [
    [10, -26], [20, -16], [30, -9], [40, -4], [50, 0], [60, 4], [70, 8],
    [80, 11], [90, 14], [100, 17], [110, 19], [120, 22], [130, 24], [140, 26],
    [150, 28], [160, 30], [170, 32], [180, 34], [190, 36], [200, 38]
  ],
  "R22": [
    [10, -28], [20, -18], [30, -11], [40, -6], [50, -1], [60, 3], [70, 6],
    [80, 9], [90, 12], [100, 15], [110, 18], [120, 20], [130, 23], [140, 25],
    [150, 27], [160, 29], [170, 31], [180, 33], [190, 35], [200, 37]
  ]
};

function buildLookup(gas){
  const anchors = PT_ANCHORS[gas];
  const map = {}; // psi integer -> TsatC
  for(let psi=10; psi<=200; psi++){
    // find segment
    let ts = null;
    for(let i=0;i<anchors.length-1;i++){
      const a = anchors[i], b = anchors[i+1];
      if(psi>=a[0] && psi<=b[0]){
        const t = (psi-a[0])/(b[0]-a[0]);
        ts = lerp(a[1], b[1], t);
        break;
      }
    }
    if(ts===null){
      // fallback edges
      if(psi<anchors[0][0]) ts = anchors[0][1];
      else ts = anchors[anchors.length-1][1];
    }
    map[String(psi)] = round1(ts);
  }
  return map;
}

const PT_LOOKUP = {
  "R410A": buildLookup("R410A"),
  "R32": buildLookup("R32"),
  "R22": buildLookup("R22")
};

function tsatFromPsi(gas, psi){
  const p = Math.round(psi); // passo 1 psi (arredondado)
  if(p<10 || p>200) return null;
  const table = PT_LOOKUP[gas];
  return table ? table[String(p)] : null;
}

/* -------------------------
   UI helpers
------------------------- */
function setAlert(type, title, text){
  els.alertBox.className = "alert " + type;
  // title is fixed label, keep in box
  els.alertText.textContent = text;
}

function atualizarFaixa(){
  const {min, max} = faixaPorTipo(tipoSistema);
  els.faixaOut.textContent = (tipoSistema==="Inverter")
    ? `Faixa típica (Inverter): ${min} a ${max}°C (varia com modulação)`
    : `Faixa esperada (Convencional): ${min} a ${max}°C (ideal 8–10°C)`;

  setAlert("neutral","Orientação",
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
  }else{
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
    setAlert("warn","Orientação",
      (tipoSistema==="Inverter")
        ? "SH abaixo da faixa típica. Pode ser modulação/EEV/sensores. Confirme estabilização, filtros, carga térmica e leituras."
        : "SH baixo. Atenção para risco de retorno de líquido. Verifique excesso de carga, fluxo de ar alto e regime."
    );
    return;
  }

  if(sh > max){
    els.statusOut.textContent = "Status: ALTO";
    setAlert("bad","Orientação",
      (tipoSistema==="Inverter")
        ? "SH acima da faixa típica. Pode sugerir baixa carga, mas confirme por PESO (etiqueta) e considere modulação/condições."
        : "SH alto. Possível falta de refrigerante, restrição (capilar/filtro), baixa vazão de ar ou baixa carga térmica."
    );
    return;
  }

  els.statusOut.textContent = "Status: OK";
  setAlert("good","Orientação",
    (tipoSistema==="Inverter")
      ? "Dentro do esperado. Lembrete: em inverter, ajuste de carga é por PESO (etiqueta)."
      : "Dentro do padrão. Se houver queixa, investigue fluxo de ar, limpeza, carga térmica e sensores."
  );
}

function calcular(){
  const gas = els.gas.value;
  const tsuc = toNum(els.tsuc.value);

  if(tsuc===null){
    els.alertBox.className = "alert bad";
    els.alertText.textContent = "Informe a temperatura de sucção (°C).";
    return;
  }

  let tsat = null;

  if(els.autoTsat.checked){
    const psi = toNum(els.psi.value);
    if(psi===null){
      els.alertBox.className = "alert bad";
      els.alertText.textContent = "No modo automático, informe a pressão (psi).";
      return;
    }
    if(psi < 10 || psi > 200){
      els.alertBox.className = "alert bad";
      els.alertText.textContent = "Pressão fora da tabela automática: use 10 a 200 psi.";
      return;
    }
    tsat = tsatFromPsi(gas, psi);
    if(tsat===null){
      els.alertBox.className = "alert bad";
      els.alertText.textContent = "Não consegui calcular Tsat. Confira gás e pressão.";
      return;
    }
    els.tsat.value = String(tsat);
  }else{
    tsat = toNum(els.tsat.value);
    if(tsat===null){
      els.alertBox.className = "alert bad";
      els.alertText.textContent = "Informe a temperatura de saturação (°C) ou ative o modo automático.";
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

/* -------------------------
   Eventos
------------------------- */
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
