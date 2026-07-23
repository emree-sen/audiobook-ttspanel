// lib/i18n/tr.ts — TEK doğruluk kaynağı; anahtarlar buradan türer.
// Başlangıçta çekirdek anahtarlar; göç görevleri anahtar ekledikçe büyür.
export const tr = {
  'common.loading': 'Yükleniyor…',
  'common.save': 'Kaydet',
  'common.cancel': 'Vazgeç',
  'common.delete': 'Sil',
  'common.confirmAgain': 'Emin misin?',
  'settings.language': 'Dil / Language',
  'sidebar.library': 'Kütüphane',
  'sidebar.newProject': 'Yeni proje',
  'sidebar.settings': 'Ayarlar',
  'sidebar.manage': 'Yönet',
  'sidebar.menu': 'Kütüphane menüsü',
} as const;
export type MessageKey = keyof typeof tr;
