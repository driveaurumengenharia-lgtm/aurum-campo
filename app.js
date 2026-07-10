// ---------- Registro do service worker (funciona offline) ----------
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("service-worker.js").catch(console.error);
}

// ---------- Abas: Coleta / Mapa offline ----------
const tabColeta = document.getElementById("tabColeta");
const tabMapa = document.getElementById("tabMapa");
const coletaWrap = document.getElementById("coletaWrap");
const mapaWrap = document.getElementById("mapaOfflineWrap");
tabColeta.onclick = () => { tabColeta.classList.add("active"); tabMapa.classList.remove("active"); coletaWrap.style.display="block"; mapaWrap.style.display="none"; };
tabMapa.onclick = () => { tabMapa.classList.add("active"); tabColeta.classList.remove("active"); coletaWrap.style.display="none"; mapaWrap.style.display="block"; drawMalha(); };

// ---------- Mapa offline vetorial (sem imagem de fundo, só geometria) ----------
let malhaData = null;
let malhaBounds = null;
let userLatLon = null;

async function carregarMalha(){
  try {
    const resp = await fetch("malha.json");
    malhaData = await resp.json();
    computeBounds();
    document.getElementById("malhaInfo").textContent = `${malhaData.features.length} feições carregadas (armazenadas no aparelho).`;
  } catch(e) {
    document.getElementById("malhaInfo").textContent = "Malha ainda não disponível offline.";
  }
}

function computeBounds(){
  let minLat=90,maxLat=-90,minLon=180,maxLon=-180;
  (malhaData.features||[]).forEach(f => {
    const coordsList = f.geometry.type === "LineString" ? f.geometry.coordinates
      : f.geometry.type === "Point" ? [f.geometry.coordinates] : [];
    coordsList.forEach(([lon,lat]) => {
      minLat=Math.min(minLat,lat); maxLat=Math.max(maxLat,lat);
      minLon=Math.min(minLon,lon); maxLon=Math.max(maxLon,lon);
    });
  });
  malhaBounds = { minLat, maxLat, minLon, maxLon };
}

function project(lon, lat, canvas){
  const pad = 20;
  const w = canvas.width - pad*2, h = canvas.height - pad*2;
  const b = malhaBounds;
  const x = pad + ((lon - b.minLon) / (b.maxLon - b.minLon || 1)) * w;
  const y = pad + (1 - (lat - b.minLat) / (b.maxLat - b.minLat || 1)) * h;
  return [x, y];
}

function drawMalha(){
  const canvas = document.getElementById("malhaCanvas");
  canvas.width = canvas.clientWidth; canvas.height = canvas.clientHeight;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0,0,canvas.width,canvas.height);
  if (!malhaData || !malhaBounds) return;

  (malhaData.features||[]).forEach(f => {
    if (f.geometry.type === "LineString") {
      ctx.beginPath();
      f.geometry.coordinates.forEach(([lon,lat], i) => {
        const [x,y] = project(lon,lat,canvas);
        i===0 ? ctx.moveTo(x,y) : ctx.lineTo(x,y);
      });
      ctx.strokeStyle = "#1976d2"; ctx.lineWidth = 1.5; ctx.stroke();
    } else if (f.geometry.type === "Point") {
      const [x,y] = project(f.geometry.coordinates[0], f.geometry.coordinates[1], canvas);
      ctx.beginPath(); ctx.arc(x,y,4,0,7); ctx.fillStyle = "#757575"; ctx.fill();
    }
  });

  if (userLatLon) {
    const [x,y] = project(userLatLon.lon, userLatLon.lat, canvas);
    ctx.beginPath(); ctx.arc(x,y,7,0,7); ctx.fillStyle = "#c62828"; ctx.fill();
    ctx.beginPath(); ctx.arc(x,y,11,0,7); ctx.strokeStyle = "#c62828"; ctx.lineWidth=2; ctx.stroke();
  }
}

function watchUserPosition(){
  if (!navigator.geolocation) return;
  navigator.geolocation.watchPosition((pos) => {
    userLatLon = { lat: pos.coords.latitude, lon: pos.coords.longitude };
    if (mapaWrap.style.display !== "none") drawMalha();
  }, () => {}, { enableHighAccuracy: true });
}
carregarMalha();
watchUserPosition();

// ---------- Banco local (IndexedDB) ----------
const DB_NAME = "aurum_campo_db";
const STORE = "amostras";
let db;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains(STORE)) {
        d.createObjectStore(STORE, { keyPath: "localId", autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveRecord(rec) {
  const d = await openDB();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(STORE, "readwrite");
    tx.objectStore(STORE).add(rec);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function getAllRecords() {
  const d = await openDB();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function markSynced(localId) {
  const d = await openDB();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const getReq = store.get(localId);
    getReq.onsuccess = () => {
      const rec = getReq.result;
      rec.synced = true;
      store.put(rec);
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ---------- Configuração (URL do Apps Script) ----------
function getApiUrl() { return localStorage.getItem("aurum_api_url") || ""; }
function setApiUrl(u) { localStorage.setItem("aurum_api_url", u); }

const setupBanner = document.getElementById("setupBanner");
const configCard = document.getElementById("configCard");
if (!getApiUrl()) setupBanner.style.display = "block";
document.getElementById("openConfig").onclick = (e) => {
  e.preventDefault();
  configCard.style.display = "block";
  document.getElementById("apiUrl").value = getApiUrl();
};
document.getElementById("saveConfig").onclick = () => {
  const v = document.getElementById("apiUrl").value.trim();
  if (v) { setApiUrl(v); setupBanner.style.display = "none"; configCard.style.display = "none"; showToast("Configuração salva"); }
};

// ---------- Login (nome + código de acesso) ----------
function getUser() {
  const raw = localStorage.getItem("aurum_user");
  return raw ? JSON.parse(raw) : null;
}
function setUser(u) { localStorage.setItem("aurum_user", JSON.stringify(u)); }

const loginGate = document.getElementById("loginGate");
const appShell = document.getElementById("appShell");
const loginSetupHint = document.getElementById("loginSetupHint");

document.getElementById("openConfigFromLogin").onclick = (e) => {
  e.preventDefault();
  // mostra a área de configuração dentro do app mesmo antes do login
  appShell.style.display = "block";
  loginGate.style.display = "none";
  setupBanner.style.display = "block";
  configCard.style.display = "block";
};

document.getElementById("loginBtn").onclick = async () => {
  const nome = document.getElementById("loginNome").value.trim();
  const codigo = document.getElementById("loginCodigo").value.trim();
  const errEl = document.getElementById("loginError");
  errEl.textContent = "";
  if (!nome || !codigo) { errEl.textContent = "Preencha nome e código."; return; }
  const apiUrl = getApiUrl();
  if (!apiUrl) { loginSetupHint.style.display = "block"; errEl.textContent = "Configure o link de sincronização primeiro."; return; }
  if (!navigator.onLine) { errEl.textContent = "É preciso estar online na primeira vez para validar seu código."; return; }
  try {
    const resp = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action: "login", codigo })
    });
    const json = await resp.json();
    if (!json.ok) { errEl.textContent = json.error || "Código inválido."; return; }
    setUser({ nome, codigo, papel: json.user.papel });
    entrarNoApp();
  } catch (err) {
    errEl.textContent = "Falha ao validar: " + err.message;
  }
};

function entrarNoApp() {
  loginGate.style.display = "none";
  appShell.style.display = "block";
  const u = getUser();
  document.getElementById("responsavel").value = u.nome;
  document.getElementById("responsavel").readOnly = true;
}

document.getElementById("logoutBtn").onclick = (e) => {
  e.preventDefault();
  if (!confirm("Trocar de usuário neste aparelho?")) return;
  localStorage.removeItem("aurum_user");
  location.reload();
};

// se já tem usuário salvo neste aparelho, entra direto (não precisa internet toda vez)
if (getUser() && getApiUrl()) {
  entrarNoApp();
} else if (!getApiUrl()) {
  loginSetupHint.style.display = "block";
}

// ---------- Status online/offline ----------
const statusPill = document.getElementById("statusPill");
function updateStatus() {
  const online = navigator.onLine;
  statusPill.textContent = online ? "online" : "offline";
  statusPill.classList.toggle("online", online);
}
window.addEventListener("online", () => { updateStatus(); autoSync(); });
window.addEventListener("offline", updateStatus);
updateStatus();

// ---------- GPS ----------
let lastPosition = null;
const gpsText = document.getElementById("gpsText");
function captureGps() {
  gpsText.textContent = "Obtendo localização…";
  if (!navigator.geolocation) { gpsText.textContent = "GPS não suportado"; return; }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      lastPosition = pos.coords;
      gpsText.innerHTML = `<b>${pos.coords.latitude.toFixed(6)}, ${pos.coords.longitude.toFixed(6)}</b> · alt ${Math.round(pos.coords.altitude || 0)}m · ±${Math.round(pos.coords.accuracy)}m`;
    },
    (err) => { gpsText.textContent = "Falha ao obter GPS: " + err.message; },
    { enableHighAccuracy: true, timeout: 15000 }
  );
}
document.getElementById("refreshGps").onclick = captureGps;
captureGps();

// data/hora atual
function setDataAtual() {
  const now = new Date();
  document.getElementById("dataColeta").value = now.toLocaleString("pt-BR");
}
setDataAtual();

// ---------- Sugestão automática de tipo de controle pelo nº da amostra ----------
const amostraInput = document.getElementById("amostraId");
const tipoControleSel = document.getElementById("tipoControle");
const ctrlHint = document.getElementById("ctrlHint");
amostraInput.addEventListener("input", () => {
  const m = amostraInput.value.match(/(\d+)\s*$/);
  if (!m) { ctrlHint.style.display = "none"; return; }
  const n = parseInt(m[1], 10);
  if (n % 50 === 1) {
    tipoControleSel.value = "Branco (Sílica)";
    ctrlHint.style.display = "block";
  } else if (n % 10 === 0) {
    tipoControleSel.value = "Duplicata de Campo (Triplicata)";
    ctrlHint.style.display = "block";
  } else {
    ctrlHint.style.display = "none";
  }
});

// ---------- Foto ----------
let photoBase64 = null;
const photoInput = document.getElementById("photoInput");
const photoLabel = document.getElementById("photoLabel");
const photoPreview = document.getElementById("photoPreview");
photoLabel.addEventListener("click", () => photoInput.click());
photoInput.addEventListener("change", () => {
  const file = photoInput.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    photoBase64 = reader.result; // data:image/...;base64,....
    photoPreview.src = photoBase64;
    photoPreview.style.display = "block";
    photoLabel.textContent = "📷 Foto anexada (toque para trocar)";
  };
  reader.readAsDataURL(file);
});

// ---------- Toast ----------
function showToast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2200);
}

// ---------- Salvar registro localmente ----------
document.getElementById("collectForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const rec = {
    amostra: amostraInput.value.trim(),
    alvo: document.getElementById("alvo").value,
    linha: document.getElementById("linha").value,
    tipoAmostra: document.getElementById("tipoAmostra").value,
    tipoControle: tipoControleSel.value,
    lat: lastPosition ? lastPosition.latitude : "",
    lon: lastPosition ? lastPosition.longitude : "",
    alt: lastPosition ? lastPosition.altitude : "",
    profundidade: document.getElementById("profundidade").value,
    dataColeta: document.getElementById("dataColeta").value,
    descricao: document.getElementById("descricao").value,
    responsavel: document.getElementById("responsavel").value,
    foto: photoBase64,
    synced: false,
    criadoEm: new Date().toISOString()
  };
  if (!rec.amostra) { showToast("Informe o ID da amostra"); return; }
  await saveRecord(rec);
  showToast("Amostra salva no aparelho ✔");
  e.target.reset();
  photoBase64 = null;
  photoPreview.style.display = "none";
  photoLabel.textContent = "📷 Toque para tirar/anexar foto";
  setDataAtual();
  captureGps();
  refreshPendingList();
  if (navigator.onLine) autoSync();
});

// ---------- Lista de pendentes ----------
async function refreshPendingList() {
  const all = await getAllRecords();
  const list = document.getElementById("pendingList");
  list.innerHTML = "";
  const pendentes = all.filter((r) => !r.synced);
  document.getElementById("pendingCount").textContent = `${pendentes.length} pendente(s)`;
  all.slice().reverse().slice(0, 15).forEach((r) => {
    const li = document.createElement("li");
    li.innerHTML = `<span>${r.amostra || "(sem ID)"} — ${r.dataColeta || ""}</span>
      <span class="tag ${r.synced ? "sent" : ""}">${r.synced ? "sincronizado" : "pendente"}</span>`;
    list.appendChild(li);
  });
}
refreshPendingList();

// ---------- Sincronização ----------
async function autoSync() {
  const apiUrl = getApiUrl();
  if (!apiUrl) return;
  if (!navigator.onLine) { showToast("Sem internet no momento"); return; }
  const all = await getAllRecords();
  const pendentes = all.filter((r) => !r.synced);
  if (pendentes.length === 0) return;
  showToast(`Sincronizando ${pendentes.length} amostra(s)…`);
  let ok = 0;
  for (const rec of pendentes) {
    try {
      const resp = await fetch(apiUrl, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" }, // evita preflight CORS no Apps Script
        body: JSON.stringify({ action: "addAmostra", codigo: (getUser() && getUser().codigo) || "", record: rec })
      });
      const json = await resp.json();
      if (json.ok) { await markSynced(rec.localId); ok++; }
    } catch (err) {
      console.error("Falha ao sincronizar", err);
      break; // para no primeiro erro de rede e tenta de novo depois
    }
  }
  showToast(`${ok} amostra(s) sincronizada(s) ✔`);
  refreshPendingList();
}
document.getElementById("syncBtn").onclick = autoSync;

// tenta sincronizar ao abrir o app, se já tiver internet
if (navigator.onLine) autoSync();
