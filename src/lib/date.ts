const DEFAULT_STEP_MINUTES = 30;

function pad(value: number): string {
  return value.toString().padStart(2, "0");
}

export function toDateKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function parseDateKey(dateKey: string): Date {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export function getWeekday(dateKey: string): number {
  return parseDateKey(dateKey).getDay();
}

export function listUpcomingDates(count: number, from = new Date()): string[] {
  const cursor = new Date(from);
  cursor.setHours(0, 0, 0, 0);

  const dates: string[] = [];
  while (dates.length < count) {
    const weekday = cursor.getDay();
    if (weekday !== 0 && weekday !== 6) {
      dates.push(toDateKey(cursor));
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  return dates;
}

export function timeToMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

export function minutesToTime(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${pad(hours)}:${pad(minutes)}`;
}

export function overlaps(
  startA: number,
  endA: number,
  startB: number,
  endB: number,
): boolean {
  return startA < endB && startB < endA;
}

export function daysFromToday(dateKey: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = parseDateKey(dateKey);
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

export function formatDateLabel(dateKey: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(parseDateKey(dateKey));
}

export function formatDateWithYear(dateKey: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(parseDateKey(dateKey));
}

export function buildTimeOptions(
  start = "08:00",
  end = "18:00",
  stepMinutes = DEFAULT_STEP_MINUTES,
): string[] {
  const items: string[] = [];
  let current = timeToMinutes(start);
  const finish = timeToMinutes(end);

  while (current <= finish) {
    items.push(minutesToTime(current));
    current += stepMinutes;
  }

  return items;
}
