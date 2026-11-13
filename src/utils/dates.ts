const dateFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' });
const displayFormatter = new Intl.DateTimeFormat('en', { timeZone: 'Asia/Manila', year: 'numeric', month: 'long', day: 'numeric' });

export function manilaDate(now: number | Date = Date.now()): string {
  return dateFormatter.format(now);
}

export function validEntryDate(value: string, today = manilaDate()): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(value + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value && value <= today && value >= '1900-01-01';
}

export function displayDate(value: string): string {
  return displayFormatter.format(new Date(value + 'T00:00:00+08:00'));
}
