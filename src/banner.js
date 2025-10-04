import { Canvas, loadImage, FontLibrary } from "skia-canvas";
import { Resvg } from "@resvg/resvg-js";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

/**
 * Configure your asset lists here.
 * - BACKGROUNDS: 256x64 PNGs
 * - EMBLEMS:     64x64 PNGs
 * - CALLSIGNS:   Short phrases displayed on row 1
 *
 * You can keep these as relative paths from your project root or absolute paths.
 * Use whatever folder you already store these in.
 */
export const BACKGROUNDS = [
	"assets/backgrounds/hud@uo_mp.png",
	"assets/backgrounds/hud@vcod-american.png",
	"assets/backgrounds/hud@vcod-british.png",
	"assets/backgrounds/hud@vcod-russian.png",
	"assets/backgrounds/hud@usa-flag.png"
];

export const EMBLEMS = [
	"assets/emblems/hud@bazooka_mp.png",
	"assets/emblems/hud@binoculars_mp.png",
	"assets/emblems/hud@bren_mp.png",
	"assets/emblems/hud@brutalamish.png",
	"assets/emblems/hud@camper.png",
	"assets/emblems/hud@colt_mp.png",
	"assets/emblems/hud@emoji57.png",
	"assets/emblems/hud@empire.png",
	"assets/emblems/hud@enfield_mp.png",
	"assets/emblems/hud@fg42_mp.png",
	"assets/emblems/hud@flamethrower_mp.png",
	"assets/emblems/hud@fraggrenade_mp.png",
	"assets/emblems/hud@gay69.png",
	"assets/emblems/hud@gewehr_mp.png",
	"assets/emblems/hud@greenthumb.png",
	"assets/emblems/hud@jumpman.png",
	"assets/emblems/hud@kar98k_mp.png",
	"assets/emblems/hud@kar98k_sniper_mp.png",
	"assets/emblems/hud@luger_mp.png",
	"assets/emblems/hud@m1carbine_mp.png",
	"assets/emblems/hud@m1garand_mp.png",
	"assets/emblems/hud@mg34_mp.png",
	"assets/emblems/hud@mg42_mp.png",
	"assets/emblems/hud@mk1britishfrag_mp.png",
	"assets/emblems/hud@mod_melee.png",
	"assets/emblems/hud@mosin_nagant_mp.png",
	"assets/emblems/hud@mosin_nagant_sniper_mp.png",
	"assets/emblems/hud@mp40_mp.png",
	"assets/emblems/hud@mp44_mp.png",
	"assets/emblems/hud@ninja.png",
	"assets/emblems/hud@none.png",
	"assets/emblems/hud@panzerfaust_mp.png",
	"assets/emblems/hud@panzerschreck_mp.png",
	"assets/emblems/hud@ppsh_mp.png",
	"assets/emblems/hud@ra.png",
	"assets/emblems/hud@ratcumfarmer.png",
	"assets/emblems/hud@rgd-33russianfrag_mp.png",
	"assets/emblems/hud@satchelcharge_mp.png",
	"assets/emblems/hud@silenced_sten_mp.png",
	"assets/emblems/hud@springfield_mp.png",
	"assets/emblems/hud@steilhandgrenate_mp.png",
	"assets/emblems/hud@sten_mp.png",
	"assets/emblems/hud@svt40_mp.png",
	"assets/emblems/hud@targetmaster.png",
	"assets/emblems/hud@thompson_mp.png",
	"assets/emblems/hud@touchgrass.png",
	"assets/emblems/hud@tt33_mp.png",
	"assets/emblems/hud@webley_mp.png",
	"assets/emblems/hud@sipsOJ.png"
];

export const CALLSIGNS = [
	"New Pugger",
	"DSR",
	"Cracked Aiming Legend",
	"SJ LEAG Player",
	"AVG CODUO Gamer",
	"Euro Player",
	"Pug Star",
	"Corgi Fan",
	"girthquake",
	"dienasty",
	".EXE",
	"Probably a Camper",
	"Touch Grass",
	"John Stockton",
	"Crete2438g",
	"Multiple Personality Disorder",
	"Green Thumb",
	"Ninja Defuser",
	"Target(+)Master",
	"Mrs. Bert 55"
];

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
  const [bgImg, emblemImg] = await Promise.all([loadImage(bgPath), loadImage(emPath)]);

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
