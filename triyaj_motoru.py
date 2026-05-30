"""
Astim Triyaj Motoru - v1 (prototip)
====================================
Gorevi: yapilandirilmis bir VAKA alir, triyaj_kurallari_v1.json'u uygular,
aciliyet sinifi + gerekce + yonlendirme dondurur.

Tasarim ilkeleri (uzerinde anlastiklarimiz):
  1. Karari LLM degil, bu deterministik motor verir. Test edilebilir.
  2. Kirmizi bayrak ONCE bakilir; biri varsa her sey atlanir -> ACIL.
  3. Atak agirliginda: parametrelerin TUMU degil, BIRKACI yeterli.
     En agir bulgu sinifi kazanir. (Tablo 4.4.1 mantigi)
  4. Belirsizlikte aciliyeti DUSURME, YUKSELT. (fail-safe)
  5. Motor kelimeyle degil KAVRAM KODU ile calisir -> dilden bagimsiz.

NOT (durustluk gerektiren bir muhendislik karari):
  Sayisal ve kategorik esikler asagida, kod icinde gomulu. Cunku JSON'daki
  esikler insan-okur metin ("artmis", ">120") seklinde; bir hekimin gozden
  gecirmesi icin oyle birakildi. v2'de bu esikleri makine-okur alan olarak
  JSON'a tasiyacagiz ki tek dogru kaynak olsun. Simdilik bu eslestirme
  KLINIK ONAY BEKLEYEN bir varsayim setidir.
"""

import json
import os

# Aciliyet siralamasi (kucukten buyuge). Karsilastirma icin indeks kullaniyoruz.
SIRA = ["hafif", "orta", "agir", "hayati_tehdit"]


# ---------------------------------------------------------------------------
# KATEGORIK PARAMETRE -> SINIF eslestirmesi  (KLINIK ONAY BEKLER)
# Vaka, her parametre icin asagidaki "token"lardan birini verir.
# ---------------------------------------------------------------------------
KATEGORIK_SINIF = {
    "P_NEFES_DARLIGI": {
        "eforla": "hafif", "konusurken": "orta",
        "dinlenmede": "agir", "konusamaz": "hayati_tehdit",
    },
    "P_KONUSMA": {
        "cumleler": "hafif", "kisa_cumleler": "orta",
        "kelimeler": "agir", "konusamiyor": "hayati_tehdit",
    },
    "P_BILINC": {
        "sakin": "hafif", "huzursuz": "orta", "konfuzyon": "hayati_tehdit",
    },
    "P_YARDIMCI_KAS": {
        "yok": "hafif", "var": "orta", "paradoks": "hayati_tehdit",
    },
    "P_HISILTI": {
        "ekspiryum_sonu": "hafif", "belirgin": "orta", "sessiz": "hayati_tehdit",
    },
}


# ---------------------------------------------------------------------------
# SAYISAL PARAMETRE siniflandiricilari  (KLINIK ONAY BEKLER)
# Imza: fn(deger, vaka) -> siniflandirici vakanin yas baglamini gorebilsin diye.
# Cocuk (cocuk) ve eriskin esikleri FARKLIDIR; erişkin esigini cocuga uygulamak
# gizli bir guvenlik hatasidir.
# ---------------------------------------------------------------------------

def _cocuk_mu(vaka):
    return vaka.get("yas_grubu") == "cocuk"

def cocuk_solunum_ust_sinir(yas_ay):
    # Tablo 6.2.8 normal ust sinirlar. Aradaki bosluklar bracket kenariyla
    # doldurulmustur (yeni sayi UYDURULMADAN).
    if yas_ay < 2:   return 60   # <2 ay
    if yas_ay < 12:  return 50   # 2-12 ay
    if yas_ay < 72:  return 40   # 1-<6 yas (tablo: 1-5 yas <40)
    return 30                    # >=6 yas (tablo: 6-8 yas <30)

def cocuk_nabiz_ust_sinir(yas_ay):
    # 0.3 - Pediatrik tasikardi esigi (yaklasik). Referans: Fleming S ve ark.,
    # Lancet 2011;377:1011-1018. Cocukta 100-120 fizyolojik olabilir; eriskin
    # esigini cocuga uygulamak gizli guvenlik hatasidir. KLINIK ONAY BEKLER.
    if yas_ay < 2:    return 180
    if yas_ay < 12:   return 170
    if yas_ay < 24:   return 150
    if yas_ay < 60:   return 140
    if yas_ay < 144:  return 120
    return 110

def sinif_nabiz(v, vaka):
    # 0.3 - Nabiz artik yas-duyarli.
    if _cocuk_mu(vaka):
        yas_ay = vaka.get("yas_ay")
        if yas_ay is None:
            return None  # yas yoksa cocukta YORUMLANAMAZ; eriskin esigi UYGULANMAZ
        ust = cocuk_nabiz_ust_sinir(yas_ay)
        if v > ust * 1.15: return "agir"
        if v > ust: return "orta"
        return "hafif"
    # eriskin (Tablo 4.4.1)
    if v > 120: return "agir"
    if v >= 100: return "orta"
    return "hafif"

def sinif_solunum_hizi(v, vaka):
    if _cocuk_mu(vaka):
        yas_ay = vaka.get("yas_ay")
        if yas_ay is None:
            return None  # yas yoksa cocukta YORUMLANAMAZ; eriskin esigi UYGULANMAZ
        ust = cocuk_solunum_ust_sinir(yas_ay)
        # 0.5 - cocukta ust sinirin belirgin uzeri -> 'agir' bandi eklendi.
        if v > ust * 1.5: return "agir"
        return "orta" if v > ust else "hafif"
    # eriskin: 0.5 - 'orta' bandi (25-30) eklendi. Esikler KLINIK ONAY BEKLER.
    if v > 30: return "agir"
    if v >= 25: return "orta"
    return "hafif"

def sinif_pef(v, vaka):  # % beklenen veya kisisel en iyi
    # Rehber: PEF/spirometri 5 yas altinda GUVENILIR DEGIL -> kullanma.
    if _cocuk_mu(vaka):
        yas_ay = vaka.get("yas_ay")
        if yas_ay is None or yas_ay < 60:
            return None  # <5 yas (veya yas bilinmiyor): PEF'e guvenme
    if v < 60: return "agir"
    if v <= 80: return "orta"
    return "hafif"

def sinif_sao2(v, vaka):
    # <90 zaten KIRMIZI BAYRAK (terfi) ile yakalanir.
    if _cocuk_mu(vaka):
        # Cocukta SaO2 <92 hastaneye yatis gostergesi -> daha tedbirli.
        if v > 95: return "hafif"
        if v >= 92: return "orta"
        return "agir"          # 90-91 (90 alti zaten terfi -> hayati)
    if v < 90: return "agir"
    if v <= 95: return "orta"
    return "hafif"

SAYISAL_SINIF = {
    "P_NABIZ": sinif_nabiz,
    "P_SOLUNUM_HIZI": sinif_solunum_hizi,
    "P_PEF": sinif_pef,
    "P_SAO2": sinif_sao2,
}

# Severity tier'i OLMAYAN ama TANINAN olcumler. Bunlar agirlik basamagi
# belirlemez; tehlikeleri 'kirmizi terfi' ile yakalanir (orn. PaCO2).
# (Dogrulama katmaninda gecerli sayilmalari icin burada listelenir.)
OLCUM_KODLARI = {"P_PACO2"}


# ---------------------------------------------------------------------------
def kurallari_yukle(yol=None):
    if yol is None:
        yol = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                           "triyaj_kurallari_v1.json")
    with open(yol, "r", encoding="utf-8") as f:
        return json.load(f)


def kirmizi_bayrak_kontrol(vaka, kurallar):
    """Vakadaki kirmizi bayrak kodlarini, kural setindeki gecerli kodlarla esler.
    Donus: tetiklenen bayraklarin (kod, tr) listesi."""
    gecerli = {}
    rf = kurallar["kirmizi_bayraklar"]
    for b in rf["astim_hayati_tehdit"]:
        gecerli[b["kod"]] = b["tr"]
    for b in rf["astim_disi_acil"]["liste"]:
        gecerli[b["kod"]] = b["tr"]

    tetiklenen = []
    for kod in vaka.get("kirmizi_bayrak", []):
        if kod in gecerli:
            tetiklenen.append((kod, gecerli[kod]))
    return tetiklenen


def kirmizi_terfi(vaka, kurallar):
    """Sayisal bir olcum, kirmizi bayrak esigini asiyorsa ilgili bayragi
    OTOMATIK ekler. Boylece ayni klinik gercek (orn. SaO2=86) ister 'kod'
    ister 'sayi' olarak girilsin sonuc AYNI ve guvenli tarafta olur.
    Esikler red-flag tanimlarinin icinde ('terfi') -> tek dogru kaynak.
    Donus: terfi eden bayrak kodlarinin listesi."""
    params = vaka.get("parametreler", {})
    rf = kurallar["kirmizi_bayraklar"]
    tanimlar = list(rf["astim_hayati_tehdit"]) + list(rf["astim_disi_acil"]["liste"])
    terfi_eden = []
    for b in tanimlar:
        kural = b.get("terfi")
        if not kural or kural["parametre"] not in params:
            continue
        try:
            deger = float(params[kural["parametre"]])
        except (TypeError, ValueError):
            continue
        op, esik = kural["op"], kural["esik"]
        if (op == "<" and deger < esik) or (op == ">" and deger > esik):
            terfi_eden.append(b["kod"])
    return terfi_eden


def atak_agirligini_belirle(vaka):
    """Verilen parametrelerden en agir sinifi secer (birkaci yeterli).
    Donus: (sinif_or_None, gerekce_listesi, siniflanabilen_parametre_sayisi)."""
    params = vaka.get("parametreler", {})
    en_agir_idx = -1
    en_agir = None
    gerekce = []
    siniflanan = 0

    for kod, deger in params.items():
        sinif = None
        if kod in KATEGORIK_SINIF:
            sinif = KATEGORIK_SINIF[kod].get(deger)
        elif kod in SAYISAL_SINIF:
            try:
                sinif = SAYISAL_SINIF[kod](float(deger), vaka)
            except (TypeError, ValueError):
                sinif = None
        if sinif is None:
            continue  # taninmayan/eksik deger -> atla (asagiya dusurmez)

        siniflanan += 1
        idx = SIRA.index(sinif)
        gerekce.append(f"{kod}={deger} -> {sinif}")
        if idx > en_agir_idx:
            en_agir_idx = idx
            en_agir = sinif

    return en_agir, gerekce, siniflanan


def risk_eskalasyonu(sinif, vaka, kurallar):
    """Olumcul-atak risk faktoru varsa esigi DUSUR (sinifi bir basamak yukselt).
    POLITIKA KARARI: yalnizca hafif/orta'yi yukseltiyoruz; risk faktoru tek
    basina 'hayati_tehdit' yapmaz (o gercek kirmizi bayrak gerektirir).
    Bu kural ayarlanabilir; hekim onayi ister."""
    gecerli = {r["kod"] for r in kurallar["olumcul_atak_risk_faktorleri"]["liste"]}
    aktif = [k for k in vaka.get("risk_faktorleri", []) if k in gecerli]
    if not aktif or sinif is None:
        return sinif, aktif, False

    idx = SIRA.index(sinif)
    if sinif in ("hafif", "orta"):
        yeni = SIRA[min(idx + 1, SIRA.index("agir"))]
        return yeni, aktif, (yeni != sinif)
    return sinif, aktif, False


def triyaj(vaka, kurallar):
    """Ana fonksiyon. Sirayla: kirmizi bayrak -> agirlik -> risk -> yonlendirme."""
    sonuc = {"adimlar": []}

    # 1) Kirmizi bayrak: varsa her seyi atla.
    #    Once sayisal terfi: esik asan olcumler bayraga yukseltilir.
    terfi = kirmizi_terfi(vaka, kurallar)
    if terfi:
        vaka = dict(vaka)
        vaka["kirmizi_bayrak"] = list(vaka.get("kirmizi_bayrak", [])) + terfi
    bayraklar = kirmizi_bayrak_kontrol(vaka, kurallar)
    if bayraklar:
        sonuc["sinif"] = "hayati_tehdit"
        sonuc["kirmizi_bayrak"] = bayraklar
        if terfi:
            sonuc["adimlar"].append(f"Sayisal olcum esigi asti -> kirmizi bayraga terfi: {terfi}")
        sonuc["adimlar"].append("Kirmizi bayrak tetiklendi -> dogrudan ACIL, diger adimlar atlandi.")
        sonuc["yonlendirme"] = kurallar["yonlendirme_haritasi"]["hayati_tehdit"]
        return sonuc

    # 2) Atak agirligi
    # Seffaflik: <5 yas cocukta PEF guvenilir degil -> kullanilmadiysa bildir.
    if vaka.get("yas_grubu") == "cocuk":
        ya = vaka.get("yas_ay")
        if "P_PEF" in vaka.get("parametreler", {}) and (ya is None or ya < 60):
            sonuc["adimlar"].append("Cocuk <5 yas (veya yas bilinmiyor): PEF guvenilir degil, dikkate alinmadi.")
    sinif, gerekce, siniflanan = atak_agirligini_belirle(vaka)
    sonuc["agirlik_gerekce"] = gerekce

    # 4) Fail-safe: hic parametre siniflanamadiysa -> belirsiz (yukari yuvarla)
    if siniflanan == 0:
        sonuc["sinif"] = "belirsiz"
        sonuc["adimlar"].append("Yeterli parametre yok -> guvenli tarafa yuvarlandi (belirsiz).")
        sonuc["yonlendirme"] = kurallar["yonlendirme_haritasi"]["belirsiz"]
        return sonuc

    sonuc["adimlar"].append(f"Atak agirligi (birkaci yeterli, en agir kazanir): {sinif}")

    # 3) Risk eskalasyonu
    yeni_sinif, aktif_riskler, yukseldi = risk_eskalasyonu(sinif, vaka, kurallar)
    if aktif_riskler:
        sonuc["aktif_risk_faktorleri"] = aktif_riskler
    if yukseldi:
        sonuc["adimlar"].append(f"Risk faktoru nedeniyle esik dusuruldu: {sinif} -> {yeni_sinif}")
    sinif = yeni_sinif

    sonuc["sinif"] = sinif
    sonuc["yonlendirme"] = kurallar["yonlendirme_haritasi"][sinif]
    return sonuc


# ---------------------------------------------------------------------------
# DEMO: birkac ornek vaka ile motoru calistir
# ---------------------------------------------------------------------------
def _yazdir(baslik, vaka, sonuc):
    print("=" * 64)
    print("VAKA:", baslik)
    print("-" * 64)
    print("Sinif:", sonuc["sinif"].upper())
    print("Hasta mesaji :", sonuc["yonlendirme"]["hasta_mesaj"])
    print("Hekim etiket :", sonuc["yonlendirme"]["hekim_etiket"])
    if sonuc.get("kirmizi_bayrak"):
        print("Kirmizi bayrak:", [b[1] for b in sonuc["kirmizi_bayrak"]])
    if sonuc.get("aktif_risk_faktorleri"):
        print("Risk faktoru :", sonuc["aktif_risk_faktorleri"])
    print("Adimlar:")
    for a in sonuc["adimlar"]:
        print("   -", a)
    print()


if __name__ == "__main__":
    K = kurallari_yukle()

    # 1) Kirmizi bayrak: sessiz akciger -> bypass, dogrudan acil
    v1 = {
        "yas_grubu": "eriskin",
        "kirmizi_bayrak": ["RF_SESSIZ_AKCIGER"],
        "parametreler": {"P_KONUSMA": "kisa_cumleler"},
    }
    _yazdir("Sessiz akciger (kirmizi bayrak)", v1, triyaj(v1, K))

    # 2) Orta tablo + risk faktoru -> agir'a yukseltilir
    v2 = {
        "yas_grubu": "eriskin",
        "parametreler": {"P_KONUSMA": "kisa_cumleler", "P_NABIZ": 110, "P_SAO2": 93},
        "risk_faktorleri": ["RISK_ENTUBASYON_OYKU"],
    }
    _yazdir("Orta tablo + entubasyon oykusu", v2, triyaj(v2, K))

    # 3) Hafif tablo, risk yok
    v3 = {
        "yas_grubu": "eriskin",
        "parametreler": {"P_NEFES_DARLIGI": "eforla", "P_KONUSMA": "cumleler", "P_NABIZ": 88},
    }
    _yazdir("Hafif tablo", v3, triyaj(v3, K))

    # 4) Tek bir parametre bile yok -> belirsiz, yukari yuvarla
    v4 = {"yas_grubu": "eriskin", "parametreler": {}}
    _yazdir("Yetersiz veri", v4, triyaj(v4, K))

    # 5) En agir kazanir: her sey hafif ama konusma 'kelimeler' (agir)
    v5 = {
        "yas_grubu": "eriskin",
        "parametreler": {"P_NEFES_DARLIGI": "eforla", "P_NABIZ": 85, "P_KONUSMA": "kelimeler"},
    }
    _yazdir("Cogu hafif ama konusma=kelimeler (en agir kazanir)", v5, triyaj(v5, K))
