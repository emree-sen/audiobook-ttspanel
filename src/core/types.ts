export type SegmentType = 'narration' | 'dialogue' | 'thought';

export interface CastMember { characterId: string; displayName: string; voiceId: string; baseStyle?: string; }
export interface Pronunciation { term: string; sayAs: string; }
export interface ScriptSegment {
  id: string; speaker: string; type: SegmentType; text: string;
  style?: string; tags?: string[]; pauseAfterMs?: number;
}
export interface VoiceoverScript {
  schemaVersion: string; series: string; season: number; episode: number;
  title: string; language: string; cast: CastMember[]; segments: ScriptSegment[];
  pronunciations?: Pronunciation[];
}

export interface ResolvedVoice { provider: string; providerVoice: string; }
export interface TtsSegmentRequest {
  text: string; voice: ResolvedVoice; language: string;
  style?: string; tags?: string[]; pronunciations?: Pronunciation[];
}
export interface TtsCost { unit: 'audio_tokens' | 'chars'; amount: number; usd?: number; }
export interface TtsResult { audio: Buffer; format: 'wav' | 'mp3' | 'pcm'; durationMs: number; cost: TtsCost; }
export interface TtsCapabilities { style: boolean }
export interface TtsAdapter { readonly id: string; readonly capabilities?: TtsCapabilities; synthesize(req: TtsSegmentRequest): Promise<TtsResult>; }
