import type { CastMember, ResolvedVoice, VoiceoverScript } from './types.js';

export function parseVoiceId(voiceId: string): ResolvedVoice {
  const idx = voiceId.indexOf(':');
  if (idx <= 0 || idx === voiceId.length - 1) throw new Error(`Geçersiz voice_id: "${voiceId}" (beklenen "provider:voice")`);
  return { provider: voiceId.slice(0, idx), providerVoice: voiceId.slice(idx + 1) };
}

export function resolveVoiceForSpeaker(script: VoiceoverScript, speaker: string): { cast: CastMember; voice: ResolvedVoice } {
  const cast = script.cast.find((c) => c.characterId === speaker);
  if (!cast) throw new Error(`Konuşmacı cast'te yok: "${speaker}"`);
  return { cast, voice: parseVoiceId(cast.voiceId) };
}

export function validateSpeakers(script: VoiceoverScript): void {
  const known = new Set(script.cast.map((c) => c.characterId));
  for (const seg of script.segments) {
    if (!known.has(seg.speaker)) throw new Error(`Segment ${seg.id}: bilinmeyen konuşmacı "${seg.speaker}"`);
  }
}

// Prototip / tek-anlatıcı modu: tüm kadronun sesini tek bir sese çevirir.
export function overrideAllVoices(script: VoiceoverScript, voiceId: string): VoiceoverScript {
  parseVoiceId(voiceId); // format doğrulaması (geçersizse fırlatır)
  return { ...script, cast: script.cast.map((c) => ({ ...c, voiceId })) };
}
