"""
Stock Mobile — Digital Stone
App web responsive para consultar stock desde el celular.
Solo lectura: busca productos por codigo de barras o texto.
"""
from functools import wraps
from datetime import timedelta
import os
import socket

from flask import (
    Flask, render_template, request, jsonify,
    session, redirect, url_for, send_from_directory,
)
from werkzeug.middleware.proxy_fix import ProxyFix
import requests

# Credenciales: priorizar env vars (para deploy en Render).
# Si no estan definidas, usar config.py (para desarrollo local).
def _get(name, default=None):
    v = os.environ.get(name)
    if v is not None and v != "":
        return v
    try:
        from config import __dict__ as _cfg
        return _cfg.get(name, default)
    except ImportError:
        return default

STORE_ID     = _get("STORE_ID")
ACCESS_TOKEN = _get("ACCESS_TOKEN")
USER_AGENT   = _get("USER_AGENT", "Stock Mobile")
APP_PASSWORD = _get("APP_PASSWORD")
SECRET_KEY   = _get("SECRET_KEY", "change-me-in-production")

if not all([STORE_ID, ACCESS_TOKEN, APP_PASSWORD]):
    raise RuntimeError(
        "Faltan credenciales. Configurá las env vars STORE_ID, ACCESS_TOKEN, "
        "APP_PASSWORD (o un config.py local con esos valores)."
    )

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CERT_FILE = os.path.join(BASE_DIR, "certs", "server.pem")
KEY_FILE  = os.path.join(BASE_DIR, "certs", "server-key.pem")
ROOT_CA   = os.path.join(BASE_DIR, "certs", "rootCA.pem")

app = Flask(__name__)
app.secret_key = SECRET_KEY
app.permanent_session_lifetime = timedelta(days=30)
# Render / cualquier reverse proxy: respetar X-Forwarded-Proto para que
# Flask sepa que la conexion es HTTPS aunque internamente reciba HTTP.
app.wsgi_app = ProxyFix(app.wsgi_app, x_proto=1, x_host=1)

API_BASE = f"https://api.tiendanube.com/v1/{STORE_ID}"
HEADERS = {
    "Authentication": f"bearer {ACCESS_TOKEN}",
    "User-Agent": USER_AGENT,
}

# In-memory cache of all products. Refreshed on first request or on /api/refresh.
_cache = {"rows": None, "by_barcode": {}, "by_sku": {}}


# ---------- helpers ----------

def get_name(name_field):
    if isinstance(name_field, dict):
        return name_field.get("es") or next(iter(name_field.values()), "")
    return name_field or ""


def variant_label(product_name, variant):
    values = variant.get("values") or []
    if not values:
        return product_name
    parts = [get_name(v) for v in values]
    suffix = " / ".join(p for p in parts if p)
    return f"{product_name} — {suffix}" if suffix else product_name


def effective_price(variant):
    promo = variant.get("promotional_price")
    if promo:
        try:
            return float(promo)
        except (TypeError, ValueError):
            pass
    price = variant.get("price")
    try:
        return float(price) if price else 0.0
    except (TypeError, ValueError):
        return 0.0


def fetch_all_products():
    """Devuelve una lista de variantes de todos los productos."""
    rows = []
    page = 1
    while True:
        r = requests.get(
            f"{API_BASE}/products",
            headers=HEADERS,
            params={"page": page, "per_page": 200, "fields": "id,name,variants,images"},
            timeout=30,
        )
        r.raise_for_status()
        batch = r.json()
        if not batch:
            break
        for p in batch:
            pname = get_name(p.get("name"))
            images = p.get("images") or []
            thumb = images[0].get("src") if images else None
            for v in p.get("variants", []):
                v_img_id = v.get("image_id")
                v_thumb = None
                if v_img_id:
                    for img in images:
                        if img.get("id") == v_img_id:
                            v_thumb = img.get("src")
                            break
                promo_val = v.get("promotional_price")
                try:
                    promo_val = float(promo_val) if promo_val else None
                except (TypeError, ValueError):
                    promo_val = None
                try:
                    list_val = float(v.get("price") or 0)
                except (TypeError, ValueError):
                    list_val = 0.0
                rows.append({
                    "product_id": p["id"],
                    "variant_id": v["id"],
                    "label": variant_label(pname, v),
                    "sku": (v.get("sku") or "").strip(),
                    "barcode": (v.get("barcode") or "").strip(),
                    "stock": v.get("stock"),
                    "stock_management": v.get("stock_management", True),
                    "thumb": v_thumb or thumb,
                    "price": effective_price(v),
                    "list_price": list_val,
                    "promotional_price": promo_val,
                })
        if len(batch) < 200:
            break
        page += 1
    rows.sort(key=lambda x: x["label"].lower())
    return rows


def refresh_cache():
    rows = fetch_all_products()
    by_barcode, by_sku = {}, {}
    for r in rows:
        if r["barcode"]:
            by_barcode.setdefault(r["barcode"], []).append(r)
        if r["sku"]:
            by_sku.setdefault(r["sku"].lower(), []).append(r)
    _cache["rows"] = rows
    _cache["by_barcode"] = by_barcode
    _cache["by_sku"] = by_sku
    return rows


def ensure_cache():
    if _cache["rows"] is None:
        refresh_cache()


def login_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if not session.get("auth"):
            if request.path.startswith("/api/"):
                return jsonify({"error": "unauthorized"}), 401
            return redirect(url_for("login"))
        return view(*args, **kwargs)
    return wrapped


# ---------- routes ----------

@app.route("/login", methods=["GET", "POST"])
def login():
    error = None
    if request.method == "POST":
        if request.form.get("password") == APP_PASSWORD:
            session.permanent = True
            session["auth"] = True
            return redirect(url_for("index"))
        error = "Contraseña incorrecta"
    return render_template("login.html", error=error)


@app.route("/logout")
def logout():
    session.clear()
    return redirect(url_for("login"))


@app.route("/")
@login_required
def index():
    return render_template("index.html")


@app.route("/api/search")
@login_required
def search():
    q = (request.args.get("q") or "").strip()
    if not q:
        return jsonify({"results": [], "match": None})
    ensure_cache()

    # 1) Exact barcode match (prioridad maxima para scanner)
    exact = _cache["by_barcode"].get(q)
    if exact:
        return jsonify({"results": exact, "match": "barcode"})

    # 2) Exact SKU match
    sku_exact = _cache["by_sku"].get(q.lower())
    if sku_exact:
        return jsonify({"results": sku_exact, "match": "sku"})

    # 3) Text search: todas las palabras presentes en label/sku/barcode
    q_lower = q.lower()
    words = [w for w in q_lower.split() if w]
    if not words:
        return jsonify({"results": [], "match": None})

    results = []
    for r in _cache["rows"]:
        hay = f"{r['label']} {r['sku']} {r['barcode']}".lower()
        if all(w in hay for w in words):
            results.append(r)
        if len(results) >= 60:
            break
    return jsonify({"results": results, "match": "text"})


@app.route("/api/refresh", methods=["POST"])
@login_required
def refresh():
    try:
        rows = refresh_cache()
        return jsonify({"count": len(rows), "ok": True})
    except requests.HTTPError as e:
        return jsonify({"ok": False, "error": str(e)}), 500


# PWA: manifest + service worker servidos desde la raiz
@app.route("/manifest.webmanifest")
def manifest():
    return send_from_directory("static", "manifest.webmanifest",
                               mimetype="application/manifest+json")


@app.route("/sw.js")
def service_worker():
    response = send_from_directory("static", "sw.js",
                                   mimetype="application/javascript")
    # SW siempre fresco: evita que quede cacheado mal
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    return response


@app.route("/rootCA.pem")
def root_ca():
    """Sirve el certificado raiz para que el celu lo descargue e instale."""
    if not os.path.isfile(ROOT_CA):
        return "CA no disponible. Correr setup de mkcert.", 404
    return send_from_directory(
        os.path.dirname(ROOT_CA),
        os.path.basename(ROOT_CA),
        mimetype="application/x-x509-ca-cert",
        as_attachment=True,
        download_name="DigitalStone-rootCA.pem",
    )


# ---------- utils ----------

def get_local_ip():
    """Devuelve la IP local de la LAN (la que se usa para salir a internet)."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.settimeout(0)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"


if __name__ == "__main__":
    ip = get_local_ip()
    hostname = socket.gethostname()
    if not hostname.endswith(".local"):
        hostname = hostname + ".local"
    port = 5001  # distinto del juego/app PC (5000)

    # Usar cert real si existe (mkcert); si no, fallback a adhoc
    if os.path.isfile(CERT_FILE) and os.path.isfile(KEY_FILE):
        ssl_context = (CERT_FILE, KEY_FILE)
        cert_status = "cert confiable (mkcert)"
    else:
        ssl_context = "adhoc"
        cert_status = "cert auto-firmado (ADHOC) — cámara puede no funcionar"

    print("=" * 66)
    print("  STOCK MOBILE — Digital Stone")
    print("=" * 66)
    print(f"  Certificado:   {cert_status}")
    print()
    print(f"  PC (testeo):   https://127.0.0.1:{port}")
    print(f"  Celular (IP):  https://{ip}:{port}")
    print(f"  Celular (host):https://{hostname}:{port}")
    print()
    if ssl_context != "adhoc":
        print("  Si es la primera vez desde este celu, primero instalá el CA:")
        print(f"     https://{ip}:{port}/rootCA.pem")
        print("  Ver INSTALAR_CERTIFICADO.txt para los pasos.")
    print("=" * 66)
    app.run(host="0.0.0.0", port=port, debug=False, ssl_context=ssl_context)
