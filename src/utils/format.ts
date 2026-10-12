export function formatCedis(amount: number): string {
  const value = Number.isFinite(amount) ? amount : 0;
  return `GHS ${value.toFixed(2)}`;
}

export function formatDeliveryDays(min: number, max: number): string {
  if (min === max) return `${min} ${min === 1 ? 'day' : 'days'}`;
  return `${min}-${max} days`;
}

export function expectedDeliveryDate(minDays: number, maxDays: number): string {
  const start = new Date();
  start.setDate(start.getDate() + minDays);

  const end = new Date();
  end.setDate(end.getDate() + maxDays);

  const options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' };

  if (minDays === maxDays) {
    return start.toLocaleDateString('en-GB', options);
  }

  return `${start.toLocaleDateString('en-GB', options)} - ${end.toLocaleDateString('en-GB', options)}`;
}

export function formatDateTime(value: string | Date | undefined | null): string {
  if (!value) return '';

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  return date.toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}