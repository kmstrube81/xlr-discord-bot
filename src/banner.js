import { Canvas, loadImage, FontLibrary } from "skia-canvas";
import { Resvg } from "@resvg/resvg-js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TMP_ROOT = path.resolve("tmp");

function getBundledMagickPath() {
  if (os.platform() === "win32") {
    return path.join(__dirname, "bin", "magick.exe");
  }
  return path.join(__dirname, "bin", "magick");
}

// helper: load all image files in a directory into an array of *relative* paths
function loadAssetList(relDir) {
  const absDir = path.resolve(relDir);
  if (!fs.existsSync(absDir)) {
    return []; // directory doesn't exist → no assets
  }

  const files = fs.readdirSync(absDir, { withFileTypes: true });

  // accept DDS (most important for you) and also PNG/JPG in case you drop any in
  const exts = [".dds", ".png", ".jpg", ".jpeg", ".webp"];

  return files
    .filter((entry) => entry.isFile())
    .filter((entry) => exts.includes(path.extname(entry.name).toLowerCase()))
    // return path in the same style your code already uses
    .map((entry) => path.join(relDir, entry.name).replace(/\\/g, "/"));
}

// try to load CALLSIGN strings from a CoD-style .str file
function loadLocalizedStrings(strPath, identifier) {
  const absPath = path.resolve(strPath);
  if (!fs.existsSync(absPath)) {
    return null; // let caller fall back
  }

  const raw = fs.readFileSync(absPath, "utf8");
  const lines = raw.split(/\r?\n/);

  const callsigns = [];
  let currentRef = null;

  for (const line of lines) {
    // REFERENCE ""
    const refMatch = line.match(/^\s*REFERENCE\s+(\S+)/i);
    if (refMatch) {
      currentRef = refMatch[1];
      continue;
    }

    // LANG_ENGLISH ""
    const langMatch = line.match(/^\s*LANG_ENGLISH\s+"([^"]*)"/i);
    if (langMatch && currentRef) {
      const value = langMatch[1];
      if (currentRef.toUpperCase().startsWith(identifier)) {
        const idx = parseInt(currentRef.replace(/[^0-9]/g, ""), 10);
        if (!Number.isNaN(idx) && value !== "#same" && value !== "") {
		  callsigns[idx] = value;
		}
      }
      // done with this reference
      currentRef = null;
    }
  }

  // if file existed but didn't actually contain callsigns, return null to fall back
  const compact = callsigns.filter((v) => v != null);
  return compact.length ? compact : null;
}


/**
 * Try to run ImageMagick (bundled → system magick → system convert)
 * and return a PNG buffer, or null if all methods fail.
 */
async function ddsToPngBuffer(inputAbsPath) {
  const candidates = [
    getBundledMagickPath(),
    "magick",
    "convert"
  ];

  for (const cmd of candidates) {
    try {
      const { stdout } = await execFileAsync(cmd, [inputAbsPath, "png:-"], {
        encoding: "buffer",
      });
      return stdout; // Buffer
    } catch (err) {
      // just try the next one
    }
  }

  // all failed
  return null;
}

/**
 * Load any image. If it's DDS, check tmp cache first, otherwise convert and cache.
 * Returns:
 *  - skia-canvas Image on success
 *  - null if we couldn't convert/load
 */
export async function loadDDS(imgPath, load = true) {
  const ext = path.extname(imgPath).toLowerCase();

  // non-DDS → just load directly
  if (ext !== ".dds") {
    try {
      // allow relative paths
      const abs = path.resolve(imgPath);
      if(load) return await loadImage(abs);
	  return abs;
    } catch (e) {
		console.log("Non DDS image, loading directly");
      return null;
    }
  }

  // DDS → we want tmp/{same structure}/file.png
  const absInput = path.resolve(imgPath);
  const relDir = path.dirname(imgPath);            // e.g. assets/gfx/backgrounds
  const baseName = path.basename(imgPath, ".dds"); // e.g. hud@usa-flag
  const tmpDir = path.join(TMP_ROOT, relDir);      // tmp/assets/gfx/backgrounds
  const tmpPngPath = path.join(tmpDir, baseName + ".png");

  // 1) if we already converted it, just load it
  try {
    if (fs.existsSync(tmpPngPath)) {
		if(load) return await loadImage(tmpPngPath);
		return tmpPngPath;
    }
  } catch {
    // fall through to convert
	console.log("Converting Image...");
  }

  // 2) ensure tmp dir exists
  try {
    await fsp.mkdir(tmpDir, { recursive: true });
  } catch (e) {
    // if we can't make the dir, we won't be able to cache; we'll still try convert
	console.log("Temporary Storage for converted file not available");
  }

  // 3) convert DDS → PNG (buffer)
  const pngBuf = await ddsToPngBuffer(absInput);
  if (!pngBuf) {
    // conversion totally failed
	console.log("couldn't convert file to pdf");
    return null;
  }

  // 4) write to tmp path so we don't convert again next time
  try {
    await fsp.writeFile(tmpPngPath, pngBuf);
  } catch (e) {
    // even if write fails, we can still load from buffer
	console.log("Failed to Save to temporary storage")
  }

  // 5) finally load it into skia
  try {
    // prefer loading from file (so next runs don't call magick)
    if (fs.existsSync(tmpPngPath)) {
		if(load) return await loadImage(tmpPngPath);
		return tmpPngPath;
    }
    // fallback: load from buffer
	if(load) return await loadImage(pngBuf);
	return pngBuf;
  } catch (e) {
	  console.log("Couldn't load image from temporary storage or buffer");
    return null;
  }
}

/**
 * Configure your asset lists here.
 * - BACKGROUNDS: 256x64 PNGs
 * - EMBLEMS:     64x64 PNGs
 * - CALLSIGNS:   Short phrases displayed on row 1
 *
 * You can keep these as relative paths from your project root or absolute paths.
 * Use whatever folder you already store these in.
 */
// auto-discovered assets
export const BACKGROUNDS = loadAssetList("assets/gfx/backgrounds");
export const EMBLEMS     = loadAssetList("assets/gfx/emblems");

export const CALLSIGNS = loadLocalizedStrings("assets/localizedstrings/english/pc.str", 'CALLSIGN');

export const DEFAULT_THUMB = "https://cod.pm/mp_maps/unknown.png";

const FONT_STACK_MONO = [
  "Courier New",       // Windows/macOS (if present)
  "Courier",
  "Liberation Mono",   // Debian/Ubuntu package
  "DejaVu Sans Mono",  // Alpine/Debian package
  "monospace"
];

const FONT_DIR = path.resolve("assets/fonts");
const FONT_REG_PATH = path.join(FONT_DIR, "CourierPrime-Regular.ttf");
const FONT_BLD_PATH = path.join(FONT_DIR, "CourierPrime-Bold.ttf");

let FONT_REG_B64 = null;
let FONT_BLD_B64 = null;
try {
  if (fs.existsSync(FONT_REG_PATH)) {
    FONT_REG_B64 = fs.readFileSync(FONT_REG_PATH).toString("base64");
  }
  if (fs.existsSync(FONT_BLD_PATH)) {
    FONT_BLD_B64 = fs.readFileSync(FONT_BLD_PATH).toString("base64");
  }
} catch { /* ignore */ }


// Canvas constants (pixels)
const WIDTH = 256;
const HEIGHT = 64;
const EMBLEM_SIZE = 64;            // emblem is 64x64
const EMBLEM_X = WIDTH - EMBLEM_SIZE; // right edge (192)
const TEXT_BOX_WIDTH = EMBLEM_X;   // left 192 px reserved for text

// Text rows/padding
const ROW1_Y = 2;   // callsign top padding (row 1)
const ROW2_Y = 40;  // player name baseline-ish (row 2)
const ROW3_Y = 60;  // stats baseline-ish (row 3)
const LEFT_X  = 4;  // left padding for rows 2 & 3

// Colors
const FILL = "#ffffff";
const STROKE = "rgba(0,0,0,0.9)";
const SHADOW_BLUR = 0;

// crude monospace width estimate so we can shrink to fit without measureText()
function estimateFitSize(text, startPx, maxWidth, charWidth = 0.6, minPx = 8) {
  const len = String(text ?? "").length || 1;
  const cap = Math.floor(maxWidth / (len * charWidth));
  return Math.max(minPx, Math.min(startPx, cap));
}

function fontFamilyString(families) {
   if (Array.isArray(families)) {
     return families.map(f => (/\s/.test(f) ? `"${f}"` : f)).join(", ");
   }
   return families;
}

function fitText(ctx, text, families, weight, maxWidth, startPx, minPx = 8) {
   const familyStr = fontFamilyString(families);
    let size = startPx;
    for (; size >= minPx; size--) {
     ctx.font = `${weight} ${size}px ${familyStr}`;
      if (ctx.measureText(text).width <= maxWidth) break;
    }
    if (size < minPx) size = minPx;
	ctx.font = `${weight} ${size}px ${familyStr}`;
    return size;
}

function sanitize(str) {
  return String(str ?? "")
    .replace(/\^\d/g, "") // strip ^ color codes
    .replace(/\|/g, "")
    .replace(/`/g, "'");
}

function renderTextPNG({
  text,
  width,
  sizePx,
  baselineY,          // absolute baseline within a full-height (64px) canvas
  weight = 700,
  color = "#ffffff",
  stroke = null,
  strokeWidth = 0,
  align = "left",     // "left" | "center"
  leftPad = 0,        // when align === "left"
}) {
  const safe = String(text ?? "").replace(/[&<>"]/g, s => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[s]));

  // Embed font faces if available (Courier Prime). Otherwise rely on default monospace.
  const fontFace = (FONT_REG_B64 && FONT_BLD_B64) ? `
  @font-face { font-family: XLRMono; src: url(data:font/ttf;base64,${FONT_REG_B64}) format('truetype'); font-weight: 400; font-style: normal; }
  @font-face { font-family: XLRMono; src: url(data:font/ttf;base64,${FONT_BLD_B64}) format('truetype'); font-weight: 700; font-style: normal; }
  ` : ``;

  const family = (FONT_REG_B64 && FONT_BLD_B64) ? "XLRMono" : "monospace";
  const anchor = (align === "center") ? `text-anchor="middle"` : `text-anchor="start"`;
  const x = (align === "center") ? width / 2 : leftPad;
  const y = baselineY; // draw at the real baseline (within 64px banner)

  const strokeAttrs = (stroke && strokeWidth > 0)
    ? ` stroke="${stroke}" stroke-width="${strokeWidth}" paint-order="stroke fill"`
    : ``;

  const svg = `
  <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${HEIGHT}">
    <style>${fontFace}</style>
    <rect width="100%" height="100%" fill="transparent"/>
    <text x="${x}" y="${y}" ${anchor}
          font-family="${family}"
          font-size="${sizePx}"
          font-weight="${weight}"
          fill="${color}"${strokeAttrs}>${safe}</text>
  </svg>`;

  const png = new Resvg(svg).render().asPng();
  return png; // Buffer
}

/**
 * Generate a banner PNG buffer.
 * @param {object} opts
 * @param {number} opts.background      Index into BACKGROUNDS[]
 * @param {number} opts.emblem          Index into EMBLEMS[]
 * @param {number} opts.callsign        Index into CALLSIGNS[]
 * @param {string} opts.playerName      Player display name (row 2)
 * @param {number} opts.kills           Kills
 * @param {number} opts.deaths          Deaths
 * @param {number} opts.skill           Skill rating
 * @returns {Promise<{buffer: Buffer, filename: string}>}
 */
export async function generateBanner(opts) {
  const {
    background = 0,
    emblem = 0,
    callsign = 0,
    playerName = "",
    kills = 0,
    deaths = 0,
    skill = 0
  } = opts || {};

  // Validate indices with friendly errors
  if (!Number.isInteger(background) || background < 0 || background >= BACKGROUNDS.length) {
    throw new Error(`Invalid background index ${background}. Provide 0..${Math.max(0, BACKGROUNDS.length - 1)}.`);
  }
  if (!Number.isInteger(emblem) || emblem < 0 || emblem >= EMBLEMS.length) {
    throw new Error(`Invalid emblem index ${emblem}. Provide 0..${Math.max(0, EMBLEMS.length - 1)}.`);
  }
  if (!Number.isInteger(callsign) || callsign < 0 || callsign >= CALLSIGNS.length) {
    throw new Error(`Invalid callsign index ${callsign}. Provide 0..${Math.max(0, CALLSIGNS.length - 1)}.`);
  }

  const bgPath = BACKGROUNDS[background];
  const emPath = EMBLEMS[emblem];
  const csText = sanitize(CALLSIGNS[callsign]);
  const name   = sanitize(playerName);

  // Load images
  const [bgImg, emblemImg] = await Promise.all([loadDDS(bgPath), loadDDS(emPath)]);

  // Canvas
  const canvas = new Canvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext("2d");

  // Draw background
  ctx.drawImage(bgImg, 0, 0, WIDTH, HEIGHT);

  // Draw emblem (right edge)
  ctx.drawImage(emblemImg, EMBLEM_X, 0, EMBLEM_SIZE, EMBLEM_SIZE);

  // Common text drawing style
  ctx.lineWidth = 2;
  ctx.fillStyle = FILL;
  ctx.strokeStyle = STROKE;
  ctx.shadowBlur = SHADOW_BLUR;

	// Row 1: Callsign centered in the 192px box
	const maxRow1Width = TEXT_BOX_WIDTH - 8;
	const csSize = estimateFitSize(csText, 16, maxRow1Width); // shrink if long
	const csPNG = renderTextPNG({
	  text: csText,
	  width: TEXT_BOX_WIDTH,          // enough to fit 16px text
	  sizePx: csSize,
	  weight: 700,
	  color: FILL,
	  stroke: STROKE,
	  strokeWidth: 2,
	  align: "center",
	  baselineY: ROW1_Y + csSize
	});
	// Draw at left edge of the 192px region
	const csImg = await loadImage(csPNG);
	ctx.drawImage(csImg, 0, 0);


	const maxRow2Width = TEXT_BOX_WIDTH - LEFT_X - 2;
	const nameSize = estimateFitSize(name, 16, maxRow2Width);
	const namePNG = renderTextPNG({
	  text: name,
	  width: TEXT_BOX_WIDTH,
	  sizePx: nameSize,
	  weight: 700,
	  color: FILL,
	  stroke: STROKE,
	  strokeWidth: 2,
	  align: "left",
	  leftPad: LEFT_X,
	  baselineY: ROW2_Y
	});
	const nameImg = await loadImage(namePNG);
	ctx.drawImage(nameImg, 0, 0);

	const stats = `K: ${Number(kills) || 0}  D: ${Number(deaths) || 0}  S: ${Number(skill) || 0}`;
	const maxRow3Width = TEXT_BOX_WIDTH - LEFT_X - 2;
	const statsSize = estimateFitSize(stats, 14, maxRow3Width, 0.6);
	const statsPNG = renderTextPNG({
	  text: stats,
	  width: TEXT_BOX_WIDTH,
	  sizePx: statsSize,
	  weight: 600,
	  color: FILL,
	  stroke: STROKE,
	  strokeWidth: 2,
	  align: "left",
	  leftPad: LEFT_X,
      baselineY: ROW3_Y
	});
	const statsImg = await loadImage(statsPNG);
	ctx.drawImage(statsImg, 0, 0);

  const filename = `xlr-banner-${Date.now()}.png`;
  const buffer = await canvas.png;
  return { buffer, filename };
}
