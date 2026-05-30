"""
Astim Triyaj - Komut Satiri Arayuzu (CLI)
=========================================
Girdi: yapilandirilmis bir VAKA (JSON).
Cikti: triyaj sonucu (insan-okur metin veya JSON).

Kullanim ornekleri
------------------
  # Dosyadan vaka oku, insan-okur cikti:
  python3 triyaj_cli.py --girdi ornek_vaka.json

  # stdin'den vaka oku (JSON), JSON cikti:
  cat ornek_vaka.json | python3 triyaj_cli.py --json

  # Komut satirinda gomulu JSON:
  python3 triyaj_cli.py --vaka '{"yas_grubu":"eriskin","parametreler":{"P_NABIZ":130}}'

VAKA semasi
-----------
  {
    "yas_grubu":     "eriskin" | "cocuk",
    "yas_ay":        <tam sayi, cocuk icin onerilir>,
    "kirmizi_bayrak":["RF_..."],          # opsiyonel
    "parametreler":  {"P_...": deger},     # kategorik token veya sayi
    "risk_faktorleri":["RISK_..."]         # opsiyonel
  }

NOT: Bu arac TANI koymaz; aciliyet duzeyi belirler ve yonlendirir.
"""

import argparse
import json
import sys

import triyaj_motoru as motor


def vakayi_oku(args):
    """Vakayi oncelik sirasiyla: --vaka > --girdi > stdin'den okur."""
    if args.vaka:
        return json.loads(args.vaka)
    if args.girdi:
        with open(args.girdi, "r", encoding="utf-8") as f:
            return json.load(f)
    # stdin
    veri = sys.stdin.read().strip()
    if not veri:
        raise SystemExit(
            "HATA: Vaka verilmedi. --vaka, --girdi veya stdin kullanin.\n"
            "Yardim icin: python3 triyaj_cli.py -h"
        )
    return json.loads(veri)


def insan_okur_yazdir(vaka, sonuc):
    cizgi = "=" * 64
    print(cizgi)
    print("ASTIM TRIYAJ SONUCU")
    print(cizgi)
    yg = vaka.get("yas_grubu", "?")
    ek = f" (yas_ay={vaka['yas_ay']})" if "yas_ay" in vaka else ""
    print(f"Yas grubu     : {yg}{ek}")
    print(f"SINIF         : {sonuc['sinif'].upper()}")
    print("-" * 64)
    y = sonuc.get("yonlendirme", {})
    print(f"Hasta mesaji  : {y.get('hasta_mesaj', '-')}")
    print(f"Hekim etiket  : {y.get('hekim_etiket', '-')}")
    if sonuc.get("kirmizi_bayrak"):
        print("Kirmizi bayrak:")
        for kod, tr in sonuc["kirmizi_bayrak"]:
            print(f"   - [{kod}] {tr}")
    if sonuc.get("aktif_risk_faktorleri"):
        print("Risk faktoru  :", ", ".join(sonuc["aktif_risk_faktorleri"]))
    if sonuc.get("agirlik_gerekce"):
        print("Agirlik gerekce:")
        for g in sonuc["agirlik_gerekce"]:
            print(f"   - {g}")
    print("Karar adimlari:")
    for a in sonuc.get("adimlar", []):
        print(f"   - {a}")
    print(cizgi)


def main(argv=None):
    p = argparse.ArgumentParser(
        description="Astim triyaj motoru CLI - vaka girilir, aciliyet sinifi alinir."
    )
    p.add_argument("--girdi", "-g", help="Vaka JSON dosyasi yolu")
    p.add_argument("--vaka", "-v", help="Vaka JSON'u (komut satirinda dize)")
    p.add_argument("--kurallar", "-k", help="Kural seti JSON yolu (varsayilan: triyaj_kurallari_v1.json)")
    p.add_argument("--json", "-j", action="store_true", help="Ciktiyi ham JSON olarak ver")
    args = p.parse_args(argv)

    try:
        vaka = vakayi_oku(args)
    except json.JSONDecodeError as e:
        raise SystemExit(f"HATA: Gecersiz JSON: {e}")

    K = motor.kurallari_yukle(args.kurallar)
    sonuc = motor.triyaj(vaka, K)

    if args.json:
        print(json.dumps({"vaka": vaka, "sonuc": sonuc}, ensure_ascii=False, indent=2))
    else:
        insan_okur_yazdir(vaka, sonuc)

    # Acil durumlarda kabuk icin yararli cikis kodu (0=hafif/orta, 2=acil)
    return 2 if sonuc["sinif"] in ("agir", "hayati_tehdit") else 0


if __name__ == "__main__":
    sys.exit(main())
