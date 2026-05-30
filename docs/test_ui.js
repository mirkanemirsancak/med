/* UI entegrasyon testi (jsdom). jsdom dev-bagimliligidir; yoksa ZARIFCE atlanir.
 * Kurulum:  npm i -D jsdom    Calistir:  node docs/test_ui.js  */
const fs = require('fs');
const path = require('path');
let JSDOM;
try { ({ JSDOM } = require('jsdom')); }
catch (e) {
  try { ({ JSDOM } = require('/tmp/node_modules/jsdom')); }
  catch (e2) { console.log("ATLANDI: jsdom kurulu degil (npm i -D jsdom). UI testi gerekli degil; mantik testleri yeterli."); process.exit(0); }
}
const DOCS = __dirname;
const html = fs.readFileSync(path.join(DOCS, 'index.html'), 'utf8');
const motorSrc = fs.readFileSync(path.join(DOCS, 'triyaj_motor.js'), 'utf8');
const cikarimSrc = fs.readFileSync(path.join(DOCS, 'cikarim.js'), 'utf8');

// <script src> -> inline (jsdom dis dosya cozmesin)
const html2 = html
  .replace('<script src="triyaj_motor.js"></script>', '<script>' + motorSrc + '</script>')
  .replace('<script src="cikarim.js"></script>', '<script>' + cikarimSrc + '</script>');

const dom = new JSDOM(html2, { runScripts: 'dangerously', pretendToBeVisual: true,
  url: 'https://example.org/' });
const w = dom.window, d = w.document;

let fail = 0;
function chk(ad, k){ console.log((k?'OK  ':'XX  ')+ad); if(!k) fail++; }
function sonuc(){ return d.getElementById('sonucAlan').textContent.replace(/\s+/g,' ').trim(); }

// modul + cikarim yuklendi mi
chk('motor yuklendi', !!w.TriyajMotor);
chk('cikarim yuklendi', !!w.TriyajCikarim);
chk('konusma karti hasta modunda gorunur', d.getElementById('konusmaKart').style.display !== 'none');

// hekim moduna gec -> kart gizli
w.modDegistir('hekim');
chk('konusma karti hekim modunda GIZLI', d.getElementById('konusmaKart').style.display === 'none');
w.modDegistir('hasta');

// serbest metin -> cevir (anahtar yok -> mock) -> form dolar
d.getElementById('serbestMetin').value = 'Eforla nefesim daraliyor ama cumlelerle konusabiliyorum, nabzim 88';
return (async () => {
  await w.anlatimiCevir();
  const f = d.getElementById('triyajForm').elements;
  chk('cevirim: P_NABIZ forma islendi (88)', f['P_NABIZ'].value === '88');
  chk('cevirim: P_KONUSMA forma islendi (cumleler)', f['P_KONUSMA'].value === 'cumleler');
  chk('cevirim: P_NEFES_DARLIGI islendi (eforla)', f['P_NEFES_DARLIGI'].value === 'eforla');

  // triyaj yap -> hafif (karari MOTOR verir)
  d.getElementById('triyajForm').dispatchEvent(new w.Event('submit', {cancelable:true,bubbles:true}));
  chk('triyaj sonucu HAFIF (motor karari)', /HAFIF/.test(sonuc()));

  // siyanoz anlatimi -> hayati (kirmizi bayrak cikarimi + motor karari)
  d.getElementById('serbestMetin').value = 'Dudaklarim morardi ve sadece kelime kelime konusabiliyorum';
  // formu temizlemek icin checkbox'lari sifirla degil; yeni cevir ekler -> motor en agir alir
  await w.anlatimiCevir();
  d.getElementById('triyajForm').dispatchEvent(new w.Event('submit', {cancelable:true,bubbles:true}));
  chk('siyanoz anlatimi -> HAYATI TEHDIT', /HAYATI/.test(sonuc()));

  console.log(fail===0 ? '\nTUM UI-CIKARIM TESTLERI GECTI' : `\n${fail} TEST KALDI`);
  process.exit(fail===0?0:1);
})();
