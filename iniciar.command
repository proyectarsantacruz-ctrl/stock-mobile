#!/bin/bash
cd "$(dirname "$0")"
echo "=========================================="
echo "  STOCK MOBILE - Digital Stone"
echo "=========================================="
echo ""
echo "Instalando dependencias (la primera vez puede tardar)..."
python3 -m pip install -r requirements.txt --quiet --disable-pip-version-check
echo ""
echo "Arrancando servidor..."
echo ""
python3 app.py
