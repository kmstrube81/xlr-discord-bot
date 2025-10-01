import { createCanvas, loadImage, registerFont } from "canvas";
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
	"assets/backgrounds/hud@vcod-russian.png"
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
	"assets/emblems/hud@webley_mp.png"
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
	"Target(+)Master"
];

const FONT_STACK_MONO = [
  "Courier New",       // Windows/macOS (if present)
  "Courier",
  "Liberation Mono",   // Debian/Ubuntu package
  "DejaVu Sans Mono",  // Alpine/Debian package
  "monospace"
];


// Canvas constants (pixels)
const WIDTH = 256;
const HEIGHT = 64;
const EMBLEM_SIZE = 64;            // emblem is 64x64
const EMBLEM_X = WIDTH - EMBLEM_SIZE; // right edge (192)
const TEXT_BOX_WIDTH = EMBLEM_X;   // left 192 px reserved for text

// Text rows/padding
const ROW1_Y = 2;   // callsign top padding (row 1)
const ROW2_Y = 20;  // player name baseline-ish (row 2)
const ROW3_Y = 40;  // stats baseline-ish (row 3)
const LEFT_X  = 4;  // left padding for rows 2 & 3

// Colors
const FILL = "#ffffff";
const STROKE = "rgba(0,0,0,0.9)";
const SHADOW_BLUR = 0;

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
  const canvas = createCanvas(WIDTH, HEIGHT);
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

  // Row 1: Callsign — centered within left 192 px, 2px from top
  // Fit text to TEXT_BOX_WIDTH minus a little padding
  const maxRow1Width = TEXT_BOX_WIDTH - 8;
  fitText(ctx, csText, FONT_STACK_MONO, "700", maxRow1Width, 16); // try up to 16px
  const csMetrics = ctx.measureText(csText);
  const csX = Math.round((TEXT_BOX_WIDTH - csMetrics.width) / 2);
  const csBaseline = ROW1_Y + Math.ceil(csMetrics.actualBoundingBoxAscent);
  ctx.strokeText(csText, csX, csBaseline);
  ctx.fillText(csText, csX, csBaseline);

  // Row 2: Player name — left-justified at x=4, y=20
  // Fit name in (TEXT_BOX_WIDTH - LEFT_X - 2)
  const maxRow2Width = TEXT_BOX_WIDTH - LEFT_X - 2;
  fitText(ctx, name, FONT_STACK_MONO, "700", maxRow2Width, 16); // bold-ish
  const nameMetrics = ctx.measureText(name);
  const nameBaseline = ROW2_Y + Math.ceil(nameMetrics.actualBoundingBoxAscent / 2);
  ctx.strokeText(name, LEFT_X, nameBaseline);
  ctx.fillText(name, LEFT_X, nameBaseline);

  // Row 3: Stats — "K: x  D: x  S: x" left-justified at x=4, y=40
  const stats = `K: ${Number(kills) || 0}  D: ${Number(deaths) || 0}  S: ${Number(skill) || 0}`;
  const maxRow3Width = TEXT_BOX_WIDTH - LEFT_X - 2;
  fitText(ctx, stats, FONT_STACK_MONO, "600", maxRow3Width, 14); // slightly smaller
  const stMetrics = ctx.measureText(stats);
  const stBaseline = ROW3_Y + Math.ceil(stMetrics.actualBoundingBoxAscent / 2);
  ctx.strokeText(stats, LEFT_X, stBaseline);
  ctx.fillText(stats, LEFT_X, stBaseline);

  const filename = `xlr-banner-${Date.now()}.png`;
  const buffer = canvas.toBuffer("image/png");
  return { buffer, filename };
}
