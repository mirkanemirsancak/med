/* ===========================================================================
 * Vinyet regresyon kosucusu  (Tier 1: 1.1 + 1.2)
 * ===========================================================================
 * - Saf JS; hem Node'da (CI/regresyon kapisi) hem tarayicida calisir.
 * - 1.1: her vinyet gecti/kaldi, toplam isabet, KIRMIZI BAYRAK DUYARLILIGI.
 *        Duyarlilik %100 degilse Node'da hata koduyla (1) cikar -> regresyon kapisi.
 * - 1.2: karisiklik matrisi + under-triage (kacirma, hedef 0) ve
 *        over-triage (asiri sevk, izlenen metrik) oranlari.
 *
 * Node:     node docs/test_vinyet.js
 * Tarayici: testleriCalistir(motor, vinyetler) -> rapor nesnesi
 * ========================================================================= */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.TriyajTest = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const SIRA = ["belirsiz", "hafif", "orta", "agir", "hayati_tehdit"];
  // 'belirsiz' siralama disi tutulur (yon degil, guvenli yuvarlama); under/over
  // hesabinda yalnizca derecelendirilmis siniflar karsilastirilir.
  const DERECE = { hafif: 1, orta: 2, agir: 3, hayati_tehdit: 4 };

  function testleriCalistir(motor, vinyetler) {
    const satirlar = [];
    let dogru = 0;
    let rfTop = 0, rfYakalanan = 0;
    let underTop = 0, under = 0;     // kacirma: tahmin < beklenen (derecelendirilmis)
    let degerlendirilen = 0, over = 0; // asiri sevk: tahmin > beklenen
    const matris = {}; // beklenen -> { tahmin -> sayi }

    for (const v of vinyetler) {
      const tahmin = motor.triyaj(v.vaka).sinif;
      const beklenen = v.beklenen;
      const gecti = tahmin === beklenen;
      if (gecti) dogru++;
      satirlar.push({ id: v.id, beklenen, tahmin, gecti, aciklama: v.aciklama });

      // Kirmizi bayrak duyarliligi (1.1): gold 'kirmizi' veya 'hayati_tehdit'
      const kirmiziGold = v.kirmizi === true || beklenen === "hayati_tehdit";
      if (kirmiziGold) {
        rfTop++;
        if (tahmin === "hayati_tehdit") rfYakalanan++;
      }

      // Karisiklik matrisi (1.2)
      (matris[beklenen] = matris[beklenen] || {});
      matris[beklenen][tahmin] = (matris[beklenen][tahmin] || 0) + 1;

      // under/over yalnizca iki taraf da derecelendirilmisse anlamli
      if (beklenen in DERECE && tahmin in DERECE) {
        degerlendirilen++;
        if (DERECE[tahmin] < DERECE[beklenen]) { under++; underTop++; }
        else if (DERECE[tahmin] > DERECE[beklenen]) over++;
      } else if (beklenen in DERECE) {
        // beklenen derecelendirilmis ama tahmin 'belirsiz' -> guvenli yuvarlama,
        // kacirma sayilmaz (asagi degil yukari/yana). Yine de izlenebilir.
      }
    }

    const toplam = vinyetler.length;
    const rapor = {
      toplam,
      dogru,
      isabet: toplam ? dogru / toplam : 0,
      rf: { toplam: rfTop, yakalanan: rfYakalanan, duyarlilik: rfTop ? rfYakalanan / rfTop : 1 },
      underTriage: { sayi: under, oran: degerlendirilen ? under / degerlendirilen : 0 },
      overTriage: { sayi: over, oran: degerlendirilen ? over / degerlendirilen : 0 },
      matris,
      satirlar,
      // KAPI: kacirma sifir VE kirmizi bayrak duyarliligi %100
      gecti: under === 0 && rfYakalanan === rfTop
    };
    return rapor;
  }

  function metniBicimle(r) {
    const L = [];
    L.push("=".repeat(64));
    L.push("VINYET REGRESYON RAPORU");
    L.push("=".repeat(64));
    for (const s of r.satirlar) {
      const im = s.gecti ? "OK " : "XX ";
      L.push(`${im}${s.id.padEnd(10)} beklenen=${s.beklenen.padEnd(14)} tahmin=${s.tahmin}`);
      if (!s.gecti) L.push(`     ! ${s.aciklama}`);
    }
    L.push("-".repeat(64));
    L.push(`Toplam isabet            : ${r.dogru}/${r.toplam} (%${(100 * r.isabet).toFixed(1)})`);
    L.push(`KIRMIZI BAYRAK DUYARLILIK : ${r.rf.yakalanan}/${r.rf.toplam} (%${(100 * r.rf.duyarlilik).toFixed(1)})  <- hedef %100`);
    L.push(`Under-triage (KACIRMA)   : ${r.underTriage.sayi} (%${(100 * r.underTriage.oran).toFixed(1)})  <- hedef 0`);
    L.push(`Over-triage (asiri sevk) : ${r.overTriage.sayi} (%${(100 * r.overTriage.oran).toFixed(1)})  <- izlenen metrik`);
    L.push("-".repeat(64));
    L.push("Karisiklik matrisi (satir=beklenen, sutun=tahmin):");
    for (const beklenen of SIRA) {
      if (!r.matris[beklenen]) continue;
      const parts = Object.entries(r.matris[beklenen]).map(([t, n]) => `${t}:${n}`);
      L.push(`   ${beklenen.padEnd(14)} -> ${parts.join("  ")}`);
    }
    L.push("=".repeat(64));
    L.push(r.gecti ? "SONUC: GECTI (kapi acik)" : "SONUC: KALDI (regresyon kapisi kapali)");
    return L.join("\n");
  }

  return { testleriCalistir, metniBicimle };
});

// --- Node dogrudan kosumu: regresyon kapisi (cikis kodu) ---
if (typeof module === "object" && module.exports && require.main === module) {
  const fs = require("fs");
  const path = require("path");
  const motor = require("./triyaj_motor.js");
  const test = module.exports;
  const vinyetler = JSON.parse(
    fs.readFileSync(path.join(__dirname, "vinyetler.json"), "utf8")
  ).vinyetler;
  const rapor = test.testleriCalistir(motor, vinyetler);
  console.log(test.metniBicimle(rapor));
  process.exit(rapor.gecti ? 0 : 1);
}
