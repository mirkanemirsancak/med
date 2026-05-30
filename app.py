"""
Astim Triyaj - Web Arayuzu (Flask)
==================================
Tarayicida bir form: vaka bilgilerini girersin, triyaj sonucu ekranda cikar.
Form alanlari kural setinden (triyaj_kurallari_v1.json) ve motorun kategorik
eslestirmelerinden DINAMIK uretilir; boylece kurallar degisince form da degisir.

Calistirma:
  pip install -r requirements.txt
  python3 app.py
  Tarayici: http://127.0.0.1:5000

Ayrica makine-makine kullanim icin JSON API:
  POST /api/triyaj   body: {vaka JSON}   ->  {sinif, yonlendirme, ...}

NOT: TANI koymaz; aciliyet duzeyi belirler ve yonlendirir.
"""

from flask import Flask, render_template, request, jsonify

import triyaj_motoru as motor

app = Flask(__name__)

# Kategorik parametre secenekleri: token -> insan etiketi (rehber esik metninden)
KATEGORIK_ETIKET = {
    "P_NEFES_DARLIGI": {
        "eforla": "Eforla (yatabilir) - hafif",
        "konusurken": "Konusurken (oturmayi tercih) - orta",
        "dinlenmede": "Dinlenmede, one egilmis - agir",
        "konusamaz": "Dinlenmede, konusamaz - hayati",
    },
    "P_KONUSMA": {
        "cumleler": "Cumlelerle - hafif",
        "kisa_cumleler": "Kisa cumlelerle - orta",
        "kelimeler": "Kelimelerle - agir",
        "konusamiyor": "Konusamiyor - hayati",
    },
    "P_BILINC": {
        "sakin": "Sakin - hafif",
        "huzursuz": "Huzursuz - orta",
        "konfuzyon": "Konfuzyon / uykuya egilim - hayati",
    },
    "P_YARDIMCI_KAS": {
        "yok": "Yok - hafif",
        "var": "Var - orta",
        "paradoks": "Paradoks hareket - hayati",
    },
    "P_HISILTI": {
        "ekspiryum_sonu": "Ekspiryum sonu - hafif",
        "belirgin": "Belirgin - orta",
        "sessiz": "Sessiz akciger - hayati",
    },
}

# Sayisal parametreler: kod -> (etiket, birim, ipucu)
SAYISAL_ALAN = {
    "P_SOLUNUM_HIZI": ("Solunum hizi", "/dk", "cocukta yasa bagli; eriskinde >30 agir"),
    "P_NABIZ": ("Nabiz", "/dk", "100-120 orta, >120 agir"),
    "P_SAO2": ("SaO2 (oda havasi)", "%", "<90 acil; cocukta <92 tedbirli"),
    "P_PEF": ("PEF (% beklenen/en iyi)", "%", "<5 yas cocukta guvenilir degil"),
    "P_PACO2": ("PaCO2", "mmHg", ">45 acil (terfi)"),
}


def form_meta():
    """Kural setinden form icin etiketleri toplar."""
    K = motor.kurallari_yukle()
    rf = K["kirmizi_bayraklar"]
    kirmizi = [(b["kod"], b["tr"]) for b in rf["astim_hayati_tehdit"]]
    kirmizi += [(b["kod"], b["tr"]) for b in rf["astim_disi_acil"]["liste"]]
    riskler = [(r["kod"], r["tr"]) for r in K["olumcul_atak_risk_faktorleri"]["liste"]]
    return {
        "kategorik": KATEGORIK_ETIKET,
        "sayisal": SAYISAL_ALAN,
        "kirmizi_bayraklar": kirmizi,
        "risk_faktorleri": riskler,
    }


def formdan_vaka(form):
    """HTML form verisini motor VAKA semasina cevirir."""
    vaka = {"yas_grubu": form.get("yas_grubu", "eriskin"), "parametreler": {}}

    yas_ay = form.get("yas_ay", "").strip()
    if yas_ay:
        try:
            vaka["yas_ay"] = int(yas_ay)
        except ValueError:
            pass

    for kod in KATEGORIK_ETIKET:
        deger = form.get(kod, "").strip()
        if deger:
            vaka["parametreler"][kod] = deger

    for kod in SAYISAL_ALAN:
        ham = form.get(kod, "").strip()
        if ham:
            try:
                vaka["parametreler"][kod] = float(ham)
            except ValueError:
                pass

    vaka["kirmizi_bayrak"] = form.getlist("kirmizi_bayrak")
    vaka["risk_faktorleri"] = form.getlist("risk_faktorleri")
    return vaka


@app.route("/", methods=["GET", "POST"])
def index():
    meta = form_meta()
    sonuc = vaka = None
    if request.method == "POST":
        vaka = formdan_vaka(request.form)
        K = motor.kurallari_yukle()
        sonuc = motor.triyaj(vaka, K)
    return render_template("index.html", meta=meta, sonuc=sonuc, vaka=vaka)


@app.route("/api/triyaj", methods=["POST"])
def api_triyaj():
    vaka = request.get_json(force=True, silent=True)
    if vaka is None:
        return jsonify({"hata": "Gecersiz veya bos JSON govdesi"}), 400
    K = motor.kurallari_yukle()
    sonuc = motor.triyaj(vaka, K)
    return jsonify({"vaka": vaka, "sonuc": sonuc})


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=True)
