#!/usr/bin/env python3
"""
CANLI Claude API dogrulama  (Tier 2.1 - gercek cagri)
=====================================================
Amac: cikarim katmaninin GERCEK Claude ile uctan uca calistigini kanitlamak.
Zincir:  serbest metin -> Claude (kod cikarimi) -> WHITELIST dogrulama
         -> deterministik triyaj() motoru -> aciliyet sinifi.

GUVENLIK:
  - API anahtari ortam degiskeninden okunur (ANTHROPIC_API_KEY). Koda/git'e GIRMEZ.
  - Sistem prompt + whitelist, sitedeki ile AYNI kaynaktan (docs/cikarim.js) gelir;
    Node uzerinden cekilir ki iki yerde sapma olmasin.
  - Claude KARAR vermez; yalniz kod onerir. Whitelist disi kod ATILIR.

Kullanim:
  export ANTHROPIC_API_KEY=sk-ant-...
  pip install anthropic
  python3 dogrula_canli.py
  # veya tek bir metin:
  python3 dogrula_canli.py "Eforla nefesim daraliyor, nabzim 130"

Maliyet: cagri basina ~1 sentin cok altinda; deneme kredisiyle (~$5) bedava sayilir.
"""
import json
import os
import subprocess
import sys

KOK = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, KOK)
import triyaj_motoru as motor  # deterministik karar motoru (ayni cekirdek)

MODEL = "claude-opus-4-8"

# Canli dogrulama senaryolari: (metin, beklenen_sinif). Beklenen, KLINIK akil yurutme;
# motorun gercekten uretmesi gereken sinif. Claude'un dogru KOD cikarip cikarmadigini
# ve zincirin dogru sinifa varip varmadigini test eder.
SENARYOLAR = [
    ("Eforla nefesim biraz daraliyor ama rahatca tam cumlelerle konusabiliyorum, nabzim 85 civari.", "hafif"),
    ("Dinlenirken bile nefesim cok daraliyor, ancak kisa kisa konusabiliyorum.", "agir"),
    ("Dudaklarim morardi ve sadece tek tek kelimelerle konusabiliyorum.", "hayati_tehdit"),
    ("Parmagimdaki olcer oksijenimi yuzde 86 gosteriyor.", "hayati_tehdit"),
    ("Biraz oksuruyorum, hafif bir sikinti var ama gunluk islerimi yapabiliyorum.", "hafif"),
]


def js_sozlesme():
    """Sistem prompt + gecerli kod evrenini docs/cikarim.js'ten (tek kaynak) ceker."""
    kod = (
        "const C=require('./docs/cikarim.js');"
        "const ev=C.gecerliEvren();"
        "const d={prompt:C.sistemPrompt(),"
        " kategorik:Object.fromEntries(Object.entries(ev.kategorik).map(([k,v])=>[k,[...v]])),"
        " sayisal:[...ev.sayisal],kirmizi:[...ev.kirmizi],risk:[...ev.risk]};"
        "process.stdout.write(JSON.stringify(d));"
    )
    out = subprocess.check_output(["node", "-e", kod], cwd=KOK)
    return json.loads(out)


def dogrula_whitelist(ham, evren, yas_grubu="eriskin"):
    """docs/cikarim.js'teki cikarimDogrula ile AYNI mantik (Python kopyasi).
    Whitelist disi kodlari atar."""
    atilan = []
    params = {}
    for kod, deger in (ham.get("parametreler") or {}).items():
        if kod in evren["kategorik"]:
            if deger in evren["kategorik"][kod]:
                params[kod] = deger
            else:
                atilan.append(f"{kod}={deger} (gecersiz token)")
        elif kod in evren["sayisal"]:
            try:
                params[kod] = float(deger)
            except (TypeError, ValueError):
                atilan.append(f"{kod}={deger} (sayisal degil)")
        else:
            atilan.append(f"{kod} (tanimsiz parametre)")
    kirmizi = []
    for k in ham.get("kirmizi_bayrak") or []:
        (kirmizi if k in evren["kirmizi"] else atilan).append(k if k in evren["kirmizi"] else f"{k} (tanimsiz kirmizi bayrak)")
    risk = []
    for r in ham.get("risk_faktorleri") or []:
        (risk if r in evren["risk"] else atilan).append(r if r in evren["risk"] else f"{r} (tanimsiz risk)")
    vaka = {"yas_grubu": yas_grubu, "parametreler": params,
            "kirmizi_bayrak": kirmizi, "risk_faktorleri": risk}
    takip = ham.get("takip_sorusu")
    takip = takip.strip() if isinstance(takip, str) and takip.strip() else None
    return vaka, atilan, takip


def claude_cikar(client, sistem, metin):
    msg = client.messages.create(
        model=MODEL,
        max_tokens=600,
        system=sistem,
        messages=[{"role": "user", "content":
            f'Hastanin anlatimi:\n"{metin}"\n\n'
            'Yalniz JSON dondur: {parametreler, kirmizi_bayrak, risk_faktorleri, takip_sorusu}. '
            'Baska metin yazma.'}],
    )
    txt = "".join(getattr(b, "text", "") for b in msg.content)
    s, e = txt.find("{"), txt.rfind("}")
    if s < 0 or e < 0:
        raise ValueError(f"JSON cikti bulunamadi: {txt[:120]}")
    return json.loads(txt[s:e + 1]), msg.usage


def main():
    anahtar = os.environ.get("ANTHROPIC_API_KEY")
    if not anahtar:
        print("HATA: ANTHROPIC_API_KEY ortam degiskeni yok.\n"
              "  export ANTHROPIC_API_KEY=sk-ant-...  ile ayarlayin.")
        sys.exit(2)
    try:
        import anthropic
    except ImportError:
        print("HATA: 'anthropic' paketi yok.  pip install anthropic")
        sys.exit(2)

    client = anthropic.Anthropic(api_key=anahtar)
    soz = js_sozlesme()
    evren = {"kategorik": {k: set(v) for k, v in soz["kategorik"].items()},
             "sayisal": set(soz["sayisal"]), "kirmizi": set(soz["kirmizi"]), "risk": set(soz["risk"])}
    K = motor.kurallari_yukle()

    # Komut satirindan tek metin verildiyse onu kullan
    if len(sys.argv) > 1:
        senaryolar = [(" ".join(sys.argv[1:]), None)]
    else:
        senaryolar = SENARYOLAR

    print("=" * 70)
    print(f"CANLI CLAUDE DOGRULAMA  (model: {MODEL})")
    print("=" * 70)
    gecti = top = 0
    toplam_in = toplam_out = 0
    for metin, beklenen in senaryolar:
        ham, usage = claude_cikar(client, soz["prompt"], metin)
        toplam_in += usage.input_tokens
        toplam_out += usage.output_tokens
        vaka, atilan, takip = dogrula_whitelist(ham, evren)
        sonuc = motor.triyaj(vaka, K)
        sinif = sonuc["sinif"]

        print(f'\nMETIN: "{metin}"')
        print(f"  Claude ham cikti : {json.dumps(ham, ensure_ascii=False)}")
        print(f"  Whitelist sonrasi: parametreler={vaka['parametreler']} "
              f"kirmizi={vaka['kirmizi_bayrak']} risk={vaka['risk_faktorleri']}")
        if atilan:
            print(f"  ATILAN (whitelist): {atilan}")
        if takip:
            print(f"  Takip sorusu     : {takip}")
        print(f"  MOTOR KARARI     : {sinif.upper()}  (Claude degil, deterministik motor)")
        if beklenen is not None:
            top += 1
            ok = sinif == beklenen
            gecti += ok
            print(f"  Beklenen         : {beklenen}  -> {'OK' if ok else 'UYUSMAZLIK'}")

    print("\n" + "=" * 70)
    if top:
        print(f"Zincir isabeti: {gecti}/{top}")
    print(f"Token kullanimi: girdi={toplam_in}, cikti={toplam_out} "
          f"(~maliyet < 1 sent)")
    print("Not: Claude yalniz KOD cikardi; aciliyet karari motorda.")
    sys.exit(0 if (not top or gecti == top) else 1)


if __name__ == "__main__":
    main()
