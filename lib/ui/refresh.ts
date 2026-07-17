// Sol panelin ağacını tazeler (Sidebar 'wnt:refresh' olayını dinler).
export function refreshTree(): void {
  window.dispatchEvent(new Event('wnt:refresh'));
}
