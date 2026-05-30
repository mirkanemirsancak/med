#!/usr/bin/env python3
"""
Capraz-motor parite testi  (Teknik-kalite: iki motor sapmasin)
==============================================================
Ayni vinyet setini HEM Python (triyaj_motoru.py) HEM JS (docs/triyaj_motor.js)
motorundan gecirir ve ciktilarin BIREBIR ayni oldugunu dogrular.

Neden: Iki dilde cogaltilmis guvenlik mantigi, tek-dilli testlerle ayri ayri
yesil kalsa bile zamanla SESSIZCE sapabilir. Bu test, "ayni" iddiasini her
kosumda kanitlar. Sapma varsa hata koduyla (1) cikar -> regresyon kapisi.

Kullanim:
    python3 test_parite.py
Gereksinim: Node.js (docs/triyaj_motor.js'i kosmak icin).
"""
import json
import os
import subprocess
import sys

KOK = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, KOK)
import triyaj_motoru as motor  # noqa: E402

VINYET_YOLLAR = [
    os.path.join(KOK, "docs", "vinyetler.json"),
    os.path.join(KOK, "docs", "vinyetler_sinir.json"),
]
JS_MOTOR = os.path.join(KOK, "docs", "triyaj_motor.js")


def vinyetleri_yukle():
    hepsi = []
    for yol in VINYET_YOLLAR:
        hepsi += json.load(open(yol, encoding="utf-8"))["vinyetler"]
    return hepsi


def python_sonuclari(vinyetler):
    K = motor.kurallari_yukle()
    return {v["id"]: motor.triyaj(v["vaka"], K)["sinif"] for v in vinyetler}


def js_sonuclari():
    """Node ile docs/triyaj_motor.js'i ayni vinyet setleri uzerinde kosar."""
    kod = (
        "const m=require(%r);const fs=require('fs');"
        "const yollar=%s;"
        "let vs=[];yollar.forEach(y=>{vs=vs.concat(JSON.parse(fs.readFileSync(y,'utf8')).vinyetler);});"
        "const o={};vs.forEach(v=>o[v.id]=m.triyaj(v.vaka).sinif);"
        "process.stdout.write(JSON.stringify(o));"
    ) % (JS_MOTOR, json.dumps(VINYET_YOLLAR))
    try:
        cikti = subprocess.check_output(["node", "-e", kod], stderr=subprocess.STDOUT)
    except FileNotFoundError:
        print("HATA: 'node' bulunamadi; JS motoru kosulamiyor.")
        sys.exit(2)
    except subprocess.CalledProcessError as e:
        print("HATA: JS motoru kosulurken hata:\n" + e.output.decode())
        sys.exit(2)
    return json.loads(cikti)


def main():
    vinyetler = vinyetleri_yukle()
    py = python_sonuclari(vinyetler)
    js = js_sonuclari()

    farklar = [(vid, py[vid], js.get(vid)) for vid in py if py[vid] != js.get(vid)]

    print("=" * 64)
    print("CAPRAZ-MOTOR PARITE TESTI (Python <-> JS)")
    print("=" * 64)
    print(f"Vinyet sayisi: {len(vinyetler)}")
    if farklar:
        print(f"SAPMA: {len(farklar)} vinyette motorlar AYRI sonuc veriyor:")
        for vid, p, j in farklar:
            print(f"   {vid}: python={p}  js={j}")
        print("SONUC: KALDI (motorlar sapmis)")
        sys.exit(1)
    print("Tum vinyetlerde Python ve JS motorlari BIREBIR AYNI.")
    print("SONUC: GECTI")
    sys.exit(0)


if __name__ == "__main__":
    main()
