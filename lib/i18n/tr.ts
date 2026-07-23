// lib/i18n/tr.ts — TEK doğruluk kaynağı; anahtarlar buradan türer.
// Başlangıçta çekirdek anahtarlar; göç görevleri anahtar ekledikçe büyür.
export const tr = {
  'common.loading': 'Yükleniyor…',
  'common.save': 'Kaydet',
  'common.cancel': 'Vazgeç',
  'common.delete': 'Sil',
  'common.confirmAgain': 'Emin misin?',
  'settings.language': 'Dil / Language',
} as const;
export type MessageKey = keyof typeof tr;
