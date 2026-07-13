import { expect, test } from 'vitest';
import { buildPrompt } from '../../src/core/tts/gemini.js';

test('stil ve telaffuzu prompt önüne ekler, Türkçe metni korur', () => {
  const p = buildPrompt({
    text: 'Kim var orada?', voice: { provider: 'gemini', providerVoice: 'Puck' }, language: 'tr-TR',
    style: 'korkmuş ama meydan okuyan', tags: ['[scared]'],
    pronunciations: [{ term: 'Aztharion', sayAs: 'Az-ta-ri-on' }],
  });
  expect(p).toContain('Kim var orada?');       // Türkçe metin aynen
  expect(p).toContain('korkmuş ama meydan okuyan');
  expect(p).toContain('[scared]');
  expect(p).toContain('Aztharion');            // telaffuz ipucu
});

test('stil yoksa sadece metni döner', () => {
  const p = buildPrompt({ text: 'Merhaba.', voice: { provider: 'gemini', providerVoice: 'Charon' }, language: 'tr-TR' });
  expect(p.trim()).toBe('Merhaba.');
});
