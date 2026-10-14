export function longDate(at: number, tz: string): string {
  return new Intl.DateTimeFormat('tr-TR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: tz }).format(at);
}

export function clock(at: number): string {
  return new Intl.DateTimeFormat('tr-TR', { hour: '2-digit', minute: '2-digit' }).format(at);
}

export function percent(r: number): string {
  return `%${Math.round(r * 100)}`;
}
