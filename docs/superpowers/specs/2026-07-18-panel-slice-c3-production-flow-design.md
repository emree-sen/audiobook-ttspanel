# Panel — Dilim C3: Üretim Akışı İyileştirmeleri (segmentleme + düzenleme + ayrı birleştirme)

> Tarih: 2026-07-18 · Durum: onaylandı (saha testi analizi + kullanıcı kararları) · Sonraki adım: writing-plans
> Kaynak: 2026-07-18 gerçek kullanım bulguları. İlgili: Dilim B (annotation), C1 (üretim hattı), C2 (sağlayıcılar).

## 0. Saha bulguları ve kararlar

| Bulgu | Kök neden | Karar |
|---|---|---|
| A. Tek anlatıcıda aşırı segmentleme + kişi-ağzından stiller | `prompt.ts` her modda "1-3 cümle" + narrator modunda "style ile belirt" talimatı — LLM söyleneni yapıyor; segment = 1 TTS çağrısı → kota düşmanı | Prompt (narrator'a özel kural) **+** kod tarafı deterministik birleştirme |
| B. Stil direktifinin sese okunması | Gemini TTS'te ayrı talimat kanalı yok; direktif + metin aynı prompt'ta, preview bazen direktifi okuyor; otomatik tespit imkânsız | **Düzenlenebilirlik**: script JSON düzenleme + segment satır içi düzenleme (elle müdahale) |
| C. Son üründe sıra karışması / tekrarlar | **Doğrulandı (diğer cihaz, 2026-07-18):** script ve birleştirici temiz; iki gerçek kök neden: **KN1** TTS modeli bazı stilli kısa segmentlerde metni tekrarlayıp uzun sessizlik üretiyor (34 kr → 14 sn); **KN2** Next dev'de rota-başına modül örneği `ensureWorker` tekilliğini kırıyor → aynı iş 2 worker'da, kota 2x + çift render (bkz. handoff dosyası "Bulgular 2") | **KN1** süre bekçisi (§3.5) + **KN2** worker tekilliği sağlamlaştırma (§3.6); chunk-dedup KALICI kapsam dışı (H1 çürüdü) |
| D. Her segment yenilemede otomatik yeniden birleştirme | C1 tasarımı (regen → stitch → yeni render) | **Ayrı "Birleştir" adımı**; regen yalnız segment dosyasını değiştirir |

## 1. A — Segmentleme (annotation)

### 1.1 Prompt (lib/llm/prompt.ts)
- "Segmentler kısa: 1-3 cümle" kuralı moda göre koşullu olur:
  - **multi**: mevcut kural aynen ("1-3 cümle, tek konuşan, tek duygu").
  - **narrator**: "Segmentler paragraf bazlı, 3-6 cümle. Kısa diyalogları çevresindeki anlatımla AYNI segmentte tut. `style` alanını YALNIZ belirgin duygu/tempo değişiminde doldur; kişi taklidi tarifleri ('kadın sesiyle' vb.) YASAK — anlatıcı tek tondadır."
- **KISIT:** `'tek anlatıcı'` / `'çok karakterli'` işaret metinleri MockLlmAdapter'ın mod algısıdır — bu ifadeler korunur (prompt.ts:12 notu).

### 1.2 Kod garantisi — post-merge (lib/services/annotation.ts)
LLM çıktısı `saveScript`'e gitmeden önce ardışık segmentler birleştirilir. Birleşme koşulu (hepsi):
- aynı `speaker` **ve** aynı efektif stil (`style` alanı birebir eşit; ikisi de boş dahil),
- öndeki segmentin `pause_after_ms`'i yok (pause birleşme SINIRIDIR — korunması gerekir),
- birleşik metin ≤ **700 karakter**.

Birleşen segment: metinler tek boşlukla eklenir, `type` ilk parçanınki, `pause_after_ms` son parçanınki. Her iki ses modunda da çalışır (multi'de aynı konuşmacının ardışık cümleleri birleşir). Saf fonksiyon olarak yazılır: `mergeSegments(segs, maxLen=700)` — birim test edilir.

## 2. B — Düzenlenebilirlik

### 2.1 Script JSON düzenleme
Script kartına "Düzenle" eylemi: mevcut script JSON'u (en güncel versiyon) textarea'ya **dolu gelir**; "Kaydet" mevcut `PUT /api/chapters/[id]/script` (elle import) endpoint'ine gönderir → doğrulama + yeni versiyon (`source: 'manual'`). Yeni API yok; yalnız UI (prefill + mevcut import alanının birleştirilmesi).

### 2.2 Segment satır içi düzenleme
- Segment tablosunda kalem ikonu → satırda `text` ve `style` düzenlenebilir; kaydet:
- **Yeni API:** `PATCH /api/segments/[id]` gövde `{ text?, style? }` → servis `editSegment(db, segmentId, patch)`: en güncel script JSON'unda ilgili segment (idx ile) güncellenir, `saveScript` ile **yeni versiyon** yazılır (changeCastVoice deseni). Yanıt `{ scriptId, version }`. Segment eski script'e aitse (güncel versiyon değil) Türkçe hata.
- Etki: düzenlenen segmentin hash'i değişir → üretimde yalnız o segment yeni çağrı; kalanlar cache-hit (C1 davranışı; yeni versiyonda tüm satırlar pending olsa da cache anında done yapar, çağrı harcanmaz).
- Segment ekleme/silme/elle birleştirme satır UI'sına girmez — yapısal işler §2.1 JSON düzenlemeyle yapılır (kapsam sınırı).

## 3. D — Birleştirme ayrı adım

- **runJob** iş sonunda `stitchChapter` ÇAĞIRMAZ. Tüm segmentler işlenince job `done`; bölüm durumu yeni değer alır: **`voiced`** (segmentler hazır, birleşik mp3 yok). Durum akışı: `draft → scripted → generating → voiced → done` (`done` = en az bir render üretilmiş). UI rozet eşlemesine `voiced` eklenir (ör. mavi-yeşil "seslendirildi").
- **Yeni API:** `POST /api/chapters/[id]/stitch` → `stitchChapter` → `{ renderId }`, bölüm `done`. Koşullar: aktif iş yok; en az 1 `done` segment. `failed` segment varsa UI'da ConfirmButton uyarısı: "N segment başarısız — yine de birleştir?" (sunucu engellemez, `done` olanlarla birleştirir — mevcut stitch davranışı).
- **Üretim kartı:** "Birleştir" düğmesi (`voiced`/`done` durumlarında, segmentler değiştiyse tekrar basılabilir); render listesi yalnız bilinçli birleştirmelerle büyür.
- **regenerateSegment**: stitch çağrısı kaldırılır; yanıt `{ segmentId, status }` olur (renderId dönmez). UI segment satırını tazeler; birleştirme kullanıcının elinde.
- **Bayat mp3 kuralı:** bölüm `done` iken bir segment yenilenir/değişirse durum `voiced`'a döner (mevcut render'lar listede kalır ama rozet "birleştirme güncel değil" mesajı verir — kullanıcı Birleştir'e basınca tazelenir). `editSegment` zaten `saveScript` üzerinden `scripted`'a düşürür (mevcut davranış, korunur).
- **Progress SSE sözleşme değişikliği:** `done` olayı artık `renderId` taşımaz (`{ doneCount, failedCount }`); UI "Üretim bitti — dinlemek için Birleştir" durumuna geçer.

### 3.5 KN1 — Süre bekçisi (bozuk TTS çıktısını yakala)

Panel katmanında (core DEĞİŞMEZ) ortak yardımcı: `synthesizeChecked(adapter, req)` (`lib/services/producer.ts`):
- Beklenen tavan: `maxMs = Math.max(4000, req.text.length * 250)` (≈ normal hızın ~2,5 katı; kısa metinlerde 4 sn taban).
- `res.durationMs > maxMs` ise **1 kez** yeniden dener; iki sonuçtan **kısa süreli olanı** kullanır (kısa = makul; ikisi de "başarılı" sayılır).
- Her gerçek deneme deftere yazılır (`recordCall`) — kota sayımı dürüst kalır; bekçi tetiklenen segment başına en fazla +1 çağrı.
- `runJob` ve `regenerateSegment` synthesize çağrılarını bu yardımcıya taşır. Mock/piper/openai için de zararsız (eşik cömert; mock hızıyla asla tetiklenmez).

### 3.6 KN2 — Worker tekilliği sağlamlaştırma (kota 2x bug'ı)

İki katman:
1. **Süreç içi:** `workerPromise` modül-global'i `globalThis.__wntWorker`'a taşınır — Next dev'de rota başına ayrı modül örneği oluşsa da tek promise paylaşılır.
2. **DB katmanı (kesin sigorta):** `runJob` işi **atomik sahiplenir**: `UPDATE jobs SET status='running' WHERE id=? AND status='queued'` — etkilenen satır 0 ise başka worker almış demektir, sessizce çıkılır. (Mevcut koşulsuz `setJob(running)` kalkar; `running` durumundaki işe ikinci giriş de engellenmiş olur.)
- Test: aynı işe eşzamanlı iki `runJob` → toplam synthesize çağrısı segment sayısını aşmaz, tek render seti.

## 4. C — kanıt kapandı

Diğer cihaz doğrulaması tamamlandı (handoff dosyası "Bulgular" + "Bulgular 2"): H1 (chunk tekrarı) ve H2 (eski render) çürüdü; kök nedenler KN1/KN2 olarak yukarıda kapsama alındı. Chunk-dedup savunması KALICI olarak kapsam dışı. §1.2 post-merge, KN1'in görülme sıklığını da düşürür (sorun stilli KISA segmentlerde gözlendi; birleşik segmentler daha uzun).

## 5. Test stratejisi

- `mergeSegments`: birleşme koşulları (speaker/stil eşitliği, pause sınırı, 700 tavanı), tip/pause aktarımı, multi korunumu, tek segment/boş girdiler.
- Prompt: narrator modunda yeni kurallar sistem prompt'unda; mock marker metinleri değişmedi (mevcut mock mod-algı testleri yeşil kalır).
- `editSegment`: yeni versiyon, yalnız hedef segment değişir, eski-versiyon segment id'sine Türkçe hata; hash değişimi → preflight newCalls=1 (kalanlar cache).
- Producer/D: runJob sonunda render YOK + chapter `voiced`; stitch endpoint render üretir + `done`; regen stitch yapmaz; SSE `done` olayı yeni şema.
- KN1: `synthesizeChecked` — normal süre → tek çağrı; absürt süre → retry + kısa sonuç seçimi + 2 defter kaydı (sahte adapter ile süre kurgulanır).
- KN2: eşzamanlı iki `runJob` aynı işte → atomik sahiplenme tek worker'a verir (çağrı sayısı = segment sayısı); `globalThis` çapası birim düzeyde doğrulanır.
- Mevcut 166 test: stitch/regen/status sözleşmesi değişen testler güncellenir (davranış sözleşmesi bilinçli değişiyor — C1 spec'inden sapma bu spec'le belgelenmiş sayılır).

## 6. Riskler / notlar

- 700 karakterlik birleşik segmentte tek hata = daha pahalı yeniden üretim (1 çağrı ama daha uzun içerik); kabul edildi (kota önceliği).
- Uzun segmentlerde Gemini preview'ın boş-yanıt kırılganlığı artabilir — mevcut stilli→düz + 3 deneme fallback'i geçerli; saha gözlemiyle 700 tavanı ayarlanabilir (sabit `MERGE_MAX_CHARS`).
- `voiced` yeni bir status değeri: sidebar durum noktaları, rozetler ve testlerdeki status beklentileri güncellenmeli (unutulursa rozet stilsiz görünür — smoke'ta kontrol edilir).
- SSE `done` olayından `renderId` kalkması UI-API iç sözleşmesidir; dış tüketici yok.

## 7. Kapsam dışı

Chunk-tekrar dedup savunması (H1 çürüdü — kalıcı) · segment satırından ekle/sil/birleştir · renders temizliği/GC · stil kaçağının otomatik tespiti · CLI davranışı (eski akış aynen; süre bekçisi panel katmanında olduğundan CLI etkilenmez).
