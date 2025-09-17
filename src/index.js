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
  StringSelectMenuBuilder
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
  renderHomeEmbed,
  renderLadderEmbeds,
  renderWeaponsEmbeds,
  renderMapsEmbeds,
  setEmojiResolver,
  resolveEmoji
} from "./format.js";
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

// --- inactivity / auto-home ---
const INACTIVITY_MS = 2 * 60 * 1000; // 2 minutes 

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
async function fetchServerStatus(ip, port) {
  const url = `https://api.cod.pm/getstatus/${ip}/${port}`;
  const res = await axios.get(url);
  return res.data;
}

async function checkUrlFor404(url) {
  try {
    const response = await fetch(url, { method: "HEAD" });
    return response.status === 404;
  } catch {
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
});

const navRow = (active) =>
  new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`ui:${VIEWS.HOME}`).setLabel("Home").setStyle(active==="home"?ButtonStyle.Primary:ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`ui:${VIEWS.LADDER}`).setLabel("Ladder").setStyle(active==="ladder"?ButtonStyle.Primary:ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`ui:${VIEWS.WEAPONS}`).setLabel("Weapons").setStyle(active==="weapons"?ButtonStyle.Primary:ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`ui:${VIEWS.MAPS}`).setLabel("Maps").setStyle(active==="maps"?ButtonStyle.Primary:ButtonStyle.Secondary),
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
    const label = `${prefix} ${String(r.name).slice(0, maxName)}`;
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

async function getLadderSlice(serverIndex, offset=0, limit=10) {
  const { sql, params } = queries.ui_ladderSlice(limit, offset);
  const rows = await runQueryOn(serverIndex, sql, params);
  return rows.map((r, i) => ({ ...r, rank: offset + i + 1 }));
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

async function getPlayerWeaponSlice(serverIndex, weapon, offset=0, limit=10) {
  const { sql, params } = queries.ui_playerWeaponSlice(weapon, limit, offset);
  const rows = await runQueryOn(serverIndex, sql, params);
  return rows.map((r, i) => ({ ...r, rank: offset + i + 1 }));
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
  const totals = await getHomeTotals(serverIndex);
  const status = await fetchServerStatus(cfg.rcon.ip, cfg.rcon.port);
  const embeds = renderHomeEmbed({ totals }, status, TZ, cfg.rcon.ip, cfg.rcon.port);
  return { embeds, nav: [navRow(VIEWS.HOME)], pager: [] };
}

async function buildLadder(serverIndex, page=0) {
  const offset = page * V_PAGE;
  const [rows, total] = await Promise.all([
    getLadderSlice(serverIndex, offset, V_PAGE),
    getLadderCount(serverIndex)
  ]);
  const embeds = renderLadderEmbeds({ rows, page });
  const pager = [pagerRow(VIEWS.LADDER, page, page>0, offset + V_PAGE < total)];
  const embedArr = Array.isArray(embeds) ? embeds : [embeds];
  const footerText = embedArr[embedArr.length - 1].data.footer.text;
  const ZERO_WIDTH = "⠀";
  const padLen = Math.min(Math.floor(footerText.length * 0.65), 2048);
  const blankText = ZERO_WIDTH.repeat(padLen);
  for (const e of embedArr) e.setFooter({ text: blankText });
  embedArr[embedArr.length - 1].setFooter({ text: footerText });
  return { embeds, nav: [navRow(VIEWS.LADDER)], pager };
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
  for (const e of embedArr) e.setFooter({ text: blank });
  embedArr[embedArr.length - 1].setFooter({ text: `${lastFooter} • Weapon page ${playerPage + 1}` });
  const hasNext = offset + pageSize < total;
  const pager   = [pagerRowWithParams(VIEWS.WEAPON_PLAYERS, playerPage, playerPage > 0, hasNext, weap, weaponsPage)];
  const nav = [navRow(VIEWS.WEAPONS), weaponSelectRowForPage(weaponsRows, weaponsPage, weap)];
  return { embeds, nav, pager };
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
  return { embeds, nav, pager };
}

async function buildMapPlayers(serverIndex, mapLabel, playerPage=0, mapsPage=0) {
  const pageSize = 10;
  const offset   = playerPage * pageSize;
  const [rows, total, mapsRows] = await Promise.all([
    (async () => {
      const { sql, params } = queries.ui_playerMapsSlice(mapLabel, pageSize, offset);
      const data = await runQueryOn(serverIndex, sql, params);
      return data.map((r, i) => ({ ...r, rank: offset + i + 1 }));
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
  for (const e of embedArr) e.setFooter({ text: blank });
  embedArr[embedArr.length - 1].setFooter({ text: `${lastFooter} • Map page ${playerPage + 1}` });
  const hasNext = offset + pageSize < total;
  const pager   = [pagerRowWithParams(VIEWS.MAPS_PLAYERS, playerPage, playerPage > 0, hasNext, mapLabel, mapsPage)];
  const nav = [navRow(VIEWS.MAPS), mapSelectRowForPage(mapsRows, mapsPage, mapLabel)];
  return { embeds, nav, pager };
}

// -------------------------------------------------------------------------------------
// Discord wiring — multi UI
// -------------------------------------------------------------------------------------
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] });

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
    .addStringOption(o => o.setName("server").setDescription("Which server to query (name or number)")),
  new SlashCommandBuilder()
    .setName("xlr-lastseen")
    .setDescription("Show recently seen players")
    .addIntegerOption(o => o.setName("count").setDescription("How many (default 10)").setMinValue(1).setMaxValue(25))
    .addStringOption(o => o.setName("server").setDescription("Which server to query (name or number)")),
  new SlashCommandBuilder()
    .setName("xlr-servers")
    .setDescription("List configured servers and their numbers"),
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
    await contentMsg.edit({ embeds: initial.embeds, components: initial.pager });
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
        const payload = await buildView(serverIndex, {view: VIEWS.HOME, page: 0});

        // Update toolbar + content
        const [navMsg, contentMsg] = await Promise.all([
          channel.messages.fetch(cfg.ui.navId),
          channel.messages.fetch(cfg.ui.contentId),
        ]);

        await Promise.all([
          navMsg.edit({ content: "", embeds: [], components: payload.nav }),
          contentMsg.edit({ embeds: payload.embeds, components: payload.pager }),
        ]);
      } catch (e) {
        console.error("[ui] idle refresh failed:", e);
      } finally {
        // Restart the idle watcher
        startUiInactivitySession(uiCollector,serverIndex,cfg,channel);
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
}
//String Select processing here
client.on(Events.InteractionCreate, async (i) => {

  const serverIndex = SERVER_CONFIGS.findIndex(c => c.channelId === i.channelId);
  if (serverIndex < 0) return;
  const cfg = byIndex.get(serverIndex);
  const uiCollector = perChannelState.get(cfg.channelId).collectors;
  
  try { //try catch error handling on button/string select
    if (i.isButton()) { //process nav button or bottom pager clicks
		const parsed = parseCustomId(i.customId);
		if (!parsed) return; //if button click is invalid, return without doing anything
	    const { view, page } = parsed;
		// if NAV toolbar button clicked
		if (i.message.id === cfg.ui.navId) {
		  const parsed = parseCustomId(i.customId);
		  if (!parsed) return;
		  const { view, page } = parsed;
		  const payload = await buildView(serverIndex, parsed);//build payload from parsed data from button
		  const channel = i.channel ?? await i.client.channels.fetch(cfg.channelId);
		  const contentMsg = await channel.messages.fetch(cfg.ui.contentId);
		  // Ack immediately by updating the nav message, and in parallel edit the content message
		  await Promise.all([
			i.update({ content: "", embeds: [], components: payload.nav }), // ACK happens here
			contentMsg.edit({ embeds: payload.embeds, components: payload.pager }),
		  ]);
		  // reset inactivity timer if present
		  if (uiCollector) uiCollector.resetTimer({ idle: INACTIVITY_MS });
		  return;
		} else //if pager buttons are clicked
		if (i.message.id === cfg.ui.contentId) {
			//if the weapon pager is clicked
			if (parsed.view === VIEWS.WEAPON_PLAYERS) {
			  const payload = await buildWeaponPlayersView(serverIndex, parsed.param, parsed.page, parsed.weaponsPage ?? 0);
			  await i.update({ embeds: payload.embeds, components: payload.pager });
			  // keep toolbar synced so the select stays on the same 10 weapons
			  if (cfg.ui.navId) {
				const channel = i.channel ?? await i.client.channels.fetch(cfg.channelId);
				const navMsg = await channel.messages.fetch(cfg.ui.navId);
				await navMsg.edit({ content: "", embeds: [], components: payload.nav });
			  }
			  if (uiCollector) uiCollector.resetTimer({ idle: INACTIVITY_MS });
			  return;
			} else //if map pager is clicked
			if (parsed.view === VIEWS.MAPS_PLAYERS) {
			  const payload = await buildMapPlayersView(serverIndex, parsed.param, parsed.page, parsed.weaponsPage ?? 0);
			  await i.update({ embeds: payload.embeds, components: payload.pager });
			  // keep toolbar synced so the select stays on the same 10 maps
			  if (cfg.ui.navId) {
				const channel = i.channel ?? await i.client.channels.fetch(cfg.channelId);
				const navMsg = await channel.messages.fetch(cfg.ui.navId);
				await navMsg.edit({ content: "", embeds: [], components: payload.nav });
			  }
			  if (uiCollector) uiCollector.resetTimer({ idle: INACTIVITY_MS });
			  return;
			} else { //if pager on another page (eg ladder or home)
				const payload = await buildView(serverIndex, parsed);
				await i.update({ embeds: payload.embeds, components: payload.pager });

				// keep toolbar highlight synced (optional, cheap)
				if (cfg.ui.navId) {
				  const channel = i.channel ?? await i.client.channels.fetch(cfg.channelId);
				  const navMsg = await channel.messages.fetch(cfg.ui.navId);
				  await navMsg.edit({ content: "", embeds: [], components: payload.nav });
				}
				// reset inactivity timer
				if (uiCollector) uiCollector.resetTimer({ idle: INACTIVITY_MS });
				return;
			}
		}
	} else
	  if (i.isStringSelectMenu()) {
		// Handle selects for weapons/maps/ladder player selection
		const [prefix, view, kind, pageStr] = i.customId.split(":");
		if (prefix !== "ui") return;
	   // await i.deferUpdate();
	   // const serverIndex = SERVER_CONFIGS.findIndex(c => c.channelId === i.channelId);
	   // if (serverIndex < 0) return;
		const page = Math.max(0, parseInt(pageStr, 10) || 0);

		if (view === "weapons" && kind === "select") {
		  const label = i.values[0];
		  const payload = await buildWeaponPlayers(serverIndex, label, 0, page);
		  // Update the NAV (tabs + same-page select) and CONTENT (embeds + pager)
		  const channel = i.channel ?? await i.client.channels.fetch(cfg.channelId);
		  const [navMsg, contentMsg] = await Promise.all([
			channel.messages.fetch(cfg.ui.navId),
			channel.messages.fetch(cfg.ui.contentId)
		  ]);
		  await Promise.all([
			i.update({ content: "", embeds: [], components: payload.nav }),
			contentMsg.edit({ embeds: payload.embeds, components: payload.pager })
		  ]);
		  if (uiCollector) uiCollector.resetTimer({ idle: INACTIVITY_MS });
		  return;
		 // const navMsg = await i.channel.messages.fetch(cfg.ui.navId);
		 // const contentMsg = await i.channel.messages.fetch(cfg.ui.contentId);
		 // await navMsg.edit({ content: "", embeds: [], components: payload.nav });
		 // await contentMsg.edit({ embeds: payload.embeds, components: payload.pager });
		 // return;
		}

		if (view === "maps" && kind === "select") {
		  const label = i.values[0];
		  const payload = await buildMapPlayers(serverIndex, label, 0, page);
		  // Update the NAV (tabs + same-page select) and CONTENT (embeds + pager)
		  const channel = i.channel ?? await i.client.channels.fetch(cfg.channelId);
		  const [navMsg, contentMsg] = await Promise.all([
			channel.messages.fetch(cfg.ui.navId),
			channel.messages.fetch(cfg.ui.contentId)
		  ]);
		  await Promise.all([
			i.update({ content: "", embeds: [], components: payload.nav }),
			contentMsg.edit({ embeds: payload.embeds, components: payload.pager })
		  ]);
		  if (uiCollector) uiCollector.resetTimer({ idle: INACTIVITY_MS });
		  return;
		}

		if (view === "ladder" && kind === "select") {
		  const clientId = i.values[0];
		  // Show player card for that clientId
		  const rows = await runQueryOn(serverIndex, queries.playerCard, [clientId, clientId, clientId]);
		  const embed = rows.length ? formatPlayerEmbed(rows[0], { thumbnail: DEFAULT_THUMB }) : new EmbedBuilder().setColor(0xcc0000).setDescription("No stats for that player.");
		  // Update the NAV (tabs + same-page select) and CONTENT (embeds + pager)
		  const channel = i.channel ?? await i.client.channels.fetch(cfg.channelId);
		  const [navMsg, contentMsg] = await Promise.all([
			channel.messages.fetch(cfg.ui.navId),
			channel.messages.fetch(cfg.ui.contentId)
		  ]);
		  await Promise.all([
			i.update({ content: "", embeds: [], components: payload.nav }),
			contentMsg.edit({ embeds: payload.embeds, components: payload.pager })
		  ]);
		  if (uiCollector) uiCollector.resetTimer({ idle: INACTIVITY_MS });
		  return;
		}
		return;
	  }
  } catch (e) {
	  console.error("[ui] button error", e);
	  try {
		if (i.deferred || i.replied) {
		  await i.followUp({ content: "Something went wrong.", flags: 64 });
		} else {
		  await i.reply({ content: "Something went wrong.", flags: 64 });
		}
	  } catch (e2) {
		// Interaction might already be invalid/expired; swallow to avoid crashing
		console.warn("[ui] failed sending error follow-up:", e2?.code || e2);
	  }
  }

  if (!i.isChatInputCommand()) return;

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

      // If weapon OR map is provided, we show that specific list (limited by count or page size)
      if (weapon) {
        const limit = count && count > 0 ? Math.min(count, 10) : 10;
        const rows = await getPlayerWeaponSlice(serverIndex, weapon, 0, limit);
        const weap = (rows && rows[0]?.matched_label) || weapon;
        const emoji = resolveEmoji(weap);
        const title = `Top Players by Weapon: ${emoji ? `${emoji} ${weap}` : weap}`;
        const embeds = formatTopEmbed(rows, title, { thumbnail: DEFAULT_THUMB, offset: 0 });
        await i.editReply({ embeds: Array.isArray(embeds) ? embeds : [embeds] });
        return;
      }

      if (map) {
        const limit = count && count > 0 ? Math.min(count, 10) : 10;
        const { sql, params } = queries.ui_playerMapsSlice(map, limit, 0);
        const rows = await runQueryOn(serverIndex, sql, params);
        const thumbUrl = (await getMapImageUrl((rows && rows[0]?.matched_label) || map)) || DEFAULT_THUMB;
        const embeds = formatTopEmbed(rows, `Top Players by Map: ${map}`, { thumbnail: thumbUrl, offset: 0 });
        await i.editReply({ embeds: Array.isArray(embeds) ? embeds : [embeds] });
        return;
      }

      // Global top by sort (limit)
      const limit = count && count > 0 ? Math.min(count, 10) : 10;
      const { sql, params } = queries.topDynamic({ limit, sort });
      const rows = await runQueryOn(serverIndex, sql, params);
      const embeds = formatTopEmbed(rows, `Top by ${sort}`, { thumbnail: DEFAULT_THUMB, offset: 0 });
      await i.editReply({ embeds: Array.isArray(embeds) ? embeds : [embeds] });
      return;
    }

    if (i.commandName === "xlr-player") {
      await i.deferReply();
      const name = i.options.getString("name", true);
      const weaponOpt = i.options.getString("weapon");
      const mapOpt = i.options.getString("map");
      const vsName = i.options.getString("vs");

      const matches = await runQueryOn(serverIndex, queries.findPlayer, [`%${name}%`, `%${name}%`]);
      if (!matches.length) return i.editReply(`No player found matching **${name}**.`);
      const clientId = matches[0].client_id;

      if (weaponOpt) {
        const idOrNeg1 = /^\d+$/.test(weaponOpt) ? Number(weaponOpt) : -1;
        const { sql, params } = queries.playerWeaponCard;
        const rows = await runQueryOn(serverIndex, sql, [ `%${weaponOpt}%`, idOrNeg1, clientId ]);
        if (!rows.length) return i.editReply(`No weapon stats found for **${matches[0].name}** matching \`${weaponOpt}\`.`);
        const embed = formatPlayerWeaponEmbed(rows[0], { thumbnail: DEFAULT_THUMB });
        return i.editReply({ embeds: [embed] });
      }

      if (mapOpt) {
        const idOrNeg1 = /^\d+$/.test(mapOpt) ? Number(mapOpt) : -1;
        const rows = await runQueryOn(serverIndex, queries.playerMapCard, [ `%${mapOpt}%`, idOrNeg1, clientId ]);
        if (!rows.length) return i.editReply(`No map stats found for **${matches[0].name}** matching \`${mapOpt}\`.`);
        let thumbUrl = DEFAULT_THUMB;
        thumbUrl = (await getMapImageUrl(rows[0].map)) || DEFAULT_THUMB;
        const embed = formatPlayerMapEmbed(rows[0], { thumbnail: thumbUrl });
        return i.editReply({ embeds: [embed] });
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
        const embed = formatPlayerVsEmbed(rows[0], { thumbnail: DEFAULT_THUMB });
        return i.editReply({ embeds: [embed] });
      }

      const details = await runQueryOn(serverIndex, queries.playerCard, [clientId, clientId, clientId]);
      if (!details.length) return i.editReply(`No stats on this server for **${matches[0].name}**.`);
      const embed = formatPlayerEmbed(details[0], { thumbnail: DEFAULT_THUMB });
      return i.editReply({ embeds: [embed] });
    }

    if (i.commandName === "xlr-lastseen") {
      await i.deferReply();
      const count = i.options.getInteger("count") ?? 10;
      const rows = await runQueryOn(serverIndex, queries.lastSeen, [count]);
      const embed = formatLastSeenEmbed(rows, { thumbnail: DEFAULT_THUMB });
      await i.editReply({ embeds: [embed] });
      return;
    }
  } catch (err) {
    console.error(err);
    if (i.deferred || i.replied) {
      await i.editReply("Error talking to the stats database.");
    } else {
      await i.reply({ content: "Error talking to the stats database.", ephemeral: true });
    }
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