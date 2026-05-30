# Astım Ön-Değerlendirme / Triyaj Sistemi

Yapılandırılmış bir **vaka** alır, deterministik bir kural motoruyla **aciliyet
sınıfı** (hafif / orta / ağır / hayati_tehdit / belirsiz) ve **yönlendirme**
üretir. Kaynak: Türk Toraks Derneği Astım Tanı ve Tedavi Rehberi (GINA temelli).

> ⚠️ Bu sistem **TANI KOYMAZ**, tedavi önermez ve **bir tıbbi cihaz değildir**;
> yalnızca aciliyet düzeyini belirler ve yönlendirir. Belirsizlikte aciliyeti
> **yükseltir** (fail-safe). Acil bir durumdan şüpheleniyorsanız sonucu
> beklemeden **112**'yi arayın. Nihai karar hekime aittir. Vinyetler kurgudur.

## Bileşenler

| Katman | Dosya | Görev |
|---|---|---|
| **Çekirdek motor** | `triyaj_motoru.py` / `docs/triyaj_motor.js` | Deterministik karar (Python ve JS, birebir aynı mantık) |
| Kurallar | `triyaj_kurallari_v1.json` | Kırmızı bayraklar, eşikler, risk faktörleri, yönlendirme |
| **Web sitesi (statik)** | `docs/index.html` + `docs/triyaj_motor.js` | GitHub Pages; backend gerekmez, tarayıcıda çalışır |
| CLI | `triyaj_cli.py` | Terminalden vaka girip sonuç alma |
| Web (Flask, opsiyonel) | `app.py` + `templates/` | Sunucu tabanlı form + `/api/triyaj` |
| **Regresyon testi** | `docs/test_vinyet.js` + `docs/vinyetler.json` | Vinyet kapısı (Node + tarayıcı) |
| Değerlendirme (Python) | `triyaj_degerlendirme.py` | Python motoru için isabet raporu |

## GitHub Pages ile yayınlama

`docs/` klasörü statik siteyi içerir. Repo → **Settings → Pages** → Source:
"Deploy from a branch", Branch: çalışma dalı + klasör **`/docs`**. Yayın adresi:
`https://<kullanici>.github.io/med/`

## Tier 0 — Güvenlik-kritik düzeltmeler (uygulandı)

- **0.1** Hasta/Hekim mod anahtarı; hasta görünümünde klinik dil, kavram kodları
  ve karar adımları gizli (varsayılan: Hasta).
- **0.2** PaCO₂ (arteriyel kan gazı) yalnızca hekim modunda gösterilir.
- **0.3** Pediatrik nabız eşiği yaşa göre dallandırıldı (`cocukNabizUstSinir`,
  Fleming ve ark. *Lancet* 2011 referanslı). Erişkin eşiği çocuğa uygulanmaz.
- **0.4** Sayısal alanlara fizyolojik makullük sınırı; sınır dışı girdi triyajı
  durdurur ve alan altında uyarı gösterir.
- **0.5** Solunum hızı granülerliği parametreler arası tutarlı (erişkin 25-30
  "orta"; çocukta üst sınırın belirgin üzeri "ağır").
- **0.6** Muafiyet metnine "tıbbi cihaz değildir" + her zaman görünür 112 çağrısı.

## Tier 1 — Doğrulama kapısı (uygulandı)

- **1.1** `docs/test_vinyet.js`: vinyet regresyon koşucusu. **Kırmızı bayrak
  duyarlılığı %100** ve **under-triage = 0** değilse Node'da hata koduyla çıkar
  (regresyon kapısı). Mevcut: **42/42 isabet, duyarlılık %100, kaçırma 0**.
- **1.2** Karışıklık matrisi + over-triage (aşırı sevk) oranı raporlanır.

```bash
node docs/test_vinyet.js     # CI/regresyon kapısı (exit 0 = geçti)
```
Tarayıcıda: `docs/test.html` aç.

## Vaka şeması

```json
{
  "yas_grubu": "eriskin",
  "yas_ay": 36,
  "kirmizi_bayrak": ["RF_SESSIZ_AKCIGER"],
  "parametreler": { "P_NABIZ": 110, "P_KONUSMA": "kisa_cumleler", "P_SAO2": 93 },
  "risk_faktorleri": ["RISK_ENTUBASYON_OYKU"]
}
```

## CLI kullanımı

```bash
python3 triyaj_cli.py --girdi ornek_vaka.json     # dosyadan, insan-okur
cat ornek_vaka_cocuk.json | python3 triyaj_cli.py --json
```

## Sonraki adımlar (planlanan)

Tier 2 (LLM slot-filling konuşma katmanı, TR/EN, RAG açıklama) ve Tier 3
(hekim gözden geçirme, güncel GINA çapraz kontrol, regülasyon konumlandırma)
motor doğrulandıktan **sonra** gelir.
