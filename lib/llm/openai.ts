// <think>…</think> (lokal reasoning modelleri sızdırır) ve ```json çitlerini sıyırır.
export function stripLlmWrappers(text: string): string {
  let t = text.replace(/<think>[\s\S]*?<\/think>/g, '');
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) t = fence[1];
  return t.trim();
}
