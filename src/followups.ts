export function localDayWindow(date = new Date()) {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { todayFrom: start.toISOString(), todayTo: end.toISOString() };
}
export function localDateInput(value: string) {
  const date = new Date(value);
  const part = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${part(date.getMonth() + 1)}-${part(date.getDate())}T${part(date.getHours())}:${part(date.getMinutes())}`;
}
export function nextFollowup(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setHours(9, 0, 0, 0);
  return date.toISOString();
}
export function followupLabel(due: string, completed = false) {
  if (completed) return "Completed";
  if (due < new Date().toISOString()) return "Overdue";
  const day = localDayWindow();
  return due >= day.todayFrom && due < day.todayTo ? "Due today" : "Upcoming";
}
