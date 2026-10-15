export function getLanguage(): "zh" | "en";
export function t(source: unknown, ...args: unknown[]): string;
export function uiText(el: HTMLElement, fn: () => unknown): string;
export function uiAttr(el: HTMLElement, name: string, fn: () => unknown): void;
export function setupLocale(): void;
export function setLanguage(value: string): void;
