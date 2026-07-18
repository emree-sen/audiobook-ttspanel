import type { LlmCast } from './schema';

export interface PromptOptions {
  voiceMode: 'narrator' | 'multi';
  maxCharacters: number;
  narrationStyle?: string | null;
  knownCast?: LlmCast[];
  instruction?: string;
  prevSummary?: string;
}

// DİKKAT: 'tek anlatıcı' / 'çok karakterli' işaret metinleri MockLlmAdapter'ın mod algısıdır — değiştirme.
export function buildSystemPrompt(o: PromptOptions): string {
  const parts: string[] = [
    'Sen bir sesli kitap yönetmenisin. Verilen bölüm metnini TTS ile seslendirilecek segmentlere ayır ve SADECE geçerli JSON döndür.',
    'KURALLAR:',
    '- type: "narration" (anlatım), "dialogue" (konuşma), "thought" (iç ses).',
    '- style: kısa Türkçe duygu/ton tarifi (ör. "sakin, gizemli"); yalnızca gerektiğinde.',
    '- Sahne/paragraf geçişlerinde pause_after_ms öner (200-600 ms).',
    '- Metni DEĞİŞTİRME; atlama/özetleme yok — tüm metin segmentlere dağılmalı.',
    '- Zor özel isimler için pronunciations doldur.',
  ];
  if (o.voiceMode === 'narrator') {
    parts.push('- Segmentler paragraf bazlı, 3-6 cümle. Kısa diyalogları çevresindeki anlatımla AYNI segmentte tut.');
    parts.push('- SES MODU: tek anlatıcı. TÜM segmentlerde speaker "narrator"; cast yalnızca narrator içerir. Diyaloglar da anlatıcı tarafından akış içinde okunur.');
    parts.push('- style alanını YALNIZ belirgin duygu/tempo değişiminde doldur; kişi taklidi tarifleri ("kadın sesiyle", "çocuk gibi" vb.) YASAK — anlatıcı tek tondadır.');
  } else {
    parts.push('- Segmentler kısa: 1-3 cümle, tek konuşan, tek duygu.');
    parts.push(`- SES MODU: çok karakterli. Konuşan karakterleri tespit et, cast'e ekle (character_id: küçük harf ascii). EN FAZLA ${o.maxCharacters} karakter; önemsiz konuşmalar "narrator"da kalır. Anlatım her zaman "narrator".`);
    parts.push('- Her karakter için gender (male|female|unknown), age_hint (child|young|adult|elder) ve kısa persona doldur.');
  }
  if (o.narrationStyle?.trim()) parts.push(`ANLATIM TARZI: ${o.narrationStyle.trim()}`);
  if (o.knownCast?.length) parts.push(`BİLİNEN KARAKTERLER (önceki parçalardan; aynı character_id kullan): ${JSON.stringify(o.knownCast)}`);
  if (o.instruction) parts.push(`KULLANICI DÜZELTMESİ (önceki denemeye göre uygula): ${o.instruction}`);
  if (o.prevSummary) parts.push(`ÖNCEKİ DENEME ÖZETİ: ${o.prevSummary}`);
  parts.push('ÇIKTI ŞEMASI (yalnızca bu JSON):');
  parts.push('{"cast":[{"character_id":"","display_name":"","gender":"male|female|unknown","age_hint":"child|young|adult|elder","persona":""}],"segments":[{"speaker":"","type":"narration|dialogue|thought","text":"","style":"","pause_after_ms":0}],"pronunciations":[{"term":"","say_as":""}]}');
  return parts.join('\n');
}

export function buildUserPrompt(chunk: string, index: number, total: number): string {
  return total > 1 ? `BÖLÜM PARÇASI ${index + 1}/${total}:\n\n${chunk}` : chunk;
}
