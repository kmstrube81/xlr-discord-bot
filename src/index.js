import "dotenv/config";
import { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, Events, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, StringSelectMenuBuilder } from "discord.js";
import mysql from "mysql2/promise";
import { queries } from "./queries.js";
import { formatPlayerEmbed, formatTopEmbed, formatLastSeenEmbed, formatPlayerWeaponEmbed, formatPlayerVsEmbed, formatPlayerMapEmbed, renderHomeEmbed, renderLadderEmbeds, renderWeaponsEmbeds, renderMapsEmbeds, setEmojiResolver, resolveEmoji } from "./format.js";
import axios from "axios";

// add near your other imports
import path from "node:path";
import fs from "node:fs";

// --- new env-driven UI config + tiny .env updater ---
const CHANNEL_ID = process.env.CHANNEL_ID?.trim() || "";
let UI_NAV_MESSAGE_ID     = process.env.UI_NAV_MESSAGE_ID?.trim() || "";
let UI_CONTENT_MESSAGE_ID = process.env.UI_CONTENT_MESSAGE_ID?.trim() || "";

// --- inactivity / auto-home ---
const INACTIVITY_MS = 2 * 60 * 1000; // 2 minutes
let uiCollector = null;              // channel-level collector for our UI buttons


function upsertEnv(key, value) {
  const ENV_PATH = path.resolve(process.cwd(), ".env");
  const lines = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, "utf8").split(/\r?\n/) : [];
  const idx = lines.findIndex(l => l.startsWith(`${key}=`));
  if (idx >= 0) lines[idx] = `${key}=${value}`;
  else lines.push(`${key}=${value}`);
  fs.writeFileSync(ENV_PATH, lines.join("\n"), "utf8");
  process.env[key] = value;
  if (key === "UI_NAV_MESSAGE_ID") UI_NAV_MESSAGE_ID = value;
  if (key === "UI_CONTENT_MESSAGE_ID") UI_CONTENT_MESSAGE_ID = value;
}


const HEARTBEAT_FILE = "/opt/xlrbot/health/ready";
// Default image if no map or fetch fails — set your own brand image here
const DEFAULT_THUMB = process.env.XLR_DEFAULT_IMAGE
	|| "https://cod.pm/mp_maps/unknown.png";
const {
  DISCORD_TOKEN, APPLICATION_ID, GUILD_ID,
  MYSQL_B3_DB, MYSQL_B3_USER, MYSQL_B3_PASSWORD,
  B3_RCON_IP, B3_RCON_PORT, TZ
} = process.env;

const pool = mysql.createPool({
  host: "db",
  port: Number(3306),
  user: MYSQL_B3_USER,
  password: MYSQL_B3_PASSWORD,
  database: MYSQL_B3_DB,
  connectionLimit: 5
});

const commands = [
 new SlashCommandBuilder()
  .setName("xlr-top")
  .setDescription("Show top players (global, or filtered by weapon OR map)")
  .addIntegerOption(o =>
    o.setName("count")
     .setDescription("How many rows (0 = all, max 10; default 0)")
     .setMinValue(0)
     .setMaxValue(10)
  )
  .addStringOption(o =>
    o.setName("weapon")
     .setDescription("Filter by weapon (partial name or exact numeric id)")
  )
  .addStringOption(o =>
    o.setName("map")
     .setDescription("Filter by map (partial name or exact numeric id)")
  )
  .addStringOption(o =>
    o.setName("sort")
     .setDescription("Sort by")
     .addChoices(
       { name: "skill", value: "skill" },
       { name: "kills", value: "kills" },
       { name: "deaths", value: "deaths" },
       { name: "ratio", value: "ratio" },
       { name: "suicides", value: "suicides" },
       { name: "assists", value: "assists" },
       { name: "rounds", value: "rounds" }
     )
  ),
  new SlashCommandBuilder()
    .setName("xlr-player")
    .setDescription("Lookup a player by name (optionally filter by weapon, or compare vs opponent)")
    .addStringOption(o => o.setName("name").setDescription("Player (partial)").setRequired(true))
    .addStringOption(o => o.setName("weapon").setDescription("Weapon (partial name or exact id)"))
	.addStringOption(o => o.setName("map").setDescription("Map (partial name or exact id)"))
    .addStringOption(o => o.setName("vs").setDescription("Opponent player (partial name)")),
  new SlashCommandBuilder()
    .setName("xlr-lastseen")
    .setDescription("Show recently seen players")
    .addIntegerOption(o => o.setName("count").setDescription("How many (default 10)").setMinValue(1).setMaxValue(25))
].map(c => c.toJSON());

async function fetchServerStatus() {
  const url = `https://api.cod.pm/getstatus/${B3_RCON_IP}/${B3_RCON_PORT}`;
  const res = await axios.get(url);
  return res.data;
}

async function checkUrlFor404(url) {
  try {
    const response = await fetch(url, { method: 'HEAD' }); 
    if (response.status === 404) {
      return true;
    } else {
      return false;
    }
  } catch (error) {
    return false; 
  }
}

// Helper: attempt to fetch an image URL for a map name from cod.pm API (adjust endpoint if needed)
async function getMapImageUrl(label) {
	try {
	  if( await checkUrlFor404("https://cod.pm/mp_maps/cod1+coduo/stock/" + label + ".png")) {
		  if (await checkUrlFor404("https://cod.pm/mp_maps/cod1+coduo/custom/" + label + ".png")){
			  return null;
		  } else {
			  return "https://cod.pm/mp_maps/cod1+coduo/custom/" + label + ".png";
		  }
	  } else {
		  return "https://cod.pm/mp_maps/cod1+coduo/stock/" + label + ".png";
	  }  
	} catch {
	  return null;
	}
}


const VIEWS = Object.freeze({ HOME: "home", LADDER: "ladder", WEAPONS: "weapons", MAPS: "maps", WEAPON_PLAYERS: "weaponPlayers", MAPS_PLAYERS: "mapsPlayers" });

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
    .setCustomId(`ui:weapons:select:${page}`) // carry the page number
    .setPlaceholder("Select Weapon to View More Stats...")
    .addOptions(
      ...rows.map((w) => ({
        label: w.label,            // human label
        value: w.label,            // we resolve by name in SQL
        default: selectedLabel ? w.label === selectedLabel : false,
      }))
    );

  return new ActionRowBuilder().addComponents(menu);
}

function mapSelectRowForPage(rows, page, selectedLabel = null) {

  const menu = new StringSelectMenuBuilder()
    .setCustomId(`ui:maps:select:${page}`) // carry the page number
    .setPlaceholder("Select Map to View More Stats...")
    .addOptions(
      ...rows.map((w) => ({
        label: w.label,            // human label
        value: w.label,            // we resolve by name in SQL
        default: selectedLabel ? w.label === selectedLabel : false,
      }))
    );

  return new ActionRowBuilder().addComponents(menu);
}

function playerSelectRowForPage(rows, page, selectedId = null) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`ui:ladder:select:${page}`) // carry the ladder page number
    .setPlaceholder("Select a Player to View More Stats..")
    .addOptions(
      rows.map((r) => ({
        label: String(r.name).slice(0, 100),  // show name
        value: String(r.client_id),           // use stable id
        default: selectedId ? r.client_id === selectedId : false,
      }))
    );

  return new ActionRowBuilder().addComponents(menu);
}


function toolbarPayload(activeView) {
  return { content: "", embeds: [], components: [navRow(activeView)] };
}

function parseCustomId(id) {
  const p = id.split(":");
  if (p[0] !== "ui") return null;

  if (p.length === 2) return { view: p[1], page: 0 };

  // ui:<view>:prev|next:<page>
  if (p.length === 4) {
    const cur = Math.max(0, parseInt(p[3], 10) || 0);
    return { view: p[1], page: p[2] === "next" ? cur + 1 : Math.max(0, cur - 1) };
  }

  // ui:<view>:prev|next:<page>:<weaponLabel>:<weaponsPage>
  if (p.length === 6) {
    const cur = Math.max(0, parseInt(p[3], 10) || 0);
    const param = decodeURIComponent(p[4]);
    const weaponsPage = Math.max(0, parseInt(p[5], 10) || 0);
    return { view: p[1], page: p[2] === "next" ? cur + 1 : Math.max(0, cur - 1), param, weaponsPage };
  }

  return null;
}

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

async function runQuery(sql, params) {
  const [rows] = await pool.query(sql, params);
  return rows;
}

async function getHomeTotals() {
  const [[{totalPlayers=0 }],[{ totalKills=0 }={}],[{ totalRounds=0 }={}],[favW={}],[favM={}]] = await Promise.all([
    runQuery(queries.ui_totalPlayers,[]),
    runQuery(queries.ui_totalKills, []),
    runQuery(queries.ui_totalRounds, []),
    runQuery(queries.ui_favoriteWeapon, []),
    runQuery(queries.ui_favoriteMap, []),
  ]);
  return {
	totalPlayers: +totalPlayers || 0,
    totalKills: +totalKills || 0,
    totalRounds: +totalRounds || 0,
    favoriteWeapon: { label: favW?.label ?? "—", kills: +(favW?.kills ?? 0) },
    favoriteMap: { label: favM?.label ?? "—", rounds: +(favM?.rounds ?? 0) },
  };
}

async function getLadderSlice(offset=0, limit=10) {
  const { sql, params } = queries.ui_ladderSlice(limit, offset);
  const rows = await runQuery(sql, params);
  return rows.map((r, i) => ({ ...r, rank: offset + i + 1 })); // absolute rank for page 2 => 11..20
}

async function getWeaponsSlice(offset=0, limit=10) {
  const { sql, params } = queries.ui_weaponsSlice(limit, offset);
  const rows = await runQuery(sql, params);
  return rows.map((r, i) => ({ ...r, rank: offset + i + 1 })); // absolute rank for page 2 => 11..20
}

async function getMapsSlice(offset = 0, limit = 10) {
  const { sql, params } = queries.ui_mapsSlice(limit, offset);
  const rows = await runQuery(sql, params);

  const slice = await Promise.all(
    rows.map(async (r, i) => {
      let url;
      try {
        url = await getMapImageUrl(r.label); // ensure it resolves
      } catch (e) {
        url = DEFAULT_THUMB;
      }

      return {
        ...r,
        rank: offset + i + 1,
        thumbnail: url || DEFAULT_THUMB
      };
    })
  );

  return slice;
}

async function getLadderCount() {
  const [{ cnt=0 }={}] = await runQuery(queries.ui_ladderCount, []);
  return +cnt || 0;
}


async function getWeaponsCount() {
  const [{ cnt=0 }={}] = await runQuery(queries.ui_weaponsCount, []);
  return +cnt || 0;
}

async function getMapsCount() {
  const [{ cnt=0 }={}] = await runQuery(queries.ui_mapsCount, []);
  return +cnt || 0;
}

async function getPlayerWeaponSlice(weapon, offset = 0, limit = 10) {
  const { sql, params } = queries.ui_playerWeaponSlice(weapon, limit, offset);
  const rows = await runQuery(sql, params);
  return rows.map((r, i) => ({ ...r, rank: offset + i + 1 }));
}

async function getPlayerWeaponCount(weapon) {
  const [{ cnt = 0 } = {}] = await runQuery(queries.ui_playerWeaponCount, [ `%${weapon}%`, /^\d+$/.test(weapon) ? Number(weapon) : -1 ]);
  return +cnt || 0;
}

async function getPlayerMapCount(map) {
  const [{ cnt = 0 } = {}] = await runQuery(queries.ui_playerMapsCount, [ `%${map}%`, /^\d+$/.test(map) ? Number(map) : -1 ]);
  return +cnt || 0;
}


const getWeaponsAll = () => runQuery(queries.ui_weaponsAll, []);
const getMapsAll    = () => runQuery(queries.ui_mapsAll,   []);

async function buildWeaponPlayersView(weaponLabel, playerPage = 0, weaponsPage = 0) {
  const pageSize = 10;
  const offset   = playerPage * pageSize;

  const [rows, total, weaponsRows] = await Promise.all([
    // players for a given weapon
    (async () => {
      const { sql, params } = queries.ui_playerWeaponSlice(weaponLabel, pageSize, offset);
      const data = await runQuery(sql, params);
      return data.map((r, i) => ({ ...r, rank: offset + i + 1 }));
    })(),
    // total players for this weapon
    (async () => {
      const [{ cnt = 0 } = {}] = await runQuery(queries.ui_playerWeaponCount, [ `%${weaponLabel}%`, /^\d+$/.test(weaponLabel) ? Number(weaponLabel) : -1 ]);
      return +cnt || 0;
    })(),
    // the same 10 weapons the user saw on that weapons page
    getWeaponsSlice(weaponsPage * pageSize, pageSize),
  ]);

  // Title + embeds (reuse your formatter; pass offset for absolute ranking)
  const titleLabel = resolveEmoji(weaponLabel) ? `${resolveEmoji(weaponLabel)} ${weaponLabel}` : weaponLabel;
  const embeds = formatTopEmbed(rows, `Top Players by Weapon: ${titleLabel}`, { thumbnail: null, offset });

  const embedArr = Array.isArray(embeds) ? embeds : [embeds];
  const lastFooter = embedArr[embedArr.length - 1].data.footer?.text || "XLRStats • B3";
  const ZERO = "⠀";
  const padLen = Math.min(Math.floor(lastFooter.length * 0.65), 2048);
  const blank  = ZERO.repeat(padLen);
  for (const e of embedArr) e.setFooter({ text: blank });
  embedArr[embedArr.length - 1].setFooter({ text: `${lastFooter} • Weapon page ${playerPage + 1}` });

  const hasNext = offset + pageSize < total;
  const pager   = [pagerRowWithParams(VIEWS.WEAPON_PLAYERS, playerPage, playerPage > 0, hasNext, weaponLabel, weaponsPage)];

  // Keep tabs on “Weapons” and keep the SAME 10-option select (with current weapon preselected)
  const nav = [navRow(VIEWS.WEAPONS), weaponSelectRowForPage(weaponsRows, weaponsPage, weaponLabel)];

  return { embeds, nav, pager };
}

async function buildMapPlayersView(mapLabel, playerPage = 0, mapsPage = 0) {
  const pageSize = 10;
  const offset   = playerPage * pageSize;

  const [rows, total, mapsRows] = await Promise.all([
    // players for a given weapon
    (async () => {
      const { sql, params } = queries.ui_playerMapsSlice(mapLabel, pageSize, offset);
      const data = await runQuery(sql, params);
      return data.map((r, i) => ({ ...r, rank: offset + i + 1 }));
    })(),
    // total players for this weapon
    (async () => {
      const [{ cnt = 0 } = {}] = await runQuery(queries.ui_playerMapsCount, [ `%${mapLabel}%`, /^\d+$/.test(mapLabel) ? Number(mapLabel) : -1 ]);
      return +cnt || 0;
    })(),
    // the same 10 weapons the user saw on that weapons page
    getMapsSlice(mapsPage * pageSize, pageSize),
  ]);

  // Title + embeds (reuse your formatter; pass offset for absolute ranking)
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

  // Keep tabs on “Weapons” and keep the SAME 10-option select (with current weapon preselected)
  const nav = [navRow(VIEWS.MAPS), mapSelectRowForPage(mapsRows, mapsPage, mapLabel)];

  return { embeds, nav, pager };
}

async function buildPlayerView(clientId, ladderPage = 0) {
  

  const pageSize = 10;
  const offset   = ladderPage * pageSize;

  const [details, ladderRows] = await Promise.all([
    runQuery(queries.playerCard, [clientId, clientId, clientId]),
    getLadderSlice(offset, pageSize), // reuse ladder rows for the same page in the select
  ]);

  const nav = [navRow(VIEWS.LADDER), playerSelectRowForPage(ladderRows, ladderPage, clientId)];
  if (!details.length) {
    const err = new EmbedBuilder().setColor(0xcc0000).setDescription("No stats for that player.");
    return { embeds: [err], nav, pager: [] };
  }
  
  const embed = formatPlayerEmbed(details[0],{ thumbnail: DEFAULT_THUMB });
  const pager   = [pagerRowWithParams(VIEWS.PLAYERS, playerPage, playerPage > 0, hasNext, mapLabel, mapsPage)];

  return { embeds: [embed], nav, pager };
}


async function buildView(view, page=0) {
  const nav = [navRow(view)];
  switch (view) {
    case VIEWS.HOME: {
      const totals = await getHomeTotals();
	  const status = await fetchServerStatus();
      const embeds = renderHomeEmbed({ totals }, status, TZ, B3_RCON_IP, B3_RCON_PORT);
      return { embeds, nav, pager: [] };
    }
    case VIEWS.LADDER: {
      const pageSize = 10, offset = page * pageSize;
      const [rows, total] = await Promise.all([getLadderSlice(offset, pageSize), getLadderCount()]);
      const embeds = renderLadderEmbeds({ rows, page }); // uses absolute r.rank for numbering
      const pager = [pagerRow(VIEWS.LADDER, page, page>0, offset + pageSize < total)];
	  
	  const embedArr = Array.isArray(embeds) ? embeds : [embeds];
	  
	  const footerText = embedArr[embedArr.length - 1].data.footer.text;
	  const ZERO_WIDTH = "⠀"; // U+2800
	  const padLen = Math.min(Math.floor(footerText.length * 0.65), 2048);
	  const blankText = ZERO_WIDTH.repeat(padLen);

	  // Apply “invisible” footer to all, then real footer on the last
	  for (const e of embedArr) {
	    e.setFooter({ text: blankText });
	  }
	  embedArr[embedArr.length - 1].setFooter({ text: footerText });
	  
	  const selectRow = playerSelectRowForPage(rows, page);
	  const nav = [navRow(VIEWS.LADDER), selectRow];
	  return { embeds, nav, pager };
	  
    }
    case VIEWS.WEAPONS: {
	  const pageSize = 10, offset = page * pageSize;
      const [rows, total] = await Promise.all([getWeaponsSlice(offset, pageSize), getWeaponsCount()]);
      const embeds = renderWeaponsEmbeds({ rows, page }); // uses absolute r.rank for numbering
      const pager = [pagerRow(VIEWS.WEAPONS, page, page>0, offset + pageSize < total)];
	  
	  const embedArr = Array.isArray(embeds) ? embeds : [embeds];
	  const footerText = embedArr[embedArr.length - 1].data.footer?.text;
	  const ZERO_WIDTH = "⠀"; // U+2800
	  const padLen = Math.min(Math.floor(footerText.length * 0.65), 2048);
	  const blankText = ZERO_WIDTH.repeat(padLen);

	  // Apply “invisible” footer to all, then real footer on the last
	  for (const e of embedArr) {
	    e.setFooter({ text: blankText });
	  }
	  embedArr[embedArr.length - 1].setFooter({ text: footerText });
	  
	  const selectRow = weaponSelectRowForPage(rows, page);
	  const nav = [navRow(VIEWS.WEAPONS), selectRow];
	  
      return { embeds, nav, pager };
    }
    case VIEWS.MAPS: {
      const pageSize = 10, offset = page * pageSize;
      const [rows, total] = await Promise.all([getMapsSlice(offset, pageSize), getMapsCount()]);
      const embeds = renderMapsEmbeds({ rows, page }); // uses absolute r.rank for numbering
      const pager = [pagerRow(VIEWS.MAPS, page, page>0, offset + pageSize < total)];
	  
	  const embedArr = Array.isArray(embeds) ? embeds : [embeds];
	  const footerText = embedArr[embedArr.length - 1].data.footer?.text;
	  const ZERO_WIDTH = "⠀"; // U+2800
	  const padLen = Math.min(Math.floor(footerText.length * 0.65), 2048);
	  const blankText = ZERO_WIDTH.repeat(padLen);

	  // Apply “invisible” footer to all, then real footer on the last
	  for (const e of embedArr) {
	    e.setFooter({ text: blankText });
	  }
	  embedArr[embedArr.length - 1].setFooter({ text: footerText });
	  
	  const selectRow = mapSelectRowForPage(rows, page);
	  const nav = [navRow(VIEWS.MAPS), selectRow];
	  
      return { embeds, nav, pager };
    }
    default:
      return buildView(VIEWS.HOME, 0);
  }
}

async function startUiInactivitySession(channel) {
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
      (i.message?.id === UI_NAV_MESSAGE_ID || i.message?.id === UI_CONTENT_MESSAGE_ID)
  });

  uiCollector.on('end', async (_collected, reason) => {
    if (reason === 'idle') {
      try {
        // Auto-refresh Home on idle, even if already on Home
        const payload = await buildView(VIEWS.HOME, 0);

        // Update toolbar + content
        const [navMsg, contentMsg] = await Promise.all([
          channel.messages.fetch(UI_NAV_MESSAGE_ID),
          channel.messages.fetch(UI_CONTENT_MESSAGE_ID),
        ]);

        await Promise.all([
          navMsg.edit({ content: "", embeds: [], components: payload.nav }),
          contentMsg.edit({ embeds: payload.embeds, components: payload.pager }),
        ]);
      } catch (e) {
        console.error("[ui] idle refresh failed:", e);
      } finally {
        // Restart the idle watcher
        startUiInactivitySession(channel);
      }
    }
  });
}


const client = new Client({ intents: [GatewayIntentBits.Guilds] });

setEmojiResolver((label) => {
  if (!label) return null;
  const e = client.emojis.cache.find((x) => x.name === label);
  return e ? e.toString() : null; // return <:name:id> mention
});

client.once(Events.ClientReady,  async (c) => {
  console.log(`Logged in as ${c.user.tag}`);

  fs.mkdirSync("/opt/xlrbot/health", { recursive: true });
  setInterval(() => fs.writeFileSync(HEARTBEAT_FILE, Date.now().toString()), 15000);
  
  await ensureUiMessages(client);

  // kick off idle watcher
	try {
	  const channel = await client.channels.fetch(CHANNEL_ID);
	  if (channel) startUiInactivitySession(channel);
	} catch (e) {
	  console.warn("[ui] could not start inactivity session:", e);
	}
});

client.on(Events.InteractionCreate, async (i) => {
  try {
    if (i.isButton()) {
      const parsed = parseCustomId(i.customId);
	  if (!parsed) return;
	  const { view, page } = parsed;

	// NAV toolbar clicked
	if (i.message.id === UI_NAV_MESSAGE_ID) {
	  const parsed = parseCustomId(i.customId);
	  if (!parsed) return;
	  const { view, page } = parsed;

	  const payload = await buildView(view, page);
	  const channel = i.channel ?? await i.client.channels.fetch(CHANNEL_ID);
	  const contentMsg = await channel.messages.fetch(UI_CONTENT_MESSAGE_ID);

	  // Ack immediately by updating the nav message, and in parallel edit the content message
	  await Promise.all([
		i.update({ content: "", embeds: [], components: payload.nav }), // ACK happens here
		contentMsg.edit({ embeds: payload.embeds, components: payload.pager }),
	  ]);

	  // reset inactivity timer if present
	  if (uiCollector) uiCollector.resetTimer({ idle: INACTIVITY_MS });

	  return;
	}


	  // PAGER clicked in content message
	  if (i.message.id === UI_CONTENT_MESSAGE_ID) {
		  
		if (parsed.view === VIEWS.WEAPON_PLAYERS) {
		  const payload = await buildWeaponPlayersView(parsed.param, parsed.page, parsed.weaponsPage ?? 0);
		  await i.update({ embeds: payload.embeds, components: payload.pager });

		  // keep toolbar synced so the select stays on the same 10 weapons
		  if (UI_NAV_MESSAGE_ID) {
			const channel = i.channel ?? await i.client.channels.fetch(CHANNEL_ID);
			const navMsg = await channel.messages.fetch(UI_NAV_MESSAGE_ID);
			await navMsg.edit({ content: "", embeds: [], components: payload.nav });
		  }
		  if (uiCollector) uiCollector.resetTimer({ idle: INACTIVITY_MS });
		  return;
		}
		
		if (parsed.view === VIEWS.MAPS_PLAYERS) {
		  const payload = await buildMapPlayersView(parsed.param, parsed.page, parsed.weaponsPage ?? 0);
		  await i.update({ embeds: payload.embeds, components: payload.pager });

		  // keep toolbar synced so the select stays on the same 10 weapons
		  if (UI_NAV_MESSAGE_ID) {
			const channel = i.channel ?? await i.client.channels.fetch(CHANNEL_ID);
			const navMsg = await channel.messages.fetch(UI_NAV_MESSAGE_ID);
			await navMsg.edit({ content: "", embeds: [], components: payload.nav });
		  }
		  if (uiCollector) uiCollector.resetTimer({ idle: INACTIVITY_MS });
		  return;
		}
				
		const payload = await buildView(view, page);
		await i.update({ embeds: payload.embeds, components: payload.pager });

		// keep toolbar highlight synced (optional, cheap)
		if (UI_NAV_MESSAGE_ID) {
		  const channel = i.channel ?? await i.client.channels.fetch(CHANNEL_ID);
		  const navMsg = await channel.messages.fetch(UI_NAV_MESSAGE_ID);
		  await navMsg.edit({ content: "", embeds: [], components: payload.nav });
		}
		// reset inactivity timer
		if (uiCollector) uiCollector.resetTimer({ idle: INACTIVITY_MS });
		return;
	  }
    }
	// Handle weapon select (customId: ui:weapons:select:<page>)
	if (i.isStringSelectMenu() && i.customId.startsWith("ui:weapons:select:")) {
	  const parts = i.customId.split(":"); // ["ui","weapons","select","<page>"]
	  const page  = Math.max(0, parseInt(parts[3], 10) || 0);
	  const weaponLabel = i.values?.[0];
	  if (!weaponLabel) return i.reply({ content: "No weapon selected.", ephemeral: true });

	  // Build “Top Players by Weapon …” view for page 0 initially
	  const payload = await buildWeaponPlayersView(weaponLabel, 0, page);

	  // Update the NAV (tabs + same-page select) and CONTENT (embeds + pager)
	  const channel = i.channel ?? await i.client.channels.fetch(CHANNEL_ID);
	  const [navMsg, contentMsg] = await Promise.all([
		channel.messages.fetch(UI_NAV_MESSAGE_ID),
		channel.messages.fetch(UI_CONTENT_MESSAGE_ID)
	  ]);

	  await Promise.all([
		i.update({ content: "", embeds: [], components: payload.nav }), // ACK on the nav message
		contentMsg.edit({ embeds: payload.embeds, components: payload.pager })
	  ]);

	  if (uiCollector) uiCollector.resetTimer({ idle: INACTIVITY_MS });
	  return;
	}

	if (i.isStringSelectMenu() && i.customId.startsWith("ui:maps:select:")) {
	  const parts = i.customId.split(":"); // ["ui","maps","select","<page>"]
	  const mapsPage = Math.max(0, parseInt(parts[3], 10) || 0);
	  const mapLabel = i.values?.[0];
	  if (!mapLabel) return i.reply({ content: "No map selected.", ephemeral: true });

	  const payload = await buildMapPlayersView(mapLabel, 0, mapsPage);

	  const channel = i.channel ?? await i.client.channels.fetch(CHANNEL_ID);
	  const [navMsg, contentMsg] = await Promise.all([
		channel.messages.fetch(UI_NAV_MESSAGE_ID),
		channel.messages.fetch(UI_CONTENT_MESSAGE_ID)
	  ]);

	  await Promise.all([
		i.update({ content: "", embeds: [], components: payload.nav }), // nav message
		contentMsg.edit({ embeds: payload.embeds, components: payload.pager }) // content message
	  ]);

	  if (uiCollector) uiCollector.resetTimer({ idle: INACTIVITY_MS });
	  return;
	}
	
	if (i.isStringSelectMenu() && i.customId.startsWith("ui:ladder:select:")) {
	  const parts = i.customId.split(":"); // ["ui","maps","select","<page>"]
	  const ladderPage = Math.max(0, parseInt(parts[3], 10) || 0);
	  const playerLabel = i.values?.[0];
	  if (!playerLabel) return i.reply({ content: "No player selected.", ephemeral: true });

	  const payload = await buildPlayerView(playerLabel, 0, ladderPage);

	  const channel = i.channel ?? await i.client.channels.fetch(CHANNEL_ID);
	  const [navMsg, contentMsg] = await Promise.all([
		channel.messages.fetch(UI_NAV_MESSAGE_ID),
		channel.messages.fetch(UI_CONTENT_MESSAGE_ID)
	  ]);

	  await Promise.all([
		i.update({ content: "", embeds: [], components: payload.nav }), // nav message
		contentMsg.edit({ embeds: payload.embeds, components: payload.pager }) // content message
	  ]);

	  if (uiCollector) uiCollector.resetTimer({ idle: INACTIVITY_MS });
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

	if (i.commandName === "xlr-top") {
	  await i.deferReply();

	  const countIn = i.options.getInteger("count");
	  const sort    = i.options.getString("sort") || "skill";
	  let weapon    = i.options.getString("weapon") || null;
	  let map       = i.options.getString("map") || null;

	  // 0 => all (up to 10)
	  const count = countIn ?? 0;
	  const limit = count === 0 ? 10 : Math.min(count, 10);

	  // weapon precedence over map
	  if (weapon && map) map = null;

	  try {
		const { sql, params } = queries.topDynamic({ limit, sort, weapon, map });
		const rows = await runQuery(sql, params);

		// figure out canonical matched labels (if any)
		const matchedLabel = rows.length ? rows[0].matched_label : null;

		// Build title
		let title = "Top Players by Skill";
		if (weapon) {
		  const label = matchedLabel || weapon;
		  const emoji = resolveEmoji(label);
		  if(emoji)
			title = `Top Players by Weapon: ${emoji} ${label}`;
		  else
			title = `Top Players by Weapon: ${label}`;
		} else if (map) {
		  const label = matchedLabel || map;
		  title = `Top Players by Map: ${label}`;
		} else if (sort && sort !== "skill") {
		  title = `Top Players by ${sort.charAt(0).toUpperCase()}${sort.slice(1)}`;
		}

		// Thumbnail: use map image if querying a map, else default image
		let thumbUrl = "";
		if (map) {
		  const label = matchedLabel || map;
		  thumbUrl = (await getMapImageUrl(label)) || DEFAULT_THUMB;
		}

		// Build tags
		const tags = [
		  `Sort: ${sort}`,
		  `Count: ${rows.length}`,
		  weapon ? `Weapon: ${matchedLabel}` : null,
		  map ? `Map: ${matchedLabel}` : null
		].filter(Boolean).join("  •  ");

		// Footer text
		const footerText = `XLRStats • B3 • ${tags}`;

		const ZERO_WIDTH = "⠀"; // U+2800
		const padLen = Math.min(Math.floor(footerText.length * 0.65), 2048);
		const blankText = ZERO_WIDTH.repeat(padLen);

		// Create embeds
		const embeds = formatTopEmbed(rows, title, { thumbnail: thumbUrl });
		const embedArr = Array.isArray(embeds) ? embeds : [embeds];

		// Apply “invisible” footer to all, then real footer on the last
		for (const e of embedArr) {
		  e.setFooter({ text: blankText });
		}
		embedArr[embedArr.length - 1].setFooter({ text: footerText });
		await i.editReply({ embeds: embeds });
	  } catch (err) {
		console.error(err);
		await i.editReply("Error talking to the stats database.");
	  }
	}

    if (i.commandName === "xlr-player") {
      await i.deferReply();
      const name = i.options.getString("name");
	  const weapon = i.options.getString("weapon");
	  const mapOpt = i.options.getString("map");
      const vsName = i.options.getString("vs");
	  
      const matches = await runQuery(queries.findPlayer, [`%${name}%`, `%${name}%`]);
      if (!matches.length) return i.editReply(`No players found matching **${name}**.`);

      // Take the best match and fetch stats row
      const clientId = matches[0].client_id;
      // precedence: weapon > vs > default player card
     if (weapon) {
        const idOrNeg1 = /^\d+$/.test(weapon) ? Number(weapon) : -1;
		const details = await runQuery(queries.playerWeaponCard, [`%${weapon}%`, idOrNeg1, clientId]);       if (!details.length) return i.editReply(`No **weapon** usage found for **${matches[0].name}** matching \`${weapon}\`.`);
        const embed = formatPlayerWeaponEmbed(details[0],{ thumbnail: DEFAULT_THUMB });
        return i.editReply({ embeds: [embed] });
      }
	  if (mapOpt) {

       const idOrNeg1 = /^\d+$/.test(mapOpt) ? Number(mapOpt) : -1;
       const details = await runQuery(queries.playerMapCard, [`%${mapOpt}%`, idOrNeg1, clientId]);
       if (!details.length) return i.editReply(`No map stats found for **${matches[0].name}** matching \`${mapOpt}\`.`);
	   let thumbUrl = DEFAULT_THUMB;
	   thumbUrl = (await getMapImageUrl(details[0].map)) || DEFAULT_THUMB;
       const embed = formatPlayerMapEmbed(details[0],{ thumbnail: thumbUrl });
       return i.editReply({ embeds: [embed] });
     }
      if (vsName) {
        const opp = await runQuery(queries.findPlayer, [`%${vsName}%`, `%${vsName}%`]);
        if (!opp.length) return i.editReply(`No opponent found matching **${vsName}**.`);
        const opponentId = opp[0].client_id;
        if (opponentId === clientId) return i.editReply(`Pick a different opponent than the player.`);
        const rows = await runQuery(queries.playerVsCard, [
		  opponentId,           
		  clientId, opponentId, 
		  opponentId, clientId, 
		  clientId              
		]);
        if (!rows.length) return i.editReply(`No opponent stats found between **${matches[0].name}** and **${opp[0].name}**.`);
        const embed = formatPlayerVsEmbed(rows[0],{ thumbnail: DEFAULT_THUMB });
        return i.editReply({ embeds: [embed] });
      }
      // default player card
      const details = await runQuery(queries.playerCard, [clientId, clientId, clientId]);
      if (!details.length) return i.editReply(`No stats on this server for **${matches[0].name}**.`);
      const embed = formatPlayerEmbed(details[0],{ thumbnail: DEFAULT_THUMB });
      return i.editReply({ embeds: [embed] });
    }

    if (i.commandName === "xlr-lastseen") {
      await i.deferReply();
      const count = i.options.getInteger("count") ?? 10;
      const rows = await runQuery(queries.lastSeen, [count]);
      const embed = formatLastSeenEmbed(rows,{ thumbnail: DEFAULT_THUMB });
      await i.editReply({ embeds: [embed] });
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

if (process.argv.includes("--register")) {
  register().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
} else {
  client.login(DISCORD_TOKEN);
}

// Ensure both messages exist and are populated
async function ensureUiMessages(client) {
  if (!CHANNEL_ID) { console.warn("[ui] No CHANNEL_ID; skipping UI."); return null; }

  const channel = await client.channels.fetch(CHANNEL_ID).catch(() => null);
  if (!channel || channel.type !== ChannelType.GuildText) { console.warn("[ui] Bad CHANNEL_ID"); return null; }

  const initial = await buildView(VIEWS.HOME, 0);

  // NAV (top)
  let navMsg = UI_NAV_MESSAGE_ID ? await channel.messages.fetch(UI_NAV_MESSAGE_ID).catch(()=>null) : null;
  if (!navMsg) {
    navMsg = await channel.send({ content: "", embeds: [], components: initial.nav });
    upsertEnv("UI_NAV_MESSAGE_ID", navMsg.id);
    try { await navMsg.pin(); } catch {}
  } else {
    await navMsg.edit({ content: "", embeds: [], components: initial.nav });
  }

  // CONTENT (bottom)
  let contentMsg = UI_CONTENT_MESSAGE_ID ? await channel.messages.fetch(UI_CONTENT_MESSAGE_ID).catch(()=>null) : null;
  if (!contentMsg) {
    contentMsg = await channel.send({ embeds: initial.embeds, components: initial.pager });
    upsertEnv("UI_CONTENT_MESSAGE_ID", contentMsg.id);
  } else {
    await contentMsg.edit({ embeds: initial.embeds, components: initial.pager });
  }

  return { navMsg, contentMsg };
}