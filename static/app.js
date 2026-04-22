// Stock Mobile — frontend logic

const q = document.getElementById("q");
const results = document.getElementById("results");
const status = document.getElementById("status");
const scanBtn = document.getElementById("scan-btn");
const clearBtn = document.getElementById("clear-btn");
const refreshBtn = document.getElementById("refresh-btn");
const scanner = document.getElementById("scanner");
const scannerClose = document.getElementById("scanner-close");
const scannerStatus = document.getElementById("scanner-status");

let searchController = null;
let debounceTimer = null;
let qrScanner = null;

// ---------- formateo ----------

function formatARS(n) {
  try {
    return new Intl.NumberFormat("es-AR", {
      style: "currency",
      currency: "ARS",
      maximumFractionDigits: 0,
    }).format(n);
  } catch {
    return "$" + Math.round(n).toLocaleString("es-AR");
  }
}

function stockBadge(r) {
  if (r.stock === null || r.stock === undefined) {
    return `<div class="stock-badge na" title="Sin gestión de stock">—</div>`;
  }
  const n = Number(r.stock);
  let cls = "ok";
  if (n <= 0) cls = "out";
  else if (n <= 3) cls = "low";
  return `<div class="stock-badge ${cls}">${n}</div>`;
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function renderCard(r, featured) {
  const thumb = r.thumb
    ? `<img src="${escapeHtml(r.thumb)}" alt="" loading="lazy" referrerpolicy="no-referrer">`
    : "Sin foto";
  const hasPromo = r.promotional_price && r.promotional_price < r.list_price;
  const priceHtml = hasPromo
    ? `<span class="price">${formatARS(r.price)}</span>
       <span class="price-old">${formatARS(r.list_price)}</span>`
    : `<span class="price">${formatARS(r.price)}</span>`;

  const meta = [];
  if (r.sku) meta.push(`SKU: ${escapeHtml(r.sku)}`);
  if (r.barcode) meta.push(`CB: ${escapeHtml(r.barcode)}`);

  return `
    <article class="card ${featured ? "featured" : ""}">
      <div class="thumb">${thumb}</div>
      <div class="info">
        <div class="name">${escapeHtml(r.label)}</div>
        ${meta.length ? `<div class="meta">${meta.join(" · ")}</div>` : ""}
        <div class="price-row">${priceHtml}</div>
      </div>
      ${stockBadge(r)}
    </article>
  `;
}

function renderResults(rows, match) {
  if (!rows || rows.length === 0) {
    results.innerHTML = `<div class="empty">Sin resultados</div>`;
    return;
  }
  const featured = rows.length === 1;
  results.innerHTML = rows.map((r) => renderCard(r, featured)).join("");
  if (match === "barcode") {
    setStatus(`Coincidencia por código de barras`, "ok");
  } else if (match === "sku") {
    setStatus(`Coincidencia por SKU`, "ok");
  } else {
    setStatus(`${rows.length} resultado${rows.length === 1 ? "" : "s"}`);
  }
}

function setStatus(text, cls) {
  status.textContent = text || "";
  status.className = "status" + (cls ? " " + cls : "");
}

// ---------- busqueda ----------

async function doSearch(query) {
  if (searchController) searchController.abort();
  searchController = new AbortController();

  const trimmed = (query || "").trim();
  clearBtn.style.display = trimmed ? "inline-flex" : "none";

  if (!trimmed) {
    results.innerHTML = `<div class="empty">Escribí o escaneá un código</div>`;
    setStatus("");
    return;
  }

  setStatus("Buscando…");
  try {
    const r = await fetch(`/api/search?q=${encodeURIComponent(trimmed)}`, {
      signal: searchController.signal,
    });
    if (r.status === 401) {
      window.location.href = "/login";
      return;
    }
    const data = await r.json();
    renderResults(data.results || [], data.match);
  } catch (e) {
    if (e.name === "AbortError") return;
    setStatus("Error buscando", "error");
  }
}

q.addEventListener("input", () => {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => doSearch(q.value), 180);
});

q.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    clearTimeout(debounceTimer);
    doSearch(q.value);
    q.blur();
  }
});

clearBtn.addEventListener("click", () => {
  q.value = "";
  clearBtn.style.display = "none";
  doSearch("");
  q.focus();
});

// ---------- refresh catalogo ----------

refreshBtn.addEventListener("click", async () => {
  refreshBtn.classList.add("spinning");
  setStatus("Actualizando catálogo…");
  try {
    const r = await fetch("/api/refresh", { method: "POST" });
    if (r.status === 401) { window.location.href = "/login"; return; }
    const data = await r.json();
    if (data.ok) {
      setStatus(`Catálogo actualizado · ${data.count} variantes`, "ok");
      if (q.value.trim()) doSearch(q.value);
    } else {
      setStatus("Error actualizando", "error");
    }
  } catch {
    setStatus("Error actualizando", "error");
  } finally {
    refreshBtn.classList.remove("spinning");
  }
});

// ---------- scanner ----------

function diagMsg(err) {
  const name = err && err.name ? err.name : "Error";
  const msg = err && err.message ? err.message : String(err);
  let hint = "";
  if (name === "NotAllowedError" || name === "PermissionDeniedError") {
    hint = " → Permiso de cámara denegado. En Ajustes del celu buscá el browser y habilitá Cámara.";
  } else if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    hint = " → No se encontró cámara.";
  } else if (name === "NotReadableError" || name === "TrackStartError") {
    hint = " → La cámara está siendo usada por otra app. Cerrala y volvé a intentar.";
  } else if (name === "SecurityError") {
    hint = " → Contexto no seguro. Tiene que ser https://, no http://.";
  } else if (name === "OverconstrainedError") {
    hint = " → No hay cámara que cumpla con los constraints.";
  } else if (name === "TypeError") {
    hint = " → getUserMedia no disponible (¿estás en http en vez de https?).";
  }
  return `${name}: ${msg}${hint}`;
}

function showScannerError(text) {
  scannerStatus.innerHTML =
    `<div style="color:#fca5a5;text-align:left;line-height:1.4;font-size:12px;white-space:pre-wrap;">${escapeHtml(text)}</div>`;
}

async function openScanner() {
  scanner.hidden = false;
  scannerStatus.textContent = "Inicializando cámara…";

  // Diagnóstico previo: todo debe estar OK antes de intentar
  const diag = [];
  if (!window.isSecureContext) diag.push("❌ No estás en contexto seguro (https).");
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    diag.push("❌ Este browser no expone getUserMedia.");
  }
  if (!window.Html5Qrcode) diag.push("❌ Librería del scanner no cargada.");
  if (diag.length) {
    showScannerError(diag.join("\n"));
    return;
  }

  // Paso 1: pedir permiso de cámara explícitamente (getUserMedia crudo).
  // Con timeout: si no responde en 6s, probablemente el cert no está completamente confiado.
  scannerStatus.textContent = "Pidiendo permiso de cámara…";
  let rawStream = null;
  try {
    rawStream = await Promise.race([
      navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("TIMEOUT: getUserMedia no respondió en 6 segundos")), 6000)
      ),
    ]);
  } catch (err) {
    let extra = "";
    if (String(err.message || "").startsWith("TIMEOUT")) {
      extra =
        "\n\n⚠️ El browser nunca respondió. Causa más común en iOS:\n" +
        "1) el certificado está instalado pero NO está marcado como confiable.\n" +
        "Ir a: Ajustes → General → Información → Ajustes de confianza de certificados\n" +
        "y activar el switch de 'mkcert development CA'.\n" +
        "2) la página se cargó antes de confiar el cert — cerrá la pestaña,\n" +
        "volvé a entrar y probá de nuevo.";
    }
    showScannerError("Cámara (raw) falló: " + diagMsg(err) + extra);
    return;
  }
  // Cerramos el stream raw — la librería va a abrir el suyo propio.
  rawStream.getTracks().forEach((t) => t.stop());

  // Paso 2: arrancar la librería.
  try {
    qrScanner = new Html5Qrcode("reader", { verbose: false });
  } catch (err) {
    showScannerError("No se pudo crear scanner: " + diagMsg(err));
    return;
  }

  const config = {
    fps: 10,
    qrbox: (vw, vh) => {
      const minEdge = Math.min(vw, vh);
      const w = Math.floor(minEdge * 0.85);
      const h = Math.floor(minEdge * 0.45);
      return { width: w, height: h };
    },
    aspectRatio: window.innerHeight / window.innerWidth,
    formatsToSupport: [
      Html5QrcodeSupportedFormats.EAN_13,
      Html5QrcodeSupportedFormats.EAN_8,
      Html5QrcodeSupportedFormats.UPC_A,
      Html5QrcodeSupportedFormats.UPC_E,
      Html5QrcodeSupportedFormats.CODE_128,
      Html5QrcodeSupportedFormats.CODE_39,
      Html5QrcodeSupportedFormats.ITF,
      Html5QrcodeSupportedFormats.QR_CODE,
    ],
  };

  try {
    await qrScanner.start(
      { facingMode: "environment" },
      config,
      onScanSuccess,
      () => {} // fallos de frame: ignorar
    );
    scannerStatus.textContent = "Apuntá al código y mantené quieto";
  } catch (err) {
    showScannerError("Scanner .start() falló: " + diagMsg(err));
  }
}

function closeScanner() {
  scanner.hidden = true;
  if (qrScanner) {
    qrScanner.stop().then(() => qrScanner.clear()).catch(() => {});
    qrScanner = null;
  }
}

async function onScanSuccess(decodedText) {
  // feedback: vibración corta si el device soporta
  if (navigator.vibrate) navigator.vibrate(60);
  closeScanner();
  q.value = decodedText;
  clearBtn.style.display = "inline-flex";
  doSearch(decodedText);
}

scanBtn.addEventListener("click", openScanner);
scannerClose.addEventListener("click", closeScanner);

// ---------- inicio ----------

results.innerHTML = `<div class="empty">Escribí o escaneá un código</div>`;
q.focus();
