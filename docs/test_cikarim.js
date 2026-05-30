/* ===========================================================================
 * Cikarim katmani testleri (Tier 2.1 guvenlik siniri)
 * ===========================================================================
 * Node: node docs/test_cikarim.js   (exit 0 = gecti)
 * Odak: LLM KARAR VERMEZ; whitelist DISI kod GECMEZ; mock->dogrula->triyaj zinciri.
 * ========================================================================= */
const motor = require("./triyaj_motor.js");
const C = require("./cikarim.js");

let fail = 0;
function chk(ad, kosul) { console.log((kosul ? "OK  " : "XX  ") + ad); if (!kosul) fail++; }
function esit(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

// --- 1) HALUSINASYON KORUMASI: uydurma kodlar atilir ---
{
  const ham = {
    parametreler: { P_NABIZ: 130, P_UYDURMA: 5, P_KONUSMA: "fisilti" /*gecersiz token*/ },
    kirmizi_bayrak: ["RF_SESSIZ_AKCIGER", "RF_UZAYLI_ISTILASI"],
    risk_faktorleri: ["RISK_ENTUBASYON_OYKU", "RISK_OLMAYAN"]
  };
  const { vaka, atilanlar } = C.cikarimDogrula(ham, "eriskin");
  chk("gecerli sayisal kod gecti (P_NABIZ)", vaka.parametreler.P_NABIZ === 130);
  chk("tanimsiz parametre ATILDI (P_UYDURMA)", !("P_UYDURMA" in vaka.parametreler));
  chk("gecersiz token ATILDI (P_KONUSMA=fisilti)", !("P_KONUSMA" in vaka.parametreler));
  chk("gecerli kirmizi bayrak gecti", vaka.kirmizi_bayrak.includes("RF_SESSIZ_AKCIGER"));
  chk("uydurma kirmizi bayrak ATILDI", !vaka.kirmizi_bayrak.includes("RF_UZAYLI_ISTILASI"));
  chk("uydurma risk ATILDI", esit(vaka.risk_faktorleri, ["RISK_ENTUBASYON_OYKU"]));
  chk("atilanlar raporlandi (4 adet)", atilanlar.length === 4);
}

// --- 2) LLM KARAR VERMEZ: cikarim 'sinif' alani URETMEZ; karari motor verir ---
{
  const ham = C.mockCikar("Dudaklarim morardi, sadece kelime kelime konusabiliyorum", "eriskin");
  chk("mock cikti 'sinif' icermiyor (karar yok)", !("sinif" in ham));
  const { vaka } = C.cikarimDogrula(ham, "eriskin");
  const sonuc = motor.triyaj(vaka);
  chk("karari MOTOR verdi: siyanoz -> hayati_tehdit", sonuc.sinif === "hayati_tehdit");
}

// --- 3) MOCK -> DOGRULA -> TRIYAJ zinciri dogru sinif uretir ---
const senaryolar = [
  { metin: "Eforla nefesim daraliyor ama cumlelerle konusabiliyorum, nabzim 88", yas: "eriskin", beklenen: "hafif" },
  { metin: "Nabzim 130 civari", yas: "eriskin", beklenen: "agir" },
  { metin: "Satürasyonum 86 olctum", yas: "eriskin", beklenen: "hayati_tehdit" },
  { metin: "Dinlenmede bile nefes darligim var", yas: "eriskin", beklenen: "agir" },
];
for (const s of senaryolar) {
  const ham = C.mockCikar(s.metin, s.yas);
  const { vaka } = C.cikarimDogrula(ham, s.yas);
  const got = motor.triyaj(vaka).sinif;
  chk(`zincir: "${s.metin.slice(0, 32)}..." -> ${got} (bekl. ${s.beklenen})`, got === s.beklenen);
}

// --- 4) BELIRSIZLIK: kritik bulgu net degilse TEK takip sorusu, uydurma yok ---
{
  const ham = C.mockCikar("Gogsum sikisiyor", "eriskin");
  chk("belirsizde takip sorusu onerildi", typeof ham.takip_sorusu === "string" && ham.takip_sorusu.length > 0);
  chk("belirsizde kirmizi bayrak UYDURULMADI", ham.kirmizi_bayrak.length === 0);
  const { vaka } = C.cikarimDogrula(ham, "eriskin");
  chk("bos cikarim -> motor 'belirsiz' (fail-safe)", motor.triyaj(vaka).sinif === "belirsiz");
}

// --- 5) SEMA/PROMPT saglikli uretiliyor (gercek LLM cagrisina hazir) ---
{
  const p = C.sistemPrompt();
  chk("sistem prompt kod evrenini iceriyor", /P_KONUSMA/.test(p) && /RF_SESSIZ_AKCIGER/.test(p));
  chk("sistem prompt 'KARAR VERMEZ' ilkesini iceriyor", /KARAR VERMEZ|ACILIYET KARARI VERMEZ/i.test(p));
  chk("az-ornek mevcut (>=3)", C.AZ_ORNEK.length >= 3);
}

console.log(fail === 0 ? "\nTUM CIKARIM TESTLERI GECTI" : `\n${fail} TEST KALDI`);
process.exit(fail === 0 ? 0 : 1);
