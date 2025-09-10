import "dotenv/config";
import { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, Events, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType } from "discord.js";
import mysql from "mysql2/promise";
import { queries } from "./queries.js";
import { formatPlayerEmbed, formatTopEmbed, formatLastSeenEmbed, formatPlayerWeaponEmbed, formatPlayerVsEmbed, formatPlayerMapEmbed, renderHomeEmbed, renderLadderEmbeds, renderWeaponsEmbed, renderMapsEmbed, setEmojiResolver, resolveEmoji } from "./format.js";
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


const VIEWS = Object.freeze({ HOME: "home", LADDER: "ladder", WEAPONS: "weapons", MAPS: "maps", LADDER_FILTER: "ladderf" });

const navRow = (active) =>
  new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`ui:${VIEWS.HOME}`).setLabel("Home").setStyle(active==="home"?ButtonStyle.Primary:ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`ui:${VIEWS.LADDER}`).setLabel("Ladder").setStyle(active==="ladder"?ButtonStyle.Primary:ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`ui:${VIEWS.WEAPONS}`).setLabel("Weapons").setStyle(active==="weapons"?ButtonStyle.Primary:ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`ui:${VIEWS.MAPS}`).setLabel("Maps").setStyle(active==="maps"?ButtonStyle.Primary:ButtonStyle.Secondary),
  );

const pagerRow = (view, page, hasPrev, hasNext, extra = "") => {
  const prevId = extra ? `ui:${view}:prev:${page}:${extra}` : `ui:${view}:prev:${page}`;
  const nextId = extra ? `ui:${view}:next:${page}:${extra}` : `ui:${view}:next:${page}`;
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(prevId).setLabel("Previous").setStyle(ButtonStyle.Secondary).setDisabled(!hasPrev),
    new ButtonBuilder().setCustomId(nextId).setLabel("Next").setStyle(ButtonStyle.Secondary).setDisabled(!hasNext),
  );
};

function selectRow(view, page, count) {
  const row = new ActionRowBuilder();
  for (let i = 0; i < count; i++) {
    row.addComponents(new ButtonBuilder().setCustomId(`ui:${view}:pick:${page}:${i}`).setLabel(String(i + 1)).setStyle(ButtonStyle.Primary));
  }
  return row;
}

function selectRows(view, page, count) {
  const rows = [];
  const perRow = 5; // Discord max 5 buttons per row
  let made = 0;
  while (made < count) {
    const row = new ActionRowBuilder();
    for (let i = 0; i < perRow && made < count; i++, made++) {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`ui:${view}:pick:${page}:${made}`)
          .setLabel(String(made + 1))
          .setStyle(ButtonStyle.Primary)
      );
    }
    if (row.components.length > 0) rows.push(row);
  }
  return rows;
}

function enc(s){ return encodeURIComponent(String(s)); }
function dec(s){ try { return decodeURIComponent(s); } catch { return s; } }


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
  // selection (ui:<view>:pick:<page>:<index>)
  if (p.length === 5 && p[2] === "pick") {
    return { view: p[1], action: "pick", page: Math.max(0, parseInt(p[3], 10) || 0), index: Math.max(0, parseInt(p[4], 10) || 0) };
  }
  // filtered ladder pager (ui:ladderf:prev|next:<page>:<type>:<labelEnc...>)
  if (p.length >= 6 && p[1] === VIEWS.LADDER_FILTER) {
    const cur = Math.max(0, parseInt(p[3], 10) || 0);
    const page = p[2] === "next" ? cur + 1 : Math.max(0, cur - 1);
    const type = p[4];                 // "weapon" | "map"
    const labelEnc = p.slice(5).join(":"); // allow ':' in label
    return { view: p[1], page, type, labelEnc };
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
  const [[{ totalKills=0 }={}],[{ totalRounds=0 }={}],[favW={}],[favM={}]] = await Promise.all([
    runQuery(queries.ui_totalKills, []),
    runQuery(queries.ui_totalRounds, []),
    runQuery(queries.ui_favoriteWeapon, []),
    runQuery(queries.ui_favoriteMap, []),
  ]);
  return {
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
async function getLadderCount() {
  const [{ cnt=0 }={}] = await runQuery(queries.ui_ladderCount, []);
  return +cnt || 0;
}
const getWeaponsAll = () => runQuery(queries.ui_weaponsAll, []);
const getMapsAll    = () => runQuery(queries.ui_mapsAll,   []);

/** Build the payload pieces for a given view/page. */
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
      return { embeds, nav, pager };
    }
    case VIEWS.WEAPONS: {
	  const items = await getWeaponsAll();
	  const per = 10;
	  const embeds = renderWeaponsEmbed({ items, page, perPage: per });
	  const start = page * per;
	  const hasNext = start + per < items.length;
	  const count = Math.min(per, Math.max(0, items.length - start));
	  const controls = [
		...selectRows(VIEWS.WEAPONS, page, count),
		pagerRow(VIEWS.WEAPONS, page, page > 0, hasNext),
	  ];
	  return { embeds, nav, pager: controls };
	}

    case VIEWS.MAPS: {
	  const items = await getMapsAll();
	  const per = 10;
	  const embeds = renderMapsEmbed({ items, page, perPage: per });
	  const start = page * per;
	  const hasNext = start + per < items.length;
	  const count = Math.min(per, Math.max(0, items.length - start));
	  const controls = [
		...selectRows(VIEWS.MAPS, page, count),
		pagerRow(VIEWS.MAPS, page, page > 0, hasNext),
	  ];
	  return { embeds, nav, pager: controls };
	}

    case VIEWS.LADDER_FILTER: {
	  const { type, label } = extra || {};
	  const pageSize = 10, offset = page * pageSize;
	  const isWeapon = type === "weapon";
	  const { sql, params } = queries.topDynamic({
		limit: pageSize,
		sort: "skill",
		weapon: isWeapon ? label : null,
		map:    !isWeapon ? label : null,
		offset
	  });
	  const rows = await runQuery(sql, params);

	  let title;
	  let thumbUrl = DEFAULT_THUMB;
	  if (isWeapon) {
		const emoji = resolveEmoji(label);
		title = emoji ? `Top Players by Weapon: ${emoji} ${label}` : `Top Players by Weapon: ${label}`;
	  } else {
		title = `Top Players by Map: ${label}`;
		const t = await getMapImageUrl(label);
		if (t) thumbUrl = t; // show map thumbnail
	  }

	  const embeds = renderLadderEmbeds({ rows, page, title, thumbnail: thumbUrl });
	  const extraTag = `${type}:${enc(label)}`;
	  const pager = [pagerRow(VIEWS.LADDER_FILTER, page, page > 0, rows.length === pageSize, extraTag)];
	  // highlight "Ladder" in the toolbar when viewing filtered ladder
	  return { embeds, nav: [navRow(VIEWS.LADDER)], pager };
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
	// PAGER / SELECT clicked in content message
	if (i.message.id === UI_CONTENT_MESSAGE_ID) {
	  if (parsed.action === "pick" && (view === VIEWS.WEAPONS || view === VIEWS.MAPS)) {
		const list = view === VIEWS.WEAPONS ? await getWeaponsAll() : await getMapsAll();
		const per = 10;
		const start = parsed.page * per;
		const row = list[start + parsed.index];
		if (!row) { await i.deferUpdate(); return; }

		const type = (view === VIEWS.WEAPONS) ? "weapon" : "map";
		const label = row.label;
		const payload = await buildView(VIEWS.LADDER_FILTER, 0, { type, label });
		await i.update({ embeds: payload.embeds, components: payload.pager });

		// Sync toolbar to Ladder
		if (UI_NAV_MESSAGE_ID) {
		  const channel = i.channel ?? await i.client.channels.fetch(CHANNEL_ID);
		  const navMsg = await channel.messages.fetch(UI_NAV_MESSAGE_ID);
		  await navMsg.edit({ content: "", embeds: [], components: [navRow(VIEWS.LADDER)] });
		}
	  } else if (view === VIEWS.LADDER_FILTER) {
		const p = parseCustomId(i.customId);
		const type = p?.type;
		const label = dec(p?.labelEnc || "");
		const payload = await buildView(VIEWS.LADDER_FILTER, page, { type, label });
		await i.update({ embeds: payload.embeds, components: payload.pager });
	  } else {
		const payload = await buildView(view, page);
		await i.update({ embeds: payload.embeds, components: payload.pager });
	  }

	  // keep toolbar highlight synced (optional)
	  if (UI_NAV_MESSAGE_ID) {
		const channel = i.channel ?? await i.client.channels.fetch(CHANNEL_ID);
		const navMsg = await channel.messages.fetch(UI_NAV_MESSAGE_ID);
		const nv = (view === VIEWS.LADDER_FILTER) ? VIEWS.LADDER : view;
		await navMsg.edit({ content: "", embeds: [], components: [navRow(nv)] });
	  }
	  // reset inactivity timer
	  if (uiCollector) uiCollector.resetTimer({ idle: INACTIVITY_MS });
	}


	  // PAGER / SELECT clicked in content message
	  if (i.message.id === UI_CONTENT_MESSAGE_ID) {
		if (parsed.action === "pick" && (view===VIEWS.WEAPONS || view===VIEWS.MAPS)) {
        const list = view===VIEWS.WEAPONS ? await getWeaponsAll() : await getMapsAll();
        const per = 10;
        const start = parsed.page * per;
        const row = list[start + parsed.index];
        if (!row) { await i.deferUpdate(); return; }
        const type = (view===VIEWS.WEAPONS) ? "weapon" : "map";
        const label = row.label;
        const payload = await buildView(VIEWS.LADDER_FILTER, 0, { type, label });
        await i.update({ embeds: payload.embeds, components: payload.pager });
        if (UI_NAV_MESSAGE_ID) {
          const channel = i.channel ?? await i.client.channels.fetch(CHANNEL_ID);
          const navMsg = await channel.messages.fetch(UI_NAV_MESSAGE_ID);
          await navMsg.edit({ content: "", embeds: [], components: [navRow(VIEWS.LADDER)] });
        }
      } else if (view === VIEWS.LADDER_FILTER) {
        const p = parseCustomId(i.customId);
        const type = p?.type;
        const label = dec(p?.labelEnc || "");
        const payload = await buildView(VIEWS.LADDER_FILTER, page, { type, label });
        await i.update({ embeds: payload.embeds, components: payload.pager });
      } else {
        const payload = await buildView(view, page);
        await i.update({ embeds: payload.embeds, components: payload.pager });
      }

		// keep toolbar highlight synced (optional, cheap)
		if (UI_NAV_MESSAGE_ID) {
		  const channel = i.channel ?? await i.client.channels.fetch(CHANNEL_ID);
		  const navMsg = await channel.messages.fetch(UI_NAV_MESSAGE_ID);
		  await navMsg.edit({ content: "", embeds: [], components: payload.nav });
		}
		// reset inactivity timer
		if (uiCollector) uiCollector.resetTimer({ idle: INACTIVITY_MS });
	  }
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
		let thumbUrl = DEFAULT_THUMB;
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
