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
tabMapa.onclick = () => { tabMapa.classList.add("active"); tabColeta.classList.remove("active"); coletaWrap.style.display="none"; mapaWrap.style.display="block"; atualizarPontosNoMapa(); resetView(); drawMalha(); };

// ---------- Mapa offline vetorial (sem imagem de fundo, só geometria) ----------
let malhaData = null;
let malhaBounds = null;
let userLatLon = null;
let meusPontos = []; // amostras já salvas neste aparelho (pendentes ou sincronizadas), com foto/descrição

// estado de zoom/pan
const view = { scale: 1, offsetX: 0, offsetY: 0, baseScale: 1, baseOffsetX: 0, baseOffsetY: 0 };

async function carregarMalha(){
  try {
    const resp = await fetch("malha.json");
    malhaData = await resp.json();
    computeBounds();
    document.getElementById("malhaInfo").textContent = `${malhaData.features.length} feições carregadas (armazenadas no aparelho). Arraste para mover, use os botões +/- ou pinça para dar zoom.`;
  } catch(e) {
    document.getElementById("malhaInfo").textContent = "Malha ainda não disponível offline.";
  }
}

function computeBounds(){
  let minLat=90,maxLat=-90,minLon=180,maxLon=-180;
  const malhaPts = [];
  (malhaData.features||[]).forEach(f => {
    const coordsList = f.geometry.type === "LineString" ? f.geometry.coordinates
      : f.geometry.type === "Point" ? [f.geometry.coordinates] : [];
    coordsList.forEach((c) => malhaPts.push(c));
  });

  // A visão principal do mapa é sempre baseada na malha planejada (nunca distorce por causa
  // de um ponto de teste com GPS incorreto, ex: coletado no computador sem GPS real).
  const baseSource = malhaPts.length ? malhaPts : meusPontos.filter(p=>p.lat&&p.lon).map(p=>[p.lon,p.lat]);
  baseSource.forEach(([lon,lat]) => {
    minLat=Math.min(minLat,lat); maxLat=Math.max(maxLat,lat);
    minLon=Math.min(minLon,lon); maxLon=Math.max(maxLon,lon);
  });
  if (baseSource.length === 0) { minLat=-1;maxLat=1;minLon=-1;maxLon=1; }

  // Pontos coletados só entram no enquadramento se estiverem realisticamente perto da malha
  // (dentro de ~2x o tamanho da área) — evita que um GPS de teste errado "estique" o mapa inteiro.
  const spanLat = (maxLat-minLat)||0.01, spanLon = (maxLon-minLon)||0.01;
  const bufferLat = spanLat, bufferLon = spanLon;
  meusPontos.forEach(p => {
    if (!p.lat || !p.lon) return;
    if (p.lat < minLat-bufferLat || p.lat > maxLat+bufferLat || p.lon < minLon-bufferLon || p.lon > maxLon+bufferLon) return;
    minLat=Math.min(minLat,p.lat); maxLat=Math.max(maxLat,p.lat);
    minLon=Math.min(minLon,p.lon); maxLon=Math.max(maxLon,p.lon);
  });

  const padFrac = 0.08;
  const latPad = (maxLat-minLat || 0.01) * padFrac, lonPad = (maxLon-minLon || 0.01) * padFrac;
  malhaBounds = { minLat: minLat-latPad, maxLat: maxLat+latPad, minLon: minLon-lonPad, maxLon: maxLon+lonPad };
}

// projeção "mundo" fixa (independente do zoom/pan) — o pan/zoom é aplicado depois, na tela
function worldProject(lon, lat, canvas){
  const b = malhaBounds;
  const x = ((lon - b.minLon) / (b.maxLon - b.minLon || 1)) * canvas.width;
  const y = (1 - (lat - b.minLat) / (b.maxLat - b.minLat || 1)) * canvas.height;
  return [x, y];
}
// aplica o zoom/pan atual para chegar à posição real na tela
function toScreen(wx, wy){
  return [wx * view.scale + view.offsetX, wy * view.scale + view.offsetY];
}
function project(lon, lat, canvas){
  const [wx, wy] = worldProject(lon, lat, canvas);
  return toScreen(wx, wy);
}

function resetView(canvas){
  // enquadra tudo (malha + pontos) na tela, na primeira vez
  view.scale = 1; view.offsetX = 0; view.offsetY = 0;
  view.baseScale = 1; view.baseOffsetX = 0; view.baseOffsetY = 0;
}

let pontosScreen = []; // cache dos pontos coletados na tela, para detectar clique

function drawMalha(){
  const canvas = document.getElementById("malhaCanvas");
  if (!canvas) return;
  const ctx = canvas.getContext && canvas.getContext("2d");
  if (!ctx) return; // ambiente sem suporte a canvas
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth, cssH = canvas.clientHeight;
  if (!cssW || !cssH) return; // canvas ainda oculto/sem tamanho (ex: aba do mapa não aberta)
  if (canvas.width !== cssW*dpr || canvas.height !== cssH*dpr) {
    canvas.width = cssW*dpr; canvas.height = cssH*dpr;
  }
  ctx.setTransform(dpr,0,0,dpr,0,0);
  ctx.clearRect(0,0,cssW,cssH);
  if (!malhaData || !malhaBounds) return;

  const canvasCss = { width: cssW, height: cssH };

  (malhaData.features||[]).forEach(f => {
    if (f.geometry.type === "LineString") {
      ctx.beginPath();
      f.geometry.coordinates.forEach(([lon,lat], i) => {
        const [x,y] = project(lon,lat,canvasCss);
        i===0 ? ctx.moveTo(x,y) : ctx.lineTo(x,y);
      });
      ctx.strokeStyle = "#1976d2"; ctx.lineWidth = 1.5; ctx.stroke();
    } else if (f.geometry.type === "Point") {
      const [x,y] = project(f.geometry.coordinates[0], f.geometry.coordinates[1], canvasCss);
      ctx.beginPath(); ctx.arc(x,y,4,0,7); ctx.fillStyle = "#9e9e9e"; ctx.fill();
    }
  });

  // pontos já coletados neste aparelho — clicáveis
  pontosScreen = [];
  meusPontos.forEach((p) => {
    if (!p.lat || !p.lon) return;
    const [x,y] = project(p.lon, p.lat, canvasCss);
    ctx.beginPath(); ctx.arc(x,y,6,0,7);
    ctx.fillStyle = p.synced ? "#2e7d32" : "#f9a825";
    ctx.fill();
    ctx.lineWidth = 1.5; ctx.strokeStyle = "#fff"; ctx.stroke();
    pontosScreen.push({ x, y, ponto: p });
  });

  if (userLatLon) {
    const [x,y] = project(userLatLon.lon, userLatLon.lat, canvasCss);
    ctx.beginPath(); ctx.arc(x,y,7,0,7); ctx.fillStyle = "#c62828"; ctx.fill();
    ctx.beginPath(); ctx.arc(x,y,11,0,7); ctx.strokeStyle = "#c62828"; ctx.lineWidth=2; ctx.stroke();
  }
}

async function atualizarPontosNoMapa(){
  const all = await getAllRecords();
  meusPontos = all;
  computeBounds();
  if (mapaWrap.style.display !== "none") drawMalha();
}

function watchUserPosition(){
  if (!navigator.geolocation) return;
  navigator.geolocation.watchPosition((pos) => {
    userLatLon = { lat: pos.coords.latitude, lon: pos.coords.longitude };
    if (mapaWrap.style.display !== "none") drawMalha();
  }, () => {}, { enableHighAccuracy: true });
}

// ---------- Zoom e Pan (mouse + toque) ----------
function setupMapInteraction(){
  const canvas = document.getElementById("malhaCanvas");
  let dragging = false, lastX = 0, lastY = 0, moved = false;
  let pinchStartDist = null, pinchStartScale = 1;

  function clampScale(s){ return Math.min(Math.max(s, 0.4), 12); }

  function zoomAt(cssX, cssY, factor){
    const newScale = clampScale(view.scale * factor);
    const f = newScale / view.scale;
    view.offsetX = cssX - f * (cssX - view.offsetX);
    view.offsetY = cssY - f * (cssY - view.offsetY);
    view.scale = newScale;
    drawMalha();
  }

  canvas.addEventListener("mousedown", (e) => { dragging = true; moved = false; lastX = e.clientX; lastY = e.clientY; });
  window.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    moved = true;
    view.offsetX += e.clientX - lastX; view.offsetY += e.clientY - lastY;
    lastX = e.clientX; lastY = e.clientY;
    drawMalha();
  });
  window.addEventListener("mouseup", (e) => {
    if (dragging && !moved) handleTapOnPoint(e.clientX, e.clientY, canvas);
    dragging = false;
  });
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    zoomAt(e.clientX - rect.left, e.clientY - rect.top, e.deltaY < 0 ? 1.15 : 1/1.15);
  }, { passive: false });

  canvas.addEventListener("touchstart", (e) => {
    if (e.touches.length === 1) {
      dragging = true; moved = false;
      lastX = e.touches[0].clientX; lastY = e.touches[0].clientY;
    } else if (e.touches.length === 2) {
      dragging = false;
      pinchStartDist = touchDist(e.touches);
      pinchStartScale = view.scale;
    }
  }, { passive: true });
  canvas.addEventListener("touchmove", (e) => {
    if (e.touches.length === 1 && dragging) {
      moved = true;
      const dx = e.touches[0].clientX - lastX, dy = e.touches[0].clientY - lastY;
      view.offsetX += dx; view.offsetY += dy;
      lastX = e.touches[0].clientX; lastY = e.touches[0].clientY;
      drawMalha();
    } else if (e.touches.length === 2 && pinchStartDist) {
      const dist = touchDist(e.touches);
      const rect = canvas.getBoundingClientRect();
      const midX = (e.touches[0].clientX + e.touches[1].clientX)/2 - rect.left;
      const midY = (e.touches[0].clientY + e.touches[1].clientY)/2 - rect.top;
      const newScale = clampScale(pinchStartScale * (dist / pinchStartDist));
      const f = newScale / view.scale;
      view.offsetX = midX - f * (midX - view.offsetX);
      view.offsetY = midY - f * (midY - view.offsetY);
      view.scale = newScale;
      drawMalha();
    }
    e.preventDefault();
  }, { passive: false });
  canvas.addEventListener("touchend", (e) => {
    if (e.touches.length === 0) {
      if (dragging && !moved && e.changedTouches.length) {
        handleTapOnPoint(e.changedTouches[0].clientX, e.changedTouches[0].clientY, canvas);
      }
      dragging = false; pinchStartDist = null;
    }
  });
  function touchDist(touches){
    const dx = touches[0].clientX - touches[1].clientX, dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx*dx + dy*dy);
  }

  document.getElementById("zoomIn").onclick = () => zoomAt(canvas.clientWidth/2, canvas.clientHeight/2, 1.3);
  document.getElementById("zoomOut").onclick = () => zoomAt(canvas.clientWidth/2, canvas.clientHeight/2, 1/1.3);
  document.getElementById("zoomReset").onclick = () => { resetView(canvas); drawMalha(); };
}

function handleTapOnPoint(clientX, clientY, canvas){
  const rect = canvas.getBoundingClientRect();
  const x = clientX - rect.left, y = clientY - rect.top;
  let melhor = null, melhorDist = 18;
  pontosScreen.forEach((p) => {
    const d = Math.hypot(p.x - x, p.y - y);
    if (d < melhorDist) { melhor = p.ponto; melhorDist = d; }
  });
  if (melhor) abrirDetalhesPonto(melhor);
}

function abrirDetalhesPonto(p){
  document.getElementById("pontoDetalheTitulo").textContent = p.amostra || "(sem ID)";
  document.getElementById("pontoDetalheInfo").innerHTML = `
    <div><b>Status:</b> ${p.synced ? "sincronizado ✔" : "pendente de sincronização"}</div>
    <div><b>Data:</b> ${p.dataColeta || "-"}</div>
    <div><b>Profundidade:</b> ${p.profundidade || "-"} cm</div>
    <div><b>Alvo:</b> ${p.alvo || "-"} · Tipo: ${p.tipoAmostra || "-"} · Controle: ${p.tipoControle || "-"}</div>
    <div style="margin-top:6px">${p.descricao || "(sem descrição)"}</div>
    <div style="margin-top:4px;color:#888">Responsável: ${p.responsavel || "-"}</div>
  `;
  const imgEl = document.getElementById("pontoDetalheFoto");
  if (p.foto) { imgEl.src = p.foto; imgEl.style.display = "block"; } else { imgEl.style.display = "none"; }
  document.getElementById("pontoDetalheModal").style.display = "flex";
}
document.getElementById("fecharPontoDetalhe").onclick = () => {
  document.getElementById("pontoDetalheModal").style.display = "none";
};

// (inicialização do mapa movida para o final do arquivo, após todas as declarações)

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

// ---------- Armazenamento seguro (cai para memória se localStorage indisponível) ----------
const _memStore = {};
function safeGet(k){ try { return localStorage.getItem(k); } catch(e){ return _memStore[k] || null; } }
function safeSet(k,v){ try { localStorage.setItem(k,v); } catch(e){ _memStore[k] = v; } }
function safeRemove(k){ try { localStorage.removeItem(k); } catch(e){ delete _memStore[k]; } }

// ---------- Configuração (URL do Apps Script) ----------
function getApiUrl() { return safeGet("aurum_api_url") || ""; }
function setApiUrl(u) { safeSet("aurum_api_url", u); }

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
  const raw = safeGet("aurum_user");
  return raw ? JSON.parse(raw) : null;
}
function setUser(u) { safeSet("aurum_user", JSON.stringify(u)); }

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
  safeRemove("aurum_user");
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
let rawPhotoBase64 = null; // foto original, sem overlay (overlay é aplicado só ao salvar, com os dados finais)
const photoInput = document.getElementById("photoInput");
const photoLabel = document.getElementById("photoLabel");
const photoPreview = document.getElementById("photoPreview");
photoLabel.addEventListener("click", () => photoInput.click());
photoInput.addEventListener("change", () => {
  const file = photoInput.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    rawPhotoBase64 = reader.result; // data:image/...;base64,....
    photoPreview.src = rawPhotoBase64;
    photoPreview.style.display = "block";
    photoLabel.textContent = "📷 Foto anexada (toque para trocar) — marca d'água aplicada ao salvar";
  };
  reader.readAsDataURL(file);
});

// ---------- Bússola (melhor esforço; nem todo navegador expõe) ----------
let ultimoHeading = null;
function iniciarBussola() {
  if (typeof DeviceOrientationEvent !== "undefined" && typeof DeviceOrientationEvent.requestPermission === "function") {
    // iOS exige permissão explícita, pedida no primeiro toque do usuário
    document.body.addEventListener("click", function pedirPermissaoUmaVez() {
      DeviceOrientationEvent.requestPermission().then((r) => {
        if (r === "granted") window.addEventListener("deviceorientation", onOrientation);
      }).catch(() => {});
      document.body.removeEventListener("click", pedirPermissaoUmaVez);
    }, { once: true });
  } else {
    window.addEventListener("deviceorientation", onOrientation);
  }
}
function onOrientation(e) {
  if (e.webkitCompassHeading !== undefined) ultimoHeading = e.webkitCompassHeading; // iOS
  else if (e.alpha !== null) ultimoHeading = 360 - e.alpha; // Android (aprox.)
}
iniciarBussola();

const AURUM_SYMBOL_B64 = "iVBORw0KGgoAAAANSUhEUgAAAHgAAABTCAYAAABUD8MnAAAdeElEQVR4nN2deZxc1XXnz7n3bbV1S2JYJMc4dhzbqD0TL3gcYxy6A0JCydjJOFUTL2OspavUChhLQoDB8KpA7BIywUhd1QJistipSmbsGQckNViyDWSxMyYTWnj7DAYbyYZYUlfX8rZ7z/xR9VoN0lu61a1u5/f51D9SddV779z37lm+5xTCApZpmgwA4LJzX+m1Ffk9xvAcIYkACIP+hgBEKqEpjYb95ZVDI2ur1SzP5Woi6P3+/49WCg+nEtqVjZbtAqACCPT69yIAISIyhHGU3rv6B0deLhaLWCqV5Oyc8eyLzfcBhKmv7xCWSiXZYuLGTNp4kyeljohJRJYIejFk6bblGYaufurAnvyFuVxNVKtZHvQdY2PLCQBAA3GbbbttzpmGCJwBKK9/IYJKkjCZ0M5yBN6KiNTXdyhwsS0ELVgDk2mybK4m94+su0DTlGsmmpYEQiQiiHpJKYWicO5KuD/qe0qlkqRqll+S3/OCK8Sd6aSOksgjADjpRQCAwCaalkwY2ppvlPPvj1pA860Fa+Ba3yFEACLJt+sqV6UkQoRYdwsi8mbbFpmkcdFoOf/xXK4mKMwI2Zok02Tpxen76hPWC4amcAIKeuwiEBLjCB7gToJ4xzRfWpAG9vfF/SOF1emEvrrZcgQiTusuQQS0HY8A8a4DX9yYhrHlRHRqYyAC1foO4UW5nW0AuVVVOAKdvAef+APgrbYjMin9A/uH85+IXEDzqAVnYALA7Nhyeq5qakiwQ0hJhMFOVbCQOa4netLGG23uXo+lkjxYNAON4D9qVxRG/naiZR9IJXVOBIHOmb+AGGN3PbVnbSZsAc2nFpyBD5omx1JJvnz8yFU9KeMdluVKBJzZcSLyRsuWmsa3fLNy1Zv7iyVBXc88TIqCm1xXCM4QAILuZH8B6W9oecrnohbQfGlBGdg0TXYQQB54ZON5CmM3tyxbAkYaN/BRigAohKSEriUs6dzrP4qD3u8/ai9dV/4Xy3ZH0kmNE1HIXYy80bKkovBNe0c2vjXuAjqTWlAH44dFruNtSyW0Ra4roxyrjl8boo4RbJFMqB/dW84PRHm9xbHlZJomk5p3S7Pt/FJVOQOAQIdLCKKEoRgovcgFNB9aMAaedKyG8xfqmrKm0bQFsmDHiqCzDwJ0EhChH06ddzGA+6YY95SGKJVKsh+ArV73yKueoGJSVxlJCn5KIPJG0xEpQ/uD0fLgZQstbFowBvZFCDsVzljwJQUAIJnQFJISxiTJj2maghAc1gAg8HbbET1p4129xxat7z6KA899oFQS1WqWvwBUHm9YzyUMlUGIwwUAQEQAyO47cMBUJr91AWhBGJj8u3d34WM9KePiZtsRgBB89xKQonAEhNtXFka+0rbdx9IJnYXulwzQsl2pMHbr3pF1S4pjy4ko0DsnAIBCoeJKhpsRMdxYCLxtuaInpf9H+4eHN3QWUHVBXNt5X2VEgFA08eDZryaFLsYUzt/oeh5BkOdMIJIJjTfbzrdW5Mv9tVqWLT7e+xsKV/+vlFKVnVDllOdFRF5vOqEca7T/dFWhcg1Vsxxj5Kn3Dee/2pPWPzLRtAPjcSIiVeUkhTzGJL3j4OGlRwE6j/zpX5XZ07yvsoPFTljkqt51mZRxvuN6ItC4nWQ/uJ4nmUqbsFMQ4Cvye35oO96fplNG+F2MyCdaltRVZejxyvo+zNVkNRu8X2a7sa3GlWtt27M4R4SA/R4R0XWFTCf1sxyAW0ulkiwuAIdrXg1Mpsn6iyWxr7L+zarCtzRatoSQjBVJkumUxi1XPHzZ2sr/oWqWZ7M11zRNxhnePtG0j6iqwkP2Y5SSSFe5yiTbAQAE2eDjw1JJQi3LBgZ3/dj2xBfSyegF1Gg5wlCVwb27C7+FC8DhmlcD1/oOIXYyu/cYupoUQhIGPl6BVJVjs+0eU5j4vGmarDi2nBCBin2HcEWhMi6IbkzoCpIMiY0RebPliHRKX7lvOP9fIr3ebE2apsmEpd9Zb9ovaxELSEgCReUKQ7pveldjbjRvBvb3t73l/EDCUP+o0Qre3wAAgEgmDY15wrvtssGHftEPwPz9zb9Tnnn5vEfHJ6zvJBMaD/N6CQmFkISI2x+7/2o9O7acgooG/gJafc0DdZLwOUNTkELy1IjgL6Df3T+c/6/zHTbNl4ERoGNkDnBfVCRLRNIwVFZvtJ8fP3z8QTJN1l8qnWTAUqkkgeMmKQnC/F4EZJblyt608Tau25/BUkkeNIPTjP4CWpEf/ovxpvUPUQsIkND1BAGDe5+pbkpk5zFPPS8GpmqV5XI1sejo4sFM2nhXOyIsQkDiDBEYbM6Vao5fSpz6Hv9OWTlYfrrtuH+VTuqcZPB+CYisadlSVdhNj5fzSw8CSDMizYgIhMg2de7+kPcBMtvxRG868ZbGscbm+cxTn3EDd/bOMXpmZNMSxvFWy3YlsuDVTUQildR4o+383YrByt4wBGesG9saKr+hZTsNRWGBj1NEQM+VlExovQzo9lKpJMPoDH8BXZ4f/gfL8f48nYpYQIC82bYl5/yGvQ8PvbG/WBRRC2gudMa/sNjNN094jWImaZztuEKGhUWMITquZyucbfFLiUGfXSqV5MFikV+ydvdPXVfenUrqDCAs+YG80bSFoalXjpYH3xcH7yEi5BJvbLWduqJGL6CUoaXRFXfNF95zRg1MZDLM1eS+PRveqevqhomWJcMcKyISmZTBbEc8cOn64R9AtcowInHgV3QyS1I76hPWC3o4nQFEAApnjAB3Rh2/v4AuGyq/7El5R8rQGVDwZyPrFDoSuvrxfSOFD86Hw3VGDVyrHUIAIBRyh9bFcCAwm0ZS0zibaNpHGMI20zQZZHORWaGpdIaUcJ0Wg85oth2RSRkf3F8pfCyKzugvdRaQqtr315vtHxm6yqIWEEMEELTz3/Uj2t87H99d+Eg6qV8eheGQBDI0lUkhb1pRqIwXuzFznO+adLiGyn9Tb9oHU4mYdEYcvAc6C2hgzZcsT+BWRWGIhOF4j+WI3ozxvg8uPXLlmcZ7zoiB/b3zwCNXGgqnez0vAsPp5pvHm9Z3nj6y9EvViJxxqJiyyfWEYDHojExKP99Vvevi4j1XDJW/NtG0R1ORYACg5biScXb7aDnfWzyDYdMZMbCP4bi2fk1POvGblh2O4SACSCIAxE0zTdZP3sX5Xc9ajrcnis7w8R5V4Vv2VdZH4z21zl+BwjY7rnA5YwBhC8gRMpPUl0qCz5e6KdCZnNd0NedfYpom6y8WxVN7/mSZorAbm+1wDIckiXRS523b/auVg+WnozoTwjTWpTNQsluabeeoqnIW6PV28R5DV5Mk8Z5IvKfWqSmvXD/8nG27w+mkHon3TLQsqWv86if3bHg75Dqo7kzOazqa8y/o6zuEiEhNz7kzmdB6vBAMhwhIURk2LadBKr+BiHAsJCyKkk9nrNw4/IrjiluTuhbu9XbxnlRC+6PRkUJ/dJ66Kk3TZBklXZxo2a9qKmfRhQ5FF57c7u/lMz23uJpTA09iOJX1v23o6n+PwnAASKQSOhNC3LVq7e6fHiwWedQjOirsGOh6vWcz3FVvWGOGoTIKMbKP95CkSLwHEakfgF00uPOoFPIWQ1dZVKGj0XJEKqn9/uhwftWZCJvm/A4mAiTJdnLOMAzDISCpawqfaFj/L704fZ9fSoz6/FyuJiIcFqr1HcILCxWXELdwhogQ7vV28Z53Lz66eF0uVxMHzEsCjeDjPceXHBuZaNjPJhJqeKEDCIUkAgY7qmZWCyt0zIbmzMA+hjNaGfxkb9r47VZEvhkISFU4SqStF+V2tmsRYREBYNXMao89uO6T3ffFSTPua7Scr0fisF28h3G87dt/ObT4IPTLKLwnl6sJBNrc+YDAswTETqGjJ5VYvmjp4o1RhY7T1ZwYmAgQxpbTU3u2ZpDxOy3HC8VfiUCkkjpvtOxvXD5Y+R9xWj4RgJa8YcmHz16S+fMnyvn3AACFPe78O4UxdYvtejZnwXRGJ2wSMp00zmlOCLPj9eYCr5W/gC4rVA602u7fRjlcgMhaliO5wm95YmTduQdjFDpmqrm5g2udlGJTjN/Yk9LfEIXhcIbgucKTEjdHfTRRJ6Z+propAUB3AABIoMg0I5ZKEqpVtiL/4A9tx30gNt6jKRuf2F1YjhFer18SNJi21bLdFucMKRDvAXQ9IVMJdbEQ/LaoQsfpaNYNTN2U4oGRjW9VFf7ZRsuKxnCSGrdcb2TVUPlfKOLu9RmuiWPNazPpxG8eq7fsTCrxO/t3R6cZIZuTpmkyhmxbB+/hsfAeweQOiPB6/eTIJfkvvuB6Ykc6qTOIwnuajtA1vu6Jcv49c+VwzbqB/b3TEd72hK4aQlAghgNAUtU4NlrOLzWAW3wMJ+iz/Zh6tJw/X1XYdc2WLRFQsR2PmAKxugh9vEcKeVNCV+PhPQlj1d7Kht+PMoKfHFFd5Z6Jpv1SFN4jiUBVOJMxCh0z1awaeBLD2V1YkUpoH2mEYKYAnXxzUteYkKI4UKj8W/8UDOdU8mNqSXBXUtfSnicJEHgnzWicH6eL0Kcznj6y9Ev1Zky8R0riIGPhPdB3CAeu2tWQHt2gx8F72o7IpLTf2V8p5OYiTz2bBkYAgAMHTIUxuo8ovDcBCETCUHm9af2r+rZlw9Vqlg+cAsPxNTlLo5y/OGGoH2u0psTUr+kijJFmhE4SBAk2S4qH9/SkEm9nmnV1XLzn8qHyl+tN66lUxAJCBHRcQQhwz75HP5ma7TbUWTPwAdPkuVxNuD88vKE3bbyzbbkyNCwCAEQEILZ5YKDkdf8pdFGYpskk4E6GCFOXz2u7CFmsLsJOL3DlqbblfDkO3tOybKmq/KYDj2w872BMrxcJNnlCyvC+CGS27cmetPEmaCe2dlDd2euKmJUP8ts+H3tozdmc82IrBoaTTum8ZTlfXVHY/URUWOQ7Xhcv+8Wne9P6haeKqU90EWofjZNm9OkMhhgL73E9KVMJbZFje/Hxng2V71q292eReA9D1il0KFsf3134dcjmZi1PPSsf4mM43FNL6YR2luuIwNYTAiDOEdu2a0mmbPXDnqDPJiIsdkqNi5DR7ZYTvHiICLuTWL7w1T1rM2Mh+6VPZ6woVF5yPXlPJN6DqDSajjB05dP7Y07vMU2TabpyU7PtHFfD8J7JJ5CaZEh3z2Yb6mkb2K/VPvlQ4bd0Vck3Wo5AFtK0TSTSSYN5rti5anDXj/2YOfD9tRorlUrScfTPZ5LGeY4TzHAhItquRwzZf+ol49xSqSSLphl4ofy92gbYUW/GwXuog/cIiIX39AOwgTW7fi6E3JaMwnv8J5Ch5vaXBy+ZrbBp1p71nkc7VZVzIbvZ+lOKpKYqvN6wX04q3p0UgeGQaTLI5eTecv4dmsKvjsVwJQ0mJd0/MLjrx9VqNrRY4d8pHy5UWkhwnabGw3t6UsbFT5QH/zgu3rNs8dIH6k3r+4YRjvf4Tc+ALLLQEVenZeAT3QmDH80k9YFmyxYY0fbZ6QwQn7t4/cMTEJFvnuSfiXbomqJFMlwqZ42W9Ypg3m1EgNlsNRIWmEwz5qeH9wBjdz/76JZQr9cvCb4zV3IIYQtn0XhPu+2InpT+nt7JQsfp5alnbOCpKUMF2T2uJwjCxi10MZx60/77FYWRv4jCcPzF80R5wxWZZPQoJZJAhq4yT8pbVg0+dBRqWYYYcjFPIcbZZi823mOc/4vWRGy85/LB8mMTLfvxSLynW+jgk4UOCCt0RJ/TTP9wMmV4tLklkzbeYjueiMJwhJBEQJuiRi74DFe1amqEtENIimS4EgmN1xvW98YXH9/TXTyxUZ/JsGn98Pcs130oLt6jqfzaA48Ufj0q7vaTI7oOm23Hc1iMQkcmaZzTnHAjCx1RmtEf+inDbz489EZVZdc3W7YECM03i3RK57bjPbqyUPnHqLDIZ7h6jx65qidlXBA5Sgmh80iRuHnK507r7vW9Xkjwm5st+5iqxMN7XIci8Z5OoSPLBtZUvu968ouZGG2onUKHFqvQEaYZ/ZGfMrRcMZkyjMJwWm2nDly9MQrD8WPqJ0Y+c67Co0cpEU0yXLUVQ+WDM2W4JvGeTw2/IiSUkkY8vCehq9lYXm8X71E147Z60/pFPLyHq5JBZKEjTNM2sH8BvzFS+GBCVz/+mpThqUQkUwmdOZ684/L1Dx6OwnD8UUqeaN+eSmqLXE/KwMUDQJwzbNtuS9XwuqiYOkq+17sEaNd4s30oFt6DCAS4My7eM7Dm/uMS4KY4eE+zg/esGo1R6AjSjB/RHtFJKcPXi4Ckoaus3mj/6C3n618Iavv0dWLxDL03oStrGk1HIKIS9P5OTK0z1xXbB9aUf+L7BTM5J4ATXu+FhYqLEmLjPb1p492Lji9ZG2N6j1etZvnlL5/3SL1h/XOsQocniYh2RBU6gjQtA/spww8sO/zpnpTxvigMBwmpkwKka9+2+gH7VG2fp5InxU6FcxZeryCpqwqvN6wXIZm5Jy7DFaVJh2tDZW+z7Xw9rtfLELZ9e9fQ4ojpPZ2/KZUkQ7ZJRpgLAZllu7I3E6+P+VSKbWAiwOLYchqt5nsVZKEpw877u22fLXv/5YWR/xU337yvPPjHmZTxoTijlDRNQUC6fuWndjSjYurpyL9TOGfXOq5nx/V6W9y7JTbekx/+dstyv5KJ08fc7vQxf7OcXzrdNtT4d3CtykqlkvSOwc2ZVHjKECbbPoXLUdkMEW2fPsO179EtKY7sbjuC4QICkUrovN6wvr1isPLXp9Xacgr5Xu+l64d/YDvigUz86T0b948MXRDl9Y51kyMc4fqW5TTj9jG3Ce6YbhtqLAP7KcMn92x4uzGNlKHjersvze8ao2o2It/czUe3Jq7LpI3zHccLWzyAiOAKTwLnm+Ic/4zU9XrPWgLbJhrWzzUt2uvVVEUDISK93lK3JLiiUHnJcUWn0BHVhtq0haEpVz4xUvjP03G4YhnY3zs9IWOnDCda1quSiVKn7TM4Zejno/dV1r9ZU/m1jZYtIaRY0YmpNW474uGVg7v/OYrhmqkQkYp9h/DCXGXcI3mTocX1evUrRsv534sOmzolQYfh9omm9YKuK5FtqKrCUIpowHCqIg1cPbE3XpFOaL8XN2UopLx51eBDR4t9fRiWMvQZLpIYf5RSyznOp4xSineq05dPZ6w8vOzPxhv2d+PiPYC4/bmqGQq1Ty10AE2jjzltXDRaKcSeMh9q4BMpw6zGAKeTMnz2RMowuFo0ieGMFPpTCS3+KCUpbn39KKW5FJZKkgFtio/3GO84fOxIJN7zmkJHaxqFDoS7vhpzynyogSdThscW/UlPOhEvZQgEyHBTjJTh5CglErQTokYpgT9KyXp+fHHwKKXZ1lS8p2W5X4kHtduSc/b56eA9Giqb4hY6elLGrxkuvyEO3hP4nydShuvOVbhyc8tyYqUMm23nb1YMRqcMfYar99ii9T2ZGKOUqDNKCQG35HKnHqU0VzrJ6+Xx8B7b8bbFwXuomuUD+V3P2rH7mC2pa8qmJ8v534jCewL/w08ZCsm3pRLqYtcVwfnmbsrQst0WMopMGRIRHgSQe0fWLVEYm9YopcsKw4+fTs/wTFTqlgRXFCoveb7XGwPvSWh8zTdGht4bd8o8xe5jJjJ0NeESRAKGpzTwpGM1MvReXeNrG00nKt8s0kmd2Z7YsTK/54XIlGEt19k7JTfTSeOcOKOUbMdz4oxSmiv5JcElDLfXG+2fxMN7OPOkiI33rNw4/IonZCluH3M6of3h/uH8pWEL6JQXdfICSrFd4QyISBCQBAIx9dVNxLu6xtlEw3oJE5m7o1KG/iilJyvr+wxVGYpyrCZjas8fpRQRU8+R/DvlwkKlRdPAezIp40OjI/n/FuX1+n3MZwHsHm9YY4mEigTgBl136oAAAhjcO6VCd9KdfJKBqZrlWCrJ0fKGtecsSfcLQcwwVC2ha8wwVD71lTA0pquKmkroTJCMlTL0RykJYvdpKleF7MwTPfW7u6OUWtbPNc3eFhVTz7Um6YxCpVZv2N+M5fW6HgHh3fsi8B6Y2scMtFlTODM0RQ267kldVYUkfu6SzLv3V/Jbuz/Rd5I9T67UZGvyuaqpHT7+89UTTfs7nbRhAAJLJA1dYUfHm99fWRj5immaDHPR1aL95cEPT2OUEj/utG+6bM2XjlM1yxFxQfzSJ1PYJs8T32EModvFcQrDIXMcz+vNJN50fKK+FUs7igfAVAAmQf/XKJerCTJNhoXS/n3l/O5kQntfu+3IoOsPQPL4RBsR2cC+R7c8iLkdLerAM5M3WCBfPF2eKUoEgGCa+KP3H1Vf/Jn9r7qqvtVyXQoMu7qtLU3L/e4zh897f1/fITyTjlWYpoz6r/RmjMF6w/KCyprUaY8lRLTQkX39G8ovQtHEsG3m9UaKI9M0T5kTCOKLCaA7fiHqBYBx4jw/pn7hp9a0RikxoBmPUpor+XgP5+LmZjse3pPQ1aQTE2pHgI5XHef6dx/5QdfojAzjMk2TFYtFGn3oqqUKiOcBIe15hIFhlyTRkzb4eKP95ZUbRj5+psOiODpgmspAqeTtH85/tjeT2Dk+0Y4YMAPC0BTueO4ll66vfOtMndMZGcY12fYp3DtijVJSGLZsp2FoyvWnO0ppruTjPcePHNtVb7Sfjwu1C4E7iSafeL/aY5QAphYr8u9PaMqnYo1SSurMdeXdl8QcpTQf8vGeXKnmSKAO3hMHak/r7xmtHFkbNb1ntnTGZlUi4LRGKWWWpHbMFoYzV5ocl1gYebzRdv4uNtSObNvXd0VO75kVzamBJ3/RbDj/iZ6U/oG4o5SI5HVxRiktBPklQQK4Ni7Unk7p5ypM3Hy6UHsc4ZzNS+x6ik/XM8m21J5XFbYs7BfNOqOUNN5o2QdWFiq/uxAdqyD5v6C2r5zfviid2DLeaAeGTQBAiEAKY54jnXc9/bNf+8GyZUd4/vDSOTlXZa7Tfvsr+c/1pvQ3RJ00ZwiuK4Si4NxhOHOlbFWaZpFp2k+2TbTwE5rKz3G9wPw6SklSMxTNaYsdpVJpNQDIwhwdGo7u2fBuENJDxmdtL0AmkSQjIcV5HPFrjKHWATWCw6LejMGP19vDK4dGhqJ+U3AhavIu3l1Y19uj76lPWBE/j0vS0FTWdrz1jOifJCqcY4gXPt3jkYI8ABX3lwvVdFLLNtsOdIvNsybOGHhCggzFDkgqCgeSdMxC9YJ/fGnJLwHm/0cdZ6JqNcuzY8tpdNmRf0oa2nvblhvuc0DH5+jm42dNUhKkEho0W/b/ZKrGP9Oy3H9TFCY7Ipitl+MKinIT/VFKjidLq9c98Gr/GcJw5kpTofaIH6UFAEDH9Wg2r7mUUioKk23bPYoSr+6MGJDytqShMUmBP2U+s5PFTr964Bs6+WY23mg/9yLCcDUbPkppoWsq1N5uO38difdAZ+zEbB6DJJApQ2OelLdfNlR+mVWrWT5++NhwvWF9P6GroUXsuRAiomS4uVCouN1fAl3QYVGU/JmViiqub1tuKN4z2yIgmdBVPt5o/0i09Qer1SxnAAC5Us2RJDdHZmNm82Cowzc32/bXVg2WR3+VwqIw+R3/l65/+EXbE/dGQe2z+t2ExDlDKWHL6msesLOQBTbdbMwsiThHtG3P0rh67em2fS40+XjPf0C4t95o/yQKap8NTXJrTXvfyg2V/91FlgUDOJGNUTjbEt1sNTsHk04azPbEFwbijFL6FdNr8B7A6yPxntNXh1tzhctVfE0v2OQGT9Uqx1xO7Cvnty/OJLYcnwhNTJzOsUhVUdDzxBGnrV1wxdElDSiWaKGnJGeiKWDAtzIp/UONlhM6hWimIiJvUSahHKu371+5ofLZqXmEE5mWbLYzSxngtnrT/pmmKcpcOAdEALrGUUi6fvU1D9R/FfLNpyumsGscT7iMzcF8bgLSVEWpN+0jSclP6gWb/EJ/xMCKQmVcEt2qciYRO1Tf7L3ANXQF6k3n7y8vVP6STJP9e3CsgvSa6T22+2jSUAkInNm8pojgqiqTJOVtH9q4+1g/wGvGR/1//0u6geQ657sAAAAASUVORK5CYII=";

// Aplica moldura estilo "registro de campo": barras com dados no topo e rodapé, como no TimeMark.
function compositeOverlay(rawDataUrl, meta) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const maxW = 1280;
      const scale = Math.min(1, maxW / img.width);
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, w, h);

      const pad = Math.round(w * 0.025);
      const fontBig = Math.max(14, Math.round(w * 0.028));
      const fontSmall = Math.max(11, Math.round(w * 0.020));

      // barra superior
      const topH = Math.round(h * 0.075);
      const topGrad = ctx.createLinearGradient(0, 0, 0, topH);
      topGrad.addColorStop(0, "rgba(0,0,0,.55)");
      topGrad.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = topGrad;
      ctx.fillRect(0, 0, w, topH * 1.4);

      ctx.fillStyle = "#fff";
      ctx.font = `bold ${fontSmall}px -apple-system, Arial, sans-serif`;
      ctx.textBaseline = "top";
      const headingTxt = (meta.heading !== null && meta.heading !== undefined) ? `🧭 ${Math.round(meta.heading)}°` : "🧭 –";
      ctx.fillText(headingTxt, pad, pad * 0.6);
      const altTxt = meta.alt ? `▲ ${Math.round(meta.alt)}m` : "▲ –";
      const altWidth = ctx.measureText(altTxt).width;
      ctx.fillText(altTxt, w / 2 - altWidth / 2, pad * 0.6);
      const coordTxt = (meta.lat && meta.lon) ? `📍 ${meta.lat.toFixed(6)}°, ${meta.lon.toFixed(6)}°` : "📍 –";
      const coordWidth = ctx.measureText(coordTxt).width;
      ctx.fillText(coordTxt, w - pad - coordWidth, pad * 0.6);

      // barra inferior
      const botH = Math.round(h * 0.16);
      const botGrad = ctx.createLinearGradient(0, h - botH * 1.6, 0, h);
      botGrad.addColorStop(0, "rgba(0,0,0,0)");
      botGrad.addColorStop(1, "rgba(0,0,0,.62)");
      ctx.fillStyle = botGrad;
      ctx.fillRect(0, h - botH * 1.6, w, botH * 1.6);

      const logoH = botH * 0.62;
      const logoImg = new Image();
      logoImg.onload = () => {
        const logoW = logoH * (logoImg.width / logoImg.height);
        ctx.drawImage(logoImg, pad, h - botH - logoH * 0.3, logoW, logoH);
        const textX = pad + logoW + pad * 0.6;
        drawBottomText(textX);
        finish();
      };
      logoImg.onerror = () => { drawBottomText(pad); finish(); };
      logoImg.src = "data:image/png;base64," + AURUM_SYMBOL_B64;

      function drawBottomText(x) {
        ctx.fillStyle = "#fff";
        ctx.font = `bold ${fontBig}px -apple-system, Arial, sans-serif`;
        ctx.fillText(meta.projeto || "Faz Castanha", x, h - botH - fontBig * 0.1);
        ctx.font = `${fontSmall}px -apple-system, Arial, sans-serif`;
        ctx.fillText(meta.dataHora || "", x, h - botH + fontBig * 0.85);
        ctx.font = `bold ${fontSmall}px -apple-system, Arial, sans-serif`;
        ctx.fillText("ID: " + (meta.amostra || "-"), x, h - botH + fontBig * 0.85 + fontSmall * 1.35);

        ctx.font = `${Math.round(fontSmall*0.85)}px -apple-system, Arial, sans-serif`;
        ctx.fillStyle = "rgba(255,255,255,.85)";
        const creditTxt = "Aurum Campo · Foto Real";
        const creditW = ctx.measureText(creditTxt).width;
        ctx.fillText(creditTxt, w - pad - creditW, h - pad * 0.9);
      }
      function finish() { resolve(canvas.toDataURL("image/jpeg", 0.85)); }
    };
    img.onerror = () => { console.error("Falha ao carregar foto para aplicar marca d'água — salvando foto original."); resolve(rawDataUrl); };
    // segurança extra: nunca trava o salvamento por mais de 8s esperando a foto processar
    setTimeout(() => resolve(rawDataUrl), 8000);
    img.src = rawDataUrl;
  });
}

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
  const amostraId = amostraInput.value.trim();
  if (!amostraId) { showToast("Informe o ID da amostra"); return; }

  let fotoFinal = null;
  if (rawPhotoBase64) {
    showToast("Aplicando marca d'água na foto…");
    fotoFinal = await compositeOverlay(rawPhotoBase64, {
      heading: ultimoHeading,
      alt: lastPosition ? lastPosition.altitude : null,
      lat: lastPosition ? lastPosition.latitude : null,
      lon: lastPosition ? lastPosition.longitude : null,
      projeto: "Faz Castanha",
      dataHora: document.getElementById("dataColeta").value,
      amostra: amostraId
    });
  }

  const rec = {
    amostra: amostraId,
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
    foto: fotoFinal,
    synced: false,
    criadoEm: new Date().toISOString()
  };
  await saveRecord(rec);
  showToast("Amostra salva no aparelho ✔");
  e.target.reset();
  if (getUser()) document.getElementById("responsavel").value = getUser().nome;
  rawPhotoBase64 = null;
  photoPreview.style.display = "none";
  photoLabel.textContent = "📷 Toque para tirar/anexar foto";
  setDataAtual();
  captureGps();
  refreshPendingList();
  atualizarPontosNoMapa();
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

// ---------- Inicialização (após todas as declarações estarem prontas) ----------
carregarMalha();
watchUserPosition();
atualizarPontosNoMapa();
setupMapInteraction();

// tenta sincronizar ao abrir o app, se já tiver internet
if (navigator.onLine) autoSync();
