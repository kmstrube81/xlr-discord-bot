/* ***************************************************************
IMPORTS
**************************************************************** */
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
  TextInputStyle,
  MessageFlags
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
  formatLoadEmbed,
  setEmojiResolver,
  resolveEmoji
} from "./format.js";
import {
  generateBanner,
  DEFAULT_THUMB,
  BACKGROUNDS,
  EMBLEMS,
  CALLSIGNS
} from "./banner.js";
import axios from "axios";
import path from "node:path";
import fs from "node:fs";

/* *******************************************************
END IMPORTS
**********************************************************
START CONSTANTS
******************************************************** */
const {
  XLR_DEBUG,
  DISCORD_TOKEN, //Token for the bot from the discord dev portal
  APPLICATION_ID, //Application ID for bot from the discord dev portal
  GUILD_ID, //The Discord server the bot is being installed to
  TZ, //Time Zone
  XLR_DEFAULT_IMAGE //link to a default image to use when thumbnails fail to load
} = process.env;

const SERVER_CONFIGS = collectServerConfigs(process.env); //parse .env file to get servers

if(XLR_DEBUG) console.log(SERVER_CONFIGS);

const byIndex = new Map(SERVER_CONFIGS.map((c, i) => [i, c])); //create map for servers by index (for use with slash commands)
const byNameLower = new Map(SERVER_CONFIGS.map((c, i) => [c.rcon?.name.toLowerCase() ?? `Server${i}`, { i, c }])); //create map for servers by server name cast to lower case (for use with slash commands)
const __memberNameCache = new Map(); //cache everyones discord names

const INACTIVITY_MS = 2 * 60 * 1000; // Inactivity timer 2 minutes 

/* ***************************************************************
AWARDS DEFINITION ARRAY
---
an array of objects in the following format
key: the canonical name of the award
name: a pretty version of the name for Discord
description: a description of the award for Discord
emoji: an emoji to display on discord pages for the award
query: the coresponding SQL query as defined in queries.js
properties: fields to be shown on the award page. An Array of Objects
with the name being what shows as the field name in discord and
prop being the sql variable name for the value

TODO: read name, description, and emoji values from csv or similar for customization
**************************************************************** */
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
	},
	{ key: "award_killcam",
	  name: "Mom, Get the Camera!",
	  description: "Most Final Kill Cams",
	  emoji: "death_headshot",
	  query: queries.award_killcam,
	  properties: [{name: "Final Killcams", prop: "num_killcam"}]
	},
	{ key: "award_clutch",
	  name: "Michael Jordan",
	  description: "Most SD Cluthes (minimum 3 kills)",
	  emoji: "jumpman",
	  query: queries.award_clutch,
	  properties: [{name: "Clutches", prop: "clutches"}]
	},
	{ key: "award_ace",
	  name: "Texas Hold'em",
	  description: "Most SD Aces (minimum 3 kills)",
	  emoji: "death_headshot",
	  query: queries.award_ace,
	  properties: [{name: "Aces", prop: "aces"}]
	},
	{ key: "award_wins",
	  name: "All I Do is Win",
	  description: "Most Match Wins",
	  emoji: "death_headshot",
	  query: queries.award_wins,
	  properties: [{name: "Wins", prop: "win"}]
	},
	{ key: "award_winper",
	  name: "VIII Rings",
	  description: "Best Win Percentage (minimum 10 games)",
	  emoji: "sipsOJ",
	  query: queries.award_winper,
	  properties: [{name: "Wins", prop: "wins"}, {name: "Losses", prop: "losses"}, {name: "Win Percentage", prop: "winper"}]
	},
	{ key: "award_lossper",
	  name: "Bad Luck Boda",
	  description: "Lowest Win Percentage (minimum 10 games)",
	  emoji: "death_headshot",
	  query: queries.award_lossper,
	  properties: [{name: "Wins", prop: "wins"}, {name: "Losses", prop: "losses"}, {name: "Win Percentage", prop: "winper"}]
	},
	{ key: "award_headper",
	  name: "Clicking Heads",
	  description: "Highest Headshot Kill Percentage",
	  emoji: "death_headshot",
	  query: queries.award_headper,
	  properties: [{name: "Headshots", prop: "headshots"}, {name: "Kills", prop: "kills"}, {name: "Percent", prop: "percent"}]
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

// --------------------------------------------------------------------------------------
// View definitions
// --------------------------------------------------------------------------------------
const VIEWS = Object.freeze({
  HOME: "home", //the cod.pm server status page with a few xlr stats for server
  LADDER: "ladder", //the ladder of competing players sorted by skill
  WEAPONS: "weapons", //the most popular weapons, a string select for showing top players by weapon
  MAPS: "maps", //the most popular maps, a string select for showing top players by map
  WEAPON_PLAYERS: "weaponPlayers", // the players with the most kills for the selected weapon
  MAPS_PLAYERS: "mapsPlayers", // the players with the most rounds played for the selected map
  PLAYER: "player", // the player stats
  AWARDS: "awards", // the list of awards with the top player for each category listed.
});

// --------------------------------------------------------------------------------------
// NAVROW definitions
// --------------------------------------------------------------------------------------
const navRow = (active) =>
	new ActionRowBuilder().addComponents(
		new ButtonBuilder().setCustomId(`ui:${VIEWS.HOME}`).setLabel("Home").setStyle(active==="home"?ButtonStyle.Primary:ButtonStyle.Secondary),
		new ButtonBuilder().setCustomId(`ui:${VIEWS.LADDER}`).setLabel("Ladder").setStyle(active==="ladder"?ButtonStyle.Primary:ButtonStyle.Secondary),
		new ButtonBuilder().setCustomId(`ui:${VIEWS.WEAPONS}`).setLabel("Weapons").setStyle(active==="weapons"?ButtonStyle.Primary:ButtonStyle.Secondary),
		new ButtonBuilder().setCustomId(`ui:${VIEWS.MAPS}`).setLabel("Maps").setStyle(active==="maps"?ButtonStyle.Primary:ButtonStyle.Secondary),
		new ButtonBuilder().setCustomId(`ui:${VIEWS.AWARDS}`).setLabel("Awards").setStyle(active==="awards"?ButtonStyle.Primary:ButtonStyle.Secondary),
);

// --------------------------------------------------------------------------------------
// PAGERROW definitions
// --------------------------------------------------------------------------------------
const pagerRow = (view, page, hasPrev, hasNext) =>
	new ActionRowBuilder().addComponents(
		new ButtonBuilder().setCustomId(`ui:${view}:prev:${page}`).setLabel("Previous").setStyle(ButtonStyle.Secondary).setDisabled(!hasPrev),
		new ButtonBuilder().setCustomId(`ui:${view}:next:${page}`).setLabel("Next").setStyle(ButtonStyle.Secondary).setDisabled(!hasNext),
);
// -------------------------------------------------------------------------------------
// PAGERROW HELPERS
// -------------------------------------------------------------------------------------
function pagerRowWithParams(view, page, hasPrev, hasNext, embedLabel, embedPage) {
  const encLabel = encodeURIComponent(embedLabel);
  const encPage = String(embedPage);
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`ui:${view}:prev:${page}:${encLabel}:${encPage}`).setLabel("Previous").setStyle(ButtonStyle.Secondary).setDisabled(!hasPrev),
    new ButtonBuilder().setCustomId(`ui:${view}:next:${page}:${encLabel}:${encPage}`).setLabel("Next").setStyle(ButtonStyle.Secondary).setDisabled(!hasNext),
  );
}

function stringSelectRowForPage(view, rows, embedPage, selected = null) {
	let placeholder, options, menu;
	const medals = ["🥇", "🥈", "🥉"];
	switch(view){
		case "weaponPlayers":
			placeholder = "Select Weapon to View More Stats...";
			menu = new StringSelectMenuBuilder()
				.setCustomId(`ui:${view}:select:${embedPage}`)
				.setPlaceholder(placeholder)
				.addOptions(
				  ...rows.map((w) => ({
					label: w.label,
					value: w.label,
					default: selected ? w.label === selected : false,
				  }))
				);
			return new ActionRowBuilder().addComponents(menu);

		case "mapsPlayers":
			placeholder = "Select Map to View More Stats...";
			menu = new StringSelectMenuBuilder()
				.setCustomId(`ui:${view}:select:${embedPage}`)
				.setPlaceholder(placeholder)
				.addOptions(
				  ...rows.map((w) => ({
					label: w.label,
					value: w.label,
					default: selected ? w.label === selected : false,
				  }))
				);
			return new ActionRowBuilder().addComponents(menu);

		case "player":
			placeholder = "Select a Player to View More Stats..."
			options = rows.map((r, i) => {
				const absoluteRank = typeof r.rank === "number" ? r.rank : embedPage * 10 + i + 1;
				const prefix = absoluteRank <= 3 ? medals[absoluteRank - 1] : `#${absoluteRank}`;
				const maxName = Math.max(0, 100 - (prefix.length + 1));
				const name = (r?.name ?? r?.player_name ?? "");
				const label = `${prefix} ${String(name).slice(0, maxName)}`;
				return {
				  label,
				  value: String(r.client_id),
				  default: selected != null && String(r.client_id) === String(selected),
				};
			});
			menu = new StringSelectMenuBuilder()
				.setCustomId(`ui:${view}:select:${embedPage}`)
				.setPlaceholder(placeholder)
				.setMinValues(1)
				.setMaxValues(1)
				.addOptions(options);
			return new ActionRowBuilder().addComponents(menu);
		
		case "awards":
			placeholder = "Select an Award to View the Winner...";
			options = rows.map((r, i) => {
    
				const label = `${String(r.name).slice(0, 100)}`.trim();
				return {
					label,
					value: String(i),
					default: selected != null && String(i) === String(selected),
				};
			});
			menu = new StringSelectMenuBuilder()
				.setCustomId(`ui:${view}:select:${embedPage}`)
				.setPlaceholder(placeholder)
				.setMinValues(1)
				.setMaxValues(1)
				.addOptions(options);
			return new ActionRowBuilder().addComponents(menu);
	}
}

// -------------------------------------------------------------------------------------
// Profile Editor component custom id definitions
// -------------------------------------------------------------------------------------
const PROFILE_IDS = Object.freeze({
  EDIT_NAME_BTN:   (si, pid) => `profile:edit:name:${si}:${pid}`,
  EDIT_BG_BTN:     (si, pid, pg=0) => `profile:edit:bg:${si}:${pid}:${pg}`,
  EDIT_EMBLEM_BTN: (si, pid, pg=0) => `profile:edit:em:${si}:${pid}:${pg}`,
  EDIT_CS_BTN:     (si, pid, pg=0) => `profile:edit:cs:${si}:${pid}:${pg}`,
  PICK_BG:         (si, pid, pg) => `profile:pick:bg:${si}:${pid}:${pg}`,
  PICK_EM:         (si, pid, pg) => `profile:pick:em:${si}:${pid}:${pg}`,
  PICK_CS:         (si, pid, pg) => `profile:pick:cs:${si}:${pid}:${pg}`,
  PAGE_BG:         (si, pid, dir, pg) => `profile:page:bg:${si}:${pid}:${pg}:${dir}`,
  PAGE_EM:         (si, pid, dir, pg) => `profile:page:em:${si}:${pid}:${pg}:${dir}`,
  PAGE_CS:         (si, pid, dir, pg) => `profile:page:cs:${si}:${pid}:${pg}:${dir}`,
  NAME_MODAL:      (si, pid) => `profile:name:${si}:${pid}`,
});

// --------------------------------------------------------------------------------------
// Slash Command Definitions
// --------------------------------------------------------------------------------------
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

// ----------------------------------------------------------------------------------------------------
// Per Channel State Maps, register loads and activity
// ----------------------------------------------------------------------------------------------------
const perChannelState = new Map();
const perChannelLoadGate = new Map();
/* ************************************************************************
END CONSTANTS
***************************************************************************
START APP OPERATION FLOW
************************************************************************* */

//DEFINE CLIENT
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildMembers] });

/* ***************************************************************
process start with --register switch
---
if register argument is included then the bot will load new slash commands
otherwise it will login and start running with the currently loaded slash commands
**************************************************************** */

if (process.argv.includes("--register")) {
  register().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
} else {
  client.login(DISCORD_TOKEN);
}

/* ***************************************************************
client once ready, runs after successful login
---
if register argument is included then the bot will load new slash commands
otherwise it will login and start running with the currently loaded slash commands
**************************************************************** */

client.once(Events.ClientReady, async () => {
	console.log(`Logged in as ${client.user.tag}`);
  
	try {
		//if bot is connected to a discord server, load their custom emojis up for use with the bot
		if (!GUILD_ID) {
			//if not connected to discord server
			console.warn("[emoji] No GUILD_ID set in .env, skipping emoji resolver");
		} else {
			//is connected to a discord
			const guild = await client.guilds.fetch(GUILD_ID).catch(() => null); //load the discord
			if (!guild) {
				//discord couldn't load
				console.warn(`[emoji] Could not fetch guild ${GUILD_ID}`);
			} else {
				//succesful discord load - load the emojis
				const emojis = await guild.emojis.fetch();
				//create array for emoji storage
				const emojiIndex = new Map();

				//foreach emoji
				emojis.forEach(e => {
					//cast name to lowercase for key, fall back to "default" if name is somehow not defined.
					const key = (e.name || "default").toLowerCase(); 
					//set the mention format, ie. a: for animated and with trailing id. eg a:pegasus_knight:12345
					const mention = `<${e.animated ? "a" : ""}:${e.name}:${e.id}>`;
					//add emjoi to array
					emojiIndex.set(key, mention);
				});

				/* TODO: does this do anything, remove if this doesn't break
				setEmojiResolver((label) => {
					if (!label) return null;
					const k = String(label).replace(/:/g, "").toLowerCase().trim();
					return emojiIndex.get(k) ?? null;
				}); */
			
				if(XLR_DEBUG) console.log(`[emoji] loaded ${emojiIndex.size} emojis from guild ${guild.name}`);
			}
		}
	} catch (e) {
		//if discord or emojis fail to load.
		console.warn("[emoji] init failed:", e);
	}
	//for each server in the config
	for (let i = 0; i < SERVER_CONFIGS.length; i++) {
		//try catch on initializing UI for UO Server
		try { await ensureUIForServer(i); } catch (e) { console.error("ensureUIForServer", i, e); }
		//try catch on creating inactivity monitor per UI
		try {
			//set cfg to the current config
			const cfg = byIndex.get(i);
			//fetch the channel from discord.js return null if failed
			const channel = await client.channels.fetch(cfg.ui.channelId).catch(() => null);
			//if channel exists and channel is a text chat channel
			if (channel && channel.type === ChannelType.GuildText) {
				//create a collector
				const collector = channel.createMessageComponentCollector();
				//update perChannelState Array for channel Id - index, add collector.
				perChannelState.set(cfg.ui.channelId, { i, collectors: collector });
				//start the collector for channel and index
				startUiInactivitySession(perChannelState.get(cfg.ui.channelId).collectors, i, cfg, channel);
			}
		} catch (e) {
			console.warn("[ui] could not start inactivity session:", e);
		}
	}
});

/* ***************************************************************
client on interaction, runs after a component click or slash command
---
if register argument is included then the bot will load new slash commands
otherwise it will login and start running with the currently loaded slash commands
**************************************************************** */

client.on(Events.InteractionCreate, async (i) => {
	//try catch on interaction
	try {
		//profile component handlers 
		if (i.customId?.startsWith("profile:")) {
			await handleProfileComponent(i);
			return;
		}
		//slash command handlers
		if (i.isChatInputCommand()) {
			await handleSlashCommand(i);
			return;
		}
		//get serverIndex from ui click
		const serverIndex = getServerIndexFromComponent(i);
		//abort if invalid config
		if (serverIndex < 0){
			console.warn("ERR: Invalid Server Config!");
			console.log(i);
			return;
		}
		//ui component handler
		await handleUiComponent(i, serverIndex);
	} catch (e) {
		//log on error
		console.error("Interaction error:", e);
		//try catch for sending error message
		try {
			if (i.deferred || i.replied) {
				await sendWhisper(i,"Something went wrong.");
			} else {
				await sendWhisper(i, "Something went wrong.");
			} //just throw an error if message can't be posted
		} catch (err) { if (err?.name === "CanceledError" || err?.code === "ERR_CANCELED") { throw err; }}
	}
});

/* ***********************************************************
END APP OPERATION FLOW
**************************************************************
START CONFIG/SQL HELPER FUNCTIONS
************************************************************ */
/* ***********************************************************
register()
return void

registers slash commands with discord guild
************************************************************ */
async function register() {
  const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);
  if (GUILD_ID) {
    await rest.put(Routes.applicationGuildCommands(APPLICATION_ID, GUILD_ID), { body: commands });
    if(XLR_DEBUG) console.log("Registered guild commands");
  } else {
    await rest.put(Routes.applicationCommands(APPLICATION_ID), { body: commands });
	if(XLR_DEBUG) console.log("Registered global commands");
  }
}

/* ***************************************************************
collectServerConfigs( env: type-file [required])
return uniq: type-array

creates an array of server configurations from an env file
---
searches the env file for numerical suffixes eg MYSQL_DB_HOST_2
and groups the ones with the same suffixs together and then returns
unique configurations
**************************************************************** */
function collectServerConfigs(env) {
	//save configs to an array
	const configs = [];
	//look for base .env vars first (no numerical suffix)
	const first = readEnvSet(env, 1);
	//if any base .env vars exist add them to the first index
	if (first.hasAny) configs.push(first);

	// find all numeric suffixes present - Create new set of suffixes
	const suffixes = new Set(
		//breakout the keys from the env file
		Object.keys(env)
			//create an array of keys from numerical indexes
			.map(k => (k.match(/_(\d+)$/)?.[1]))
			//filter out failed matches
			.filter(Boolean)
			//create array out of numbers that survived the filter
			.map(s => Number(s))
			//filter out invalid numbers, start suffixes at 2
			.filter(n => Number.isFinite(n) && n >= 2)
	);
	
	//recreate suffixes array, sort it ascending order, step through each suffix
	[...suffixes].sort((a,b)=>a-b).forEach(n => {
		//look for env vars for numerical suffix n
		const cfg = readEnvSet(env, n);
		//if any env vars exist for n, add them to the latest index of configs
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
		if (!c.rcon.name) c.rcon.name = `Server ${c.n}`;
	}

	// filter out duplicates - create set of seen configs
	const seen = new Set();
	//create a new array of unique configs only
	const uniq = [];
	//loop through all the configs
	for (const c of configs) {
		//save the config vars to a string
		const key = `${c.ui.channelId ?? "nochan"}|${c.db.host}|${c.db.name}|${c.rcon.ip}:${c.rcon.port}|${c.rcon.name}`;
		//if config vars haven't been seen yet, mark them as seen and add them to unique array
		if (!seen.has(key)) { seen.add(key); uniq.push(c); }
	}
	//return unique configs
	return uniq;
}

/* ***************************************************************
readEnvSet( env: type-file [required],
			n: type-int [optional, 1])
return {}: type-object
reads the env for the server configurations, starting with the
specified numeric suffix
---
returns an object of the index, db env vars, rcon env vars, discord env vars, hasAny flag
DB ENV VARS:	MYSQL_B3_HOST,
				MYSQL_B3_DB,
				MYSQL_B3_USER,
				MYSQL_B3_PASSWORD,
RCON ENV VARS:	B3_RCON_IP,
				B3_RCON_PORT,
				XLR_SERVER_NAME,
DISC ENV VARS:	CHANNEL_ID,
				UI_NAV_MESSAGE_ID,
				UI_CONTENT_MESSAGE_ID
			
**************************************************************** */
function readEnvSet(env, n = 1) {
	//set the suffix to the digit if its not the first set
	const suf = n === 1 ? "" : `_${n}`;
	//trim the output of the getter, set value to string
	const get = (k) => env[`${k}${suf}`]?.toString().trim();

	//store database related vars to db object
	const db = {
		host: get("MYSQL_B3_HOST") || "db",
		name: get("MYSQL_B3_DB"),
		user: get("MYSQL_B3_USER"),
		pass: get("MYSQL_B3_PASSWORD"),
	};
	//store coduo server related vars to rcon object
	const rcon = {
		ip: get("B3_RCON_IP"),
		port: get("B3_RCON_PORT"),
		name: get("XLR_SERVER_NAME") || null,
	};
	//store discord server related vars to ui object
	const ui = {
		channelId: get("CHANNEL_ID") || null,
		navId: get("UI_NAV_MESSAGE_ID") || null,
		contentId: get("UI_CONTENT_MESSAGE_ID") || null,
	};
	//set flag if any of these vars are set.
	const hasAny = db.name || db.user || db.pass || db.host || rcon.ip || rcon.port || ui.channelId || rcon.name;
	return { n, db, rcon, ui, hasAny };
}

/* ***************************************************************
upsertEnv( 	key: type-string [required],
			value: type-string [required]
			)
return void

inserts new value into env file
---
matches a key value pair and replaces it in env file
**************************************************************** */
function upsertEnv(key, value) {
	//load env file
	const ENV_PATH = path.resolve(process.cwd(), ".env");
	//match new lines
	const lines = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, "utf8").split(/\r?\n/) : [];
	//get index of line that starts with the key
	const idx = lines.findIndex(l => l.startsWith(`${key}=`));
	//if index is found, update value
	if (idx >= 0) lines[idx] = `${key}=${value}`;
	//otherwise create new line
	else lines.push(`${key}=${value}`);
	//save file
	fs.writeFileSync(ENV_PATH, lines.join("\n"), "utf8");
	//update env variable
	process.env[key] = value;
}

/* ***************************************************************
getPoolByIndex( idx: type-int [required])
return pool: type-db handle

retrieves a db handle from the specified index
---
returns a db handle for performing sql operations
**************************************************************** */
function getPoolByIndex(idx) {
  const pool = pools[idx];
  if (!pool) throw new Error(`No DB pool for server index ${idx}`);
  return pool;
}

/* ***************************************************************
runQueryOn( idx: type-int [required],
			sql: type-string [required],
			params: type-array[optional, []])
return rows: type-array of row objects

runs specified query on specifeid server index.
---
returns the results of the query as an array of objects where the column name are properties on the row object.
**************************************************************** */
async function runQueryOn(idx, sql, params = []) {
  const [rows] = await getPoolByIndex(idx).query(sql, params);
  return rows;
}

/* ***************************************************************
insertPlayerCardDetails( rows: type-array [required])
return array: type-array

adds playerCard details onto SQL query results
---
returns edited SQL query results
**************************************************************** */
async function insertPlayerCardDetails(rows, serverIndex) {
	return await Promise.all(
		rows.map(async (r) => {
			const [pc]   = await runQueryOn(serverIndex, queries.getPlayerCardRow, [r.client_id]);
			const bg = Number(pc?.background ?? 0) || 0;
			const em = Number(pc?.emblem ?? 0) || 0;
			const cs = Number(pc?.callsign ?? 0) || 0;
			return { ...r, name: (await displayName(r, r.name, serverIndex, true)) || r.name, em: em, cs: cs, bg: bg  };
		})
	);
}

/* ***********************************************************
END CONFIG/SQL HELPER FUNCTIONS
**************************************************************
START -- LOAD -- TIMEOUT -- ACTIVITY -- HELPER FUNCTIONS
************************************************************ */

/* **************************************************************
loadMessage( 	i: type-discord interaction [required],
					cfg: type-obj [required],
					
					)
return void

updates the UI for the CODUO Server at given index
---
uses discord.js package to update messages for bot UO
*************************************************************** */
async function loadMessage(i, cfg, gate) {
	
	const embed = formatLoadEmbed();
	
	const LOADING_GIF_PATH = path.resolve(process.cwd(), "assets", "load.gif");
	const filename = 'load.gif';
	const file = new AttachmentBuilder(LOADING_GIF_PATH, { name: filename });

	embed.setImage(`attachment://${filename}`);

	const files = [file];
	
	await sendMessage(i, cfg, gate, [], [embed], "Loading...", [], files);
	
	return;
}
/* ***************************************************************
sendMessage( 	i: type-discord interaction [required],
					cfg: type-obj [required],
					navComponents: type-discord component [required],
					contentEmbeds: type-discord embed [required],
					footerText: type- string [optional, ""],
					contentComponents: type- discord component [optional, []],
					files: type- discord attachment [optional, []]
					)
return void

updates the UI for the CODUO Server at given index
---
uses discord.js package to update messages for bot UO
**************************************************************** */
async function sendMessage(i, cfg, gate, navComponents, contentEmbeds, footerText = "", contentComponents = [], files = []) {

	gate = gate ? gate : beginChannelLoad(cfg.ui.channelId);
	const state = perChannelState.get(cfg.ui.channelId);
	//get UI Activity Collector
	const uiCollector = state?.collectors || null;
	
	//get channel id from interaction or config
	const channel =
	  (i?.channel && i.channel.isTextBased?.() ? i.channel : null) ??
	  (i?.isTextBased?.() ? i : null) ??
	  (await i.client.channels.fetch(i?.channelId ?? cfg.ui.channelId));

	if (navComponents && navComponents.length > 0) {
		//UPDATE NAV
		const navMsg = await channel.messages.fetch(cfg.ui.navId);
		//abort message edit if load has been interupted by new click
		if (isStale(cfg.ui.channelId, gate.token)) return;
		await navMsg.edit({embeds: [], components: navComponents });
	}
	
	footerText = footerText ? footerText : contentEmbeds[contentEmbeds.length - 1].data.footer.text ?? " ";
	//EDIT FOOTER
	const ZERO_WIDTH = "⠀";
	const padLen = Math.min(Math.floor(footerText.length * 0.65) ?? 1, 2048);	
	const blankText = ZERO_WIDTH.repeat(padLen);
	for(const e of contentEmbeds){
		e.setFooter({ text: blankText });
	}
	contentEmbeds[contentEmbeds.length - 1].data.footer.text = footerText;
	//UPDATE CONTENT
	//get the content message id from config
	const contentMsg = await channel.messages.fetch(cfg.ui.contentId);
	//abort message edit if load has been interupted by new click
	
	if (isStale(cfg.ui.channelId, gate.token)) return;
	
	//edit contentMsg with payload
	await contentMsg.edit({ embeds: contentEmbeds, components: contentComponents, files: files ?? [] });
  	
    if (uiCollector) uiCollector.resetTimer({ idle: INACTIVITY_MS });
		return;
    
}

/* ***************************************************************
sendWhisper( 	i: type-discord interaction [required],
					content: type-string  )
return void

sends an ephemeral private message to whoever started the interaction
---
uses discord.js package to send whispers for bot UO
**************************************************************** */
async function sendWhisper(i, content) {
	await i.reply({ content: content, flags: MessageFlags.Ephemeral });
}

/* ***************************************************************
sendReply( 	i: type-discord interaction [required],
					contentEmbeds: type-discord embed [required],
					contentComponents: type- discord component [optional, []],
					footerText: type- string [optional, ""],
					files: type- discord attachment [optional, []]
					)
return uniq: type-array

updates the UI for the CODUO Server at given index
---
uses discord.js package to update messages for bot UO
**************************************************************** */
async function sendReply(i, contentEmbeds = [],  contentComponents = [], footerText = "", files = [] ) {
	let contentFlag = false;
	let componentFlag = false;
	let filesFlag = false;
	
	//if embed included in message
	if(contentEmbeds.length > 0){
		//set footer text
		if(footerText)
			contentEmbeds[contentEmbeds.length - 1].setFooter({ text: footerText });
		//set content Flag
		contentFlag = true;
	}
	//if navs are included in message
	if(contentComponents.length > 0)
		componentFlag = true;
	
	//if files need updated
	if(files.length > 0)
		filesFlag = true;
	
	let message = {};
	
	if(contentFlag)
		message.embeds = contentEmbeds;
	if(componentFlag)
		message.components = contentComponents;
	if(filesFlag)
		message.files = files;
	
	await i.reply(message);
}

/* ***************************************************************
sendDM( 	i: type-discord interaction [required],
					contentEmbeds: type-discord embed [required],
					contentComponents: type- discord component [optional, []],
					footerText: type- string [optional, ""],
					files: type- discord attachment [optional, []]
					)
return uniq: type-array

updates the UI for the CODUO Server at given index
---
uses discord.js package to update messages for bot UO
**************************************************************** */
async function sendDM(i, contentEmbeds = [],  contentComponents = [], footerText = "", files = [] ) {
	let contentFlag = false;
	let componentFlag = false;
	let filesFlag = false;
	
	//if embed included in message
	if(contentEmbeds.length > 0){
		//set footer text
		if(footerText)
			contentEmbeds[contentEmbeds.length - 1].setFooter({ text: footerText });
		//set content Flag
		contentFlag = true;
	}
	//if navs are included in message
	if(contentComponents.length > 0)
		componentFlag = true;
	
	//if files need updated
	if(files.length > 0)
		filesFlag = true;
	
	let message = {};
	
	if(contentFlag)
		message.embeds = contentEmbeds;
	if(componentFlag)
		message.components = contentComponents;
	if(filesFlag)
		message.files = files;
	
	await i.update(message);
}

/* ***************************************************************
ensureUIForServer( serverIndex: type-int [required])
return uniq: type-array

initializes the UI for the CODUO Server at given index
---
creates nav and content components, inserts the IDs into the env 
if not present at starts a loadGate for UI clicks
**************************************************************** */
async function ensureUIForServer(serverIndex) {
	//get config for server
	const cfg = byIndex.get(serverIndex);
	//if there is no specified channel for server then no need for a UI. (can still use commands)
	if (!cfg?.ui.channelId) return;

	//get the channel
	const channel = await client.channels.fetch(cfg.ui.channelId).catch(() => null);
	//if the channel doesn't exist or its not a text based channel then we can't build a UI
	if (!channel || channel.type !== ChannelType.GuildText) return;

	// initialize HOME view
	// Create a load gate
	const gate = beginChannelLoad(cfg.ui.channelId);
	//
	const initial = await buildView(serverIndex, {
		view: VIEWS.HOME,
		signal: gate.signal,
		token: gate.token,
		channelId: cfg.ui.channelId
	});
	if (initial?.stale) return; // superseded before finishing


	// Load Nav Message
	let navMsg = cfg.ui.navId ? await channel.messages.fetch(cfg.ui.navId).catch(()=>null) : null;
	if (!navMsg) {
		//If Nav Message couldn't load, it must not exist, recreate it and update env
		upsertEnvForServer(cfg.n, "UI_NAV_MESSAGE_ID", navMsg.id);
		cfg.ui.navId = navMsg.id;
	}

	//Load Content Message
	let contentMsg = cfg.ui.contentId ? await channel.messages.fetch(cfg.ui.contentId).catch(()=>null) : null;
	if (!contentMsg) {
		//If content Message couldn't load, it must not exist, recreate it and update env
		upsertEnvForServer(cfg.n, "UI_CONTENT_MESSAGE_ID", contentMsg.id);
		cfg.ui.contentId = contentMsg.id;
	}
    //Send message
	sendMessage(channel, cfg, gate, initial.nav, initial.embeds, initial.footerText)
}

/* ***************************************************************
startUiInactivitySession( 	uiCollector: type-string [required],
							serverIndex: type-int [required],
							cfg: type-obj [required],
							channel: type-string [required])
return void

starts the idle activity timer and refreshes UI on set interval

**************************************************************** */
async function startUiInactivitySession(uiCollector,serverIndex,cfg, channel) {
	// Stop an old one if it exists
	if (uiCollector) {
		//try catch on uiCollector termination
		try { uiCollector.stop('restart'); } catch (err) { if (err?.name === "CanceledError" || err?.code === "ERR_CANCELED") { throw err; }}
		//null out collector regardless
		uiCollector = null;
	}

	// Only collect our UI buttons in the target channel + for our 2 UI messages
	uiCollector = channel.createMessageComponentCollector({
		//set idle time
		idle: INACTIVITY_MS,
		//filter interactions to just ui components:
		filter: (i) =>
			i.customId?.startsWith('ui:') &&
			(i.message?.id === cfg.ui.contentId || i.message?.id === cfg.ui.navId)
	});

	//on timer end
	uiCollector.on('end', async (_collected, reason) => {
		//if ended because of timer
		if (reason === 'idle') {
			//try catch on Home refresh
			try {
				// Auto-refresh Home on idle, even if already on Home - build load gate
				const gate = beginChannelLoad(cfg.ui.channelId);
				const payload = await buildView(serverIndex, { view: VIEWS.HOME, page: 0, signal: gate.signal, token: gate.token, channelId: cfg.ui.channelId });
				if (payload?.stale || isStale(cfg.ui.channelId, gate.token)) return;

				if (payload?.hadError) {
					console.warn("[ui] idle refresh: aborting edit due to upstream error");
				} else {
					if (isStale(cfg.ui.channelId, gate.token)) return;
					// Send Message
					await sendMessage(channel, cfg, gate, payload.nav, payload.embeds, payload.footerText);

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

/* ***************************************************************
beginChannelLoad( channelId: type-string [required])
return {}: type-obj

creates a load gate for the specified channel, aborts the previous load in progress if necessary
---
returns obj with load gate signal and token
**************************************************************** */
function beginChannelLoad(channelId) {
	//get previous load
	const prev = perChannelLoadGate.get(channelId);
	//if a previous load existed
	if (prev?.controller) {
		//try to abort it.
		try { prev.controller.abort(); } catch (err) { if (err?.name === "CanceledError" || err?.code === "ERR_CANCELED") { throw err; }}
	}
	//create a new abort controller
	const controller = new AbortController();
	//timestamp the token
	const token = Symbol(`load:${channelId}:${Date.now()}`);
	//save the latest load to the load gate
	perChannelLoadGate.set(channelId, { controller, token });
	
	return { signal: controller.signal, token };
}

/* ***************************************************************
isStale( channelId: type-string [required],
		 token: type-string [required])
return boolean.

returns true if token has changed (and therefore the click has been overwritten
returns false if token is the same (no new clicks to overwrite current op
**************************************************************** */
function isStale(channelId, token) {
  return perChannelLoadGate.get(channelId)?.token !== token;
}
/* ***********************************************************
END -- LOAD -- TIMEOUT -- ACTIVITY -- HELPER FUNCTIONS
**************************************************************
START VIEW BUILDER HELPER FUNCTIONS
************************************************************ */
/* ***************************************************************
buildView( 	serverIndex: type-int [required],
			{ view: type-string [required],
			  signal: type-string [required],
			  token: type-string [required],
			  channelId: type-string [required],
			  embedPage type-int [optional, 0],
			  param: type-object [optional, null,
			  stringSelectPage: type-int [optional, 0]
			})
return {}: type-obj

sorts the view and params and sends it to the appropriate view builder
---
returns discord js message obj
**************************************************************** */
async function buildView(serverIndex, { view, signal, token, channelId, embedPage = 0, label = null, stringSelectPage = 0 }) {
  
  if (view === VIEWS.HOME) {
    return await buildHome(serverIndex,  signal, token, channelId);
  }
  if (view === VIEWS.PLAYER) {
    return await buildPlayer(serverIndex,  signal, token, channelId, label, embedPage);
  }
  if (view === VIEWS.LADDER) {
    return await buildLadder(serverIndex,  signal, token, channelId, embedPage);
  }
  if (view === VIEWS.WEAPONS) {
    return await buildWeapons(serverIndex,  signal, token, channelId, embedPage);
  }
  if (view === VIEWS.WEAPON_PLAYERS) {
    return await buildWeaponPlayers(serverIndex,  signal, token, channelId, label, embedPage, stringSelectPage ?? 0);
  }
  if (view === VIEWS.MAPS) {
    return await buildMaps(serverIndex,  signal, token, channelId, embedPage);
  }
  if (view === VIEWS.MAPS_PLAYERS) {
    return await buildMapPlayers(serverIndex,  signal, token, channelId, label, embedPage, stringSelectPage ?? 0);
  }
  if(view === VIEWS.AWARDS) {
	return label ? await buildAward(serverIndex,  signal, token, channelId, awards.find(a => a.name === label) || awards[0], embedPage, stringSelectPage ?? 0) : await buildAwards(serverIndex,  signal, token, channelId, embedPage);
  }
}

/* ***************************************************************
buildHome( 	serverIndex: type-int [required],
			ctx: type-obj [ 
			  signal: type-string [required],
			  token: type-string [required],
			  channelId: type-string [required]
			])
return {}: type-obj

builds the UI home page (server status page and some basic stats)
---
returns discord js message obj
**************************************************************** */
async function buildHome(serverIndex, signal, token, channelId) {
	//get config
	const cfg = byIndex.get(serverIndex);
	
	//define vars
	let totals, status;
	let hadError = false;

	try {
		//try catch on getting totals from SQL
		totals = await getHomeTotals(serverIndex);
	} catch (e) {
		//log error on failure and just set stats to zero
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
	//try catch on fetching Server Status from cod.pm
	try {
		status = await fetchServerStatus(cfg.rcon.ip, cfg.rcon.port, signal);
		//server status loaded but returned error - set error flag
		if (status && status.error) hadError = true;
	} catch (e) {
		// If this was canceled by a newer click, just return "stale" when we have a ctx
		if ((e?.name === "CanceledError" || e?.code === "ERR_CANCELED")) {
			return { stale: true };
		}
		// otherwise set error flag on status load failed
		hadError = true;
		// set status to error
		status = { error: summarizeAxiosError(e) };
	}

	// Only do staleness checks if a ctx was provided
	if (isStale(channelId, token)) return { stale: true };
	
	//format home page
	const contentEmbeds = renderHomeEmbed({ totals }, status, TZ, cfg.rcon.ip, cfg.rcon.port);
	const navComponents = [navRow(VIEWS.HOME)];
	const footerText = contentEmbeds[contentEmbeds.length - 1].data.footer.text;
	
	return { embeds: contentEmbeds, nav: navComponents, footerText, hadError };
}

/* ***************************************************************
buildLadder( 	serverIndex: type-int [required],
				ctx: type-obj [ 
				signal: type-string [required],
				token: type-string [required],
				channelId: type-string [required]
				],
				page: type-int [optional, 0]
			)
return {}: type-obj

builds the UI ladder page (sort players by skill)
---
returns discord js message obj
**************************************************************** */
async function buildLadder(serverIndex,  signal, token, channelId, page=0) {
	
	const offset = page * 10;
	const [rows, total] = await Promise.all([
		getLadderSlice(serverIndex, offset, 10),
		getLadderCount(serverIndex)
	]);

	// PRE-ENRICH: fetch Discord username for titles/labels
	const rowsWithNames = await insertPlayerCardDetails(rows, serverIndex);
	const embeds = renderLadderEmbeds({ rows: rowsWithNames, page });
	const pager = [pagerRow(VIEWS.LADDER, page, page>0, offset + 10 < total)];
	const nav   = [navRow(VIEWS.LADDER), stringSelectRowForPage(VIEWS.PLAYER, rowsWithNames, page, null)];

	return { embeds, nav, pager};
}

async function buildPlayer(serverIndex, signal, token, channelId, label, page = 0){
	const clientId = label;
	//load stats
	let details = await runQueryOn(serverIndex, queries.playerCard, [clientId, clientId, clientId]);
	if (!details.length) {
		await sendWhisper(i,`No stats on this server for **${details[0].name}**.`);
		return;
	}
	//add playercard details to query results
	details = await insertPlayerCardDetails(details, serverIndex);
	//generate embed
	const [embed, files] = await formatPlayerEmbed(details[0]);
	
	const offset = page * 10;
	const [rows, total] = await Promise.all([
		getLadderSlice(serverIndex, offset, 10),
		getLadderCount(serverIndex)
	]);

	// PRE-ENRICH: fetch Discord username for titles/labels
	const rowsWithNames = await insertPlayerCardDetails(rows, serverIndex);
	const pager = [pagerRow(VIEWS.LADDER, page, page>0, offset + 10 < total)];
	const nav   = [navRow(VIEWS.LADDER), stringSelectRowForPage(VIEWS.PLAYER, rowsWithNames, page, null)];
	
	return { embeds: [embed], nav, pager, files};
}

/* ***************************************************************
buildWeapons( 	serverIndex: type-int [required],
				ctx: type-obj [ 
				signal: type-string [required],
				token: type-string [required],
				channelId: type-string [required]
				],
				page: type-int [optional, 0]
			)
return {}: type-obj

builds the UI weapon ladder page (sort weapons by kills)
---
returns discord js message obj
**************************************************************** */
async function buildWeapons(serverIndex,  signal, token, channelId, page=0) {

	const offset = page * 10;
	const [rows, total] = await Promise.all([
		getWeaponsSlice(serverIndex, offset, 10),
		getWeaponsCount(serverIndex)
	]);
	if (channelId && token && isStale(channelId, token)) return { stale: true };
	const embeds = renderWeaponsEmbeds({ rows, page });
	const pager = [pagerRow(VIEWS.WEAPONS, page, page>0, offset + 10 < total)];
	const nav = [navRow(VIEWS.WEAPONS), stringSelectRowForPage(VIEWS.WEAPON_PLAYERS, rows, page, null)];
	return { embeds, nav, pager };
}

/* ***************************************************************
buildWeaponsPlayers( 	serverIndex: type-int [required],
				ctx: type-obj [ 
				signal: type-string [required],
				token: type-string [required],
				channelId: type-string [required]
				],
				page: type-int [optional, 0]
			)
return {}: type-obj

builds the UI weapon ladder page (sort weapons by kills)
---
returns discord js message obj
**************************************************************** */
async function buildWeaponPlayers(serverIndex,  signal, token, channelId, weaponLabel, playerPage=0, weaponsPage=0) {
  
  const pageSize = 10;
  const offset   = playerPage * pageSize;
  const [rows, total, weaponsRows] = await Promise.all([
    getPlayerWeaponSlice(serverIndex, weaponLabel, offset, pageSize),
    getPlayerWeaponCount(serverIndex, weaponLabel),
    getWeaponsSlice(serverIndex, weaponsPage * pageSize, pageSize),
  ]);
  
  if (channelId && token && isStale(channelId, token)) return { stale: true };
  
  const weap = (rows && rows[0]?.matched_label) || weaponLabel;
  const emoji = resolveEmoji(weap);
  const title = `Top Players by Weapon: ${emoji ? `${emoji} ${weap}` : weap}`;
  const embeds = formatTopEmbed(rows, title, { thumbnail: DEFAULT_THUMB, offset });
  
  const hasNext = offset + pageSize < total;
  const pager   = [pagerRowWithParams(VIEWS.WEAPON_PLAYERS, playerPage, playerPage > 0, hasNext, weap, weaponsPage)];
  const nav = [navRow(VIEWS.WEAPONS), stringSelectRowForPage(VIEWS.WEAPON_PLAYERS, weaponsRows, weaponsPage, weap)];
  return { embeds: embeds, nav: nav, pager: pager };
}

/* ***************************************************************
buildMaps( 	serverIndex: type-int [required],
			ctx: type-obj [ 
			signal: type-string [required],
			token: type-string [required],
			channelId: type-string [required]
			],
			page: type-int [optional, 0]
			)
return {}: type-obj

builds the UI map ladder page (sort mpas by rounds played)
---
returns discord js message obj
**************************************************************** */
async function buildMaps(serverIndex,  signal, token, channelId, page=0) {

  const offset = page * 10;
  const [rows, total] = await Promise.all([
    getMapsSlice(serverIndex, offset, 10, signal),
    getMapsCount(serverIndex)
  ]);
  if (channelId && token && isStale(channelId, token)) return { stale: true };
  const embeds = renderMapsEmbeds({ rows, page });
  const pager = [pagerRow(VIEWS.MAPS, page, page>0, offset + 10 < total)];
  const nav = [navRow(VIEWS.MAPS), stringSelectRowForPage(VIEWS.MAPS_PLAYERS,rows, page, null)];
  return { embeds, nav, pager};
}

/* ***************************************************************
buildMapsPlayers( 	serverIndex: type-int [required],
				ctx: type-obj [ 
				signal: type-string [required],
				token: type-string [required],
				channelId: type-string [required]
				],
				page: type-int [optional, 0]
			)
return {}: type-obj

builds the UI map ladder page (sort players by rounds played)
---
returns discord js message obj
**************************************************************** */
async function buildMapPlayers(serverIndex,  signal, token, channelId, mapLabel, playerPage=0, mapsPage=0) {
	
  const pageSize = 10;
  const offset   = playerPage * pageSize;
  const [rows, total, mapsRows] = await Promise.all([
    getPlayerMapSlice(serverIndex, mapLabel, offset, pageSize),
    getPlayerMapCount(serverIndex, mapLabel),
    getMapsSlice(serverIndex, mapsPage * pageSize, pageSize, signal),
  ]);
  if (channelId && token && isStale(channelId, token)) return { stale: true };
  const thumbUrl = (await getMapImageUrl(mapLabel, signal)) || DEFAULT_THUMB;
  const embeds = formatTopEmbed(rows, `Top Players by Map: ${mapLabel}`, { thumbnail: thumbUrl, offset });

  const hasNext = offset + pageSize < total;
  const pager   = [pagerRowWithParams(VIEWS.MAPS_PLAYERS, playerPage, playerPage > 0, hasNext, mapLabel, mapsPage)];
  const nav = [navRow(VIEWS.MAPS), stringSelectRowForPage(VIEWS.MAPS_PLAYERS, mapsRows, mapsPage, mapLabel)];
  return { embeds: embeds, nav: nav, pager: pager };
}

/* ***************************************************************
buildAwards( 	serverIndex: type-int [required],
			ctx: type-obj [ 
			signal: type-string [required],
			token: type-string [required],
			channelId: type-string [required]
			],
			page: type-int [optional, 0]
			)
return {}: type-obj

builds the UI award ladder page (sort awards by index)
---
returns discord js message obj
**************************************************************** */
async function buildAwards(serverIndex,  signal, token, channelId, page=0) {
  const offset = page * 10;
  const baseRows = awards.slice(offset, offset + 10);
  const rows = await Promise.all(baseRows.map(async (aw) => {
	  const top = await runQueryOn(serverIndex, aw.query, [1, 0]).then(r => r?.[0] || null);
	  if (top) top.name = await displayName(top, top.name, serverIndex, true);
	  return { ...aw, top };
  }));
	if (channelId && token && isStale(channelId, token)) return { stale: true };
  const total  = awards.length;

  const embeds = renderAwardsEmbeds({ rows, page });
  const pager  = [pagerRow(VIEWS.AWARDS, page, page > 0, offset + 10 < total)];
  const nav    = [navRow(VIEWS.AWARDS), stringSelectRowForPage(VIEWS.AWARDS, rows, page, null)];

  return { embeds: embeds, nav, pager };
}

/* ***************************************************************
buildAward( 	serverIndex: type-int [required],
			ctx: type-obj [ 
			signal: type-string [required],
			token: type-string [required],
			channelId: type-string [required]
			],
			award: type-int [required],
			page: type-int [optional, 0],
			playerPage: type-int [optional,0],
			awardsPage: type-int [optional,0]
			)
return {}: type-obj

builds the UI award ladder page (sort players by position)
---
returns discord js message obj
**************************************************************** */
async function buildAward(serverIndex,  signal, token, channelId, award, playerPage=0, awardsPage=0) {
  const pageSize = 10;
  const offset   = playerPage * pageSize;
  const [rows, total] = await Promise.all([
    (async () => {
      const data = await runQueryOn(serverIndex, award.query, [pageSize, offset]);
      const mapped = await Promise.all(data.map(async (r, i) => ({ ...r, rank: offset + i + 1 , name: (await displayName(r, r.name, serverIndex, true)) || r.name })));
      return mapped;
    })(),
    pageSize,
  ]);
  if (channelId && token && isStale(channelId, token)) return { stale: true };
  const thumbUrl = DEFAULT_THUMB; //(await getMapImageUrl(mapLabel, signal)) || DEFAULT_THUMB;
  const embeds = formatAwardEmbed(rows, award.name, award.emoji, award.properties, { thumbnail: thumbUrl, offset });
  
  const hasNext = rows.length === pageSize;
  const pager   = [pagerRowWithParams(VIEWS.AWARDS, playerPage, playerPage > 0, hasNext, award.name, awardsPage)];
  const currentAwardsPageRows = awards.slice(awardsPage * 10, awardsPage * 10 + 10);
  const nav = [navRow(VIEWS.AWARDS), stringSelectRowForPage(VIEWS.AWARDS, currentAwardsPageRows, awardsPage, null)];
  return { embeds: embeds, nav: nav, pager: pager};
}

/* ***************************************************************
buildProfileDm( 	serverIndex: type-int [required],
					clientId: type-string [required])
return {}: type-obj

builds the profile editor UI and returns it ready to send
---
returns discord js message obj
**************************************************************** */
async function buildProfileDm(serverIndex, clientId ){
	//load card (player stats, pc (playercard elements), and preferredName 
	let { card, pc, preferredName } = await loadProfileData(serverIndex, clientId);
	if (!card) return { content: "No stats found for your account on this server." };

	console.log(card);

	card = insertPlayerCardDetails(card, serverIndex);

	// Get a playercard embed
	const [statsEmbed, files] = await formatPlayerEmbed(card, { thumbnail: DEFAULT_THUMB });

	// Controls
	const rowButtons = buildDmNavRow(serverIndex, clientId);
	const display = preferredName || card.name;
	const bg = Number(pc?.background ?? 0) || 0;
	const em = Number(pc?.emblem ?? 0) || 0;
	const cs = Number(pc?.callsign ?? 0) || 0;
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
		files: files,
		embeds: [summary, statsEmbed],
		components: [rowButtons]
	};
}

/* ************************************************************************************
END VIEW BUILDER HELPER FUNCTIONS
***************************************************************************************
START INTERACTION HANDLER FUNCTIONS
************************************************************************************* */
/* ***************************************************************
handleProfileComponent( 	i: type-discord interaction [required] )
return void

handles profile component clicks

**************************************************************** */
async function handleProfileComponent(i) {
	
	//Handle Button Clicks
	if (i.isButton() && i.customId?.startsWith("profile:")) {
		await handleProfileButton(i);
	}

	// Handle String Select
	if (i.isStringSelectMenu() && i.customId?.startsWith("profile:pick:")) {
		await handleProfileStringSelect(i);
	  }

  // Handle Modal — save preferred name
	if (i.isModalSubmit() && i.customId?.startsWith("profile:name:")) {
		await handleProfileModal(i);
  }
	
}

/* ***************************************************************
handleProfileButton( 	i: type-discord interaction [required] )
return void

handles button clicks on profile edit DMs

**************************************************************** */
async function handleProfileButton(i) {
	//explode customId on semicolon - profile:edit:name:si:pid or profile:edit:bg:si:pid:page
	const parts = i.customId.split(":");
	//get variables from exploded custom id parts
    const [, action, sub, siStr, pidStr, pageStr, dir] = parts;
	//cast variables to number
    const si = Number(siStr), pid = Number(pidStr);
    const page = Number(pageStr || 0);
	//edit preferred_name interaction
    if (action === "edit" && sub === "name") {
		//create name text entry modal
		const modal = new ModalBuilder()
			.setCustomId(PROFILE_IDS.NAME_MODAL(si, pid))
			.setTitle("Set Preferred Name");
		const input = new TextInputBuilder()
			.setCustomId("preferred_name")
			.setLabel("Preferred display name (max 64)")
			.setStyle(TextInputStyle.Short)
			.setMaxLength(64)
			.setRequired(true);
		//spawn modal
		modal.addComponents(new ActionRowBuilder().addComponents(input));
		await i.showModal(modal);
		return;
    }
	//playercard button interaction
    if (action === "edit" && (sub === "bg" || sub === "em" || sub === "cs")) {
		const rows = buildDmPickerRow(sub === "bg" ? "bg" : sub === "em" ? "em" : "cs", si, pid, page);
		await sendDM(i, [], rows);
		return;
    }
	//next previous page interactions
	if (action === "page") {

		// Clamp target page so we never render an empty select
		const total   = sub === "bg" ? BACKGROUNDS.length
						: sub === "em" ? EMBLEMS.length
									  : CALLSIGNS.length;
		//25 items per select page
		const per     = 25;
		//calculate the last page
		const maxPage = Math.max(0, Math.ceil(total / per) - 1);
		//calculate whether there is a next or previous page or not
		const next    = dir === "prev" ? cur - 1 : cur + 1;
		const clamped = Math.min(maxPage, Math.max(0, next));

		const rows = buildDmPickerRow(sub === "bg" ? "bg" : sub === "em" ? "em" : "cs", si, pid, page);
		await sendDM(i, [], rows);
		return;
	}
}

/* ***************************************************************
handleProfileStringSelect( 	i: type-discord interaction [required] )
return void

handles String Select clicks on profile edit DMs

**************************************************************** */
async function handleProfileStringSelect(i){
	//explode customId on semicolon
	const [, , kind, siStr, pidStr, pageStr] = i.customId.split(":");
	const si = Number(siStr), pid = Number(pidStr);
	const page = Number(pageStr || 0);
	const picked = Number(i.values[0]); // absolute index from array

	//try catch on setter queries
	try {
		//set playercard element
		if (kind === "bg") {
			await runQueryOn(si, queries.setPlayerCardBackground, [pid, picked]);
		} else if (kind === "em") {
			await runQueryOn(si, queries.setPlayerCardEmblem, [pid, picked]);
		} else if (kind === "cs") {
			await runQueryOn(si, queries.setPlayerCardCallsign, [pid, picked]);
		}
		// Rebuild DM with new banner + reset to main buttons row
		const payload = await buildProfileDmPayload(si, pid, i.user.id);
		await sendDM(i, payload.embeds, payload.components, "", payload.files);
	} catch (e) {
		//log on error.
		console.error("[profile] save failed:", e);
		//notify user
		await sendWhisper(i, "Saving failed. Try again.");
	}
	return;
}

/* ***************************************************************
handleProfileModal( 	i: type-discord interaction [required] )
return void

handles modal submits on profile edit DMs

**************************************************************** */
async function handleProfileModal(i){
	//explode custom id on semicolon
	const [, , siStr, pidStr] = i.customId.split(":");
	//server index - player id
    const si = Number(siStr), pid = Number(pidStr);
	//get preferred name from modal input
    const name = i.fields.getTextInputValue("preferred_name")?.trim()?.slice(0,64) || null;

	//try catch on setter query
    try {
		await runQueryOn(si, "UPDATE clients SET preferred_name = ? WHERE id = ?", [name, pid]);
		//rebuild UI on submit
		const payload = await buildProfileDmPayload(si, pid, i.user.id);
		await sendDM(i, payload.embeds, payload.components, "", payload.files);
    } catch (e) {
		//log on failure
		console.error("[profile] name save failed:", e);
		//notify user
		await sendWhisper(i , "Saving failed. Try again.");
    }
    return;
}

/* ***************************************************************
handleSlashCommand( 	i: type-discord interaction [required] )
return void

handles slash command routing

**************************************************************** */
async function handleSlashCommand(i) {
	//log command execution
	if(XLR_DEBUG) console.log(`[slash] ${i.commandName} in #${i.channel?.id || "?"}`);

	try {
	  if (!i.deferred && !i.replied) {
		  //update loading screen
		  await i.deferUpdate(); // acknowledges the interaction
	  }
	} catch (e) {
	  // If already acknowledged somewhere else, ignore
	}

	//try catch on command execution
	try {
		
		const serverIndex = resolveServerIndexFromInteraction(i);
		const cfg = byIndex.get(serverIndex);
		
		let count, rows, clientId, embed;
		
		switch(i.commandName){
			case "xlr-servers":
				//get the server 
				const lines = SERVER_CONFIGS.map((c, idx) => {
					const chan = c.channelId ? `#${c.ui.channelId}` : "(no channel)";
					return `**${idx + 1}. ${c.rcon.name}** — /connect ${c.rcon.ip}:${c.rcon.port}`;
				});
				await sendWhisper( i , lines.join("\n") || "No servers configured." );
				return;
			case "xlr-top":
				//get the top list of players based on specified filters
				count  = i.options.getInteger("count") ?? 0;
				const weapon = i.options.getString("weapon");
				const map    = i.options.getString("map");
				const sort   = i.options.getString("sort") || "skill";
				const limit = count && count > 0 ? Math.min(count, 10) : 10;
				let emoji, title, thumbUrl;
				if(weapon) {
					rows = await getPlayerWeaponSlice(serverIndex, weapon, 0, limit);
					const weap = (rows && rows[0]?.matched_label) || weapon;
					emoji = resolveEmoji(weap);
					title = `Top Players by Weapon: ${emoji ? `${emoji} ${weap}` : weap}`;
				} else if(map) {
					const { sql, params } = queries.ui_playerMapsSlice(map, limit, 0);
					rows = await runQueryOn(serverIndex, sql, params);
					thumbUrl = (await getMapImageUrl((rows && rows[0]?.matched_label) || map)) || DEFAULT_THUMB;
					title = `Top Players by Map: ${map}`;
				} else {
					const { sql, params } = queries.topDynamic({ limit, sort });
					rows = await runQueryOn(serverIndex, sql, params);
					title = `Top by ${sort}`;
				}
				//insert playerCardDetails
				rows = await insertPlayerCardDetails(rows, serverIndex);
				//format data
				const embeds = formatTopEmbed(rows, title, { thumbnail: thumbUrl, offset: 0 });
				const embedArr = Array.isArray(embeds) ? embeds : [embeds];
				await sendReply(i, embedArr);
				return;
			case "xlr-player":
				//get options
				const name = i.options.getString("name", true);
				const weaponOpt = i.options.getString("weapon");
				const mapOpt = i.options.getString("map");
				const vsName = i.options.getString("vs");
				const awardOpt = i.options.getString("award");
				//init award var
				let aw;
				//lookup player
			    const matches = await runQueryOn(serverIndex, queries.findPlayer, [`%${name}%`, `%${name}%`]);
			    if (!matches.length) return i.editReply(`No player found matching **${name}**.`);
			    clientId = matches[0].client_id;
				//load stats
				let details = await runQueryOn(serverIndex, queries.playerCard, [clientId, clientId, clientId]);
				if (!details.length) {
					await sendWhisper(i,`No stats on this server for **${matches[0].name}**.`);
					return;
				}
				//add playercard details to query results
				details = await insertPlayerCardDetails(details, serverIndex);
				//generate embed
				const [playerEmbed, files] = await formatPlayerEmbed(details[0]);
				
				//further enrich embed with award options
				if (awardOpt) {
					const aw = awardOpt === "-1" ? false : awards[parseInt(awardOpt)];
					//if a single award was specified
					if(aw) {
						// Player rank + metric(s)
						const { sql, params } = queries.awardRank(parseInt(awardOpt), clientId);
						const [rankRow] = await runQueryOn(serverIndex, sql, params);
						const playerName = (await displayName({ discord_id: rankRow?.discord_id }, rankRow?.name, serverIndex, true)) || (rankRow?.name ?? name);

						const emote = resolveEmoji(aw.emoji) ?? "";
						/* TODO insert into existing player page
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
						} */
					} else {
						//get top 10 placements instead.
						// Compute ranks across all awards, pick best 10
						const ranks = await Promise.all(awards.map(async (aw,i) => {
							const { sql, params } = queries.awardRank(i, clientId);
							const [row] = await runQueryOn(serverIndex, sql, params);
							return row ? { key: aw.key, name: aw.name, emoji: aw.emoji, properties: aw.properties, rank: row.rank } : null;
						}));
						const top10 = ranks.filter(Boolean).sort((a,b) => a.rank - b.rank);
						
						/* TODO add fields to main embed
						if (!top10.length) {
							emb.setDescription("_No placements yet_");
						} else {
							const lines = top10.map(r => `${resolveEmoji(r.emoji) || ""} **${r.name}** — #${r.rank}`);
							emb.setDescription(lines.join("\n"));
						}
						*/
					}
				} //if weapon option specified
				else if (weaponOpt) {
					const idOrNeg1 = /^\d+$/.test(weaponOpt) ? Number(weaponOpt) : -1;
					const { sql, params } = queries.playerWeaponCard;
					rows = await runQueryOn(serverIndex, sql, [ `%${weaponOpt}%`, idOrNeg1, clientId ]);
					if (!rows.length){
						await sendWhisper(i,`No weapon stats found for **${matches[0].name}** matching \`${weaponOpt}\`.`);
						return;
					}
					/* TODO add fields to main embed */
					
				} //if map option selected
				else if (mapOpt) {
					const idOrNeg1 = /^\d+$/.test(mapOpt) ? Number(mapOpt) : -1;
					rows = await runQueryOn(serverIndex, queries.playerMapCard, [ `%${mapOpt}%`, idOrNeg1, clientId ]);
					if (!rows.length){
						await sendWhisper( i,`No map stats found for **${matches[0].name}** matching \`${mapOpt}\`.`);
						return;
					}
				} //if vs option specified
				else if (vsName) {
					const opp = await runQueryOn(serverIndex, queries.findPlayer, [`%${vsName}%`, `%${vsName}%`]);
					if (!opp.length){
						await sendWhisper(i,`No opponent found matching **${vsName}**.`);
						return;
					}
					const opponentId = opp[0].client_id;
					if (opponentId === clientId){
						await sendWhisper( i,`Pick a different opponent than the player.`);
						return;
					}
					rows = await runQueryOn(serverIndex, queries.playerVsCard, [
						opponentId,
						clientId, opponentId,
						opponentId, clientId,
						clientId
					]);
					if (!rows.length){
						await sendWhisper(i,`No opponent stats found between **${matches[0].name}** and **${opp[0].name}**.`);
						return;
					}
					rows = await Promise.all(
					  rows.map(async (r) => ({ ...r, player_name: (await displayName(r, r.player_name, serverIndex, true)) || r.name, opponent_name: (await displayName(r, r.opponent_name, serverIndex, true)) || r.name }))
					);
					/* TODO add fields to main embed */
				}
				await sendReply(i,[playerEmbed], [], "", files);
				return;
				
			case "xlr-lastseen":
				count = i.options.getInteger("count") ?? 10;
				rows = await runQueryOn(serverIndex, queries.lastSeen, [count]);
				rows = await insertPlayerCardDetails(rows, serverIndex);
				//format embed
				embed = formatLastSeenEmbed(rows, { thumbnail: DEFAULT_THUMB });
				await sendReply(i,[embed]);
				return;
			
			case "xlr-register":
				//get guid from options
				const guid = i.options.getString("guid", true).trim();
				//try catch on player lookup
				try {
					// Look up client by GUID first,error if not found
					rows = await runQueryOn(serverIndex, "SELECT id FROM clients WHERE guid = ? LIMIT 1", [guid]);
					if (!rows.length) {
						await sendWhisper(i,`No client found with GUID **${guid}** on server ${serverIndex + 1}.` );
						return;
					}
					clientId = rows[0].id;
					await runQueryOn(serverIndex, "UPDATE clients SET discord_id = ? WHERE guid = ?", [i.user.id, guid]);
					await sendWhisper(i,`Linked <@${i.user.id}> to GUID **${guid}** (client #${clientId}) on server ${serverIndex + 1}.` );
				} catch (e) { //log on error and notify user
					console.error("xlr-register failed:", e);
					await sendWhisper(i,"Sorry, linking failed. Try again later or contact an admin." );
				}
				return;
			case "xlr-profile":
				// Look up the invoking user's linked client
				const uid = i.user.id;
				// Prefer most-recently seen client if multiple
				rows = await runQueryOn(
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
				//let user know if they aren't registered
				if (!rows.length) {
					await sendWhisper( i, "You haven’t linked your Discord to a B3 user on this server yet. Use `/xlr-register` to link your GUID.");
					return;
				}

				clientId = rows[0].client_id;

				// try catch on DM the profile
				try {
					const dm = await i.user.createDM();

					// Clean up old UI first
					await deleteOldProfileDMs(dm, client);

					const payload = await buildProfileDm(serverIndex, clientId, uid);
					await dm.send(payload);
					await sendWhisper(i,"I sent your playercard to your DMs. 📬" );
				//log on error
				} catch (e) {
					console.error("[xlr-profile] DM failed:", e);
					//notify the user
					await sendWhisper(i,"I couldn't DM you (are DMs disabled?). Enable DMs and try again." );
				}
				return;
		}
	//log on error
	} catch (err) {
		console.error("[slash] error:", err);
		//notify user
		await sendWhisper(i, "Error Processing your command");
	}
}

/* ***************************************************************
handleUiComponent( 	i: type-discord interaction [required],
					serverIndex: type-int [required])
return void

handles ui component click

**************************************************************** */
async function handleUiComponent(i, serverIndex) {
	const cfg = byIndex.get(serverIndex);
	const state = perChannelState.get(cfg.ui.channelId);
	const uiCollector = state?.collectors || null;
	const gate = beginChannelLoad(cfg.ui.channelId);
	
	if(XLR_DEBUG) console.log(`${i.customId} in #${i.channel?.id || '?'} msg=${i.message?.id || '?'} user=${i.user?.id || '?'}`);
	const parsed = parseCustomId(i.customId);
	if (!parsed) return; // ignore non-UI buttons

	try {
	  if (!i.deferred && !i.replied) {
		  //update loading screen
		  await i.deferUpdate(); // acknowledges the interaction
		  await loadMessage(i, cfg, gate);
	  }
	} catch (e) {
	  // If already acknowledged somewhere else, ignore
	}

	

	const payload = await buildView(serverIndex, { ...parsed, label: i?.values ? i.values[0] : null, signal: gate.signal, token: gate.token, channelId: cfg.ui.channelId });
	if (payload?.stale || isStale(cfg.ui.channelId, gate.token)) return;
	const files = [];
	
	const channel = i.channel ?? await i.client.channels.fetch(cfg.ui.channelId);
	const contentMsg = await channel.messages.fetch(cfg.ui.contentId);
	const navMsg = await channel.messages.fetch(cfg.ui.navId);
	if (isStale(cfg.ui.channelId, gate.token)) return;
	const footerText = payload.embeds[payload.embeds.length - 1].data.footer.text;
	await sendMessage(i, cfg, gate, payload.nav, payload.embeds, footerText, payload.pager, payload.files ?? []);

	if (uiCollector) uiCollector.resetTimer({ idle: INACTIVITY_MS });
	return;
	

}

/* ***************************************************************
buildDmNavRow( 	kind: type-string [required],
				serverIndex: type-int [required],
				clientId: type-int [required])
return array

handles building buttons at the top of profile edit DMs

**************************************************************** */
function buildDmNavRow(serverIndex, clientId, page) {
	const rowButtons = new ActionRowBuilder().addComponents(
		new ButtonBuilder().setCustomId(PROFILE_IDS.EDIT_NAME_BTN(serverIndex, clientId)).setLabel("Edit Preferred Name").setStyle(ButtonStyle.Primary),
		new ButtonBuilder().setCustomId(PROFILE_IDS.EDIT_BG_BTN(serverIndex, clientId, 0)).setLabel("Edit Background").setStyle(ButtonStyle.Secondary),
		new ButtonBuilder().setCustomId(PROFILE_IDS.EDIT_EMBLEM_BTN(serverIndex, clientId, 0)).setLabel("Edit Emblem").setStyle(ButtonStyle.Secondary),
		new ButtonBuilder().setCustomId(PROFILE_IDS.EDIT_CS_BTN(serverIndex, clientId, 0)).setLabel("Edit Callsign").setStyle(ButtonStyle.Secondary)
	);
	return rowButtons;
}

/* ***************************************************************
buildDmPickerRow( kind: type-string [required],
				serverIndex: type-int [required],
				playerId: type-int [required]
				page: type-int [required])
return array

handles building string selects at the bottom of profile edit DMs

**************************************************************** */
function buildDmPickerRow(kind, serverIndex, playerId, page) {
	//create an array of choices for selected playercard elements
	const arr = kind==="bg" ? BACKGROUNDS : kind==="em" ? EMBLEMS : CALLSIGNS.map(c => c);
	//create the label for the choices
	const labels = kind==="cs" ? CALLSIGNS.slice() : arr.map(basenameNoExt);
	//chunk the current options into the current page
	const chunk = chunkOptions(labels, 0, page, 25);

	//create string select
	const select = new StringSelectMenuBuilder()
		.setCustomId(kind==="bg" ? PROFILE_IDS.PICK_BG(serverIndex, playerId, page)
					: kind==="em" ? PROFILE_IDS.PICK_EM(serverIndex, playerId, page)
                              : PROFILE_IDS.PICK_CS(serverIndex, playerId, page))
		.setPlaceholder(kind==="bg" ? "Pick a background…" : kind==="em" ? "Pick an emblem…" : "Pick a callsign…")
		.addOptions(chunk.options);
	
	//add string select to first row of components
	const row1 = new ActionRowBuilder().addComponents(select);
	//create pager buttons
	const row2 = new ActionRowBuilder().addComponents(
		//create previous button
		new ButtonBuilder()
			.setCustomId(kind==="bg" ? PROFILE_IDS.PAGE_BG(serverIndex, playerId, "prev", page) :
						kind==="em" ? PROFILE_IDS.PAGE_EM(serverIndex, playerId, "prev", page) :
									PROFILE_IDS.PAGE_CS(serverIndex, playerId, "prev", page))
			.setLabel("Previous")
			.setStyle(ButtonStyle.Secondary)
			.setDisabled(!chunk.hasPrev),
		//create next button
		new ButtonBuilder()
			.setCustomId(kind==="bg" ? PROFILE_IDS.PAGE_BG(serverIndex, playerId, "next", page) :
						kind==="em" ? PROFILE_IDS.PAGE_EM(serverIndex, playerId, "next", page) :
									PROFILE_IDS.PAGE_CS(serverIndex, playerId, "next", page))
			.setLabel("Next")
			.setStyle(ButtonStyle.Secondary)
			.setDisabled(!chunk.hasNext)
	);
	//return nav component rows
	return [row1, row2];
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
      try { await m.delete(); } catch (err) { if (err?.name === "CanceledError" || err?.code === "ERR_CANCELED") { throw err; }}
    }
  } catch (e) {
    console.warn("[profile] deleteOldProfileDMs failed:", e.message || e);
  }
}
/* *************************************************************************************
END INTERACTION HANDLER FUNCTIONS
****************************************************************************************
START SQL DATA FUNCTIONS
************************************************************************************* */

/* ***************************************************************
loadProfileData( 	serverIndex: type-int [required],
					clientId: type-int [required])
return {}: type-obj

gets SQL related stats for the UI player profile page (playercard stats and playercard elements as well as preferredName)
---
returns object of card (stats), pc (playercard elements), preferredName
**************************************************************** */
async function loadProfileData(serverIndex, clientId) {
  const [card] = await runQueryOn(serverIndex, queries.playerCard, [clientId, clientId, clientId]);
  const [pc]   = await runQueryOn(serverIndex, queries.getPlayerCardRow, [clientId]);
  const prefNameRow = await runQueryOn(serverIndex,
    "SELECT COALESCE(preferred_name, NULL) AS preferred_name FROM clients WHERE id = ? LIMIT 1", [clientId]);
  const preferredName = prefNameRow?.[0]?.preferred_name || null;
  return { card, pc, preferredName };
}

/* ***************************************************************
getHomeTotals( 	serverIndex: type-int [required] )
return {}: type-obj

gets SQL related stats for the UI home page (server status page and some basic stats)
---
returns object of totalPlayers, totalKills, totalRounds, favoriteWeapon, favoriteMap
**************************************************************** */
async function getHomeTotals(serverIndex) {
	
	//load totals
	const [[{totalPlayers=0 }],[{ totalKills=0 }={}],[{ totalRounds=0 }={}],[favW={}],[favM={}]] = await Promise.all([
		runQueryOn(serverIndex, queries.ui_totalPlayers),
		runQueryOn(serverIndex, queries.ui_totalKills),
		runQueryOn(serverIndex, queries.ui_totalRounds),
		runQueryOn(serverIndex, queries.ui_favoriteWeapon),
		runQueryOn(serverIndex, queries.ui_favoriteMap),
	]);
	return {
		totalPlayers: +totalPlayers || 0,
		totalKills: +totalKills || 0,
		totalRounds: +totalRounds || 0,
		favoriteWeapon: { label: favW?.label ?? "—", kills: +(favW?.kills ?? 0) },
		favoriteMap: { label: favM?.label ?? "—", rounds: +(favM?.rounds ?? 0) },
	};
}

/* ***************************************************************
getLadderSlice( 	serverIndex: type-int [required],
				offset: type-int [optional, 0],
				limit: type-int [optional, 10])
return {}: type-obj

gets SQL related stats for the ladder page 
---
returns object of sql results
*/
async function getLadderSlice(serverIndex, offset = 0, limit = 10) {
  const { sql, params } = queries.ui_ladderSlice(limit, offset);
  const rows = await runQueryOn(serverIndex, sql, params);
  
  return rows;
}

/* ***************************************************************
getLadderCount( serverIndex: type-int [required])
return {}: type-int

gets number of players on the ladder
---
returns count of sql results
*/
async function getLadderCount(serverIndex) {
  const [{ cnt=0 }={}] = await runQueryOn(serverIndex, queries.ui_ladderCount, []);
  return +cnt || 0;
}

/* ***************************************************************
getWeaponsSlice( 	serverIndex: type-int [required],
					offset: type-int [optional, 0],
					limit: type-int [optional, 10])
return {}: type-obj

gets SQL related stats for the weapons page 
---
returns object of sql results
*/
async function getWeaponsSlice(serverIndex, offset=0, limit=10) {
  const { sql, params } = queries.ui_weaponsSlice(limit, offset);
  const rows = await runQueryOn(serverIndex, sql, params);
  return rows.map((r, i) => ({ ...r, rank: offset + i + 1 }));
}

/* ***************************************************************
getWeaponsCount( serverIndex: type-int [required])
return {}: type-int

gets number of weapons on the ladder
---
returns count of sql results
*/
async function getWeaponsCount(serverIndex) {
  const [{ cnt=0 }={}] = await runQueryOn(serverIndex, queries.ui_weaponsCount, []);
  return +cnt || 0;
}

/* ***************************************************************
getMapsSlice( 	serverIndex: type-int [required],
				signal: type-int [required],
				offset: type-int [optional, 0],
				limit: type-int [optional, 10])
return {}: type-obj

gets SQL related stats for the maps page 
---
returns object of sql results
*/
async function getMapsSlice(serverIndex, offset=0, limit=10, signal) {
  const { sql, params } = queries.ui_mapsSlice(limit, offset);
  const rows = await runQueryOn(serverIndex, sql, params);
  //attach map thumbnail
  const slice = await Promise.all(rows.map(async (r, i) => {
    let url;
    try { url = await getMapImageUrl(r.label, signal); } catch (err) { if (err?.name === "CanceledError" || err?.code === "ERR_CANCELED") { throw err; } url = DEFAULT_THUMB; }
    return { ...r, rank: offset + i + 1, thumbnail: url || DEFAULT_THUMB };
  }));
  return slice;
}

/* ***************************************************************
getWeaponsCount( serverIndex: type-int [required])
return {}: type-int

gets number of weapons on the ladder
---
returns count of sql results
*/
async function getMapsCount(serverIndex) {
  const [{ cnt=0 }={}] = await runQueryOn(serverIndex, queries.ui_mapsCount, []);
  return +cnt || 0;
}

/* ***************************************************************
getPlayerWeaponSlice( 	serverIndex: type-int [required],
					offset: type-int [optional, 0],
					limit: type-int [optional, 10])
return {}: type-obj

gets SQL related player specific stats for the weapon's page 
---
returns object of sql results
*/
async function getPlayerWeaponSlice(serverIndex, weapon, offset = 0, limit = 10) {
  const { sql, params } = queries.ui_playerWeaponSlice(weapon, limit, offset);
  const rows = await runQueryOn(serverIndex, sql, params);
  
  return rows;
}

/* ***************************************************************
getPlayerMapSlice( 	serverIndex: type-int [required],
					offset: type-int [optional, 0],
					limit: type-int [optional, 10])
return {}: type-obj

gets SQL related player specific stats for the map's page 
---
returns object of sql results
*/
async function getPlayerMapSlice(serverIndex, mapLabel, offset = 0, limit = 10) {
  const { sql, params } = queries.ui_playerMapsSlice(mapLabel, limit, offset);
  const rows = await runQueryOn(serverIndex, sql, params);
  
  return rows;
}

/* ***************************************************************
getPlayerWeaponCount( serverIndex: type-int [required])
return {}: type-int

gets number of players of a weapon on the ladder
---
returns count of sql results
*/
async function getPlayerWeaponCount(serverIndex, weapon) {
  const [{ cnt=0 }={}] = await runQueryOn(serverIndex, queries.ui_playerWeaponCount, [ `%${weapon}%`, /^\d+$/.test(weapon) ? Number(weapon) : -1 ]);
  return +cnt || 0;
}

/* ***************************************************************
getPlayerMapCount( serverIndex: type-int [required])
return {}: type-int

gets number of players of a map on the ladder
---
returns count of sql results
*/
async function getPlayerMapCount(serverIndex, map) {
  const [{ cnt=0 }={}] = await runQueryOn(serverIndex, queries.ui_playerMapsCount, [ `%${map}%`, /^\d+$/.test(map) ? Number(map) : -1 ]);
  return +cnt || 0;
}

async function displayName(row, rowname, serverIndex = 0, isTitle = false, isOpponent = false) {
  const raw = rowname ?? row?.name ?? "";
  const base = typeof raw === "string" ? raw : String(raw ?? "");
  const sanitized = base
    .replace(/\^\d/g, "")
    .replace(/\|/g, "")
    .replace(/`/g, "'");

  const prefNameRow = await runQueryOn(serverIndex,
    "SELECT COALESCE(preferred_name, NULL) AS preferred_name FROM clients WHERE id = ? LIMIT 1", [row.client_id]);
  const preferredName = prefNameRow?.[0]?.preferred_name || null;
  
  if(preferredName) return preferredName;

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
    } catch (err) { if (err?.name === "CanceledError" || err?.code === "ERR_CANCELED") { throw err; }}
  }

  try {
    const user = await client.users.fetch(id);
    const uName = user?.globalName ?? user?.username ?? null;
    if (uName) return isTitle ? uName : `<@${id}>`;
  } catch (err) { if (err?.name === "CanceledError" || err?.code === "ERR_CANCELED") { throw err; }}

  return sanitized;
}

/* ************************************************************************************
END SQL DATA FUNCTIONS
***************************************************************************************
START HTTP HELPER FUNCTIONS
************************************************************************************* */

/* ***************************************************************
summarizeAxiosError( 	err: type-object [required] )
return error code: type-string

summarizes an Axios Error object when url load fails
---
returns string of summarized error
**************************************************************** */
function summarizeAxiosError(err) {
	//check error object for response property
	if (err?.response) {
		//if response exists get status
		const s = err.response.status;
		//trim whitespace off status text
		const t = (err.response.statusText || "").trim();
		//return error code + text
		return t ? `${s} ${t}` : `${s}`;
	}
	//its a request object but no response, return NETWORK ERROR
	if (err?.request) return "NETWORK ERROR";
	//if there is a code somehow return it, otherwise return "ERROR"
	return (err?.code || "ERROR");
}

/* ***************************************************************
fetchServerStatus( 	ip: type-string [required],
						port: type-string [required],
						signal: type-string [required])
return {}: type-obj

fetches json from cod.pm api
---
returns obj of either valid JSON or error message
**************************************************************** */
async function fetchServerStatus(ip, port, signal) {
	//format URL
	const url = `https://api.cod.pm/getstatus/${ip}/${port}`;
	//try catch on page load
	try {
		//load page and send interupt signal
		const res = await axios.get(url, { timeout: 5000 , signal });
		//valid load, return JSON
		return res.data;
	//if the catch handle fires, sumarrize error code instead
	} catch (err) {
		//summarize error
		const summary = summarizeAxiosError(err);
		//log error
		console.warn(`[http] status api error ${ip}:${port} → ${summary}`);

		return { error: summary };
	}
}

/* ***************************************************************
checkUrlFor404( 	url: type-string [required],
					signal: type-string [required])
return boolean

attempts to load URL 
---
returns true if URL 404s otherwise returns false
**************************************************************** */
async function checkUrlFor404(url, signal) {
	//run try catch on page load
	try {
		//load page header
		const res = await axios.head(url, { timeout: 4000, validateStatus: () => true, signal });
		//return true if the status is 404, false on anything else
		return res.status === 404;
	//if there is an error, its the same outcome as a 404 but still log it
	} catch (err) {
		//summarize error
		const summary = summarizeAxiosError(err);
		//log error
		console.warn(`[http] head error ${url} → ${summary}`);
		//return true for failed page load
		return false;
	}
}

/* ***************************************************************
getMapImageUrl( 	label: type-string [required],
					signal: type-string [required])
return url: type-string

given a map label, attempts to load the map image from cod.pm's api
---
returns URL if map image is valid or null if not
**************************************************************** */
async function getMapImageUrl(label, signal) {
	//try catch on 404 checks
	try {
		//if stock map thumbs don't exist
		if (await checkUrlFor404(`https://cod.pm/mp_maps/cod1+coduo/stock/${label}.png`, signal)) {
			//check for custom thumbs
			if (await checkUrlFor404(`https://cod.pm/mp_maps/cod1+coduo/custom/${label}.png`, signal)) {
				//both failed so return null
				return null;
			} else {
				//custom map thumbnails got a hit, return it
				return `https://cod.pm/mp_maps/cod1+coduo/custom/${label}.png`;
			}
		//stock map thumbs have a hit
		} else {
			//return thumbnail from stock pile
			return `https://cod.pm/mp_maps/cod1+coduo/stock/${label}.png`;
		}
		//not being able to load due to error, same effect as not being able to find at all
	} catch (err) { if (err?.name === "CanceledError" || err?.code === "ERR_CANCELED") { throw err; }
		//return null on error
		return null;
	}
}
/* ***************************************************************
END HTTP HELPER FUNCTIONS
******************************************************************
START MISC HELPER FUNCTIONS
*************************************************************** */

/* ***************************************************************
basenameNoExt( 	p: type-object [required] )

return label: type-string

returns a string of the file name for file p with the extension stripped
---
returns string of the file with the extension stripped
**************************************************************** */
function basenameNoExt(p) {
	try {
		const b = path.basename(p);
		return b.replace(/\.(png|jpg|jpeg|gif|webp)$/i, "");
	} catch (err) { if (err?.name === "CanceledError" || err?.code === "ERR_CANCELED") { throw err; } return String(p); }
}

/* ***************************************************************
chunkOptions( 	labels: type-array [required],
				page: type-int [optional, 0],
				perPage: type-int [optional, 0])

return label: type-string

chunks an array into the a page of perPage items, starting at a given page
---
returns object of the current page sliced out of all options
**************************************************************** */
function chunkOptions(labels, page = 0, perPage = 25) {
	//get starting pos
	const offset  = page * perPage;
	//get the size of the slice
	const slice   = labels.slice(offset, offset + perPage);
	//set available options (if none give default "No item")
	const options = slice.length
		? slice.map((label, i) => ({
			label: `${offset + i}. ${label}`,
			value: String(offset + i)
		}))
		: [{ label: "No items", value: "noop" }]; // never 0 options

	//return new object of the sliced objects
	return {
		page,
		total: labels.length,
		hasPrev: page > 0,
		hasNext: offset + perPage < labels.length,
		options
	};
}

/* ***************************************************************
resolveServerIndexFromInteraction( 	interaction: type-object [required] )

return index: type-int

returns the index of the server from the slash commands

**************************************************************** */
function resolveServerIndexFromInteraction(interaction) {
	//get the server index from slash command
	const arg = interaction.options?.getString("server")?.trim();
	//if an argument wasn't specified check if the channel id matches a server
	if (!arg) {
		return 0; // default
	}
	//if the argument can be cast to a valid number, use that index
	const asNum = Number(arg);
	if (Number.isFinite(asNum) && asNum >= 1 && asNum <= SERVER_CONFIGS.length) return asNum - 1;
  
	//if it isn't a number, instead see if its the server name
	const found = byNameLower.get(arg.toLowerCase());
	if (found) return found.i;
  
	//if its not the server name and not a number, fallback to the first server by default
	return 0;
}

function getServerIndexFromComponent(interaction) {
	
	const channelId = interaction?.channelId ?? null;
	
	for( let i = 0; i < SERVER_CONFIGS.length; i++){
		if(SERVER_CONFIGS[i].ui.channelId === channelId)
			return i;
	}
	return -1;
}

/* ***************************************************************
parseCustomId( 	id: type-string [required] )

return index: type-obj

returns processed custom id exploded on semicolon.

view, embedPage, param, stringSelectPage
**************************************************************** */
function parseCustomId(id) {
  const p = id.split(":");
  if (p[0] !== "ui") return null;
  if (p.length === 2) return { view: p[1], embedPage: 0 };
  if (p.length === 4) {
    const cur = Math.max(0, parseInt(p[3], 10) || 0);
    return { view: p[1], embedPage: p[2] === "next" ? cur + 1 : Math.max(0, cur - 1) };
  }
  if (p.length === 6) {
    const cur = Math.max(0, parseInt(p[3], 10) || 0);
    const param = decodeURIComponent(p[4]);
    const stringSelectPage = Math.max(0, parseInt(p[5], 10) || 0);
    return { view: p[1], embedPage: p[2] === "next" ? cur + 1 : Math.max(0, cur - 1), param, stringSelectPage };
  }
  return null;
}