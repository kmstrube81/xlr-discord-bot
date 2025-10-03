import "dotenv/config";
import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  Events,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  StringSelectMenuBuilder,
  AttachmentBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} from "discord.js";
import mysql from "mysql2/promise";
import { queries } from "./queries.js";
import {
  formatPlayerEmbed,
  formatTopEmbed,
  formatLastSeenEmbed,
  formatPlayerWeaponEmbed,
  formatPlayerVsEmbed,
  formatPlayerMapEmbed,
  formatAwardEmbed,
  renderHomeEmbed,
  renderLadderEmbeds,
  renderWeaponsEmbeds,
  renderMapsEmbeds,
  renderAwardsEmbeds,
  setEmojiResolver,
  resolveEmoji
} from "./format.js";
import {
  generateBanner,
  BACKGROUNDS,
  EMBLEMS,
  CALLSIGNS
} from "./banner.js";
import axios from "axios";
import path from "node:path";
import fs from "node:fs";

// -------------------------------------------------------------------------------------
// ENV + helpers
// -------------------------------------------------------------------------------------

const {
  DISCORD_TOKEN, APPLICATION_ID, GUILD_ID, TZ,
  XLR_DEFAULT_IMAGE
} = process.env;

const DEFAULT_THUMB = XLR_DEFAULT_IMAGE || "https://cod.pm/mp_maps/unknown.png";

// Write a key=value into .env (create if missing)
function upsertEnv(key, value) {
  const ENV_PATH = path.resolve(process.cwd(), ".env");
  const lines = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, "utf8").split(/\r?\n/) : [];
  const idx = lines.findIndex(l => l.startsWith(`${key}=`));
  if (idx >= 0) lines[idx] = `${key}=${value}`;
  else lines.push(`${key}=${value}`);
  fs.writeFileSync(ENV_PATH, lines.join("\n"), "utf8");
  process.env[key] = value;
}

function suffixKey(n, base) {
  return n === 1 ? base : `${base}_${n}`;
}

function readEnvSet(env, n = 1) {
  const suf = n === 1 ? "" : `_${n}`;
  const get = (k) => env[`${k}${suf}`]?.toString().trim();

  const db = {
    host: get("MYSQL_B3_HOST") || "db",
    name: get("MYSQL_B3_DB"),
    user: get("MYSQL_B3_USER"),
    pass: get("MYSQL_B3_PASSWORD"),
  };
  const rcon = { ip: get("B3_RCON_IP"), port: get("B3_RCON_PORT") };
  const channelId = get("CHANNEL_ID") || null;
  const ui = {
    navId: get("UI_NAV_MESSAGE_ID") || null,
    contentId: get("UI_CONTENT_MESSAGE_ID") || null,
  };
  const name = get("XLR_SERVER_NAME") || null;

  const hasAny = db.name || db.user || db.pass || db.host || rcon.ip || rcon.port || channelId || name;
  return { n, db, rcon, channelId, ui, name, hasAny };
}

function collectServerConfigs(env) {
  const configs = [];
  // always include base
  const first = readEnvSet(env, 1);
  if (first.hasAny) configs.push(first);

  // find all numeric suffixes present
  const suffixes = new Set(
    Object.keys(env)
      .map(k => (k.match(/_(\d+)$/)?.[1]))
      .filter(Boolean)
      .map(s => Number(s))
      .filter(n => Number.isFinite(n) && n >= 2)
  );

  [...suffixes].sort((a,b)=>a-b).forEach(n => {
    const cfg = readEnvSet(env, n);
    if (cfg.hasAny) configs.push(cfg);
  });

  // fill missing fields from base
  const base = configs[0] || readEnvSet(env, 1);
  for (const c of configs) {
    c.db.host ||= base.db.host || "db";
    c.db.name ||= base.db.name;
    c.db.user ||= base.db.user;
    c.db.pass ||= base.db.pass;
    c.rcon.ip ||= base.rcon.ip;
    c.rcon.port ||= base.rcon.port;
  }

  // derive default name
  for (const c of configs) {
    if (!c.name) c.name = `Server ${c.n}`;
  }

  // de-dup by unique tuple
  const seen = new Set();
  const uniq = [];
  for (const c of configs) {
    const key = `${c.channelId ?? "nochan"}|${c.db.host}|${c.db.name}|${c.rcon.ip}:${c.rcon.port}|${c.name}`;
    if (!seen.has(key)) { seen.add(key); uniq.push(c); }
  }
  return uniq;
}

const SERVER_CONFIGS = collectServerConfigs(process.env);
const byIndex = new Map(SERVER_CONFIGS.map((c, i) => [i, c]));
const byNameLower = new Map(SERVER_CONFIGS.map((c, i) => [c.name.toLowerCase(), { i, c }]));
const __memberNameCache = new Map();

// --- inactivity / auto-home ---
const INACTIVITY_MS = 2 * 60 * 1000; // 2 minutes 

// --- Awards Array ---
const awards = [

	{ key: "award_headshot",
	  name: "Cracked Aiming Legend",
	  description: "Most Headshot Kills",
	  emoji: "death_headshot",
	  query: queries.award_headshot,
	  properties: [{name: "Headshots", prop: "kills"}]
	},
	{ key: "award_ratio",
	  name: "Probably a Camper",
	  description: "Best Kill-Death Ratio",
	  emoji: "camper",
	  query: queries.award_ratio,
	  properties: [{name: "Kills", prop: "kills"}, {name: "Deaths", prop: "deaths"}, {name: "Kill-Death Ratio", prop: "ratio"}]
	},
	{ key: "award_skill",
	  name: "Touch Grass",
	  description: "Highest Skill Rating",
	  emoji: "touchgrass",
	  query: queries.award_skill,
	  properties: [{name: "Skill", prop: "skill"}]
	},
	{ key: "award_assits",
	  name: "John Stockton",
	  description: "Most Kill Assists",
	  emoji: "jumpman",
	  query: queries.award_assists,
	  properties: [{name: "Assists", prop: "assists"}]
	},
	{ key: "award_melee",
	  name: "Crete2438g",
	  description: "Very Nice Bash. (Most Melee Kills)",
	  emoji: "mod_melee",
	  query: queries.award_melee,
	  properties: [{name: "Melee Kills", prop: "kills"}]
	},
	{ key: "award_deaths",
	  name: "Team Captain",
	  description: "Most deaths with a KDR under 1.00",
	  emoji: "brutalamish",
	  query: queries.award_deaths,
	  properties: [{name: "Deaths", prop: "deaths"},{name: "Kill-Death Ratio", prop: "ratio"}]
	},
	{ key: "award_alias",
	  name: "Multiple Personality Disorder",
	  description: "Most Aliases",
	  emoji: "corgi_fan",
	  query: queries.award_alias,
	  properties: [{name: "Aliases", prop: "num_alias"}]
	},
	{ key: "award_plant",
	  name: "Green Thumb",
	  description: "Most Bomb Plants",
	  emoji: "plant",
	  query: queries.award_plant,
	  properties: [{name: "Bomb Plants", prop: "num_plant"}]
	},
	{ key: "award_defuse",
	  name: "Ninja Defuser",
	  description: "Most Bomb Defusals",
	  emoji: "defuse",
	  query: queries.award_defuse,
	  properties: [{name: "Bomb Defusals", prop: "num_defuse"}]
	},
	{ key: "award_chat",
	  name: "Target(+)Master",
	  description: "I'm in position with Katy Perry. (Most chat messages sent)",
	  emoji: "targetmaster",
	  query: queries.award_chat,
	  properties: [{name: "Chats sent", prop: "num_chat"}]
	}
];

// -------------------------------------------------------------------------------------
// MySQL pools per server
// -------------------------------------------------------------------------------------
const pools = SERVER_CONFIGS.map(c => mysql.createPool({
  host: c.db.host || "db",
  port: 3306,
  user: c.db.user,
  password: c.db.pass,
  database: c.db.name,
  connectionLimit: 5
}));

function getPoolByIndex(idx) {
  const pool = pools[idx];
  if (!pool) throw new Error(`No DB pool for server index ${idx}`);
  return pool;
}
async function runQueryOn(idx, sql, params) {
  const [rows] = await getPoolByIndex(idx).query(sql, params);
  return rows;
}

// -------------------------------------------------------------------------------------
// HTTP helpers
// -------------------------------------------------------------------------------------
function summarizeAxiosError(err) {
  if (err?.response) {
    const s = err.response.status;
    const t = (err.response.statusText || "").trim();
    return t ? `${s} ${t}` : `${s}`;
  }
  if (err?.request) return "NETWORK ERROR";
  return (err?.code || "ERROR");
}

async function fetchServerStatus(ip, port) {
  const url = `https://api.cod.pm/getstatus/${ip}/${port}`;
  try {
    const res = await axios.get(url, { timeout: 5000 });
    return res.data;
  } catch (err) {
    const summary = summarizeAxiosError(err);
    console.warn(`[http] status api error ${ip}:${port} → ${summary}`);
    return { error: summary };
  }
}

async function checkUrlFor404(url) {
  try {
    const res = await axios.head(url, { timeout: 4000, validateStatus: () => true });
    return res.status === 404;
  } catch (err) {
    const summary = summarizeAxiosError(err);
    console.warn(`[http] head error ${url} → ${summary}`);
    return false;
  }
}

async function getMapImageUrl(label) {
  try {
    if (await checkUrlFor404(`https://cod.pm/mp_maps/cod1+coduo/stock/${label}.png`)) {
      if (await checkUrlFor404(`https://cod.pm/mp_maps/cod1+coduo/custom/${label}.png`)) {
        return null;
      } else {
        return `https://cod.pm/mp_maps/cod1+coduo/custom/${label}.png`;
      }
    } else {
      return `https://cod.pm/mp_maps/cod1+coduo/stock/${label}.png`;
    }
  } catch {
    return null;
  }
}

// -------------------------------------------------------------------------------------
// UI components
// -------------------------------------------------------------------------------------
const VIEWS = Object.freeze({
  HOME: "home",
  LADDER: "ladder",
  WEAPONS: "weapons",
  MAPS: "maps",
  WEAPON_PLAYERS: "weaponPlayers",
  MAPS_PLAYERS: "mapsPlayers",
  AWARDS: "awards",
});

async function displayName(row, rowname, isTitle = false, isOpponent = false) {
  const raw = rowname ?? row?.name ?? "";
  const base = typeof raw === "string" ? raw : String(raw ?? "");
  const sanitized = base
    .replace(/\^\d/g, "")
    .replace(/\|/g, "")
    .replace(/`/g, "'");

  const id = isOpponent ? row?.opponent_discord_id : row?.discord_id;
  if (!id) return sanitized;

  if (GUILD_ID) {
    const cacheKey = `${GUILD_ID}:${id}`;
    if (__memberNameCache.has(cacheKey)) {
      const dn = __memberNameCache.get(cacheKey);
      return isTitle ? (dn || sanitized) : `<@${id}>`;
    }
    try {
      const guild = await client.guilds.fetch(GUILD_ID);
      const member = await guild.members.fetch(id).catch(() => null);
      const dn = member?.displayName || null;
      __memberNameCache.set(cacheKey, dn);
      if (dn) return isTitle ? dn : `<@${id}>`;
    } catch {}
  }

  try {
    const user = await client.users.fetch(id);
    const uName = user?.globalName ?? user?.username ?? null;
    if (uName) return isTitle ? uName : `<@${id}>`;
  } catch {}

  return sanitized;
}


const navRow = (active) =>
  new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`ui:${VIEWS.HOME}`).setLabel("Home").setStyle(active==="home"?ButtonStyle.Primary:ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`ui:${VIEWS.LADDER}`).setLabel("Ladder").setStyle(active==="ladder"?ButtonStyle.Primary:ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`ui:${VIEWS.WEAPONS}`).setLabel("Weapons").setStyle(active==="weapons"?ButtonStyle.Primary:ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`ui:${VIEWS.MAPS}`).setLabel("Maps").setStyle(active==="maps"?ButtonStyle.Primary:ButtonStyle.Secondary),
	new ButtonBuilder().setCustomId(`ui:${VIEWS.AWARDS}`).setLabel("Awards").setStyle(active==="awards"?ButtonStyle.Primary:ButtonStyle.Secondary),

  );

const pagerRow = (view, page, hasPrev, hasNext) =>
  new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`ui:${view}:prev:${page}`).setLabel("Previous").setStyle(ButtonStyle.Secondary).setDisabled(!hasPrev),
    new ButtonBuilder().setCustomId(`ui:${view}:next:${page}`).setLabel("Next").setStyle(ButtonStyle.Secondary).setDisabled(!hasNext),
  );
  
function pagerRowWithParams(view, page, hasPrev, hasNext, weaponLabel, weaponsPage) {
  const encWeap = encodeURIComponent(weaponLabel);
  const encPage = String(weaponsPage);
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`ui:${view}:prev:${page}:${encWeap}:${encPage}`).setLabel("Previous").setStyle(ButtonStyle.Secondary).setDisabled(!hasPrev),
    new ButtonBuilder().setCustomId(`ui:${view}:next:${page}:${encWeap}:${encPage}`).setLabel("Next").setStyle(ButtonStyle.Secondary).setDisabled(!hasNext),
  );
}

function weaponSelectRowForPage(rows, page, selectedLabel = null) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`ui:weapons:select:${page}`)
    .setPlaceholder("Select Weapon to View More Stats...")
    .addOptions(
      ...rows.map((w) => ({
        label: w.label,
        value: w.label,
        default: selectedLabel ? w.label === selectedLabel : false,
      }))
    );
  return new ActionRowBuilder().addComponents(menu);
}

function mapSelectRowForPage(rows, page, selectedLabel = null) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`ui:maps:select:${page}`)
    .setPlaceholder("Select Map to View More Stats...")
    .addOptions(
      ...rows.map((w) => ({
        label: w.label,
        value: w.label,
        default: selectedLabel ? w.label === selectedLabel : false,
      }))
    );
  return new ActionRowBuilder().addComponents(menu);
}

function playerSelectRowForPage(rows, page, selectedId = null) {
  const medals = ["🥇", "🥈", "🥉"];
  const PAGE_SIZE = 10;
  const options = rows.map((r, i) => {
    const absoluteRank = typeof r.rank === "number" ? r.rank : page * PAGE_SIZE + i + 1;
    const prefix = absoluteRank <= 3 ? medals[absoluteRank - 1] : `#${absoluteRank}`;
    const maxName = Math.max(0, 100 - (prefix.length + 1));
    const name = (r?.name ?? r?.player_name ?? "");
    const label = `${prefix} ${String(name).slice(0, maxName)}`;
    return {
      label,
      value: String(r.client_id),
      default: selectedId != null && String(r.client_id) === String(selectedId),
    };
  });
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`ui:ladder:select:${page}`)
    .setPlaceholder("Select a Player to View More Stats...")
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(options);
  return new ActionRowBuilder().addComponents(menu);
}

function awardSelectRowForPage(rows, page, selectedIndex = null) {
  const options = rows.map((r, i) => {
    
    const label = `${String(r.name).slice(0, 100)}`.trim();
    return {
      label,
      value: String(i),
      default: selectedIndex != null && String(i) === String(selectedIndex),
    };
  });
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`ui:awards:select:${page}`)
    .setPlaceholder("Select an Award to View the Winner...")
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(options);
  return new ActionRowBuilder().addComponents(menu);
}

function toolbarPayload(activeView) {
  return { content: "", embeds: [], components: [navRow(activeView)] };
}

function parseCustomId(id) {
  const p = id.split(":");
  if (p[0] !== "ui") return null;
  if (p.length === 2) return { view: p[1], page: 0 };
  if (p.length === 4) {
    const cur = Math.max(0, parseInt(p[3], 10) || 0);
    return { view: p[1], page: p[2] === "next" ? cur + 1 : Math.max(0, cur - 1) };
  }
  if (p.length === 6) {
    const cur = Math.max(0, parseInt(p[3], 10) || 0);
    const param = decodeURIComponent(p[4]);
    const weaponsPage = Math.max(0, parseInt(p[5], 10) || 0);
    return { view: p[1], page: p[2] === "next" ? cur + 1 : Math.max(0, cur - 1), param, weaponsPage };
  }
  return null;
}

// -------------------------------------------------------------------------------------
// Data helpers — per-server
// -------------------------------------------------------------------------------------
async function getHomeTotals(serverIndex) {
  const rq = (sql, p=[]) => runQueryOn(serverIndex, sql, p);
  const [[{totalPlayers=0 }],[{ totalKills=0 }={}],[{ totalRounds=0 }={}],[favW={}],[favM={}]] = await Promise.all([
    rq(queries.ui_totalPlayers,[]),
    rq(queries.ui_totalKills, []),
    rq(queries.ui_totalRounds, []),
    rq(queries.ui_favoriteWeapon, []),
    rq(queries.ui_favoriteMap, []),
  ]);
  return {
    totalPlayers: +totalPlayers || 0,
    totalKills: +totalKills || 0,
    totalRounds: +totalRounds || 0,
    favoriteWeapon: { label: favW?.label ?? "—", kills: +(favW?.kills ?? 0) },
    favoriteMap: { label: favM?.label ?? "—", rounds: +(favM?.rounds ?? 0) },
  };
}

async function getLadderSlice(serverIndex, offset = 0, limit = 10) {
  const { sql, params } = queries.ui_ladderSlice(limit, offset);
  const rows = await runQueryOn(serverIndex, sql, params);
  const enriched = await Promise.all(
    rows.map(async (r, i) => ({
      ...r,
      rank: offset + i + 1,
      name: (await displayName(r, r.name, true)) ?? r.name,
    }))
  );
  return enriched;
}

async function getLadderCount(serverIndex) {
  const [{ cnt=0 }={}] = await runQueryOn(serverIndex, queries.ui_ladderCount, []);
  return +cnt || 0;
}

async function getWeaponsSlice(serverIndex, offset=0, limit=10) {
  const { sql, params } = queries.ui_weaponsSlice(limit, offset);
  const rows = await runQueryOn(serverIndex, sql, params);
  return rows.map((r, i) => ({ ...r, rank: offset + i + 1 }));
}
async function getWeaponsCount(serverIndex) {
  const [{ cnt=0 }={}] = await runQueryOn(serverIndex, queries.ui_weaponsCount, []);
  return +cnt || 0;
}
async function getWeaponsAll(serverIndex) {
  const rows = await runQueryOn(serverIndex, queries.ui_weaponsAll, []);
  return rows;
}

async function getMapsSlice(serverIndex, offset=0, limit=10) {
  const { sql, params } = queries.ui_mapsSlice(limit, offset);
  const rows = await runQueryOn(serverIndex, sql, params);
  const slice = await Promise.all(rows.map(async (r, i) => {
    let url;
    try { url = await getMapImageUrl(r.label); } catch { url = DEFAULT_THUMB; }
    return { ...r, rank: offset + i + 1, thumbnail: url || DEFAULT_THUMB };
  }));
  return slice;
}
async function getMapsCount(serverIndex) {
  const [{ cnt=0 }={}] = await runQueryOn(serverIndex, queries.ui_mapsCount, []);
  return +cnt || 0;
}
async function getMapsAll(serverIndex) {
  const rows = await runQueryOn(serverIndex, queries.ui_mapsAll, []);
  return rows;
}

async function getPlayerWeaponSlice(serverIndex, weapon, offset = 0, limit = 10) {
  const { sql, params } = queries.ui_playerWeaponSlice(weapon, limit, offset);
  const rows = await runQueryOn(serverIndex, sql, params);
  const enriched = await Promise.all(
    rows.map(async (r, i) => ({
      ...r,
      rank: offset + i + 1,
      name: (await displayName(r, r.name, true)) ?? r.name,
    }))
  );
  return enriched;
}

async function getPlayerWeaponCount(serverIndex, weapon) {
  const [{ cnt=0 }={}] = await runQueryOn(serverIndex, queries.ui_playerWeaponCount, [ `%${weapon}%`, /^\d+$/.test(weapon) ? Number(weapon) : -1 ]);
  return +cnt || 0;
}

async function getPlayerMapCount(serverIndex, map) {
  const [{ cnt=0 }={}] = await runQueryOn(serverIndex, queries.ui_playerMapsCount, [ `%${map}%`, /^\d+$/.test(map) ? Number(map) : -1 ]);
  return +cnt || 0;
}

// -------------------------------------------------------------------------------------
// View builders — per server
// -------------------------------------------------------------------------------------
const V_PAGE = 10;

async function buildHome(serverIndex) {
  const cfg = byIndex.get(serverIndex);
  let totals, status;
  let hadError = false;

  try {
    totals = await getHomeTotals(serverIndex);
  } catch (e) {
    hadError = true;
    console.warn("[home] totals error → falling back to zeros");
    totals = {
      totalPlayers: 0,
      totalKills: 0,
      totalRounds: 0,
      favoriteWeapon: { label: "—", kills: 0 },
      favoriteMap: { label: "—", rounds: 0 },
    };
  }

  try {
    status = await fetchServerStatus(cfg.rcon.ip, cfg.rcon.port);
    if (status && status.error) hadError = true;
  } catch (e) {
    hadError = true;
    status = { error: summarizeAxiosError(e) };
  }

  const embeds = renderHomeEmbed({ totals }, status, TZ, cfg.rcon.ip, cfg.rcon.port);
  return { embeds, nav: [navRow(VIEWS.HOME)], pager: [], hadError };
}


async function buildLadder(serverIndex, page=0) {
  const offset = page * V_PAGE;
  const [rows, total] = await Promise.all([
    getLadderSlice(serverIndex, offset, V_PAGE),
    getLadderCount(serverIndex)
  ]);

  // PRE-ENRICH: fetch Discord username for titles/labels
  const rowsWithNames = await Promise.all(
    rows.map(async (r) => ({
      ...r,
      // use the fetched discord username when available; fall back to r.name
      name: (await displayName(r, r.name, true)) || r.name,
    }))
  );

  const embeds = renderLadderEmbeds({ rows: rowsWithNames, page });
  const pager = [pagerRow(VIEWS.LADDER, page, page>0, offset + V_PAGE < total)];
  const nav   = [navRow(VIEWS.LADDER), playerSelectRowForPage(rowsWithNames, page, null)];

  // Keep footer balancing so pages line up visually
  const embedArr = Array.isArray(embeds) ? embeds : [embeds];
  const footerText = embedArr[embedArr.length - 1].data.footer.text;
  const ZERO_WIDTH = "⠀";
  const padLen = Math.min(Math.floor(footerText.length * 0.65), 2048);
  const blankText = ZERO_WIDTH.repeat(padLen);
  const files = [];
  for (const [i,e] of embedArr.entries()){
	  e.setFooter({ text: blankText });
	  // Pull saved banner options (default to 0 if not set)
	  const clientId = rows[i].client_id;
	  const [pc] = await runQueryOn(
		serverIndex,
		queries.playerCoreAndBannerById,
		[clientId]
	  );
	  const bg = Number(pc?.background ?? 0) || 0;
	  const em = Number(pc?.emblem ?? 0) || 0;
	  const cs = Number(pc?.callsign ?? 0) || 0;

	  // Generate the banner
	  const { buffer, filename } = await generateBanner({
		background: bg,
		emblem: em,
		callsign: cs,
		playerName: pc.name,              
		kills: Number(pc.kills) || 0,
		deaths: Number(pc.deaths) || 0,
		skill: Number(pc.skill) || 0
	  });
	  
	  const file = new AttachmentBuilder(buffer, { name: filename });

	  e.setImage(`attachment://${filename}`);

	  files.push(file);
  }
  embedArr[embedArr.length - 1].setFooter({ text: footerText });

  return { embeds: embedArr, nav, pager, files };
}
async function buildWeapons(serverIndex, page=0) {
  const offset = page * V_PAGE;
  const [rows, total] = await Promise.all([
    getWeaponsSlice(serverIndex, offset, V_PAGE),
    getWeaponsCount(serverIndex)
  ]);
  const embeds = renderWeaponsEmbeds({ rows, page });
  const pager = [pagerRow(VIEWS.WEAPONS, page, page>0, offset + V_PAGE < total)];
  const nav = [navRow(VIEWS.WEAPONS), weaponSelectRowForPage(rows, page, null)];
  return { embeds, nav, pager };
}

async function buildWeaponPlayers(serverIndex, weaponLabel, playerPage=0, weaponsPage=0) {
  const pageSize = 10;
  const offset   = playerPage * pageSize;
  const [rows, total, weaponsRows] = await Promise.all([
    getPlayerWeaponSlice(serverIndex, weaponLabel, offset, pageSize),
    getPlayerWeaponCount(serverIndex, weaponLabel),
    getWeaponsSlice(serverIndex, weaponsPage * pageSize, pageSize),
  ]);
  
  const weap = (rows && rows[0]?.matched_label) || weaponLabel;
  const emoji = resolveEmoji(weap);
  const title = `Top Players by Weapon: ${emoji ? `${emoji} ${weap}` : weap}`;
  const embeds = formatTopEmbed(rows, title, { thumbnail: DEFAULT_THUMB, offset });
  const embedArr = Array.isArray(embeds) ? embeds : [embeds];
  const lastFooter = embedArr[embedArr.length - 1].data.footer?.text || "XLRStats • B3";
  const ZERO = "⠀";
  const padLen = Math.min(Math.floor(lastFooter.length * 0.65), 2048);
  const blank  = ZERO.repeat(padLen);
  const files = [];
  for (const [i,e] of embedArr.entries()){
	  e.setFooter({ text: blank });
	  // Pull saved banner options (default to 0 if not set)
	  const clientId = rows[i].client_id;
	  const [pc] = await runQueryOn(
		serverIndex,
		queries.playerCoreAndBannerById,
		[clientId]
	  );
	  const bg = Number(pc?.background ?? 0) || 0;
	  const em = Number(pc?.emblem ?? 0) || 0;
	  const cs = Number(pc?.callsign ?? 0) || 0;

	  // Generate the banner
	  const { buffer, filename } = await generateBanner({
		background: bg,
		emblem: em,
		callsign: cs,
		playerName: pc.name,              
		kills: Number(pc.kills) || 0,
		deaths: Number(pc.deaths) || 0,
		skill: Number(pc.skill) || 0
	  });
	  
	  const file = new AttachmentBuilder(buffer, { name: filename });

	  e.setImage(`attachment://${filename}`);

	  files.push(file);
  }
  embedArr[embedArr.length - 1].setFooter({ text: `${lastFooter} • Weapon page ${playerPage + 1}` });
  const hasNext = offset + pageSize < total;
  const pager   = [pagerRowWithParams(VIEWS.WEAPON_PLAYERS, playerPage, playerPage > 0, hasNext, weap, weaponsPage)];
  const nav = [navRow(VIEWS.WEAPONS), weaponSelectRowForPage(weaponsRows, weaponsPage, weap)];
  return { embeds: embedArr, nav: nav, pager: pager, files: files };
}

async function buildMaps(serverIndex, page=0) {
  const offset = page * V_PAGE;
  const [rows, total] = await Promise.all([
    getMapsSlice(serverIndex, offset, V_PAGE),
    getMapsCount(serverIndex)
  ]);
  const embeds = renderMapsEmbeds({ rows, page });
  const pager = [pagerRow(VIEWS.MAPS, page, page>0, offset + V_PAGE < total)];
  const nav = [navRow(VIEWS.MAPS), mapSelectRowForPage(rows, page, null)];
  return { embeds, nav, pager};
}

async function buildMapPlayers(serverIndex, mapLabel, playerPage=0, mapsPage=0) {
  const pageSize = 10;
  const offset   = playerPage * pageSize;
  const [rows, total, mapsRows] = await Promise.all([
    (async () => {
      const { sql, params } = queries.ui_playerMapsSlice(mapLabel, pageSize, offset);
      const data = await runQueryOn(serverIndex, sql, params);
      const mapped = await Promise.all(data.map(async (r, i) => ({ ...r, rank: offset + i + 1 , name: (await displayName(r, r.name, true)) || r.name })));
      return mapped;
    })(),
    getPlayerMapCount(serverIndex, mapLabel),
    getMapsSlice(serverIndex, mapsPage * pageSize, pageSize),
  ]);
  const thumbUrl = (await getMapImageUrl(mapLabel)) || DEFAULT_THUMB;
  const embeds = formatTopEmbed(rows, `Top Players by Map: ${mapLabel}`, { thumbnail: thumbUrl, offset });
  const embedArr = Array.isArray(embeds) ? embeds : [embeds];
  const lastFooter = embedArr[embedArr.length - 1].data.footer?.text || "XLRStats • B3";
  const ZERO = "⠀";
  const padLen = Math.min(Math.floor(lastFooter.length * 0.65), 2048);
  const blank  = ZERO.repeat(padLen);
  const files = [];
  for (const [i,e] of embedArr.entries()){
	  e.setFooter({ text: blank });
	  // Pull saved banner options (default to 0 if not set)
	  const clientId = rows[i].client_id;
	  const [pc] = await runQueryOn(
		serverIndex,
		queries.playerCoreAndBannerById,
		[clientId]
	  );
	  const bg = Number(pc?.background ?? 0) || 0;
	  const em = Number(pc?.emblem ?? 0) || 0;
	  const cs = Number(pc?.callsign ?? 0) || 0;

	  // Generate the banner
	  const { buffer, filename } = await generateBanner({
		background: bg,
		emblem: em,
		callsign: cs,
		playerName: pc.name,              
		kills: Number(pc.kills) || 0,
		deaths: Number(pc.deaths) || 0,
		skill: Number(pc.skill) || 0
	  });
	  
	  const file = new AttachmentBuilder(buffer, { name: filename });

	  e.setImage(`attachment://${filename}`);

	  files.push(file);
  }
  embedArr[embedArr.length - 1].setFooter({ text: `${lastFooter} • Map page ${playerPage + 1}` });
  const hasNext = offset + pageSize < total;
  const pager   = [pagerRowWithParams(VIEWS.MAPS_PLAYERS, playerPage, playerPage > 0, hasNext, mapLabel, mapsPage)];
  const nav = [navRow(VIEWS.MAPS), mapSelectRowForPage(mapsRows, mapsPage, mapLabel)];
  return { embeds: embedArr, nav: nav, pager: pager, files: files };
}

async function buildAwards(serverIndex, page=0) {
  const offset = page * V_PAGE;
  const baseRows = awards.slice(offset, offset + V_PAGE);
  const rows = await Promise.all(baseRows.map(async (aw) => {
	  const top = await runQueryOn(serverIndex, aw.query, [1, 0]).then(r => r?.[0] || null);
	  if (top) top.name = await displayName(top, top.name, true);
	  return { ...aw, top };
  }));

  const total  = awards.length;

  const embeds = renderAwardsEmbeds({ rows, page });
  const pager  = [pagerRow(VIEWS.AWARDS, page, page > 0, offset + V_PAGE < total)];
  const nav    = [navRow(VIEWS.AWARDS), awardSelectRowForPage(rows, page, null)];
   // Keep footer balancing so pages line up visually
  const embedArr = Array.isArray(embeds) ? embeds : [embeds];
  const footerText = embedArr[embedArr.length - 1].data.footer.text;
  const ZERO_WIDTH = "⠀";
  const padLen = Math.min(Math.floor(footerText.length * 0.65), 2048);
  const blankText = ZERO_WIDTH.repeat(padLen);
  for (const e of embedArr) e.setFooter({ text: blankText });
  embedArr[embedArr.length - 1].setFooter({ text: footerText });

  return { embeds: embedArr, nav, pager };
}

async function buildAward(serverIndex, award, playerPage=0, awardsPage=0) {
  const pageSize = 10;
  const offset   = playerPage * pageSize;
  const [rows, total] = await Promise.all([
    (async () => {
      const data = await runQueryOn(serverIndex, award.query, [pageSize, offset]);
      const mapped = await Promise.all(data.map(async (r, i) => ({ ...r, rank: offset + i + 1 , name: (await displayName(r, r.name, true)) || r.name })));
      return mapped;
    })(),
    pageSize,
  ]);
  const thumbUrl = DEFAULT_THUMB; //(await getMapImageUrl(mapLabel)) || DEFAULT_THUMB;
  const embeds = formatAwardEmbed(rows, award.name, award.emoji, award.properties, { thumbnail: thumbUrl, offset });
  const embedArr = Array.isArray(embeds) ? embeds : [embeds];
  const lastFooter = embedArr[embedArr.length - 1].data.footer?.text || "XLRStats • B3";
  const ZERO = "⠀";
  const padLen = Math.min(Math.floor(lastFooter.length * 0.65), 2048);
  const blank  = ZERO.repeat(padLen);
  
  const files = [];
  for (const [i,e] of embedArr.entries()){
	  e.setFooter({ text: blank });
	  // Pull saved banner options (default to 0 if not set)
	  const clientId = rows[i].client_id;
	  const [pc] = await runQueryOn(
		serverIndex,
		queries.playerCoreAndBannerById,
		[clientId]
	  );
	  const bg = Number(pc?.background ?? 0) || 0;
	  const em = Number(pc?.emblem ?? 0) || 0;
	  const cs = Number(pc?.callsign ?? 0) || 0;

	  // Generate the banner
	  const { buffer, filename } = await generateBanner({
		background: bg,
		emblem: em,
		callsign: cs,
		playerName: pc.name,              
		kills: Number(pc.kills) || 0,
		deaths: Number(pc.deaths) || 0,
		skill: Number(pc.skill) || 0
	  });
	  
	  const file = new AttachmentBuilder(buffer, { name: filename });

	  e.setImage(`attachment://${filename}`);

	  files.push(file);
  }
  embedArr[embedArr.length - 1].setFooter({ text: `${lastFooter} • Awards page ${playerPage + 1}` });
  const hasNext = rows.length === pageSize;
  const pager   = [pagerRowWithParams(VIEWS.AWARDS, playerPage, playerPage > 0, hasNext, award.name, awardsPage)];
  const currentAwardsPageRows = awards.slice(awardsPage * V_PAGE, awardsPage * V_PAGE + V_PAGE);
  const nav = [navRow(VIEWS.AWARDS), awardSelectRowForPage(currentAwardsPageRows, awardsPage, null)];
  return { embeds: embedArr, nav: nav, pager: pager, files: files };
}

// --- PROFILE (DM) helpers ----------------------------------------------------
const PROFILE_IDS = Object.freeze({
  EDIT_NAME_BTN:   (si, pid) => `profile:edit:name:${si}:${pid}`,
  EDIT_BG_BTN:     (si, pid, pg=0) => `profile:edit:bg:${si}:${pid}:${pg}`,
  EDIT_EMBLEM_BTN: (si, pid, pg=0) => `profile:edit:em:${si}:${pid}:${pg}`,
  EDIT_CS_BTN:     (si, pid, pg=0) => `profile:edit:cs:${si}:${pid}:${pg}`,
  PICK_BG:         (si, pid, pg) => `profile:pick:bg:${si}:${pid}:${pg}`,
  PICK_EM:         (si, pid, pg) => `profile:pick:em:${si}:${pid}:${pg}`,
  PICK_CS:         (si, pid, pg) => `profile:pick:cs:${si}:${pid}:${pg}`,
  PAGE_BG:         (si, pid, dir, pg) => `profile:page:bg:${si}:${pid}:${dir}:${pg}`,
  PAGE_EM:         (si, pid, dir, pg) => `profile:page:em:${si}:${pid}:${dir}:${pg}`,
  PAGE_CS:         (si, pid, dir, pg) => `profile:page:cs:${si}:${pid}:${dir}:${pg}`,
  NAME_MODAL:      (si, pid) => `profile:name:${si}:${pid}`,
});

function basenameNoExt(p) {
  try {
    const b = path.basename(p);
    return b.replace(/\.(png|jpg|jpeg|gif|webp)$/i, "");
  } catch { return String(p); }
}

function chunkOptions(labels, startIndex = 0, page = 0, perPage = 25) {
  const offset  = page * perPage;
  const slice   = labels.slice(offset, offset + perPage);
  const options = slice.length
    ? slice.map((label, i) => ({
        label: `${offset + i}. ${label}`,
        value: String(offset + i)
      }))
    : [{ label: "No items", value: "noop" }]; // never 0 options

  return {
    page,
    total: labels.length,
    hasPrev: page > 0,
    hasNext: offset + perPage < labels.length,
    options
  };
}

function buildPickerRow(kind, serverIndex, playerId, page, arrays) {
  const arr = kind==="bg" ? BACKGROUNDS : kind==="em" ? EMBLEMS : CALLSIGNS.map(c => c);
  const labels = kind==="cs" ? CALLSIGNS.slice() : arr.map(basenameNoExt);
  const chunk = chunkOptions(labels, 0, page, 25);

  const select = new StringSelectMenuBuilder()
    .setCustomId(kind==="bg" ? PROFILE_IDS.PICK_BG(serverIndex, playerId, page)
               : kind==="em" ? PROFILE_IDS.PICK_EM(serverIndex, playerId, page)
                              : PROFILE_IDS.PICK_CS(serverIndex, playerId, page))
    .setPlaceholder(kind==="bg" ? "Pick a background…" : kind==="em" ? "Pick an emblem…" : "Pick a callsign…")
    .addOptions(chunk.options);

  const row1 = new ActionRowBuilder().addComponents(select);
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(kind==="bg" ? PROFILE_IDS.PAGE_BG(serverIndex, playerId, "prev", page) :
                   kind==="em" ? PROFILE_IDS.PAGE_EM(serverIndex, playerId, "prev", page) :
                                 PROFILE_IDS.PAGE_CS(serverIndex, playerId, "prev", page))
      .setLabel("Previous")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!chunk.hasPrev),
    new ButtonBuilder()
      .setCustomId(kind==="bg" ? PROFILE_IDS.PAGE_BG(serverIndex, playerId, "next", page) :
                   kind==="em" ? PROFILE_IDS.PAGE_EM(serverIndex, playerId, "next", page) :
                                 PROFILE_IDS.PAGE_CS(serverIndex, playerId, "next", page))
      .setLabel("Next")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!chunk.hasNext)
  );

  return [row1, row2];
}

async function loadProfileData(serverIndex, clientId) {
  const [card] = await runQueryOn(serverIndex, queries.playerCard, [clientId, clientId, clientId]);
  const [pc]   = await runQueryOn(serverIndex, queries.getPlayerCardRow, [clientId]);
  const prefNameRow = await runQueryOn(serverIndex,
    "SELECT COALESCE(preferred_name, NULL) AS preferred_name FROM clients WHERE id = ? LIMIT 1", [clientId]);
  const preferredName = prefNameRow?.[0]?.preferred_name || null;
  return { card, pc, preferredName };
}

async function buildProfileDmPayload(serverIndex, clientId, userId) {
  const { card, pc, preferredName } = await loadProfileData(serverIndex, clientId);
  if (!card) return { content: "No stats found for your account on this server." };

  const display = preferredName || card.name;
  const bg = Number(pc?.background ?? 0) || 0;
  const em = Number(pc?.emblem ?? 0) || 0;
  const cs = Number(pc?.callsign ?? 0) || 0;

  const { buffer, filename } = await generateBanner({
    background: bg,
    emblem: em,
    callsign: cs,
    playerName: display,
    kills: card.kills || 0,
    deaths: card.deaths || 0,
    skill: card.skill || 0
  });
  const file = new AttachmentBuilder(buffer, { name: filename });

  // Stats embed
  const statsEmbed = formatPlayerEmbed(card, { thumbnail: DEFAULT_THUMB });

  // Controls
  const rowButtons = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(PROFILE_IDS.EDIT_NAME_BTN(serverIndex, clientId)).setLabel("Edit Preferred Name").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(PROFILE_IDS.EDIT_BG_BTN(serverIndex, clientId, 0)).setLabel("Edit Background").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(PROFILE_IDS.EDIT_EMBLEM_BTN(serverIndex, clientId, 0)).setLabel("Edit Emblem").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(PROFILE_IDS.EDIT_CS_BTN(serverIndex, clientId, 0)).setLabel("Edit Callsign").setStyle(ButtonStyle.Secondary)
  );

  // Show the current choices summary
  const summary = new EmbedBuilder()
    .setColor(0x2b7cff)
    .setTitle("Your Banner Settings")
    .setDescription([
      `**Preferred Name:** ${display}`,
      `**Background:** ${bg} — ${basenameNoExt(BACKGROUNDS[bg] || "N/A")}`,
      `**Emblem:** ${em} — ${basenameNoExt(EMBLEMS[em] || "N/A")}`,
      `**Callsign:** ${cs} — ${CALLSIGNS[cs] ?? "N/A"}`
    ].join("\n"));

  return {
    files: [file],
    embeds: [summary, statsEmbed],
    components: [rowButtons]
  };
}

async function deleteOldProfileDMs(dmChannel, client) {
  try {
    const msgs = await dmChannel.messages.fetch({ limit: 50 });
    const mine = msgs.filter(m =>
      m.author?.id === client.user.id &&
      (
        // our profile UI has this embed title
        (Array.isArray(m.embeds) && m.embeds.some(e => e?.title === "Your Banner Settings")) ||
        // or any row with a customId that starts with "profile:"
        (Array.isArray(m.components) && m.components.some(row =>
          row?.components?.some(c => typeof c.customId === "string" && c.customId.startsWith("profile:"))
        ))
      )
    );

    // Delete sequentially (DMs don't support bulkDelete)
    for (const m of mine.values()) {
      try { await m.delete(); } catch {}
    }
  } catch (e) {
    console.warn("[profile] deleteOldProfileDMs failed:", e.message || e);
  }
}

// -------------------------------------------------------------------------------------
// Discord wiring — multi UI
// -------------------------------------------------------------------------------------
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildMembers] });

const commands = [
  new SlashCommandBuilder()
    .setName("xlr-top")
    .setDescription("Show top players (global, or filtered by weapon OR map)")
    .addIntegerOption(o => o.setName("count").setDescription("How many rows (0=all, max 10; default 0)").setMinValue(0).setMaxValue(10))
    .addStringOption(o => o.setName("weapon").setDescription("Filter by weapon (partial name or exact numeric id)"))
    .addStringOption(o => o.setName("map").setDescription("Filter by map (partial name or exact numeric id)"))
    .addStringOption(o => o.setName("sort").setDescription("Sort by")
      .addChoices(
        { name: "skill", value: "skill" },
        { name: "kills", value: "kills" },
        { name: "deaths", value: "deaths" },
        { name: "ratio", value: "ratio" },
        { name: "suicides", value: "suicides" },
        { name: "assists", value: "assists" },
        { name: "rounds", value: "rounds" },
      ))
    .addStringOption(o => o.setName("server").setDescription("Which server to query (name or number)")),
  new SlashCommandBuilder()
    .setName("xlr-player")
    .setDescription("Lookup a player by name (optionally filter by weapon/map, or compare vs opponent)")
    .addStringOption(o => o.setName("name").setDescription("Player (partial)").setRequired(true))
    .addStringOption(o => o.setName("weapon").setDescription("Weapon (partial name or exact id)"))
    .addStringOption(o => o.setName("map").setDescription("Map (partial name or exact id)"))
    .addStringOption(o => o.setName("vs").setDescription("Opponent player (partial name)"))
    .addStringOption(o => o.setName("server").setDescription("Which server to query (name or number)"))
	.addStringOption(o => {
	  const opt = o.setName("award").setDescription("Award category to show placement in");
	  opt.addChoices({name: "Best Placements", value: "-1"});
	  awards.slice(0,24).map((p,i) => {
		  const ch = {name: p.name, value: String(i)};
		  opt.addChoices(ch);
	  });
	  return opt;
	}),
  new SlashCommandBuilder()
    .setName("xlr-lastseen")
    .setDescription("Show recently seen players")
    .addIntegerOption(o => o.setName("count").setDescription("How many (default 10)").setMinValue(1).setMaxValue(25))
    .addStringOption(o => o.setName("server").setDescription("Which server to query (name or number)")),
  new SlashCommandBuilder()
    .setName("xlr-servers")
    .setDescription("List configured servers and their numbers"),
  new SlashCommandBuilder()
    .setName("xlr-register")
    .setDescription("Link your Discord user to a B3 GUID")
    .addStringOption(o => o.setName("guid").setDescription("Your in-game GUID").setRequired(true))
    .addStringOption(o => o.setName("server").setDescription("Which server to use (name or number)")),
   new SlashCommandBuilder()
    .setName("xlr-profile")
    .setDescription("DM your playercard and let you edit profile/banner settings")
    .addStringOption(o => o.setName("server").setDescription("Which server to query (name or number)"))
].map(c => c.toJSON());

async function register() {
  const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);
  if (GUILD_ID) {
    await rest.put(Routes.applicationGuildCommands(APPLICATION_ID, GUILD_ID), { body: commands });
    console.log("Registered guild commands");
  } else {
    await rest.put(Routes.applicationCommands(APPLICATION_ID), { body: commands });
    console.log("Registered global commands");
  }
}

function upsertEnvForServer(n, keyBase, value) {
  upsertEnv(suffixKey(n, keyBase), value);
}

const perChannelState = new Map(); // channelId => { serverIndex, collectors }

async function ensureUIForServer(serverIndex) {
  const cfg = byIndex.get(serverIndex);
  if (!cfg?.channelId) return;

  const channel = await client.channels.fetch(cfg.channelId).catch(() => null);
  if (!channel || channel.type !== ChannelType.GuildText) return;

  // initial HOME
  const initial = await buildHome(serverIndex);

  // NAV (top)
  let navMsg = cfg.ui.navId ? await channel.messages.fetch(cfg.ui.navId).catch(()=>null) : null;
  if (!navMsg) {
    navMsg = await channel.send({ content: "", embeds: [], components: initial.nav });
    upsertEnvForServer(cfg.n, "UI_NAV_MESSAGE_ID", navMsg.id);
    cfg.ui.navId = navMsg.id;
    try { await navMsg.pin(); } catch {}
  } else {
    await navMsg.edit({ content: "", embeds: [], components: initial.nav });
  }

  // CONTENT (bottom)
  let contentMsg = cfg.ui.contentId ? await channel.messages.fetch(cfg.ui.contentId).catch(()=>null) : null;
  if (!contentMsg) {
    contentMsg = await channel.send({ embeds: initial.embeds, components: initial.pager });
    upsertEnvForServer(cfg.n, "UI_CONTENT_MESSAGE_ID", contentMsg.id);
    cfg.ui.contentId = contentMsg.id;
  } else {
    await contentMsg.edit({ embeds: initial.embeds, components: initial.pager, files: [] });
  }
  
}

async function startUiInactivitySession(uiCollector,serverIndex,cfg, channel) {
  // Stop an old one if it exists
  if (uiCollector) {
    try { uiCollector.stop('restart'); } catch {}
    uiCollector = null;
  }

  // Only collect our UI buttons in the target channel + for our 2 UI messages
  uiCollector = channel.createMessageComponentCollector({
    idle: INACTIVITY_MS,
    filter: (i) =>
      i.customId?.startsWith('ui:') &&
      (i.message?.id === cfg.ui.contentId || i.message?.id === cfg.ui.navId)
  });

  uiCollector.on('end', async (_collected, reason) => {
	  if (reason === 'idle') {
		try {
		  // Auto-refresh Home on idle, even if already on Home
		  const payload = await buildView(serverIndex, { view: VIEWS.HOME, page: 0 });

		  if (payload?.hadError) {
			console.warn("[ui] idle refresh: aborting edit due to upstream error");
		  } else {
			// Update toolbar + content
			const [navMsg, contentMsg] = await Promise.all([
			  channel.messages.fetch(cfg.ui.navId),
			  channel.messages.fetch(cfg.ui.contentId),
			]);

			await Promise.all([
			  navMsg.edit({ content: "", embeds: [], components: payload.nav }),
			  contentMsg.edit({ embeds: payload.embeds, components: payload.pager }),
			]);
		  }
		} catch (e) {
		  console.error("[ui] idle refresh failed:", e);
		} finally {
		  // Restart the idle watcher
		  startUiInactivitySession(uiCollector, serverIndex, cfg, channel);
		}
	  }
	});
}

async function buildView(serverIndex, { view, page, param, weaponsPage }) {
  
  if (view === VIEWS.HOME) {
    return await buildHome(serverIndex);
  }
  if (view === VIEWS.LADDER) {
    return await buildLadder(serverIndex, page);
  }
  if (view === VIEWS.WEAPONS) {
    return await buildWeapons(serverIndex, page);
  }
  if (view === VIEWS.WEAPON_PLAYERS) {
    return await buildWeaponPlayers(serverIndex, param, page, weaponsPage ?? 0);
  }
  if (view === VIEWS.MAPS) {
    return await buildMaps(serverIndex, page);
  }
  if (view === VIEWS.MAPS_PLAYERS) {
    return await buildMapPlayers(serverIndex, param, page, weaponsPage ?? 0);
  }
  if(view === VIEWS.AWARDS) {
	return param ? await buildAward(serverIndex, awards.find(a => a.name === param) || awards[0], page, weaponsPage ?? 0) : await buildAwards(serverIndex, page);
  }
}
//String Select processing here

// -------------------------------------------------------------------------------------
// Handlers
// -------------------------------------------------------------------------------------
async function handleSlashCommand(i) {
  console.log(`[slash] ${i.commandName} in #${i.channel?.id || "?"}`);

  try {
    if (i.commandName === "xlr-servers") {
      const lines = SERVER_CONFIGS.map((c, idx) => {
        const chan = c.channelId ? `#${c.channelId}` : "(no channel)";
        return `**${idx + 1}. ${c.name}** — /connect ${c.rcon.ip}:${c.rcon.port}`;
      });
      await i.reply({ ephemeral: true, content: lines.join("\n") || "No servers configured." });
      return;
    }

    const serverIndex = resolveServerIndexFromInteraction(i);

    if (i.commandName === "xlr-top") {
      await i.deferReply();

      const count  = i.options.getInteger("count") ?? 0;
      const weapon = i.options.getString("weapon");
      const map    = i.options.getString("map");
      const sort   = i.options.getString("sort") || "skill";

      if (weapon) {
        const limit = count && count > 0 ? Math.min(count, 10) : 10;
        const rows = await getPlayerWeaponSlice(serverIndex, weapon, 0, limit);
		const rows2 = await Promise.all(
		  rows.map(async (r) => ({ ...r, name: (await displayName(r, r.name, true)) || r.name }))
		);
        const weap = (rows && rows[0]?.matched_label) || weapon;
        const emoji = resolveEmoji(weap);
        const title = `Top Players by Weapon: ${emoji ? `${emoji} ${weap}` : weap}`;
        const embeds = formatTopEmbed(rows2, title, { thumbnail: DEFAULT_THUMB, offset: 0 });
		const embedArr = Array.isArray(embeds) ? embeds : [embeds];
		const files = [];
		  for (const [i,e] of embedArr.entries()){
			  e.setFooter({ text: blank });
			  // Pull saved banner options (default to 0 if not set)
			  const clientId = rows2[i].client_id;
			  const [pc] = await runQueryOn(
				serverIndex,
				queries.playerCoreAndBannerById,
				[clientId]
			  );
			  const bg = Number(pc?.background ?? 0) || 0;
			  const em = Number(pc?.emblem ?? 0) || 0;
			  const cs = Number(pc?.callsign ?? 0) || 0;

			  // Generate the banner
			  const { buffer, filename } = await generateBanner({
				background: bg,
				emblem: em,
				callsign: cs,
				playerName: pc.name,              
				kills: Number(pc.kills) || 0,
				deaths: Number(pc.deaths) || 0,
				skill: Number(pc.skill) || 0
			  });
			  
			  const file = new AttachmentBuilder(buffer, { name: filename });

			  e.setImage(`attachment://${filename}`);

			  files.push(file);
		  }
		
        await i.editReply({ embeds: embedArr, components: [], files: files });
        return;
      }

      if (map) {
        const limit = count && count > 0 ? Math.min(count, 10) : 10;
        const { sql, params } = queries.ui_playerMapsSlice(map, limit, 0);
        const rows = await runQueryOn(serverIndex, sql, params);
		const rows2 = await Promise.all(
		  rows.map(async (r) => ({ ...r, name: (await displayName(r, r.name, true)) || r.name }))
		);
        const thumbUrl = (await getMapImageUrl((rows2 && rows2[0]?.matched_label) || map)) || DEFAULT_THUMB;
        const embeds = formatTopEmbed(rows2, `Top Players by Map: ${map}`, { thumbnail: thumbUrl, offset: 0 });
		const embedArr = Array.isArray(embeds) ? embeds : [embeds];
		const files = [];
		  for (const [i,e] of embedArr.entries()){
			  e.setFooter({ text: blank });
			  // Pull saved banner options (default to 0 if not set)
			  const clientId = rows2[i].client_id;
			  const [pc] = await runQueryOn(
				serverIndex,
				queries.playerCoreAndBannerById,
				[clientId]
			  );
			  const bg = Number(pc?.background ?? 0) || 0;
			  const em = Number(pc?.emblem ?? 0) || 0;
			  const cs = Number(pc?.callsign ?? 0) || 0;

			  // Generate the banner
			  const { buffer, filename } = await generateBanner({
				background: bg,
				emblem: em,
				callsign: cs,
				playerName: pc.name,              
				kills: Number(pc.kills) || 0,
				deaths: Number(pc.deaths) || 0,
				skill: Number(pc.skill) || 0
			  });
			  
			  const file = new AttachmentBuilder(buffer, { name: filename });

			  e.setImage(`attachment://${filename}`);

			  files.push(file);
		  }
		
        await i.editReply({ embeds: embedArr, components: [], files: files });
        return;
      }

      const limit = count && count > 0 ? Math.min(count, 10) : 10;
      const { sql, params } = queries.topDynamic({ limit, sort });
      const rows = await runQueryOn(serverIndex, sql, params);
	  const rows2 = await Promise.all(
		  rows.map(async (r) => ({ ...r, name: (await displayName(r, r.name, true)) || r.name }))
		);

      const embeds = formatTopEmbed(rows2, `Top by ${sort}`, { thumbnail: DEFAULT_THUMB, offset: 0 });
      const embedArr = Array.isArray(embeds) ? embeds : [embeds];
		const files = [];
		  for (const [i,e] of embedArr.entries()){
			  e.setFooter({ text: blank });
			  // Pull saved banner options (default to 0 if not set)
			  const clientId = rows2[i].client_id;
			  const [pc] = await runQueryOn(
				serverIndex,
				queries.playerCoreAndBannerById,
				[clientId]
			  );
			  const bg = Number(pc?.background ?? 0) || 0;
			  const em = Number(pc?.emblem ?? 0) || 0;
			  const cs = Number(pc?.callsign ?? 0) || 0;

			  // Generate the banner
			  const { buffer, filename } = await generateBanner({
				background: bg,
				emblem: em,
				callsign: cs,
				playerName: pc.name,              
				kills: Number(pc.kills) || 0,
				deaths: Number(pc.deaths) || 0,
				skill: Number(pc.skill) || 0
			  });
			  
			  const file = new AttachmentBuilder(buffer, { name: filename });

			  e.setImage(`attachment://${filename}`);

			  files.push(file);
		  }
		
        await i.editReply({ embeds: embedArr, components: [], files: files });
      return;
    }

    if (i.commandName === "xlr-player") {
      await i.deferReply();
      const name = i.options.getString("name", true);
      const weaponOpt = i.options.getString("weapon");
      const mapOpt = i.options.getString("map");
      const vsName = i.options.getString("vs");
	  const awardOpt = i.options.getString("award");
	  
	  let aw;

      const matches = await runQueryOn(serverIndex, queries.findPlayer, [`%${name}%`, `%${name}%`]);
      if (!matches.length) return i.editReply(`No player found matching **${name}**.`);
      const clientId = matches[0].client_id;

	  if (awardOpt) {
		const aw = awardOpt === "-1" ? false : awards[parseInt(awardOpt)];
	  
		if(aw) {
		  // Player rank + metric(s)
		  const { sql, params } = queries.awardRank(parseInt(awardOpt), clientId);
		  const [rankRow] = await runQueryOn(serverIndex, sql, params);
		  const playerName = (await displayName({ discord_id: rankRow?.discord_id }, rankRow?.name, true)) || (rankRow?.name ?? name);

		  const emote = resolveEmoji(aw.emoji) ?? "";

		  const head = new EmbedBuilder()
			.setColor(0x32d296)
			.setTitle(`${emote} ${aw.name} — ${playerName}`)
			.setDescription(rankRow?.rank ? `Current place: **#${rankRow.rank}**` : "_No placement yet_")
			.setFooter({ text: "XLRStats • B3" });

		  if (rankRow) {
			for (const p of (aw.properties || [])) {
			  if (Object.prototype.hasOwnProperty.call(rankRow, p.prop)) {
				head.addFields({ name: p.name, value: String(rankRow[p.prop]), inline: true });
			  }
			}
		  }
		  
		  // Pull saved banner options (default to 0 if not set)
		  const [pc] = await runQueryOn(
			serverIndex,
			queries.playerCoreAndBannerById,
			[clientId]
		  );
		  const bg = Number(pc?.background ?? 0) || 0;
		  const em = Number(pc?.emblem ?? 0) || 0;
		  const cs = Number(pc?.callsign ?? 0) || 0;

		  // Generate the banner
		  const { buffer, filename } = await generateBanner({
			background: bg,
			emblem: em,
			callsign: cs,
			playerName: pc.name,              
			kills: Number(pc.kills) || 0,
			deaths: Number(pc.deaths) || 0,
			skill: Number(pc.skill) || 0
		  });
		  
		  const file = new AttachmentBuilder(buffer, { name: filename });

		  head.setImage(`attachment://${filename}`);

		  const files = [file];
		  
		  const embeds = [head];

		  await i.editReply({ embeds, components: [], files});
		  return;
		} else { 			
		  // Compute ranks across all awards, pick best 10
		  const ranks = await Promise.all(awards.map(async (aw,i) => {
			const { sql, params } = queries.awardRank(i, clientId);
			const [row] = await runQueryOn(serverIndex, sql, params);
			return row ? { key: aw.key, name: aw.name, emoji: aw.emoji, properties: aw.properties, rank: row.rank } : null;
		  }));
		  const top10 = ranks.filter(Boolean).sort((a,b) => a.rank - b.rank);
		  const titleName = (await displayName({ discord_id: matches[0]?.discord_id }, matches[0]?.name, true)) || matches[0]?.name;

		  const emb = new EmbedBuilder()
			.setColor(0x32d296)
			.setTitle(`🏆 Best Award Placements — ${titleName}`)
			.setFooter({ text: "XLRStats • B3" });

		  if (!top10.length) {
			emb.setDescription("_No placements yet_");
		  } else {
			const lines = top10.map(r => `${resolveEmoji(r.emoji) || ""} **${r.name}** — #${r.rank}`);
			emb.setDescription(lines.join("\n"));
		  }
		  
		  // Pull saved banner options (default to 0 if not set)
		  const [pc] = await runQueryOn(
			serverIndex,
			queries.playerCoreAndBannerById,
			[clientId]
		  );
		  const bg = Number(pc?.background ?? 0) || 0;
		  const em = Number(pc?.emblem ?? 0) || 0;
		  const cs = Number(pc?.callsign ?? 0) || 0;

		  // Generate the banner
		  const { buffer, filename } = await generateBanner({
			background: bg,
			emblem: em,
			callsign: cs,
			playerName: pc.name,              
			kills: Number(pc.kills) || 0,
			deaths: Number(pc.deaths) || 0,
			skill: Number(pc.skill) || 0
		  });
		  
		  const file = new AttachmentBuilder(buffer, { name: filename });

		  emb.setImage(`attachment://${filename}`);

		  const files = [file];
		  
		  await i.editReply({ embeds: [emb], components: [], files });
		  return;
			
		}
		
	  }

      if (weaponOpt) {
        const idOrNeg1 = /^\d+$/.test(weaponOpt) ? Number(weaponOpt) : -1;
        const { sql, params } = queries.playerWeaponCard;
        const rows = await runQueryOn(serverIndex, sql, [ `%${weaponOpt}%`, idOrNeg1, clientId ]);
        if (!rows.length) return i.editReply(`No weapon stats found for **${matches[0].name}** matching \`${weaponOpt}\`.`);
        const rows2 = await Promise.all(
		  rows.map(async (r) => ({ ...r, name: (await displayName(r, r.name, true)) || r.name }))
		);
		const embed = formatPlayerWeaponEmbed(rows2[0]);
		
		// Pull saved banner options (default to 0 if not set)
		  const [pc] = await runQueryOn(
			serverIndex,
			queries.playerCoreAndBannerById,
			[clientId]
		  );
		  const bg = Number(pc?.background ?? 0) || 0;
		  const em = Number(pc?.emblem ?? 0) || 0;
		  const cs = Number(pc?.callsign ?? 0) || 0;

		  // Generate the banner
		  const { buffer, filename } = await generateBanner({
			background: bg,
			emblem: em,
			callsign: cs,
			playerName: pc.name,              
			kills: Number(pc.kills) || 0,
			deaths: Number(pc.deaths) || 0,
			skill: Number(pc.skill) || 0
		  });
		  
		  const file = new AttachmentBuilder(buffer, { name: filename });

		  embed.setImage(`attachment://${filename}`);

		  const files = [file];
		
        return i.editReply({ embeds: [embed], components: [], files });
      }

      if (mapOpt) {
        const idOrNeg1 = /^\d+$/.test(mapOpt) ? Number(mapOpt) : -1;
        const rows = await runQueryOn(serverIndex, queries.playerMapCard, [ `%${mapOpt}%`, idOrNeg1, clientId ]);
        if (!rows.length) return i.editReply(`No map stats found for **${matches[0].name}** matching \`${mapOpt}\`.`);
        const rows2 = await Promise.all(
		  rows.map(async (r) => ({ ...r, name: (await displayName(r, r.name, true)) || r.name }))
		);
		let thumbUrl = DEFAULT_THUMB;
        thumbUrl = (await getMapImageUrl(rows2[0].map)) || DEFAULT_THUMB;
        const embed = formatPlayerMapEmbed(rows2[0], null, { thumbnail: thumbUrl });
		
		// Pull saved banner options (default to 0 if not set)
		  const [pc] = await runQueryOn(
			serverIndex,
			queries.playerCoreAndBannerById,
			[clientId]
		  );
		  const bg = Number(pc?.background ?? 0) || 0;
		  const em = Number(pc?.emblem ?? 0) || 0;
		  const cs = Number(pc?.callsign ?? 0) || 0;

		  // Generate the banner
		  const { buffer, filename } = await generateBanner({
			background: bg,
			emblem: em,
			callsign: cs,
			playerName: pc.name,              
			kills: Number(pc.kills) || 0,
			deaths: Number(pc.deaths) || 0,
			skill: Number(pc.skill) || 0
		  });
		  
		  const file = new AttachmentBuilder(buffer, { name: filename });

		  embed.setImage(`attachment://${filename}`);

		  const files = [file];
		
		  return i.editReply({ embeds: [embed], components: [], files });
      }

      if (vsName) {
        const opp = await runQueryOn(serverIndex, queries.findPlayer, [`%${vsName}%`, `%${vsName}%`]);
        if (!opp.length) return i.editReply(`No opponent found matching **${vsName}**.`);
        const opponentId = opp[0].client_id;
        if (opponentId === clientId) return i.editReply(`Pick a different opponent than the player.`);
        const rows = await runQueryOn(serverIndex, queries.playerVsCard, [
          opponentId,
          clientId, opponentId,
          opponentId, clientId,
          clientId
        ]);
        if (!rows.length) return i.editReply(`No opponent stats found between **${matches[0].name}** and **${opp[0].name}**.`);
        const rows2 = await Promise.all(
		  rows.map(async (r) => ({ ...r, player_name: (await displayName(r, r.player_name, true)) || r.name, opponent_name: (await displayName(r, r.opponent_name, true)) || r.name }))
		);
		const embed = formatPlayerVsEmbed(rows2[0], { thumbnail: DEFAULT_THUMB });
		
		// Pull saved banner options (default to 0 if not set)
		  const [pc] = await runQueryOn(
			serverIndex,
			queries.playerCoreAndBannerById,
			[clientId]
		  );
		  const bg = Number(pc?.background ?? 0) || 0;
		  const em = Number(pc?.emblem ?? 0) || 0;
		  const cs = Number(pc?.callsign ?? 0) || 0;

		  // Generate the banner
		  const { buffer, filename } = await generateBanner({
			background: bg,
			emblem: em,
			callsign: cs,
			playerName: pc.name,              
			kills: Number(pc.kills) || 0,
			deaths: Number(pc.deaths) || 0,
			skill: Number(pc.skill) || 0
		  });
		  
		  const file = new AttachmentBuilder(buffer, { name: filename });

		  embed.setImage(`attachment://${filename}`);

		  const files = [file];
		
        return i.editReply({ embeds: [embed], components: [], files });
      }

      const details = await runQueryOn(serverIndex, queries.playerCard, [clientId, clientId, clientId]);
      if (!details.length) return i.editReply(`No stats on this server for **${matches[0].name}**.`);
	  const rows2 = await Promise.all(
		  details.map(async (r) => ({ ...r, name: (await displayName(r, r.name, true)) || r.name }))
		);
      const embed = formatPlayerEmbed(rows2[0]);
	  
	  // Pull saved banner options (default to 0 if not set)
	  const [pc] = await runQueryOn(
		serverIndex,
		queries.playerCoreAndBannerById,
		[clientId]
	  );
	  const bg = Number(pc?.background ?? 0) || 0;
	  const em = Number(pc?.emblem ?? 0) || 0;
	  const cs = Number(pc?.callsign ?? 0) || 0;

	  // Generate the banner
	  const { buffer, filename } = await generateBanner({
		background: bg,
		emblem: em,
		callsign: cs,
		playerName: pc?.name,              
		kills: Number(pc?.kills) || 0,
		deaths: Number(pc?.deaths) || 0,
		skill: Number(pc?.skill) || 0
	  });
	  
	  const file = new AttachmentBuilder(buffer, { name: filename });

	  embed.setImage(`attachment://${filename}`);

	  const files = [file];

      return i.editReply({ embeds: [embed], components: [], files });
    }

    if (i.commandName === "xlr-lastseen") {
      await i.deferReply();
      const count = i.options.getInteger("count") ?? 10;
      const rows = await runQueryOn(serverIndex, queries.lastSeen, [count]);
	  const rows2 = await Promise.all(
		  rows.map(async (r) => ({ ...r, name: (await displayName(r, r.name, true)) || r.name }))
		);
      const embed = formatLastSeenEmbed(rows2, { thumbnail: DEFAULT_THUMB });
      await i.editReply({ embeds: [embed] });
      return;
    }
	
	if (i.commandName === "xlr-register") {
      const guid = i.options.getString("guid", true).trim();
      const serverIndex = resolveServerIndexFromInteraction(i);
      try {
        // Look up client by GUID first for a friendly error if not found
        const rows = await runQueryOn(serverIndex, "SELECT id FROM clients WHERE guid = ? LIMIT 1", [guid]);
        if (!rows.length) {
          await i.reply({ ephemeral: true, content: `No client found with GUID **${guid}** on server ${serverIndex + 1}.` });
          return;
        }
        const clientId = rows[0].id;
        await runQueryOn(serverIndex, "UPDATE clients SET discord_id = ? WHERE guid = ?", [i.user.id, guid]);
        await i.reply({ ephemeral: true, content: `Linked <@${i.user.id}> to GUID **${guid}** (client #${clientId}) on server ${serverIndex + 1}.` });
      } catch (e) {
        console.error("xlr-register failed:", e);
        await i.reply({ ephemeral: true, content: "Sorry, linking failed. Try again later or contact an admin." });
      }
      return;
    }

     if (i.commandName === "xlr-profile") {
      const serverIndex = resolveServerIndexFromInteraction(i);
      // Look up the invoking user's linked client
      const uid = i.user.id;
      // Prefer most-recently seen client if multiple
      const rows = await runQueryOn(
        serverIndex,
        `SELECT c.id AS client_id
           FROM clients c
      LEFT JOIN aliases a ON a.client_id = c.id
          WHERE c.discord_id = ?
          GROUP BY c.id
          ORDER BY MAX(c.time_edit) DESC, MAX(a.time_edit) DESC
          LIMIT 5`,
        [uid]
      );

      if (!rows.length) {
        await i.reply({
          ephemeral: true,
          content: "You haven’t linked your Discord to a B3 user on this server yet. Use `/xlr-register` to link your GUID."
        });
        return;
      }

      const clientId = rows[0].client_id;

      // DM the profile
      try {
        const dm = await i.user.createDM();

		// Clean up old UI first
		await deleteOldProfileDMs(dm, client);

		const payload = await buildProfileDmPayload(serverIndex, clientId, uid);
		await dm.send(payload);
		await i.reply({ ephemeral: true, content: "I sent your playercard to your DMs. 📬" });

      } catch (e) {
        console.error("[xlr-profile] DM failed:", e);
        await i.reply({ ephemeral: true, content: "I couldn't DM you (are DMs disabled?). Enable DMs and try again." });
      }
      return;
    }


	
  } catch (err) {
    console.error("[slash] error:", err);
    if (i.deferred || i.replied) {
      await i.editReply("Error talking to the stats database.");
    } else {
      await i.reply({ content: "Error talking to the stats database.", ephemeral: true });
    }
  }
}

async function handleUiComponent(i, serverIndex) {
  const cfg = byIndex.get(serverIndex);
  const state = perChannelState.get(cfg.channelId);
  const uiCollector = state?.collectors || null;

  // Buttons
  if (i.isButton()) {
    console.log(`[ui:button] ${i.customId} in #${i.channel?.id || '?'} msg=${i.message?.id || '?'} user=${i.user?.id || '?'}`);
    const parsed = parseCustomId(i.customId);
    if (!parsed) return; // ignore non-UI buttons

    // NAV toolbar button
    if (i.message.id === cfg.ui.navId) {
      const payload = await buildView(serverIndex, parsed);
      const channel = i.channel ?? await i.client.channels.fetch(cfg.channelId);
      const contentMsg = await channel.messages.fetch(cfg.ui.contentId);
	  
      await Promise.all([
        i.update({ content: "", embeds: [], components: payload.nav }),
        contentMsg.edit({ embeds: payload.embeds, components: payload.pager, files: payload.files ?? [] })
      ]);
      if (uiCollector) uiCollector.resetTimer({ idle: INACTIVITY_MS });
      return;
    }

    // CONTENT pager buttons
    if (i.message.id === cfg.ui.contentId) {
      if (parsed.view === VIEWS.WEAPON_PLAYERS) {
        const payload = await buildWeaponPlayers(serverIndex, parsed.param, parsed.page, parsed.weaponsPage ?? 0);
        await i.update({ embeds: payload.embeds, components: payload.pager, files: payload.files });
        if (cfg.ui.navId) {
          const channel = i.channel ?? await i.client.channels.fetch(cfg.channelId);
          const navMsg = await channel.messages.fetch(cfg.ui.navId);
          await navMsg.edit({ content: "", embeds: [], components: payload.nav });
        }
        if (uiCollector) uiCollector.resetTimer({ idle: INACTIVITY_MS });
        return;
      }
      if (parsed.view === VIEWS.MAPS_PLAYERS) {
        const payload = await buildMapPlayers(serverIndex, parsed.param, parsed.page, parsed.weaponsPage ?? 0);
        await i.update({ embeds: payload.embeds, components: payload.pager, files: payload.files });
        if (cfg.ui.navId) {
          const channel = i.channel ?? await i.client.channels.fetch(cfg.channelId);
          const navMsg = await channel.messages.fetch(cfg.ui.navId);
          await navMsg.edit({ content: "", embeds: [], components: payload.nav });
        }
        if (uiCollector) uiCollector.resetTimer({ idle: INACTIVITY_MS });
        return;
      }

      const payload = await buildView(serverIndex, parsed);
      await i.update({ embeds: payload.embeds, components: payload.pager, files: payload.files ?? [] });
      if (cfg.ui.navId) {
        const channel = i.channel ?? await i.client.channels.fetch(cfg.channelId);
        const navMsg = await channel.messages.fetch(cfg.ui.navId);
        await navMsg.edit({ content: "", embeds: [], components: payload.nav });
      }
      if (uiCollector) uiCollector.resetTimer({ idle: INACTIVITY_MS });
      return;
    }
	
/*	if (parsed.view === VIEWS.AWARDS) {
        const payload = await buildView(serverIndex, parsed);
        await i.update({ embeds: payload.embeds, components: payload.pager });
        if (cfg.ui.navId) {
          const channel = i.channel ?? await i.client.channels.fetch(cfg.channelId);
          const navMsg = await channel.messages.fetch(cfg.ui.navId);
          await navMsg.edit({ content: "", embeds: [], components: payload.nav });
        }
        if (uiCollector) uiCollector.resetTimer({ idle: INACTIVITY_MS });
        return;
      } */
  }

  // Select Menus
  if (i.isStringSelectMenu()) {
    console.log(`[ui:select] ${i.customId} -> ${JSON.stringify(i.values)} in #${i.channel?.id || '?'} user=${i.user?.id || '?'}`);
    const [prefix, view, kind, pageStr] = i.customId.split(":");
    if (prefix !== "ui") return;
    const page = Math.max(0, parseInt(pageStr, 10) || 0);

    if (view === "weapons" && kind === "select") {
      const label = i.values[0];
      const payload = await buildWeaponPlayers(serverIndex, label, 0, page);
      const channel = i.channel ?? await i.client.channels.fetch(cfg.channelId);
      const contentMsg = await channel.messages.fetch(cfg.ui.contentId);
      await Promise.all([
        i.update({ content: "", embeds: [], components: payload.nav }),
        contentMsg.edit({ embeds: payload.embeds, components: payload.pager, files: payload.files })
      ]);
      if (uiCollector) uiCollector.resetTimer({ idle: INACTIVITY_MS });
      return;
    }

    if (view === "maps" && kind === "select") {
      const label = i.values[0];
      const payload = await buildMapPlayers(serverIndex, label, 0, page);
      const channel = i.channel ?? await i.client.channels.fetch(cfg.channelId);
      const contentMsg = await channel.messages.fetch(cfg.ui.contentId);
      await Promise.all([
        i.update({ content: "", embeds: [], components: payload.nav }),
        contentMsg.edit({ embeds: payload.embeds, components: payload.pager, files: payload.files })
      ]);
      if (uiCollector) uiCollector.resetTimer({ idle: INACTIVITY_MS });
      return;
    }
	
	if (view === "awards" && kind === "select") {
      const selIndex = Number(i.values[0]);
      const globalIndex = page * V_PAGE + selIndex;
      const award = awards[globalIndex];
      const payload = await buildAward(serverIndex, award, 0, page);
      const channel = i.channel ?? await i.client.channels.fetch(cfg.channelId);
      const contentMsg = await channel.messages.fetch(cfg.ui.contentId);
      await Promise.all([
        i.update({ content: "", embeds: [], components: payload.nav }),
        contentMsg.edit({ embeds: payload.embeds, components: payload.pager, files: payload.files })
      ]);
      if (uiCollector) uiCollector.resetTimer({ idle: INACTIVITY_MS });
      return;
    }

    if (view === "ladder" && kind === "select") {
        const clientId = i.values[0];
		const rows = await runQueryOn(serverIndex, queries.playerCard, [clientId, clientId, clientId]);
		const embed = rows.length
		  ? formatPlayerEmbed(rows[0], { thumbnail: DEFAULT_THUMB })
		  : new EmbedBuilder().setColor(0xcc0000).setDescription("No stats for that player.");

		const ladderRows = await getLadderSlice(serverIndex, page * 10, 10);

		// PRE-ENRICH: compute display names for select menu labels
		const ladderRowsWithNames = await Promise.all(
		  ladderRows.map(async (r) => ({
			...r,
			name: (await displayName(r, r.name, true)) || r.name,
		  }))
		);
		
		 // Pull saved banner options (default to 0 if not set)
		 const [pc] = await runQueryOn(
			serverIndex,
			queries.playerCoreAndBannerById,
			[clientId]
		  );
		  const bg = Number(pc?.background ?? 0) || 0;
		  const em = Number(pc?.emblem ?? 0) || 0;
		  const cs = Number(pc?.callsign ?? 0) || 0;

		  // Generate the banner
		  const { buffer, filename } = await generateBanner({
			background: bg,
			emblem: em,
			callsign: cs,
			playerName: pc.name,              
			kills: Number(pc.kills) || 0,
			deaths: Number(pc.deaths) || 0,
			skill: Number(pc.skill) || 0
		  });
		  
		  const file = new AttachmentBuilder(buffer, { name: filename });

		  embed.setImage(`attachment://${filename}`);

		  const files = [file];

		const navComponents = [navRow(VIEWS.LADDER), playerSelectRowForPage(ladderRowsWithNames, page, clientId)];

      const channel   = i.channel ?? await i.client.channels.fetch(cfg.channelId);
      const contentMsg= await channel.messages.fetch(cfg.ui.contentId);
      await Promise.all([
        i.update({ content: "", embeds: [], components: navComponents }),
        contentMsg.edit({ embeds: [embed], components: [], files }),
      ]);
      if (uiCollector) uiCollector.resetTimer({ idle: INACTIVITY_MS });
      return;
    }
  }
}

async function handleProfileComponent(i) {
	
	  // === PROFILE DM: Buttons & Selects & Modal ===
  // Buttons — open modal or show pickers
  if (i.isButton() && i.customId?.startsWith("profile:")) {
    const parts = i.customId.split(":"); // profile:edit:name:si:pid or profile:edit:bg:si:pid:page
    const [, action, sub, siStr, pidStr, pageStr] = parts;
    const si = Number(siStr), pid = Number(pidStr);
    const page = Number(pageStr || 0);

    if (action === "edit" && sub === "name") {
      const modal = new ModalBuilder()
        .setCustomId(PROFILE_IDS.NAME_MODAL(si, pid))
        .setTitle("Set Preferred Name");
      const input = new TextInputBuilder()
        .setCustomId("preferred_name")
        .setLabel("Preferred display name (max 64)")
        .setStyle(TextInputStyle.Short)
        .setMaxLength(64)
        .setRequired(true);
      modal.addComponents(new ActionRowBuilder().addComponents(input));
      await i.showModal(modal);
      return;
    }

    if (action === "edit" && (sub === "bg" || sub === "em" || sub === "cs")) {
      const rows = buildPickerRow(sub === "bg" ? "bg" : sub === "em" ? "em" : "cs", si, pid, page);
      await i.update({ components: rows });
      return;
    }

	if (action === "page") {
	  // id format: profile:page:<kind>:<si>:<pid>:<dir>:<page>
	  const parts = i.customId.split(":");
	  const kind = parts[2];                 // "bg" | "em" | "cs"
	  const si   = Number(parts[3]);         // server index
	  const pid  = Number(parts[4]);         // player id
	  const dir  = parts[5];                 // "prev" | "next"
	  const cur  = Number(parts[6] || 0);    // current page

	  // Clamp target page so we never render an empty select
	  const total   = kind === "bg" ? BACKGROUNDS.length
					 : kind === "em" ? EMBLEMS.length
									  : CALLSIGNS.length;
	  const per     = 25;
	  const maxPage = Math.max(0, Math.ceil(total / per) - 1);

	  const next    = dir === "prev" ? cur - 1 : cur + 1;
	  const clamped = Math.min(maxPage, Math.max(0, next));

	  const rows = buildPickerRow(kind, si, pid, clamped);
	  await i.update({ components: rows });
	  return;
	}


  }

  // Selects — persist choice
  if (i.isStringSelectMenu() && i.customId?.startsWith("profile:pick:")) {
    const [, , kind, siStr, pidStr, pageStr] = i.customId.split(":");
    const si = Number(siStr), pid = Number(pidStr);
    const page = Number(pageStr || 0);
    const picked = Number(i.values[0]); // absolute index from array

    try {
      if (kind === "bg") {
	    await runQueryOn(si, queries.setPlayerCardBackground, [pid, picked]);
	  } else if (kind === "em") {
	    await runQueryOn(si, queries.setPlayerCardEmblem, [pid, picked]);
	  } else if (kind === "cs") {
	    await runQueryOn(si, queries.setPlayerCardCallsign, [pid, picked]);
	  }
      // Rebuild DM with new banner + reset to main buttons row
      const payload = await buildProfileDmPayload(si, pid, i.user.id);
      await i.update(payload);
    } catch (e) {
      console.error("[profile] save failed:", e);
      await i.reply({ content: "Saving failed. Try again.", flags: 64 });
    }
    return;
  }

  // Modal — save preferred name
  if (i.isModalSubmit() && i.customId?.startsWith("profile:name:")) {
    const [, , siStr, pidStr] = i.customId.split(":");
    const si = Number(siStr), pid = Number(pidStr);
    const name = i.fields.getTextInputValue("preferred_name")?.trim()?.slice(0,64) || null;

    try {
      await runQueryOn(si, "UPDATE clients SET preferred_name = ? WHERE id = ?", [name, pid]);
      const payload = await buildProfileDmPayload(si, pid, i.user.id);
      await i.reply(payload);
    } catch (e) {
      console.error("[profile] name save failed:", e);
      await i.reply({ content: "Saving failed. Try again.", flags: 64 });
    }
    return;
  }
	
}

client.on(Events.InteractionCreate, async (i) => {
  try {
	  
	if (i.customId?.startsWith("profile:")) {
		await handleProfileComponent(i);
		return;
	}
	  
    if (i.isChatInputCommand()) {
      await handleSlashCommand(i);
      return;
    }
    const serverIndex = SERVER_CONFIGS.findIndex(c => c.channelId === i.channelId);
    if (serverIndex < 0) return;
    await handleUiComponent(i, serverIndex);
  } catch (e) {
    console.error("Interaction error:", e);
    try {
      if (i.deferred || i.replied) {
        await i.followUp({ content: "Something went wrong.", flags: 64 });
      } else {
        await i.reply({ content: "Something went wrong.", flags: 64 });
      }
    } catch {}
  }
});

// -------------------------------------------------------------------------------------
// Slash command routing
// -------------------------------------------------------------------------------------
function resolveServerIndexFromInteraction(interaction) {
  const arg = interaction.options?.getString("server")?.trim();
  if (!arg) return 0; // default
  const asNum = Number(arg);
  if (Number.isFinite(asNum) && asNum >= 1 && asNum <= SERVER_CONFIGS.length) return asNum - 1;
  const found = byNameLower.get(arg.toLowerCase());
  if (found) return found.i;
  return 0;
}

client.once(Events.ClientReady, async () => {
  console.log(`Logged in as ${client.user.tag}`);
  
  //init emoji resolver
	try {
	  if (!GUILD_ID) {
		console.warn("[emoji] No GUILD_ID set in .env, skipping emoji resolver");
	  } else {
		const guild = await client.guilds.fetch(GUILD_ID).catch(() => null);
		if (!guild) {
		  console.warn(`[emoji] Could not fetch guild ${GUILD_ID}`);
		} else {
		  const emojis = await guild.emojis.fetch();
		  const emojiIndex = new Map();

		  emojis.forEach(e => {
			const key = (e.name || "").toLowerCase();
			const mention = `<${e.animated ? "a" : ""}:${e.name}:${e.id}>`;
			emojiIndex.set(key, mention);
		  });

		  setEmojiResolver((label) => {
			if (!label) return null;
			const k = String(label).replace(/:/g, "").toLowerCase().trim();
			return emojiIndex.get(k) ?? null;
		  });

		  console.log(`[emoji] loaded ${emojiIndex.size} emojis from guild ${guild.name}`);
		}
	  }
	} catch (e) {
	  console.warn("[emoji] init failed:", e);
	}
  
  for (let i = 0; i < SERVER_CONFIGS.length; i++) {
	
    try { await ensureUIForServer(i); } catch (e) { console.error("ensureUIForServer", i, e); }
	try { 
		const cfg = byIndex.get(i);
		const channel = await client.channels.fetch(cfg.channelId).catch(() => null);
		if (channel && channel.type === ChannelType.GuildText) {
			const collector = channel.createMessageComponentCollector();
			perChannelState.set(cfg.channelId, { i, collectors: collector });
			startUiInactivitySession(perChannelState.get(cfg.channelId).collectors, i, cfg, channel);
		}
	} catch (e) {
	  console.warn("[ui] could not start inactivity session:", e);
	}
  }
});

if (process.argv.includes("--register")) {
  register().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
} else {
  client.login(DISCORD_TOKEN);
}