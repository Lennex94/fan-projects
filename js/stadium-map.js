// js/stadium-map.js
export const UPPER_CLOCKWISE = [
  "417","418","419","420","421","422","423","424",
  "425","426","427","428","429","430","401",
  "402","403","404","405","406","407","408","409",
  "410","411","412","413","414","415","416",
];

export const LOWER_CLOCKWISE = [
  "117","118","119","120","121","122","123","124",
  "125","126","127","128","129",
  "101","102","103","104","105","106","107","108","109","110","111",
  "112","113","114","115","116",
];

// Optional: “Innenblöcke”, erstmal NICHT nutzen, bis wir’s sauber brauchen
export const LOWER_INNER = ["018","019","020","021","022","023","010","008","007","006","005","004","003","002"];

export function normalizeBlock(v) {
  const raw = String(v ?? "").trim();
  if (!raw) return "";
  const onlyDigits = raw.replace(/\D+/g, "");
  return onlyDigits.padStart(3, "0"); // "18" -> "018", "117" -> "117"
}

export function getBlockProgress(level, block) {
  const b = normalizeBlock(block);
  const list = level === "upper" ? UPPER_CLOCKWISE : level === "lower" ? LOWER_CLOCKWISE : null;
  if (!list) return null;

  const idx = list.indexOf(b);
  if (idx === -1) return null;

  const t = list.length <= 1 ? 0 : idx / (list.length - 1); // 0..1
  return { idx, t, count: list.length, block: b };
}
