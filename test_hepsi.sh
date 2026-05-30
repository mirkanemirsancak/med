#!/usr/bin/env bash
# Tum dogrulama kapilari tek komutta. Herhangi biri kalirsa script de kalir.
# Kullanim: ./test_hepsi.sh
set -e
KOK="$(cd "$(dirname "$0")" && pwd)"
cd "$KOK"

echo "### 1) Vinyet regresyon + sinir kapisi (JS motor) ###"
node docs/test_vinyet.js

echo
echo "### 2) Capraz-motor parite (Python <-> JS) ###"
PYTHONPATH="$KOK" python3 test_parite.py

echo
echo "### 3) Python degerlendirme (eski suite) ###"
python3 triyaj_degerlendirme.py | grep -E "Genel tam|ACIL|Alt-triyaj"

echo
echo "TUM KAPILAR GECTI."
