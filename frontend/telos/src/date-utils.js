// Keep date-only values in the user's local calendar instead of converting
// them through UTC, which can shift the visible day around midnight.
export function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return year + '-' + month + '-' + day;
}

export function addLocalDays(days, date = new Date()) {
  return localDateKey(new Date(date.getFullYear(), date.getMonth(), date.getDate() + days));
}
