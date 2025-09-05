import "dotenv/config";
import { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, Events, EmbedBuilder } from "discord.js";
import mysql from "mysql2/promise";
import { queries } from "./queries.js";
import { formatPlayerEmbed, formatTopEmbed, formatLastSeenEmbed } from "./format.js";

import fs from "fs";

const HEARTBEAT_FILE = "/opt/xlrbot/health/ready";

const {
  DISCORD_TOKEN, APPLICATION_ID, GUILD_ID,
  MYSQL_B3_DB, MYSQL_B3_USER, MYSQL_B3_PASSWORD
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
    .setDescription("Lookup a player by name")
    .addStringOption(o => o.setName("name").setDescription("Partial name").setRequired(true)),
  new SlashCommandBuilder()
    .setName("xlr-lastseen")
    .setDescription("Show recently seen players")
    .addIntegerOption(o => o.setName("count").setDescription("How many (default 10)").setMinValue(1).setMaxValue(25))
].map(c => c.toJSON());

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

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once(Events.ClientReady, (c) => {
  console.log(`Logged in as ${c.user.tag}`);

  fs.mkdirSync("/opt/xlrbot/health", { recursive: true });
  setInterval(() => fs.writeFileSync(HEARTBEAT_FILE, Date.now().toString()), 15000);
});

client.on(Events.InteractionCreate, async (i) => {
  if (!i.isChatInputCommand()) return;

  try {

	if (i.commandName === "xlr-top") {
	  await i.deferReply();

	  const countIn = i.options.getInteger("count");
	  const sort    = i.options.getString("sort") || "skill";
	  let weapon    = i.options.getString("weapon") || null;
	  let map       = i.options.getString("map") || null;

	  // 0 => all (up to 100)
	  const count = countIn ?? 0;
	  const limit = count === 0 ? 100 : Math.min(count, 100);

	  // weapon precedence over map
	  if (weapon && map) map = null;

	  // Helper: make a Discord custom emoji placeholder from a weapon label
	  const toEmojiCode = (label) =>
		client.emojis.cache.find(e => e.name === label);
	  
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

	  // Default image if no map or fetch fails — set your own brand image here
	  const DEFAULT_THUMB = process.env.XLR_DEFAULT_IMAGE
		|| "https://cod.pm/mp_maps/unknown.png";

	  try {
		const { sql, params } = queries.topDynamic({ limit, sort, weapon, map });
		const rows = await runQuery(sql, params);

		// figure out canonical matched labels (if any)
		const matchedLabel = rows.length ? rows[0].matched_label : null;

		// Build title
		let title = "Top Players by Skill";
		if (weapon) {
		  const label = matchedLabel || weapon;
		  const emoji = toEmojiCode(label);
		  if(emoji)
			title = `Top Players by Weapon: ${emoji}`;
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
		const padLen = Math.min(Math.floor(footerText.length * 0.7), 2048);
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
      const matches = await runQuery(queries.findPlayer, [`%${name}%`, `%${name}%`]);
      if (!matches.length) return i.editReply(`No players found matching **${name}**.`);

      // Take the best match and fetch stats row
      const clientId = matches[0].client_id;
      const details = await runQuery(queries.playerCard, [clientId]);
      if (!details.length) return i.editReply(`No stats on this server for **${matches[0].name}**.`);
      const embed = formatPlayerEmbed(details[0]);
      await i.editReply({ embeds: [embed] });
    }

    if (i.commandName === "xlr-lastseen") {
      await i.deferReply();
      const count = i.options.getInteger("count") ?? 10;
      const rows = await runQuery(queries.lastSeen, [count]);
      const embed = formatLastSeenEmbed(rows);
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
