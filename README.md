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
- **1.2** Karışıklık matrisi + over-triage (aşırı sevk) oranı raporlanır. Over-triage
  artık **klinik tabana** (`klinik_gold`) göre ölçülür ve "fail-safe gereği kabul"
  ile "beklenmedik" olarak ayrılır — sıfır-over yanıltıcı güveni oluşturmaz.

### Doğrulama katmanları ve dürüstlük sınırı

- **`docs/vinyetler.json`** — temel regresyon seti (iç tutarlılık).
- **`docs/vinyetler_sinir.json`** — adversaryal/sınır seti: eşik kenarları
  (off-by-one), çelişkili sinyaller, kasıtlı belirsizlik, kabul edilen over-triage.
  Bu set bir gerçek bug yakaladı (S02: erişkin SaO₂=90 fail-safe boşluğu → düzeltildi).
- **`test_parite.py`** — **çapraz-motor parite**: aynı vinyetleri hem Python hem JS
  motorundan geçirip çıktının birebir aynı olduğunu doğrular (iki motor sapamaz).

> Bu testler **iç tutarlılık** ve **iki-motor uyumu** kanıtlar; **dış geçerlilik
> DEĞİL**. Vinyetler kurgudur, gerçek hasta verisi yoktur. Semptom kontrolcüleri
> için referans nokta ~%57 uygun triyaj (Semigran ve ark., *BMJ* 2015); iddialar
> bu zemine göre mütevazı tutulmalıdır.

```bash
./test_hepsi.sh              # üç kapıyı birden çalıştırır (exit 0 = hepsi geçti)
node docs/test_vinyet.js     # yalnız regresyon + sınır kapısı
python3 test_parite.py       # yalnız çapraz-motor parite
```
Tarayıcıda: `docs/test.html` aç (her iki vinyet setini yükler).

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

## Açık maddeler (kapanmadı — bilinçli)

Kod doğrulanmış olsa da şu maddeler **klinik/yönetişim** kararı bekler:

- **Klinik imza:** Pediatrik nabız eşikleri (`cocuk_nabiz_ust_sinir`) ve erişkin
  solunum "orta" bandı (25–30) tarafımızca konuldu; göğüs hastalıkları uzmanı
  onayı gerekir. Kodda "KLİNİK ONAY BEKLER" olarak işaretli.
- **Güncel GINA:** Kaynak TTD/GINA 2007 dönemi. Triyaj için kabul edilebilir;
  SaO₂ kesim noktaları güncel GINA ile çapraz kontrol edilmeli (tedavi eklenirse
  zorunlu).
- **Regülasyon konumu:** "Tıbbi cihaz değildir" ibaresi etik korur ama sınıfı
  değiştirmez; MDR 2017/745 Kural 11 kapsamında muhtemelen Sınıf IIa. Bilgi aracı
  mı / tıbbi cihaz mı kararı bütçe/takvimden önce verilmelidir.
- **Denetim izi:** Sürüm damgası var; girdi+çıktıyı kalıcı, indirilebilir bir kayda
  yazmak savunulabilirlik için önerilir.

## Tier 2.1 — Konuşma / kod çıkarımı katmanı (uygulandı)

Hasta modunda **serbest metin** kutusu: kullanıcı durumunu günlük dille anlatır;
katman bunu yalnızca **kavram koduna** çevirip formu doldurur. Karar yine
deterministik `triyaj()` motorundadır.

Güvenlik sınırı (yapısal olarak zorlanır, `docs/cikarim.js`):
- LLM **aciliyet kararı vermez**, yalnızca `{parametreler, kirmizi_bayrak,
  risk_faktorleri, takip_sorusu}` kodları önerir.
- **Whitelist dışı hiçbir kod geçmez** — `cikarimDogrula()` tanımsız/uydurma
  kodları (halüsinasyon) atar ve raporlar.
- Belirsizlikte **tek bir takip sorusu** önerilir; bulgu uydurulmaz.
- **Çevrimdışı yedek:** Claude API anahtarı girilirse gerçek çağrı yapılır
  (istemci tarafı, anahtar yalnız tarayıcıda); yoksa veya hata olursa deterministik
  anahtar-kelime eşleyici + form akışına düşülür (graceful fallback).

Bu katman da test edilir (`docs/test_cikarim.js`): halüsinasyon koruması,
"LLM karar vermez", mock→doğrula→triyaj zinciri, belirsizlik→takip sorusu.

## Sonraki adımlar (planlanan)

Tier 2.3 (hekim-modu RAG açıklama, rehber pasajına bağlı "neden bu sınıf") ve
Tier 3 klinik/regülasyon imzaları. Gerçek Claude çağrısının canlı doğrulaması
bir API anahtarı gerektirir; mock ile sözleşme ve güvenlik sınırı kanıtlanmıştır.
