# Diğer cihaz doğrulaması — sıra karışması / tekrar şikâyeti (2026-07-18)

> Bu not, diğer bilgisayardaki Claude session'ı için hazırlandı. Bağlam: kullanıcı tek anlatıcı modunda bir bölüm üretti; son mp3'te bazı segmentlerin sırası karışık ve bazıları birden fazla kez okunuyor. Ana makinedeki kod analizi birleştiriciyi temize çıkardı (stitch `ORDER BY idx` ile deterministik — `lib/services/scripts.ts:58`, `lib/services/producer.ts stitchChapter`). Kalan iki hipotezi BU cihazdaki gerçek veri ayırt edecek.

## Hipotezler

- **H1 — Tekrar script'in İÇİNDE:** Metin ~12k karakteri aştıysa LLM annotation chunk sınırlarında komşu parçanın cümlelerini yeniden üretmiş olabilir (Dilim B chunk'lama: `lib/services/annotation.ts chunkText`). Bu durumda mp3 doğru şekilde "script'te ne varsa onu" okuyor.
- **H2 — Eski render dinlendi:** Her segment yenileme yeni bir render (mp3) satırı ekliyor; oynatıcı listesindeki eski bir render dinlenmiş olabilir.

## Yapılacaklar (sırayla)

1. `git pull` (bu not + Dilim C2 + C3 spec'i gelir).
2. Sorunlu bölümün **script JSON'unda mükerrer metin ara** — aşağıdaki scripti repo kökünde çalıştır (yalnız SELECT, veri değiştirmez):

```js
// node inspect.mjs  (repo kökünde kaydet)
import { createRequire } from 'node:module';
const Database = createRequire(import.meta.url)('better-sqlite3');
const db = new Database('data/app.db');
const short = (s, n = 50) => (s ?? '').replace(/\s+/g, ' ').slice(0, n);
for (const ch of db.prepare('SELECT id,title FROM chapters').all()) {
  const scr = db.prepare('SELECT id,version,json FROM scripts WHERE chapter_id=? ORDER BY version DESC LIMIT 1').get(ch.id);
  if (!scr) continue;
  const segs = JSON.parse(scr.json).segments ?? [];
  const map = new Map();
  segs.forEach((s, i) => map.set(s.text.trim(), [...(map.get(s.text.trim()) ?? []), i]));
  const dups = [...map].filter(([, v]) => v.length > 1);
  console.log(`\n${ch.title} (v${scr.version}): ${segs.length} segment, mükerrer: ${dups.length}`);
  for (const [t, v] of dups.slice(0, 10)) console.log(`  [${v.join(',')}] "${short(t)}"`);
  const renders = db.prepare('SELECT count(*) n FROM renders WHERE chapter_id=?').get(ch.id);
  console.log(`  render sayısı: ${renders.n}`);
}
db.close();
```

3. Yorumlama:
   - **Mükerrer > 0** → H1 doğrulandı: tekrarlar LLM çıktısında. Mükerrer indekslerin chunk sınırlarına denk gelip gelmediğini not et (bölüm metni kaç karakter? >12k mı?).
   - **Mükerrer = 0 ve render sayısı > 1** → H2 güçlenir: dinlenen mp3 muhtemelen eski render'dı. En son render'ı dinleyip sorunun sürüp sürmediğini sor.
   - "Sıra karışıklığı" için: JSON'daki segment sırası metnin doğal akışıyla karşılaştırılır (ilk 15-20 segmentin metin başlangıçları kaynağın akışını izliyor mu?).

4. **Bulgularını bu dosyanın altına "## Bulgular" bölümü olarak yaz, commit'le ve push'la** — ana makinedeki session oradan okuyacak. H1 doğrulanırsa ana makine C3 kapsamına "chunk-sınırı dedup savunması"nı ekleyecek (karar bekliyor, kendiliğinden uygulama).

## Bu cihazda ayrıca bilinmesi gerekenler

- Dilim C2 merge edildi: `/settings` ekranı, sağlayıcılar, ses havuzları (git pull sonrası `npm install` gerekmez — yeni bağımlılık yok; migration ilk açılışta otomatik).
- Dilim C3 spec'i onay aşamasında (`docs/superpowers/specs/2026-07-18-panel-slice-c3-production-flow-design.md`): segment birleştirme, script/segment düzenleme, ayrı Birleştir adımı. Bu cihazda C3 UYGULAMAYA BAŞLAMA — ana makine yürütüyor; görev yalnız yukarıdaki doğrulama.

## Bulgular (2026-07-18, diğer cihaz)

İnceleme scripti + ek sıra kontrolü çalıştırıldı. Tek bölüm var: **"bölüm 1" (v1, 16 segment)**.

- **Mükerrer segment: 0** → H1 **ÇÜRÜDÜ**. Ayrıca bölüm metni **1.073 karakter** (<12k), yani chunk'lama hiç devreye girmemiş — H1 bu bölüm için zaten mümkün değildi.
- **Sıra kontrolü:** 16 segmentin ilk 40 karakteri raw_text içinde arandı; bulunan tüm pozisyonlar **kesin monoton artan** — script sırası kaynağın doğal akışını birebir izliyor. Eşleşmeyen 2 segment önemsiz LLM normalizasyonu çıktı (raw "gülüm**s**eyip" → script "gülüm**l**eyip"; "…" → "..."), tekrar/sıra sorunu değil.
- **Render sayısı: 4** → H2 **GÜÇLENDİ**. Zaman damgaları (lokal): 17:11:34, 17:11:43, 17:14:22, 17:14:35 — iki çift halinde, çift içi ~9-12 sn arayla. Saniyeler arayla oluşan çiftler dikkat çekici (çift tıklama / çift stitch tetiklenmesi olabilir — ana makine isterse ayrıca bakabilir).

**Sonuç:** Script temiz; sıra karışıklığı/tekrar script'te YOK. Şikâyet büyük olasılıkla **eski bir render'ın dinlenmesinden** (H2). Kullanıcıdan **en son render'ı (17:14:35)** dinleyip sorunun sürüp sürmediğini teyit etmesi istendi. C3'e chunk-dedup savunması eklemek için bu bölümden kanıt çıkmadı.
