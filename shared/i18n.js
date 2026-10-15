import { english } from "./translations.js";
let language = "zh";
const texts = new Map(),
  attributes = new Map(),
  staticTexts = new Map();
let patterns;
const normalized = (s) => s.replace(/\s+/g, " ").trim();
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export function getLanguage() {
  return language;
}
export function t(source, ...args) {
  if (typeof source !== "string") return source == null ? "" : String(source);
  if (args.length) {
    const template = language === "en" ? english[source] || source : source;
    return template.replace(/\{(\d+)\}/g, (_, i) =>
      String(args[Number(i)] ?? ""),
    );
  }
  if (language !== "en") return source;
  const direct = english[source] || english[normalized(source)];
  if (direct) return direct;
  if (!patterns)
    patterns = Object.entries(english)
      .filter(([k]) => /\{\d+\}/.test(k))
      .sort(([a], [b]) => b.length - a.length)
      .map(([key, value]) => {
        const indices = [];
        let last = 0,
          expr = "";
        for (const m of key.matchAll(/\{(\d+)\}/g)) {
          expr += esc(key.slice(last, m.index)) + "([\\s\\S]*?)";
          indices.push(Number(m[1]));
          last = m.index + m[0].length;
        }
        expr += esc(key.slice(last));
        return { regex: new RegExp("^" + expr + "$"), indices, value };
      });
  for (const { regex, indices, value } of patterns) {
    const m = source.match(regex);
    if (m) {
      const values = [];
      indices.forEach((n, i) => (values[n] = m[i + 1]));
      return value.replace(/\{(\d+)\}/g, (_, i) => values[Number(i)] ?? "");
    }
  }
  return source;
}
function update(el, binding) {
  if (binding.node?.parentNode === el) binding.node.nodeValue = t(binding.fn());
}
let additions = 0;
export function uiText(el, fn) {
  const value = t(fn()),
    previous = texts.get(el);
  if (
    previous?.node?.parentNode === el &&
    el.childNodes.length === 1 &&
    previous.node.nodeValue === value
  ) {
    previous.fn = fn;
    return value;
  }
  el.textContent = value;
  const node = el.firstChild || el.appendChild(document.createTextNode(""));
  texts.set(el, { fn, node });
  if (++additions % 100 === 0) {
    for (const node of texts.keys()) if (!node.isConnected) texts.delete(node);
    for (const node of attributes.keys())
      if (!node.isConnected) attributes.delete(node);
  }
  return el.textContent;
}
export function uiAttr(el, name, fn) {
  let map = attributes.get(el);
  if (!map) attributes.set(el, (map = new Map()));
  map.set(name, fn);
  el.setAttribute(name, t(fn()));
}
function refresh() {
  document.documentElement.lang = language === "en" ? "en" : "zh-CN";
  for (const [node, raw] of staticTexts) {
    if (node.isConnected) {
      const leading = raw.match(/^\s*/)[0],
        trailing = raw.match(/\s*$/)[0];
      const shortNav = {
        导入照片: "Import",
        核对画面: "Review",
        导出报告: "Export",
      };
      const value =
        language === "en" && node.parentElement?.closest(".steps")
          ? shortNav[normalized(raw)] || t(normalized(raw))
          : t(normalized(raw));
      node.textContent = leading + value + trailing;
    } else staticTexts.delete(node);
  }
  for (const [el, fn] of texts) {
    if (el.isConnected) update(el, fn);
    else texts.delete(el);
  }
  for (const [el, items] of attributes) {
    if (el.isConnected)
      for (const [name, fn] of items) el.setAttribute(name, t(fn()));
    else attributes.delete(el);
  }
  document
    .querySelectorAll("[data-language-choice]")
    .forEach((el) => (el.value = language));
}
export function setLanguage(value) {
  language = value === "en" ? "en" : "zh";
  try {
    localStorage.setItem("talkcapture-language", language);
  } catch {}
  if (typeof document !== "undefined") {
    refresh();
    document.dispatchEvent(new Event("languagechange"));
  }
}
export function setupLocale() {
  try {
    const requested = new URLSearchParams(location.search).get("lang");
    language =
      (requested || localStorage.getItem("talkcapture-language")) === "en"
        ? "en"
        : "zh";
    if (requested === "en" || requested === "zh")
      localStorage.setItem("talkcapture-language", language);
  } catch {}
  const walk = document.createTreeWalker(
    document.documentElement,
    NodeFilter.SHOW_TEXT,
  );
  let node;
  while ((node = walk.nextNode()))
    if (
      node.parentElement &&
      !node.parentElement.closest('script,style,textarea,[translate="no"]') &&
      /[\u4e00-\u9fff]/.test(node.textContent)
    )
      staticTexts.set(node, node.textContent);
  document
    .querySelectorAll("[aria-label],[title],[placeholder],[alt]")
    .forEach((el) => {
      for (const name of ["aria-label", "title", "placeholder", "alt"]) {
        const raw = el.getAttribute(name);
        if (raw && /[\u4e00-\u9fff]/.test(raw)) uiAttr(el, name, () => raw);
      }
    });
  document
    .querySelectorAll("[data-language-choice]")
    .forEach((el) =>
      el.addEventListener("change", () => setLanguage(el.value)),
    );
  refresh();
}
