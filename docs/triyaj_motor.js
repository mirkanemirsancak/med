/* ===========================================================================
 * Astim Triyaj Motoru - tarayicida ve Node'da calisan tek dogru kaynak
 * ===========================================================================
 * triyaj_motoru.py'nin JS portu + Tier 0 guvenlik duzeltmeleri.
 * Karari LLM degil bu deterministik motor verir. Motor KAVRAM KODU ile calisir
 * (RF_*, P_*), dilden bagimsizdir. Belirsizlikte aciliyet DUSURULMEZ, yukseltilir.
 *
 * UMD: hem <script src> ile (window.TriyajMotor) hem require() ile kullanilir.
 * ========================================================================= */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.TriyajMotor = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // -------------------------------------------------------------------------
  // KURAL SETI (triyaj_kurallari_v1.json'dan gomulu)
  // -------------------------------------------------------------------------
  const KURALLAR = {
    _meta: { surum: "0.4.0", kaynak: "Turk Toraks Dernegi Astim Rehberi (GINA temelli)" },
    kirmizi_bayraklar: {
      astim_hayati_tehdit: [
        { kod: "RF_SESSIZ_AKCIGER", tr: "Hisilti duyulmuyor / 'sessiz akciger'", en: "Silent chest" },
        { kod: "RF_SIYANOZ", tr: "Dudak veya ciltte morarma", en: "Cyanosis" },
        { kod: "RF_KONFUZYON", tr: "Bilinc bulanikligi / uykuya egilim / konfuzyon", en: "Confusion / drowsiness" },
        { kod: "RF_KELIME_KONUSMA", tr: "Yalnizca tek tek kelimelerle konusabiliyor", en: "Speaks single words only" },
        { kod: "RF_PARADOKS_SOLUNUM", tr: "Torako-abdominal paradoks hareket", en: "Paradoxical breathing" },
        { kod: "RF_BRADIKARDI", tr: "Nabizda dusme (bradikardi)", en: "Bradycardia" },
        { kod: "RF_SAO2_DUSUK", tr: "SaO2 < %90", en: "SaO2 < 90%", terfi: { parametre: "P_SAO2", op: "<", esik: 90 } },
        { kod: "RF_PACO2_YUKSEK", tr: "PaCO2 > 45 mmHg", en: "PaCO2 > 45 mmHg", terfi: { parametre: "P_PACO2", op: ">", esik: 45 } },
        { kod: "RF_BESLENME_KESILMESI", tr: "Bebek nefes darligindan beslenmeyi/emmeyi kesiyor", en: "Infant stops feeding due to dyspnea" }
      ],
      astim_disi_acil: {
        liste: [
          { kod: "RF_GOGUS_AGRISI_KARDIYAK", tr: "Baskili/sikistirici gogus agrisi, kola/ceneye yayilma, soguk terleme", en: "Cardiac-type chest pain" },
          { kod: "RF_ANI_NEFES_DARLIGI_TEK_TARAF", tr: "Ani baslayan nefes darligi + tek tarafli gogus agrisi", en: "Sudden dyspnea + unilateral chest pain" },
          { kod: "RF_BACAK_SISLIK_AGRI", tr: "Tek bacakta sislik/agri + nefes darligi", en: "Unilateral leg swelling + dyspnea" },
          { kod: "RF_YABANCI_CISIM", tr: "Ani bogulma / yabanci cisim aspirasyonu suphesi", en: "Choking / foreign body aspiration" }
        ]
      }
    },
    olumcul_atak_risk_faktorleri: {
      liste: [
        { kod: "RISK_ENTUBASYON_OYKU", tr: "Gecmiste entubasyon / mekanik ventilasyon gerektiren atak", en: "Prior intubation/ventilation" },
        { kod: "RISK_SON_YIL_YATIS", tr: "Son 1 yilda astim nedeniyle yatis veya acil basvuru", en: "Hospitalization/ED visit in last year" },
        { kod: "RISK_ORAL_STEROID", tr: "Halen oral steroid kullaniyor veya yeni birakti", en: "Current/recent oral steroid" },
        { kod: "RISK_IKS_YOK", tr: "Inhaler steroid kullanmiyor veya yeni birakti", en: "Not on / recently stopped ICS" },
        { kod: "RISK_ASIRI_SABA", tr: "Asiri kurtarici kullanimi (>1 kutu/ay salbutamol)", en: "Overuse of SABA (>1 canister/month)" },
        { kod: "RISK_PSIKOSOSYAL", tr: "Psikiyatrik hastalik veya psikososyal sorun", en: "Psychiatric/psychosocial issues" },
        { kod: "RISK_UYUMSUZLUK", tr: "Tedaviye uyumsuzluk", en: "Poor adherence" },
        { kod: "RISK_DUSUK_SES", tr: "Dusuk sosyoekonomik duzey", en: "Low socioeconomic status" },
        { kod: "RISK_KOMORBIDITE", tr: "Eslik eden hastalik (kardiyovaskuler/diger akciger)", en: "Comorbidity" }
      ]
    },
    yonlendirme_haritasi: {
      hayati_tehdit: { hasta_mesaj: "Acil tibbi yardim alin (112 / en yakin acil servis).", hekim_etiket: "Hayati tehdit eden atak - derhal mudahale" },
      agir:          { hasta_mesaj: "Vakit kaybetmeden acil servise basvurun.", hekim_etiket: "Agir atak - hastane kosullari" },
      orta:          { hasta_mesaj: "Bugun bir hekime/acile basvurun.", hekim_etiket: "Orta atak - yakin degerlendirme" },
      hafif:         { hasta_mesaj: "Yakin zamanda hekiminize danisin; belirtiler kotuleserse acile basvurun.", hekim_etiket: "Hafif atak - ayaktan degerlendirilebilir" },
      belirsiz:      { hasta_mesaj: "Belirtileriniz net degerlendirilemedi; guvenli olmasi icin bir hekime danisin.", hekim_etiket: "Yetersiz veri - guvenli tarafa yuvarlandi" }
    }
  };

  const SIRA = ["hafif", "orta", "agir", "hayati_tehdit"];

  // -------------------------------------------------------------------------
  // KATEGORIK PARAMETRE -> SINIF  (token -> aciliyet sinifi)
  // -------------------------------------------------------------------------
  const KATEGORIK_SINIF = {
    P_NEFES_DARLIGI: { eforla: "hafif", konusurken: "orta", dinlenmede: "agir", konusamaz: "hayati_tehdit" },
    P_KONUSMA:       { cumleler: "hafif", kisa_cumleler: "orta", kelimeler: "agir", konusamiyor: "hayati_tehdit" },
    P_BILINC:        { sakin: "hafif", huzursuz: "orta", konfuzyon: "hayati_tehdit" },
    P_YARDIMCI_KAS:  { yok: "hafif", var: "orta", paradoks: "hayati_tehdit" },
    P_HISILTI:       { ekspiryum_sonu: "hafif", belirgin: "orta", sessiz: "hayati_tehdit" }
  };

  function cocukMu(vaka) { return vaka.yas_grubu === "cocuk"; }

  // -------------------------------------------------------------------------
  // YASA BAGLI ESIK YARDIMCILARI  (hekim gozden gecirebilsin diye ayri)
  // -------------------------------------------------------------------------

  // Solunum hizi normal ust siniri (Tablo 6.2.8 / WHO IMCI ile uyumlu).
  function cocukSolunumUstSinir(yasAy) {
    if (yasAy < 2)  return 60;   // <2 ay
    if (yasAy < 12) return 50;   // 2-12 ay
    if (yasAy < 72) return 40;   // 1-<6 yas
    return 30;                   // >=6 yas
  }

  // 0.3 - Pediatrik nabiz ust siniri (tasikardi esigi), yaklasik degerler.
  // Referans: Fleming S ve ark., Lancet 2011;377:1011-1018 (dinlenme nabiz
  // santilleri). Cocukta 100-120 fizyolojik olabilir; eriskin esigini cocuga
  // uygulamak gizli guvenlik hatasidir. Bu degerler KLINIK ONAY BEKLER.
  function cocukNabizUstSinir(yasAy) {
    if (yasAy < 2)  return 180;  // <2 ay
    if (yasAy < 12) return 170;  // 2-12 ay
    if (yasAy < 24) return 150;  // 1-2 yas
    if (yasAy < 60) return 140;  // 2-5 yas
    if (yasAy < 144) return 120; // 5-12 yas
    return 110;                  // >=12 yas (eriskine yaklasir)
  }

  // -------------------------------------------------------------------------
  // SAYISAL PARAMETRE siniflandiricilari  (KLINIK ONAY BEKLER)
  // -------------------------------------------------------------------------

  // 0.3 - Nabiz artik yas-duyarli.
  function sinifNabiz(v, vaka) {
    if (cocukMu(vaka)) {
      const ya = vaka.yas_ay;
      if (ya === undefined || ya === null) return null; // yas yoksa cocukta yorumlanamaz
      const ust = cocukNabizUstSinir(ya);
      if (v > ust * 1.15) return "agir";  // belirgin tasikardi
      if (v > ust) return "orta";
      return "hafif";
    }
    // eriskin (Tablo 4.4.1)
    if (v > 120) return "agir";
    if (v >= 100) return "orta";
    return "hafif";
  }

  // 0.5 - Solunum hizi granulerligi parametreler arasi tutarli kilindi.
  function sinifSolunumHizi(v, vaka) {
    if (cocukMu(vaka)) {
      const ya = vaka.yas_ay;
      if (ya === undefined || ya === null) return null; // cocukta yas yoksa yorumlanamaz
      const ust = cocukSolunumUstSinir(ya);
      if (v > ust * 1.5) return "agir"; // ust sinirin belirgin uzeri -> pediatrik distres
      if (v > ust) return "orta";
      return "hafif";
    }
    // eriskin: 'orta' bandi eklendi (25-30). Esikler KLINIK ONAY BEKLER.
    if (v > 30) return "agir";
    if (v >= 25) return "orta";
    return "hafif";
  }

  function sinifPef(v, vaka) {
    if (cocukMu(vaka)) {
      const ya = vaka.yas_ay;
      if (ya === undefined || ya === null || ya < 60) return null; // <5 yas guvenilmez
    }
    if (v < 60) return "agir";
    if (v <= 80) return "orta";
    return "hafif";
  }

  function sinifSao2(v, vaka) {
    if (cocukMu(vaka)) {
      if (v > 95) return "hafif";
      if (v >= 92) return "orta";
      return "agir"; // 90-91 (90 alti zaten terfi -> hayati)
    }
    // Eriskin: <90 zaten terfi -> hayati. Tam 90 rehberde TANIMSIZ bosluk
    // (rehber: <90 agir, 91-95 orta). Fail-safe geregi 90 -> 'agir' (yukari
    // yuvarla), 'orta'ya DUSURME. Sinir vinyeti S02 ile yakalandi.
    if (v <= 90) return "agir";
    if (v <= 95) return "orta";
    return "hafif";
  }

  const SAYISAL_SINIF = {
    P_NABIZ:        sinifNabiz,
    P_SOLUNUM_HIZI: sinifSolunumHizi,
    P_PEF:          sinifPef,
    P_SAO2:         sinifSao2
  };

  // -------------------------------------------------------------------------
  // FORM / SUNUM META (etiketler + 0.4 makullük sinirlari + mod)
  // Esikler ve sinirlar koda dagitilmadan tek yerde tutulur.
  // -------------------------------------------------------------------------
  const KATEGORIK_ETIKET = {
    P_NEFES_DARLIGI: { tr: "Nefes darligi", en: "Dyspnea", secenek: {
      eforla: { tr: "Eforla (yatabilir) - hafif", en: "On exertion (can lie flat) - mild" },
      konusurken: { tr: "Konusurken (oturmayi tercih) - orta", en: "While talking (prefers sitting) - moderate" },
      dinlenmede: { tr: "Dinlenmede, one egilmis - agir", en: "At rest, leaning forward - severe" },
      konusamaz: { tr: "Dinlenmede, konusamaz - hayati", en: "At rest, cannot speak - life-threatening" } } },
    P_KONUSMA: { tr: "Konusma", en: "Speech", secenek: {
      cumleler: { tr: "Cumlelerle - hafif", en: "Full sentences - mild" },
      kisa_cumleler: { tr: "Kisa cumlelerle - orta", en: "Short phrases - moderate" },
      kelimeler: { tr: "Kelimelerle - agir", en: "Words only - severe" },
      konusamiyor: { tr: "Konusamiyor - hayati", en: "Cannot speak - life-threatening" } } },
    P_BILINC: { tr: "Bilinc durumu", en: "Consciousness", secenek: {
      sakin: { tr: "Sakin - hafif", en: "Calm - mild" },
      huzursuz: { tr: "Huzursuz - orta", en: "Agitated - moderate" },
      konfuzyon: { tr: "Konfuzyon / uykuya egilim - hayati", en: "Confusion / drowsy - life-threatening" } } },
    P_YARDIMCI_KAS: { tr: "Yardimci solunum kaslari", en: "Accessory muscle use", secenek: {
      yok: { tr: "Yok - hafif", en: "None - mild" },
      var: { tr: "Var - orta", en: "Present - moderate" },
      paradoks: { tr: "Paradoks hareket - hayati", en: "Paradoxical movement - life-threatening" } } },
    P_HISILTI: { tr: "Hisilti", en: "Wheeze", secenek: {
      ekspiryum_sonu: { tr: "Ekspiryum sonu - hafif", en: "End-expiratory - mild" },
      belirgin: { tr: "Belirgin - orta", en: "Prominent - moderate" },
      sessiz: { tr: "Sessiz akciger - hayati", en: "Silent chest - life-threatening" } } }
  };

  // 0.4 - Her sayisal alana fizyolojik makullük siniri (min/max).
  // 0.2 - PaCO2 yalnizca hekim modunda gosterilir (hastada arteriyel kan gazi olmaz).
  const SAYISAL_ALAN = {
    // min/max: fizyolojik/olcum makullük siniri. Olculebilir en dusuk anlamli
    // deger alt sinir; sinir disi giris = ölçüm/yazim hatasi -> triyaj durur.
    P_SOLUNUM_HIZI: { tr: "Solunum hizi", en: "Respiratory rate", birim: "/dk", ipucu: "cocukta yasa bagli; eriskinde 25-30 orta, >30 agir", min: 4, max: 80, hekimModu: false },
    P_NABIZ:        { tr: "Nabiz", en: "Pulse", birim: "/dk", ipucu: "eriskinde 100-120 orta, >120 agir; cocukta yasa bagli", min: 20, max: 300, hekimModu: false },
    P_SAO2:         { tr: "SaO2 (oda havasi)", en: "SaO2 (room air)", birim: "%", ipucu: "<90 acil; cocukta <92 tedbirli", min: 50, max: 100, hekimModu: false },
    P_PEF:          { tr: "PEF (% beklenen/en iyi)", en: "PEF (% predicted/best)", birim: "%", ipucu: "<5 yas cocukta guvenilir degil", min: 0, max: 150, hekimModu: false },
    P_PACO2:        { tr: "PaCO2", en: "PaCO2", birim: "mmHg", ipucu: ">45 acil (terfi) - arteriyel kan gazi, yalnizca hekim", min: 10, max: 120, hekimModu: true }
  };

  // -------------------------------------------------------------------------
  // 0.4 - Girdi dogrulamasi: sinir disi sayisal degerleri yakalar.
  // triyaj() mantigindan AYRIDIR; UI ve test bunu ayri cagirir.
  // Donus: hata mesajlari dizisi (bos => gecerli).
  // -------------------------------------------------------------------------
  function dogrula(vaka) {
    const hatalar = [];
    const params = (vaka && vaka.parametreler) || {};
    for (const [kod, ham] of Object.entries(params)) {
      const meta = SAYISAL_ALAN[kod];
      if (!meta) continue; // kategorik veya bilinmeyen -> burada degil
      const v = parseFloat(ham);
      if (isNaN(v)) { hatalar.push({ kod, mesaj: `${meta.tr}: sayisal olmayan deger ('${ham}')` }); continue; }
      if (v < meta.min || v > meta.max)
        hatalar.push({ kod, mesaj: `${meta.tr} = ${v} ${meta.birim} makul aralik disinda (${meta.min}-${meta.max})` });
    }
    return hatalar;
  }

  // -------------------------------------------------------------------------
  // CEKIRDEK MANTIK
  // -------------------------------------------------------------------------
  function gecerliKodlar() {
    const m = {};
    KURALLAR.kirmizi_bayraklar.astim_hayati_tehdit.forEach(b => (m[b.kod] = b));
    KURALLAR.kirmizi_bayraklar.astim_disi_acil.liste.forEach(b => (m[b.kod] = b));
    return m;
  }

  function kirmiziBayrakKontrol(vaka) {
    const gecerli = gecerliKodlar();
    const tetiklenen = [];
    (vaka.kirmizi_bayrak || []).forEach(kod => {
      if (gecerli[kod]) tetiklenen.push([kod, gecerli[kod].tr]);
    });
    return tetiklenen;
  }

  function kirmiziTerfi(vaka) {
    const params = vaka.parametreler || {};
    const tanimlar = KURALLAR.kirmizi_bayraklar.astim_hayati_tehdit
      .concat(KURALLAR.kirmizi_bayraklar.astim_disi_acil.liste);
    const terfiEden = [];
    tanimlar.forEach(b => {
      const k = b.terfi;
      if (!k || !(k.parametre in params)) return;
      const deger = parseFloat(params[k.parametre]);
      if (isNaN(deger)) return;
      if ((k.op === "<" && deger < k.esik) || (k.op === ">" && deger > k.esik)) terfiEden.push(b.kod);
    });
    return terfiEden;
  }

  function atakAgirliginiBelirle(vaka) {
    const params = vaka.parametreler || {};
    let enAgirIdx = -1, enAgir = null, siniflanan = 0;
    const gerekce = [];
    for (const [kod, deger] of Object.entries(params)) {
      let sinif = null;
      if (kod in KATEGORIK_SINIF) {
        sinif = KATEGORIK_SINIF[kod][deger] || null;
      } else if (kod in SAYISAL_SINIF) {
        const sayi = parseFloat(deger);
        sinif = isNaN(sayi) ? null : SAYISAL_SINIF[kod](sayi, vaka);
      }
      if (sinif === null) continue;
      siniflanan++;
      const idx = SIRA.indexOf(sinif);
      gerekce.push(`${kod}=${deger} -> ${sinif}`);
      if (idx > enAgirIdx) { enAgirIdx = idx; enAgir = sinif; }
    }
    return { enAgir, gerekce, siniflanan };
  }

  function riskEskalasyonu(sinif, vaka) {
    const gecerli = new Set(KURALLAR.olumcul_atak_risk_faktorleri.liste.map(r => r.kod));
    const aktif = (vaka.risk_faktorleri || []).filter(k => gecerli.has(k));
    if (aktif.length === 0 || sinif === null) return { yeni: sinif, aktif, yukseldi: false };
    if (sinif === "hafif" || sinif === "orta") {
      const idx = SIRA.indexOf(sinif);
      const yeni = SIRA[Math.min(idx + 1, SIRA.indexOf("agir"))];
      return { yeni, aktif, yukseldi: yeni !== sinif };
    }
    return { yeni: sinif, aktif, yukseldi: false };
  }

  function triyaj(vakaGirdi) {
    const sonuc = { adimlar: [] };
    let vaka = vakaGirdi;

    // 1) Kirmizi bayrak (once sayisal terfi)
    const terfi = kirmiziTerfi(vaka);
    if (terfi.length) {
      vaka = Object.assign({}, vaka);
      vaka.kirmizi_bayrak = (vaka.kirmizi_bayrak || []).concat(terfi);
    }
    const bayraklar = kirmiziBayrakKontrol(vaka);
    if (bayraklar.length) {
      sonuc.sinif = "hayati_tehdit";
      sonuc.kirmizi_bayrak = bayraklar;
      if (terfi.length) sonuc.adimlar.push(`Sayisal olcum esigi asti -> kirmizi bayraga terfi: ${terfi.join(", ")}`);
      sonuc.adimlar.push("Kirmizi bayrak tetiklendi -> dogrudan ACIL, diger adimlar atlandi.");
      sonuc.yonlendirme = KURALLAR.yonlendirme_haritasi.hayati_tehdit;
      sonuc.surum = KURALLAR._meta.surum;
      return sonuc;
    }

    // 2) Atak agirligi
    if (vaka.yas_grubu === "cocuk") {
      const ya = vaka.yas_ay;
      if ("P_PEF" in (vaka.parametreler || {}) && (ya === undefined || ya === null || ya < 60))
        sonuc.adimlar.push("Cocuk <5 yas (veya yas bilinmiyor): PEF guvenilir degil, dikkate alinmadi.");
    }
    const { enAgir, gerekce, siniflanan } = atakAgirliginiBelirle(vaka);
    sonuc.agirlik_gerekce = gerekce;

    if (siniflanan === 0) {
      sonuc.sinif = "belirsiz";
      sonuc.adimlar.push("Yeterli parametre yok -> guvenli tarafa yuvarlandi (belirsiz).");
      sonuc.yonlendirme = KURALLAR.yonlendirme_haritasi.belirsiz;
      sonuc.surum = KURALLAR._meta.surum;
      return sonuc;
    }
    sonuc.adimlar.push(`Atak agirligi (birkaci yeterli, en agir kazanir): ${enAgir}`);

    // 3) Risk eskalasyonu
    const { yeni, aktif, yukseldi } = riskEskalasyonu(enAgir, vaka);
    if (aktif.length) sonuc.aktif_risk_faktorleri = aktif;
    if (yukseldi) sonuc.adimlar.push(`Risk faktoru nedeniyle esik dusuruldu: ${enAgir} -> ${yeni}`);

    sonuc.sinif = yeni;
    sonuc.yonlendirme = KURALLAR.yonlendirme_haritasi[yeni];
    sonuc.surum = KURALLAR._meta.surum;
    return sonuc;
  }

  return {
    KURALLAR, SIRA, KATEGORIK_ETIKET, SAYISAL_ALAN,
    cocukSolunumUstSinir, cocukNabizUstSinir,
    dogrula, triyaj
  };
});
