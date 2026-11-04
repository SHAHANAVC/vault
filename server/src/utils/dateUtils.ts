/**
 * Date & Timezone Utilities for Vault
 * 
 * Defines month boundaries strictly in Asia/Kolkata (IST = UTC+05:30)
 * to ensure that transactions recorded near midnight IST land in the correct
 * financial reporting month and do not leak or misalign due to UTC shifts.
 */

export function getCurrentISTYearMonth(): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
  });
  return formatter.format(new Date()).substring(0, 7);
}

export function getCurrentISTDateString(date: Date = new Date()): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(date);
}

export function getISTMonthDateRange(yearMonth: string): { start: Date; end: Date; yearMonth: string } {
  const parts = yearMonth.split('-');
  const year = parseInt(parts[0] || '2026', 10);
  const month = parseInt(parts[1] || '10', 10);

  const pad = (n: number) => String(n).padStart(2, '0');
  const startIso = `${year}-${pad(month)}-01T00:00:00.000+05:30`;

  let nextYear = year;
  let nextMonth = month + 1;
  if (nextMonth > 12) {
    nextMonth = 1;
    nextYear += 1;
  }
  const endIso = `${nextYear}-${pad(nextMonth)}-01T00:00:00.000+05:30`;

  return {
    start: new Date(startIso),
    end: new Date(endIso),
    yearMonth: `${year}-${pad(month)}`,
  };
}

export function getPastNMonthsIST(count = 6): string[] {
  const currentYM = getCurrentISTYearMonth();
  const [currentYearStr, currentMonthStr] = currentYM.split('-');
  let year = parseInt(currentYearStr || '2026', 10);
  let month = parseInt(currentMonthStr || '10', 10);

  const months: string[] = [];
  const pad = (n: number) => String(n).padStart(2, '0');

  for (let i = 0; i < count; i++) {
    months.unshift(`${year}-${pad(month)}`);
    month -= 1;
    if (month < 1) {
      month = 12;
      year -= 1;
    }
  }

  return months;
}

export function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
