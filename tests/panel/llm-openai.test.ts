import { describe, expect, test } from 'vitest';
import { stripLlmWrappers } from '@/lib/llm/openai';

describe('stripLlmWrappers', () => {
  test('düz JSON dokunulmadan döner', () => {
    expect(stripLlmWrappers('{"a":1}')).toBe('{"a":1}');
  });
  test('<think> bloğu sıyrılır', () => {
    expect(stripLlmWrappers('<think>hmm\nuzun düşünce</think>\n{"a":1}')).toBe('{"a":1}');
  });
  test('```json çiti sıyrılır', () => {
    expect(stripLlmWrappers('İşte yanıt:\n```json\n{"a":1}\n```\nBitti.')).toBe('{"a":1}');
  });
  test('think + çit birlikte', () => {
    expect(stripLlmWrappers('<think>x</think>```json\n{"a":1}\n```')).toBe('{"a":1}');
  });
});
