#!/usr/bin/env node
/**
 * Generates `tokens/Colors.tokens.json` in the exact Figma Variables
 * REST-API export shape used by `~/Downloads/Value.tokens.json`.
 *
 * Differences from a hand-written file that prevented the previous
 * version from importing:
 *   1. `$value` is an `{r,g,b,a}` object with 0–1 floats (not a hex
 *      string) — this is Figma's native color value format.
 *   2. Every token has a `com.figma.variableId` (synthetic, sequential
 *      under collection prefix `200`) so the plugin recognises each
 *      entry as a real variable rather than a free-form blob.
 *   3. Token names are Tailwind-style and contain no commas or
 *      periods — those tripped the importer for alpha tokens.
 *   4. Color scopes use only valid scope names that the Figma REST
 *      schema accepts for COLOR variables.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(here, "..", "tokens", "Colors.tokens.json");

/** Convert `#rgb` / `#rrggbb` / `#rrggbbaa` → { r,g,b,a } in 0–1. */
function hexToRgba(hex) {
  let h = hex.replace(/^#/, "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (h.length !== 6 && h.length !== 8) {
    throw new Error(`Invalid hex: ${hex}`);
  }
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
  const round = (n) => Number(n.toFixed(4));
  return { r: round(r), g: round(g), b: round(b), a: round(a) };
}

/* ----------------------------------------------------------------
 * variableId factory — produces sequential synthetic IDs of the form
 * `VariableID:200:<n>` so each token has a unique identifier the
 * import plugin can hash against. The collection prefix `200` is
 * arbitrary but high enough not to clash with existing Figma file IDs.
 * ---------------------------------------------------------------- */
let nextId = 1;
const varId = () => `VariableID:200:${nextId++}`;

/** Color-variable scope names valid in Figma's REST schema. */
const SCOPE = {
  ALL: ["ALL_SCOPES"],
  ALL_FILLS: ["ALL_FILLS"],
  FILL: ["FRAME_FILL", "SHAPE_FILL"],
  TEXT: ["TEXT_FILL"],
  STROKE: ["STROKE_COLOR"],
  EFFECT: ["EFFECT_COLOR"],
};

/** Build one color token in the Figma-REST shape. */
function token(hex, { scopes = SCOPE.ALL, code }) {
  const ext = {
    "com.figma.variableId": varId(),
    "com.figma.scopes": scopes,
  };
  if (code) ext["com.figma.codeSyntax"] = { WEB: code };
  return {
    $type: "color",
    $value: hexToRgba(hex),
    $extensions: ext,
  };
}

/* ----------------------------------------------------------------
 * Token tree
 * ---------------------------------------------------------------- */
const data = {
  color: {
    neutral: {
      white:    token("#ffffff", { code: "white" }),
      "gray-50":  token("#f8f8f8", { code: "gray-50" }),
      "gray-100": token("#ececec", { code: "gray-100" }),
      "gray-150": token("#eceff3", { code: "gray-150" }),
      "gray-200": token("#e5e5e5", { code: "gray-200" }),
      "gray-300": token("#d1d5db", { code: "gray-300" }),
      "gray-400": token("#9ca3af", { code: "gray-400" }),
      "gray-500": token("#6b7280", { code: "gray-500" }),
      "gray-700": token("#33373d", { code: "gray-700" }),
      "gray-750": token("#35353b", { code: "gray-750" }),
      "gray-800": token("#3f3f46", { code: "gray-800" }),
      "gray-900": token("#18181b", { code: "gray-900" }),
      "gray-925": token("#17171b", { code: "gray-925" }),
      "gray-950": token("#131315", { code: "gray-950" }),
      black:    token("#000000", { code: "black" }),
    },
    brand: {
      "blue-100":   token("#dbeafe", { code: "blue-100" }),
      "blue-500":   token("#0045df", { code: "blue-500" }),
      "blue-600":   token("#0176d3", { code: "blue-600" }),
      "blue-700":   token("#2563eb", { code: "blue-700" }),
      "green-600":  token("#2e844a", { code: "green-600" }),
      "yellow-400": token("#facc15", { code: "yellow-400" }),
    },
    payment: {
      paypal: token("#ffc43a", { code: "paypal" }),
      venmo:  token("#008cff", { code: "venmo" }),
      amazon: token("#f0f1f2", { code: "amazon" }),
    },
    alpha: {
      "focus-ring":    token("#a3a3a380", { scopes: SCOPE.EFFECT, code: "focus-ring" }),
      "scrim-modal":   token("#0f0f1166", { scopes: SCOPE.FILL,   code: "scrim-modal" }),
      "scrim-confirm": token("#0f0f1473", { scopes: SCOPE.FILL,   code: "scrim-confirm" }),
      "shadow-100":    token("#0000000f", { scopes: SCOPE.EFFECT, code: "shadow-100" }),
      "shadow-150":    token("#00000014", { scopes: SCOPE.EFFECT, code: "shadow-150" }),
      "shadow-200":    token("#0000001a", { scopes: SCOPE.EFFECT, code: "shadow-200" }),
      "shadow-300":    token("#0000002e", { scopes: SCOPE.EFFECT, code: "shadow-300" }),
      "shadow-400":    token("#00000040", { scopes: SCOPE.EFFECT, code: "shadow-400" }),
    },
    background: {
      primary:   token("#ffffff", { scopes: SCOPE.FILL, code: "bg-primary" }),
      secondary: token("#f8f8f8", { scopes: SCOPE.FILL, code: "bg-secondary" }),
      tertiary:  token("#ececec", { scopes: SCOPE.FILL, code: "bg-tertiary" }),
      muted:     token("#eceff3", { scopes: SCOPE.FILL, code: "bg-muted" }),
      inverse:   token("#131315", { scopes: SCOPE.FILL, code: "bg-inverse" }),
      header:    token("#18181b", { scopes: SCOPE.FILL, code: "bg-header" }),
    },
    foreground: {
      primary:   token("#17171b", { scopes: SCOPE.TEXT, code: "fg-primary" }),
      heading:   token("#3f3f46", { scopes: SCOPE.TEXT, code: "fg-heading" }),
      card:      token("#3f3f46", { scopes: SCOPE.TEXT, code: "fg-card" }),
      secondary: token("#33373d", { scopes: SCOPE.TEXT, code: "fg-secondary" }),
      muted:     token("#35353b", { scopes: SCOPE.TEXT, code: "fg-muted" }),
      tertiary:  token("#6b7280", { scopes: SCOPE.TEXT, code: "fg-tertiary" }),
      inverse:   token("#ffffff", { scopes: SCOPE.TEXT, code: "fg-inverse" }),
    },
    border: {
      subtle:  token("#d1d5db", { scopes: SCOPE.STROKE, code: "border-subtle" }),
      default: token("#d1d5db", { scopes: SCOPE.STROKE, code: "border-default" }),
      strong:  token("#9ca3af", { scopes: SCOPE.STROKE, code: "border-strong" }),
    },
    action: {
      "primary-bg": token("#131315", { scopes: SCOPE.FILL, code: "action-primary-bg" }),
      "primary-fg": token("#ffffff", { scopes: SCOPE.TEXT, code: "action-primary-fg" }),
      "accent-bg":  token("#ececec", { scopes: SCOPE.FILL, code: "action-accent-bg" }),
    },
    feedback: {
      link:    token("#0176d3", { scopes: SCOPE.TEXT,      code: "feedback-link" }),
      info:    token("#dbeafe", { scopes: SCOPE.FILL,      code: "feedback-info" }),
      success: token("#2e844a", { scopes: SCOPE.ALL_FILLS, code: "feedback-success" }),
      warning: token("#facc15", { scopes: SCOPE.ALL_FILLS, code: "feedback-warning" }),
      accent:  token("#0045df", { scopes: SCOPE.ALL_FILLS, code: "feedback-accent" }),
    },
    focus: {
      ring: token("#a3a3a380", { scopes: SCOPE.EFFECT, code: "focus-ring" }),
    },
  },
  $extensions: {
    "com.figma.modeName": "Value",
  },
};

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(data, null, 2) + "\n", "utf8");

const count = (() => {
  let n = 0;
  const walk = (o) => {
    for (const v of Object.values(o)) {
      if (v && typeof v === "object") {
        if ("$type" in v) n++;
        else walk(v);
      }
    }
  };
  walk(data.color);
  return n;
})();
console.log(`wrote ${outPath} (${count} color tokens)`);
