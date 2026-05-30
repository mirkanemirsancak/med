"""
Astim Triyaj - Degerlendirme Kosucusu (v3, cok-dosyali)
========================================================
Birden fazla vinyet setini (erişkin + cocuk) yukler, kaynak bazinda ve
birlesik raporlar. Olculen:
  - Kaynak + kategori bazli isabet
  - ACIL DUYARLILIGI (gold hayati -> tahmin hayati; hedef %100)
  - ALT-TRIYAJ (tehlikeli) / UST-TRIYAJ (guvenli)
  - 'klinik_inceleme' etiketli sinir davranislari (ayri rapor)

NOT: Motorun KURAL MANTIGINI test eder (deterministik). LLM cikarma katmani
ile cocuk klinik esiklerinin DIS dogrulamasi ayrica gerekir.
"""

import json
import os
import triyaj_motoru as motor

RANK = {"hafif": 0, "orta": 1, "agir": 2, "hayati_tehdit": 3}
DOSYALAR = ["vinyetler_v2.json", "vinyetler_cocuk_v1.json"]


def yukle(dosya):
    yol = os.path.join(os.path.dirname(os.path.abspath(__file__)), dosya)
    with open(yol, "r", encoding="utf-8") as f:
        return json.load(f)["vinyetler"]


def degerlendir():
    K = motor.kurallari_yukle()

    genel_dogru = genel_top = 0
    gold_hayati = yakalanan_hayati = 0
    alt_triyaj, hatalar, klinik_inceleme = [], [], []

    for dosya in DOSYALAR:
        vinyetler = yukle(dosya)
        kat = {}
        d_dogru = 0
        print("=" * 72)
        print(f"KAYNAK: {dosya}  ({len(vinyetler)} vinyet)")
        print("=" * 72)
        for v in vinyetler:
            beklenen = v["beklenen"]
            tahmin = motor.triyaj(v["vaka"], K)["sinif"]
            dogru = (tahmin == beklenen)
            d_dogru += dogru
            genel_top += 1
            genel_dogru += dogru
            if not dogru:
                hatalar.append((dosya, v["id"], beklenen, tahmin, v["aciklama"]))

            kg = v.get("kategori", "?")
            kat.setdefault(kg, [0, 0]); kat[kg][1] += 1
            if dogru: kat[kg][0] += 1

            if beklenen == "hayati_tehdit":
                gold_hayati += 1
                if tahmin == "hayati_tehdit": yakalanan_hayati += 1

            if beklenen in RANK and tahmin in RANK and RANK[tahmin] < RANK[beklenen]:
                alt_triyaj.append((dosya, v["id"], beklenen, tahmin, v["aciklama"]))

            if "klinik_inceleme" in v.get("etiket", []):
                klinik_inceleme.append((v["id"], tahmin, v["aciklama"]))

        for kg in sorted(kat):
            a, t = kat[kg]
            print(f"   {kg:<16}: {a}/{t}  (%{100*a/t:.0f})")
        print(f"   {'KAYNAK TOPLAM':<16}: {d_dogru}/{len(vinyetler)} (%{100*d_dogru/len(vinyetler):.1f})")
        print()

    print("=" * 72)
    print("BIRLESIK SONUC")
    print("=" * 72)
    print(f"Genel tam isabet        : {genel_dogru}/{genel_top} (%{100*genel_dogru/genel_top:.1f})")
    print(f"ACIL DUYARLILIGI        : {yakalanan_hayati}/{gold_hayati} "
          f"(%{100*yakalanan_hayati/gold_hayati:.1f})  <- KRITIK, hedef %100")
    print(f"Alt-triyaj (TEHLIKELI)  : {len(alt_triyaj)}")

    if hatalar:
        print("\nHATALAR:")
        for d, vid, b, t, ac in hatalar:
            print(f"   [X] {d}:{vid}  beklenen={b} tahmin={t} | {ac}")
    if alt_triyaj:
        print("\n!!! ALT-TRIYAJ:")
        for d, vid, b, t, ac in alt_triyaj:
            print(f"   {d}:{vid}  {b}->{t} | {ac}")

    if klinik_inceleme:
        print("\n" + "-" * 72)
        print("KLINIK INCELEME BEKLEYEN SINIR DAVRANISLARI (hekim onayi gerek)")
        print("-" * 72)
        for vid, t, ac in klinik_inceleme:
            print(f"   {vid} -> sistem '{t}' diyor")
            print(f"        {ac}")
    print()


if __name__ == "__main__":
    degerlendir()
