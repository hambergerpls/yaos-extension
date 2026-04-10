const PREFIX = "[yaos-ext]";

export function log(context: string, ...data: unknown[]): void {
  console.log(`${PREFIX} ${context}`, ...data);
}

export function logWarn(context: string, ...data: unknown[]): void {
  console.warn(`${PREFIX} ${context}`, ...data);
}
