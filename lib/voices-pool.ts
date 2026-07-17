export interface PoolVoice { voiceId: string; gender: 'male' | 'female'; tone: string }

// Bake-off'ta doğrulanmış Gemini prebuilt sesleri (etiketler UI/atama için; genişletilebilir).
export const VOICE_POOL: PoolVoice[] = [
  { voiceId: 'gemini:Charon', gender: 'male', tone: 'olgun, anlatıcı' },
  { voiceId: 'gemini:Iapetus', gender: 'male', tone: 'derin' },
  { voiceId: 'gemini:Puck', gender: 'male', tone: 'genç, enerjik' },
  { voiceId: 'gemini:Algenib', gender: 'male', tone: 'sert' },
  { voiceId: 'gemini:Algieba', gender: 'male', tone: 'yumuşak' },
  { voiceId: 'gemini:Schedar', gender: 'male', tone: 'ölçülü' },
  { voiceId: 'gemini:Kore', gender: 'female', tone: 'bilge, sakin' },
  { voiceId: 'gemini:Leda', gender: 'female', tone: 'genç, canlı' },
];

export const DEFAULT_NARRATOR_VOICE = 'gemini:Charon';

// Cinsiyete uygun, kullanılmamış ilk ses; havuz biterse deterministik döngü.
export function pickVoice(gender: string, used: Set<string>): string {
  const candidates = gender === 'male' || gender === 'female' ? VOICE_POOL.filter((v) => v.gender === gender) : VOICE_POOL;
  const free = candidates.filter((v) => !used.has(v.voiceId));
  const pick = (free[0] ?? candidates[used.size % candidates.length] ?? VOICE_POOL[0]).voiceId;
  used.add(pick);
  return pick;
}
