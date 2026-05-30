/* ===========================================================================
 * Cikarim Katmani (Tier 2.1) - serbest metin -> KAVRAM KODU
 * ===========================================================================
 * GUVENLIK SINIRI (degismez ilke):
 *   - LLM yalnizca KAVRAM KODU onerir; aciliyet KARARINI vermez.
 *   - Karari her zaman deterministik triyaj() verir.
 *   - LLM cikti yalnizca {parametreler, kirmizi_bayrak, risk_faktorleri} kodlari
 *     icerebilir. Whitelist DISI hicbir kod gecmez (halusinasyon korumasi).
 *   - Belirsizlikte tek bir takip sorusu onerilir; uydurma yapilmaz.
 *
 * Bu dosya 3 sey saglar:
 *   1) SEMA + SISTEM PROMPT + AZ-ORNEK  -> gercek LLM cagrisi icin sozlesme
 *   2) cikarimDogrula()                 -> LLM ciktisini whitelist'e gore TEMIZLER
 *   3) mockCikar()                      -> API'siz, deterministik anahtar-kelime
 *      cikarici (test ve fallback icin). LLM DEGILDIR; sadece sozlesmeyi
 *      kanitlamak ve cevrimdisi calismak icin.
 *
 * UMD: tarayicida window.TriyajCikarim, Node'da require().
 * ========================================================================= */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./triyaj_motor.js"));
  else root.TriyajCikarim = factory(root.TriyajMotor);
})(typeof self !== "undefined" ? self : this, function (motor) {
  "use strict";

  // -------------------------------------------------------------------------
  // GECERLI KOD EVRENI  (tek dogru kaynak: motorun kural seti)
  // -------------------------------------------------------------------------
  function gecerliEvren() {
    const K = motor.KURALLAR;
    const kategorik = {}; // P_* -> izinli token kumesi
    for (const [kod, meta] of Object.entries(motor.KATEGORIK_ETIKET))
      kategorik[kod] = new Set(Object.keys(meta.secenek));
    const sayisal = new Set(Object.keys(motor.SAYISAL_ALAN)); // P_* sayisal
    const kirmizi = new Set(
      K.kirmizi_bayraklar.astim_hayati_tehdit.map(b => b.kod)
        .concat(K.kirmizi_bayraklar.astim_disi_acil.liste.map(b => b.kod))
    );
    const risk = new Set(K.olumcul_atak_risk_faktorleri.liste.map(r => r.kod));
    return { kategorik, sayisal, kirmizi, risk };
  }

  // -------------------------------------------------------------------------
  // SEMA  (gercek LLM'e verilecek cikti sozlesmesi)
  // -------------------------------------------------------------------------
  const CIKTI_SEMASI = {
    type: "object",
    additionalProperties: false,
    properties: {
      parametreler: { type: "object", description: "P_* kodu -> token (kategorik) veya sayi (sayisal)" },
      kirmizi_bayrak: { type: "array", items: { type: "string" }, description: "RF_* kodlari" },
      risk_faktorleri: { type: "array", items: { type: "string" }, description: "RISK_* kodlari" },
      takip_sorusu: { type: ["string", "null"], description: "Eksik/belirsizse TEK takip sorusu; yoksa null" }
    },
    required: ["parametreler", "kirmizi_bayrak", "risk_faktorleri"]
  };

  function sistemPrompt() {
    const ev = gecerliEvren();
    const kategorikSatir = Object.entries(ev.kategorik)
      .map(([k, s]) => `  ${k}: ${[...s].join(" | ")}`).join("\n");
    return [
      "Sen bir TIBBI TRIYAJ ASISTANI DEGILSIN ve ACILIYET KARARI VERMEZSIN.",
      "Gorevin YALNIZCA: hastanin gunluk dildeki anlatimini, asagidaki SABIT kod",
      "evrenine cevirmek. Karari ayri bir deterministik motor verecek.",
      "",
      "KURALLAR:",
      "- Yalnizca asagida TANIMLI kodlari kullan. Tanimsiz kod URETME.",
      "- Emin olmadigin bulguyu EKLEME (ozellikle kirmizi bayrak uydurma).",
      "- Cikti SADECE su JSON: {parametreler, kirmizi_bayrak, risk_faktorleri, takip_sorusu}.",
      "- Kritik bir bulgu belirsizse takip_sorusu'na TEK soru yaz; yoksa null.",
      "",
      "KATEGORIK PARAMETRELER (kod: izinli degerler):",
      kategorikSatir,
      "",
      "SAYISAL PARAMETRELER (kod -> sayi): " + [...ev.sayisal].join(", "),
      "KIRMIZI BAYRAKLAR: " + [...ev.kirmizi].join(", "),
      "RISK FAKTORLERI: " + [...ev.risk].join(", ")
    ].join("\n");
  }

  // Az-ornek (few-shot): gercek cagrida prompt'a eklenir, mock testinde referans.
  const AZ_ORNEK = [
    {
      girdi: "Nefesim eforla daralıyor ama cümlelerle konuşabiliyorum, nabzım 88.",
      cikti: { parametreler: { P_NEFES_DARLIGI: "eforla", P_KONUSMA: "cumleler", P_NABIZ: 88 },
               kirmizi_bayrak: [], risk_faktorleri: [], takip_sorusu: null }
    },
    {
      girdi: "Dudaklarım morardı ve sadece tek tek kelime söyleyebiliyorum.",
      cikti: { parametreler: { P_KONUSMA: "kelimeler" },
               kirmizi_bayrak: ["RF_SIYANOZ"], risk_faktorleri: [], takip_sorusu: null }
    },
    {
      girdi: "Göğsüm sıkışıyor.",
      cikti: { parametreler: {}, kirmizi_bayrak: [], risk_faktorleri: [],
               takip_sorusu: "Gogus agriniz kola veya cenenize yayiliyor, soguk terleme var mi?" }
    }
  ];

  // -------------------------------------------------------------------------
  // DOGRULAYICI (halusinasyon korumasi) - LLM ciktisini whitelist'e indirger
  // Donus: { vaka, atilanlar:[...], takip_sorusu }
  // -------------------------------------------------------------------------
  function cikarimDogrula(ham, yasGrubu) {
    const ev = gecerliEvren();
    const atilanlar = [];
    const params = {};
    const gelenParams = (ham && ham.parametreler) || {};
    for (const [kod, deger] of Object.entries(gelenParams)) {
      if (ev.kategorik[kod]) {
        if (ev.kategorik[kod].has(deger)) params[kod] = deger;
        else atilanlar.push(`${kod}=${deger} (gecersiz token)`);
      } else if (ev.sayisal.has(kod)) {
        const n = parseFloat(deger);
        if (!isNaN(n)) params[kod] = n;
        else atilanlar.push(`${kod}=${deger} (sayisal degil)`);
      } else {
        atilanlar.push(`${kod} (tanimsiz parametre)`);
      }
    }
    const kirmizi = [];
    for (const k of (ham && ham.kirmizi_bayrak) || []) {
      if (ev.kirmizi.has(k)) kirmizi.push(k); else atilanlar.push(`${k} (tanimsiz kirmizi bayrak)`);
    }
    const risk = [];
    for (const r of (ham && ham.risk_faktorleri) || []) {
      if (ev.risk.has(r)) risk.push(r); else atilanlar.push(`${r} (tanimsiz risk)`);
    }
    const vaka = { yas_grubu: yasGrubu || "eriskin", parametreler: params,
                   kirmizi_bayrak: kirmizi, risk_faktorleri: risk };
    let takip = (ham && typeof ham.takip_sorusu === "string" && ham.takip_sorusu.trim())
      ? ham.takip_sorusu.trim() : null;
    return { vaka, atilanlar, takip_sorusu: takip };
  }

  // -------------------------------------------------------------------------
  // MOCK CIKARICI (deterministik, API'siz) - anahtar kelime esleme.
  // NOT: Bu bir LLM DEGILDIR; yalnizca sozlesmeyi test etmek ve API yokken
  // graceful fallback saglamak icindir. Kapsami bilincli olarak dardir.
  // -------------------------------------------------------------------------
  const ANAHTAR = [
    // [regex, uygulayici(vaka)]
    [/morar|siyanoz|dudak.*mor/i, v => v.kirmizi_bayrak.push("RF_SIYANOZ")],
    [/sessiz|h[ıi]ş[ıi]lt[ıi].*duy(m|a)|hav[ai] giremiyor/i, v => v.kirmizi_bayrak.push("RF_SESSIZ_AKCIGER")],
    [/bay[ıi]l|bilinç|uyku.*eğilim|konf[uü]z/i, v => v.kirmizi_bayrak.push("RF_KONFUZYON")],
    [/kelime kelime|tek tek kelime|sadece kelime/i, v => v.parametreler.P_KONUSMA = "kelimeler"],
    [/konuşam[ıi]yor|konuşamad/i, v => v.parametreler.P_KONUSMA = "konusamiyor"],
    [/k[ıi]sa c[uü]mle|k[ıi]sa k[ıi]sa/i, v => v.parametreler.P_KONUSMA = "kisa_cumleler"],
    [/c[uü]mlelerle|rahat konuş/i, v => v.parametreler.P_KONUSMA = "cumleler"],
    [/dinlenmede.*nefes|otururken bile nefes|hareketsiz.*nefes darl/i, v => v.parametreler.P_NEFES_DARLIGI = "dinlenmede"],
    [/eforla|yürürken nefes|merdiven.*nefes/i, v => v.parametreler.P_NEFES_DARLIGI = "eforla"],
  ];
  const SAYI_KURAL = [
    [/nab[ıi]?z\D{0,12}(\d{2,3})/i, "P_NABIZ"],
    [/(?:sat[üu]ras|sao2|oksijen)\D{0,12}(\d{2,3})/i, "P_SAO2"],
    [/solunum\D{0,12}(\d{2,3})|dakikada (\d{2,3}) nefes/i, "P_SOLUNUM_HIZI"],
  ];

  function mockCikar(metin, yasGrubu) {
    const v = { yas_grubu: yasGrubu || "eriskin", parametreler: {}, kirmizi_bayrak: [], risk_faktorleri: [] };
    for (const [re, fn] of ANAHTAR) if (re.test(metin)) fn(v);
    for (const [re, kod] of SAYI_KURAL) {
      const m = metin.match(re);
      if (m) { const sayi = m.slice(1).find(x => x !== undefined); if (sayi) v.parametreler[kod] = parseFloat(sayi); }
    }
    // belirsizlik: gogus agrisi gecip kardiyak ayrinti yoksa tek takip sorusu
    let takip = null;
    // gogus/göğüs/gögsüm + sikis/sıkış/agri/ağrı (ASCII ve TR yaziluma toleransli)
    if (/g[oö]ğ?[gs][uü]?[sm]/i.test(metin) && /s[ıi]k[ıi]ş?|ağr|agr/i.test(metin) &&
        v.kirmizi_bayrak.length === 0 && Object.keys(v.parametreler).length === 0)
      takip = "Gogus agriniz kola/cenenize yayiliyor mu, soguk terleme var mi?";
    return { parametreler: v.parametreler, kirmizi_bayrak: v.kirmizi_bayrak,
             risk_faktorleri: v.risk_faktorleri, takip_sorusu: takip };
  }

  return {
    CIKTI_SEMASI, AZ_ORNEK, sistemPrompt, gecerliEvren,
    cikarimDogrula, mockCikar
  };
});
