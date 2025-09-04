import "dotenv/config";
import { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } from "discord.js";
import mysql from "mysql2/promise";
import { queries } from "./queries.js";
import { formatPlayerEmbed, formatTopEmbed, formatLastSeenEmbed } from "./format.js";

const {
  DISCORD_TOKEN, APPLICATION_ID, GUILD_ID,
  XLR_DB_HOST, XLR_DB_PORT, XLR_DB_NAME, XLR_DB_USER, XLR_DB_PASS,
  XLR_SERVER_ID
} = process.env;

const pool = mysql.createPool({
  host: XLR_DB_HOST,
  port: Number(XLR_DB_PORT || 3306),
  user: XLR_DB_USER,
  password: XLR_DB_PASS,
  database: XLR_DB_NAME,
  connectionLimit: 5
});

const commands = [
  new SlashCommandBuilder()
    .setName("xlr-top")
    .setDescription("Show top players by skill")
    .addIntegerOption(o => o.setName("count").setDescription("How many (default 10)").setMinValue(1).setMaxValue(25)),
  new SlashCommandBuilder()
    .setName("xlr-player")
    .setDescription("Lookup a player by name")
    .addStringOption(o => o.setName("name").setDescription("Partial name").setRequired(true)),
  new SlashCommandBuilder()
    .setName("xlr-lastseen")
    .setDescription("Show recently seen players")
    .addIntegerOption(o => o.setName("count").setDescription("How many (default 10)").setMinValue(1).setMaxValue(25))
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

async function runQuery(sql, params) {
  const [rows] = await pool.query(sql, params);
  return rows;
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once("ready", () => {
  console.log(`Logged in as ${client.user.tag}`);
});

client.on("interactionCreate", async (i) => {
  if (!i.isChatInputCommand()) return;

  try {
    if (i.commandName === "xlr-top") {
      await i.deferReply();
      const count = i.options.getInteger("count") ?? 10;
      const rows = await runQuery(queries.topBySkill, [count]);
      const embed = formatTopEmbed(rows, "Top Players by Skill");
      await i.editReply({ embeds: [embed] });
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
