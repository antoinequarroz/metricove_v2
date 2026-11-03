import { format } from "date-fns";
import { fr } from "date-fns/locale";

export { default as cn } from "clsx";

export function fmt(date: Date | string, pattern: string) {
  return format(typeof date === "string" ? new Date(date) : date, pattern, { locale: fr });
}

export function compact(n: number) {
  return new Intl.NumberFormat("fr-CH", { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

export function duration(sec: number) {
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
}

export function uid() {
  return Math.random().toString(36).slice(2, 10);
}
