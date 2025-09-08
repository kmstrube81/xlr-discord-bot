import dayjs from "dayjs";
import { EmbedBuilder } from "discord.js";

// Shared emoji resolver (injected by index.js at runtime)
let _emojiResolver = () => null;

/** Allow other modules (index.js) to set how emojis are resolved. */
export function setEmojiResolver(fn) {
  if (typeof fn === "function") _emojiResolver = fn;
}

/** Use the shared resolver. Always returns a string (emoji mention) or null. */
export function resolveEmoji(label) {
  try { return _emojiResolver(label) ?? null; } catch { return null; }
}


export function formatPlayerEmbed(p, opts = {}) {
  const { thumbnail } = opts;
  const kd = p.deaths === 0 ? p.kills : (p.kills / p.deaths).toFixed(2);
  const lastSeen = p.time_edit ? dayjs.unix(p.time_edit).fromNow?.() || dayjs.unix(p.time_edit).format("YYYY-MM-DD HH:mm") : "—";
  const favWeapEmoji = emojiResolver(p.fav);
  const favWeap = favWeapEmoji ? "${favWeapEmoji} ${p.fav}" : p.fav;
  return new EmbedBuilder().
	setColor(0x2b7cff).
    setTitle(`**${p.name}**`).
	setThumbnail(thumbnail).
    addFields(
      { name: "Skill", value: String(p.skill ?? "—"), inline: true },
	  { name: "Fav Weapon", value: String( favWeap ?? "—"), inline: true },
	  { name: "Nemesis", value: p.nemesis ? `${p.nemesis}${typeof p.nemesis_kills === "number" ? ` (${p.nemesis_kills})` : ""}` : "—", inline: true },
      { name: "Kills", value: `${p.kills ?? 0}`, inline: true },
	  { name: "Best Killstreak", value: `${p.winstreak ?? 0}`, inline: true },
      { name: "KDR", value: String(kd), inline: true },
	  { name: "Headshots", value: String(p.headshots ?? 0), inline: true },
	  { name: "Assists", value: String(p.assists ?? 0), inline: true },
	  { name: "Deaths", value: String(p.deaths ?? 0), inline: true },
      { name: "Rounds Played", value: `${p.rounds ?? 0}`, inline: true },
      { name: "Connections", value: String(p.connections ?? 0), inline: true },
      { name: "Last Seen", value: lastSeen, inline: true }
    ).
    setFooter({ text: "XLRStats • B3" });
}

export function formatPlayerWeaponEmbed(row, opts = {}) {
  const { thumbnail } = opts;
  const kd = row.deaths === 0 ? row.kills : (row.kills / row.deaths).toFixed(2);
  const lastSeen = row.time_edit ? dayjs.unix(row.time_edit).fromNow?.() || dayjs.unix(row.time_edit).format("YYYY-MM-DD HH:mm") : "—";
  const weapEmoji = emojiResolver(row.weapon);
  const weap = weapEmoji ? "${weapEmoji} ${row.weapon}" : row.weapon;
  return new EmbedBuilder()
    .setColor(0x2b7cff)
	.setThumbnail(thumbnail)
    .setDescription(`**${row.name}**`)
    .addFields(
      { name: "Skill", value: String(row.skill ?? "—"), inline: true },
      { name: "Weapon", value: String(weap ?? "—"), inline: true },
      { name: "\u200B", value: "\u200B", inline: true },
      { name: "Kills", value: String(row.kills ?? 0), inline: true },
      { name: "Killed By", value: String(row.deaths ?? 0), inline: true },
      { name: "Suicides By", value: String(row.suicides ?? 0), inline: true }
    )
    .setFooter({ text: "XLRStats • B3" });
}

export function formatPlayerVsEmbed(row, opts = {}) {
  const { thumbnail } = opts;
  return new EmbedBuilder()
    .setColor(0x2b7cff)
    .setDescription(`**${row.player_name}** vs. **${row.opponent_name}**`)
	.setThumbnail(thumbnail)
    .addFields(
      { name: "Kills", value: String(row.kills_vs ?? 0), inline: true },
      { name: "Skill", value: String(row.player_skill ?? "—"), inline: true },
      { name: "\u200B", value: "\u200B", inline: true },
      { name: "Killed By", value: String(row.deaths_vs ?? 0), inline: true },
      { name: "Opponent Skill", value: String(row.opp_skill ?? "—"), inline: true },
      { name: "\u200B", value: "\u200B", inline: true }
    )
    .setFooter({ text: "XLRStats • B3" });
}

export function formatPlayerMapEmbed(row, opts = {}) {
  const { thumbnail } = opts;
  const lastSeen = row.time_edit
    ? (dayjs.unix(row.time_edit).fromNow?.() || dayjs.unix(row.time_edit).format("YYYY-MM-DD HH:mm"))
    : "—";

  return new EmbedBuilder()
    .setColor(0x2b7cff)
	.setThumbnail(thumbnail)
    .setDescription(`**${row.name}** on **${row.map}**`)
    .addFields(
      { name: "Skill", value: String(row.skill ?? "—"), inline: true },
      { name: "Kills", value: String(row.kills ?? 0), inline: true },
      { name: "Deaths", value: String(row.deaths ?? 0), inline: true },
      { name: "Suicides", value: String(row.suicides ?? 0), inline: true },
      { name: "Rounds Played", value: String(row.rounds ?? 0), inline: true }
    )
    .setFooter({ text: "XLRStats • B3 • " + (lastSeen === "—" ? "last seen unknown" : `last seen ${lastSeen}`) });
}

export function formatTopEmbed(rows, title = "Top by Skill", opts = {}) {
  const { thumbnail, offset = 0 } = opts; // <— add offset with default 0

  const embeds = [
    new EmbedBuilder().setColor(0x32d296).setTitle(`🏆 ${title}`)
  ];

  rows.map((r, i) => {
	  
    let embed;
	
	if(i === 0) {
		
		embed = embeds[0];
		
	} else {
		
		embed = new EmbedBuilder()
			.setColor(0x32d296);
		embeds.push(embed);
		
	}
	
    const kd = r.deaths === 0 ? r.kills : (r.kills / r.deaths).toFixed(2);
    const medals = ["🥇", "🥈", "🥉"];

    const absoluteIndex = offset + i;               // <— absolute rank
    let rankDisplay;
    if (absoluteIndex < 3) {                        // medals only for 1–3 overall
      rankDisplay = medals[absoluteIndex];
    } else {
      rankDisplay = `#${absoluteIndex + 1}.`;       // e.g., 11, 12, ...
    }

    embed.setDescription(`**${rankDisplay} ${r.name}**`);
  embed.addFields(
		{
			name : `Skill`,
			value : String(r.skill),
			inline : true
		},
		{
			name : `Kill-Death Ratio`,
			value : String(kd),
			inline : true
		},
		{
			name : `Kills`,
			value : String(r.kills),
			inline : true
		},
		{
			name : `Deaths`,
			value : String(r.deaths),
			inline : true
		}
	);
        // append extra stats when present
    if (typeof r.suicides === "number") embed.addFields({ name: "Suicides", value : String(r.suicides), inline : true });
    if (typeof r.assists === "number")  embed.addFields({ name: "Assists", value : String(r.assists), inline : true });
    if (typeof r.rounds === "number")   embed.addFields({ name: "Rounds Played", value : String(r.rounds), inline : true });

  });

  embeds[embeds.length-1].setFooter({ text: "XLRStats • B3" });

  if (thumbnail) {
    embeds[0].setThumbnail(thumbnail);
  }
  
  if(!rows.length) {
	embeds[0].setDescription("_No players found_");
  }
  return embeds;
}



export function formatLastSeenEmbed(rows, opts = {}) {
  const { thumbnail } = opts;
  const lines = rows.map(r => `**${r.name}** — <t:${r.time_edit}:R>`);
  return new EmbedBuilder().
    setColor(0xffa500).
	setThumbnail(thumbnail).
    setTitle("🕒 Recently Seen").
    setDescription(lines.join("\n") || "_No recent players_");
}

// === App UI renderers ===
// Keep components (buttons) outside; these return only embeds so index.js can add rows.

export function renderHomeEmbed({ totals }) {
  const { totalKills, totalRounds, favoriteWeapon, favoriteMap } = totals;
  return [
    new EmbedBuilder()
      .setColor(0x2b7cff)
      .setTitle("📊 Server Overview")
      .setDescription("High-level stats at a glance")
      .addFields(
        { name: "Total Kills", value: (totalKills ?? 0).toLocaleString(), inline: true },
        { name: "Total Rounds", value: (totalRounds ?? 0).toLocaleString(), inline: true },
        { name: "\u200b", value: "\u200b", inline: true },
        { name: "Favorite Weapon (by kills)", value: `${favoriteWeapon?.label ?? "—"} — **${Number(favoriteWeapon?.kills ?? 0).toLocaleString()}**`, inline: true },
        { name: "Favorite Map (by rounds)", value: `${favoriteMap?.label ?? "—"} — **${Number(favoriteMap?.rounds ?? 0).toLocaleString()}**`, inline: true },
      )
      .setFooter({ text: "XLR App • Home" })
  ];
}

export function renderLadderEmbeds({ rows, page, title = "Top Players by Skill", thumbnail = null }) {
  // Reuse your existing multi-embed pack so it matches /xlr-top exactly
  const embeds = formatTopEmbed(rows, `🏆 ${title}`, { thumbnail });
  // Tag the page in the footer of the last embed (formatTopEmbed already sets a footer)
  if (embeds.length) {
    const last = embeds[embeds.length - 1];
    const footer = last.data.footer?.text || "XLRStats • B3";
    last.setFooter({ text: `${footer} • Ladder page ${page + 1}` });
  }
  return embeds;
}

function chunkedListEmbed({ title, items, page, perPage, unitKey, unitLabel }) {
  const start = page * perPage;
  const slice = items.slice(start, start + perPage);
  const text = slice
    .map((it, i) => `**${start + i + 1}.** ${it.label} — ${Number(it[unitKey] ?? 0).toLocaleString()} ${unitLabel}`)
    .join("\n") || "_No data_";

  return [
    new EmbedBuilder()
      .setColor(0x2b7cff)
      .setTitle(title)
      .setDescription(text)
      .setFooter({ text: `XLR App • Page ${page + 1}` })
  ];
}

export function renderWeaponsEmbed({ items, page, perPage = 50 }) {
  return chunkedListEmbed({
    title: "🔫 Weapons by Kills",
    items, page, perPage,
    unitKey: "kills",
    unitLabel: "kills",
  });
}

export function renderMapsEmbed({ items, page, perPage = 50 }) {
  return chunkedListEmbed({
    title: "🗺️ Maps by Rounds Played",
    items, page, perPage,
    unitKey: "rounds",
    unitLabel: "rounds",
  });
}

