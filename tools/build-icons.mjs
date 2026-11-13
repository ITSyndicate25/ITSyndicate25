// Builds the animated tech-stack icons used by README.md.
//
// Geometry comes from devicon (MIT). The artwork is kept intact: groups,
// <defs> and gradients all survive, so inherited fills keep working. One CSS
// keyframe animation is added - the outline is traced, then the fill lands.
// Renderers that ignore CSS show the plain filled mark, so every asset stays
// readable as a static image, and `prefers-reduced-motion` disables motion.
//
// Usage: node tools/build-icons.mjs

import { mkdir, writeFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "..", "assets", "icons");

const DEVICON = "https://raw.githubusercontent.com/devicons/devicon/master/icons";

// All geometry is devicon. "original" keeps the brand colors;
// "-original-wordmark" is used where the standalone mark reads too small.
const ICONS = {
  go: "original",
  luau: "original",
  sass: "original",
  express: "original",
  socketio: "original",
  zustand: "original",
  chartjs: "original",
  bootstrap: "original",
  fastapi: "original",
  sqlite: "original",
  docker: "original",
  git: "original",
  vscode: "original",
  vite: "original",
  vitest: "original",
  npm: "original-wordmark",
  composer: "original",
  apache: "original",
  bun: "original",
  githubactions: "original",
};

const SHAPE = "path|circle|rect|ellipse|polygon|polyline|line";

// Every shape is normalised to this outline length, so one dash value traces
// any mark, long or short, at the same speed.
const PATH_LENGTH = 1000;

const ANIMATION = `<style>
  /* Fill first: the mark reads as a normal logo in any renderer that ignores
     CSS, and never disappears while the animation runs. */
  .icon, .icon * { stroke-dasharray: ${PATH_LENGTH}; stroke-dashoffset: 0; }
  .icon { transform-box: view-box; transform-origin: center; }
  .icon * { stroke-width: 1.5; stroke-linejoin: round; }
  @media (prefers-reduced-motion: no-preference) {
    .icon {
      animation: icon-float 4s ease-in-out infinite;
      animation-delay: var(--delay, 0s);
    }
    .icon * {
      animation: icon-sweep 4s linear infinite;
      animation-delay: var(--delay, 0s);
    }
    @keyframes icon-float {
      0%, 100% { transform: translateY(0) }
      50% { transform: translateY(-4px) }
    }
    /* The outline runs from before the start of the path to past its end, so
       it always travels the same direction. */
    @keyframes icon-sweep {
      0% { stroke-dashoffset: ${PATH_LENGTH} }
      100% { stroke-dashoffset: -${PATH_LENGTH} }
    }
  }
</style>`;

// Deterministic stagger so a row does not pulse in lockstep.
function delayFor(name) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 1000;
  return ((h % 12) * 0.12).toFixed(2);
}

// Each shape needs an outline color. A shape with its own fill traces in that
// color; a shape inheriting the default traces in black, which is exactly the
// color it renders as. Gradient fills have no solid color to match, so they
// only take part in the fill and float animation.
function addOutline(tag) {
  if (/\s(pathLength|stroke)=/.test(tag)) return tag;
  const fill = tag.match(/\sfill="([^"]+)"/)?.[1];
  if (fill && fill.startsWith("url(")) return tag;
  const stroke = fill && fill !== "none" && fill !== "currentColor" ? fill : "currentColor";
  return tag.replace(/\s*\/?>$/, (tail) => ` pathLength="${PATH_LENGTH}" stroke="${stroke}"${tail}`);
}

function build(name, body, rootAttrs) {
  const traced = body.replace(
    new RegExp(`<(${SHAPE})\\b[^>]*\\/?>`, "g"),
    (tag) => addOutline(tag),
  );

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" ${rootAttrs}role="img" viewBox="0 0 128 128">`,
    `<title>${name}</title>`,
    ANIMATION,
    `<g class="icon" style="--delay: ${delayFor(name)}s">`,
    traced,
    "</g>",
    "</svg>",
    "",
  ].join("\n");
}

// devicon ships both 128x128 and viewBox-less files. Anything that is not the
// 128 grid is fitted to it, so every asset shares one coordinate space.
function normalize(svg) {
  const open = svg.match(/<svg\b[^>]*>/)?.[0];
  if (!open) throw new Error("no <svg> root");
  const box = open.match(/viewBox="([^"]+)"/)?.[1];
  // go.svg references its clip path through xlink:href; dropping the
  // namespace breaks that reference and the icon renders as a broken image.
  const extraNs = /xmlns:xlink/.test(open) ? 'xmlns:xlink="http://www.w3.org/1999/xlink" ' : "";

  let body = svg.slice(svg.indexOf(open) + open.length).replace(/<\/svg>\s*$/, "");
  body = body.replace(/<style[\s\S]*?<\/style>/g, "");
  body = body.replace(/<!--[\s\S]*?-->/g, "");
  body = body.replace(/<title>[\s\S]*?<\/title>/g, "");
  if (!body.trim()) throw new Error("empty artwork");

  if (!box) {
    const w = Number(open.match(/\swidth="([\d.]+)"/)?.[1]);
    const h = Number(open.match(/\sheight="([\d.]+)"/)?.[1]);
    if (!w || !h) throw new Error("no viewBox and no width/height");
    return { viewBox: `0 0 ${w} ${h}`, body, extraNs };
  }

  const [x, y, w, h] = box.split(/\s+/).map(Number);
  const span = Math.max(w, h);
  if (x === 0 && y === 0 && w === 128 && h === 128) return { viewBox: box, body, extraNs };

  // Fit the source box into the 128 grid, preserving its aspect ratio.
  const scale = 128 / span;
  const shiftX = (128 - w * scale) / 2 - x * scale;
  const shiftY = (128 - h * scale) / 2 - y * scale;
  const fitted = `<g transform="translate(${shiftX.toFixed(3)} ${shiftY.toFixed(3)}) scale(${scale.toFixed(4)})">${body}</g>`;
  return { viewBox: "0 0 128 128", body: fitted, extraNs };
}

const shapes = (svg) => svg.match(new RegExp(`<(${SHAPE})\\b`, "g"))?.length ?? 0;

// Relative luminance of a #rgb / #rrggbb color, 0 (black) to 1 (white).
function luminance(hex) {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? [...h].map((c) => c + c).join("") : h;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function solidFills(body) {
  return [...body.matchAll(/\sfill="(#[0-9A-Fa-f]{3,6})"/g)].map((m) => m[1]);
}

// A mark painted near-black, or painted nothing at all (which renders as
// black), disappears on GitHub's dark theme. For those icons a second file is
// written with every dark paint lifted until it is clearly readable.
const DARK_THRESHOLD = 0.22;
const LIGHT_TARGET = 0.5;
const INHERITED_LIGHT = "#e6edf3";
const SHAPE_OPEN = new RegExp(`<(${SHAPE})\\b[^>]*\\/?>`, "g");

function lift(hex) {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? [...h].map((c) => c + c).join("") : h;
  const rgb = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));

  let mixed = rgb;
  for (let mix = 0.2; mix <= 1.0001; mix += 0.2) {
    mixed = rgb.map((v) => Math.round(v + (255 - v) * mix));
    const lum = luminance("#" + mixed.map((v) => v.toString(16).padStart(2, "0")).join(""));
    if (lum >= LIGHT_TARGET) break;
  }
  return "#" + mixed.map((v) => v.toString(16).padStart(2, "0")).join("");
}

// Literal fills are lifted; shapes with no fill at all inherit black, so they
// get an explicit light paint instead.
function lighten(body) {
  return body
    .replace(/\sfill="(#[0-9A-Fa-f]{3,6})"/g, (whole, hex) =>
      luminance(hex) >= DARK_THRESHOLD ? whole : ` fill="${lift(hex)}"`,
    )
    .replace(SHAPE_OPEN, (tag) =>
      /\sfill=/.test(tag) ? tag : tag.replace(/\s*\/?>$/, (t) => ` fill="${INHERITED_LIGHT}"${t}`),
    );
}

// The dark variant is needed when any paint is near-black, or when the mark
// has no paint of its own and therefore renders black.
function needsDarkVariant(body) {
  const fills = solidFills(body);
  if (!fills.length) return true;
  return Math.min(...fills.map(luminance)) < DARK_THRESHOLD;
}

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

const darkVariants = [];

for (const [name, variant] of Object.entries(ICONS)) {
  const url = `${DEVICON}/${name}/${name}-${variant}.svg`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status} ${url}`);

  const { viewBox, body, extraNs } = normalize(await res.text());
  const svg = build(name, body, extraNs).replace('viewBox="0 0 128 128"', `viewBox="${viewBox}"`);

  if (shapes(svg) === 0) throw new Error(`${name}: source produced no shapes`);
  await writeFile(join(outDir, `${name}.svg`), svg, "utf8");

  const dark = needsDarkVariant(body);
  if (dark) {
    const variantSvg = build(name, lighten(body), extraNs).replace(
      'viewBox="0 0 128 128"',
      `viewBox="${viewBox}"`,
    );
    await writeFile(join(outDir, `${name}-dark.svg`), variantSvg, "utf8");
    darkVariants.push(name);
  }
}

const attribution = `# Icon attribution

Generated by \`tools/build-icons.mjs\`. Do not edit these files by hand.

| Source | License | Used for |
| --- | --- | --- |
| [devicon](https://github.com/devicons/devicon) | MIT | all icons in this folder |

Brand marks remain the property of their owners. The artwork is unmodified;
this repository only adds the CSS animation. Files named \`*-dark.svg\` are
lightened copies of a near-black mark, used by \`<picture>\` on dark themes so
the icon stays visible.
`;
await writeFile(join(outDir, "ATTRIBUTION.md"), attribution, "utf8");

console.log(`${Object.keys(ICONS).length} icons written to assets/icons/`);
console.log(darkVariants.length ? `dark variants: ${darkVariants.join(", ")}` : "no dark variants needed");
