import dayjs from "dayjs";
import { EmbedBuilder } from "discord.js";
import { DateTime } from "luxon";

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

function pad(str, len) {
  str = str.toString();
  return str.length >= len ? str.slice(0, len - 1) + " " : str + " ".repeat(len - str.length);
}

function sanitize(name) {
  return name
    .replace(/\^\d/g, "") // remove color codes like ^1, ^7, etc.
    .replace(/\|/g, "")   // remove pipes
    .replace(/`/g, "'");  // replace backticks with apostrophes
}

export function formatPlayerEmbed(p, opts = {}) {
  const { thumbnail } = opts;
  const kd = p.deaths === 0 ? p.kills : (p.kills / p.deaths).toFixed(2);
  const lastSeen = p.time_edit ? dayjs.unix(p.time_edit).fromNow?.() || dayjs.unix(p.time_edit).format("YYYY-MM-DD HH:mm") : "—";
  const favWeapEmoji = resolveEmoji(p.fav);
  const favWeap = favWeapEmoji ? `${favWeapEmoji} ${p.fav}` : p.fav;
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
  const weapEmoji = resolveEmoji(row.weapon);
  const weap = weapEmoji ? `${weapEmoji} ${row.weapon}` : row.weapon;
  return new EmbedBuilder()
    .setColor(0x2b7cff)
	.setThumbnail(thumbnail)
    .setDescription(`**${displayName(row)}**`)
    .addFields(
      { name: "Skill", value: String(row.skill ?? "—"), inline: true },
      { name: "Weapon", value: String(weap ?? "—"), inline: true },
      { name: "Kills", value: String(row.kills ?? 0), inline: true },
	 // { name: "KDR", value: String(kd), inline: true },
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

export function formatPlayerMapEmbed(row, title = null, opts = {}) {
  const { thumbnail } = opts;
  const lastSeen = row.time_edit
    ? (dayjs.unix(row.time_edit).fromNow?.() || dayjs.unix(row.time_edit).format("YYYY-MM-DD HH:mm"))
    : "—";
  const kd = row.deaths === 0 ? row.kills : (row.kills / row.deaths).toFixed(2);

  return new EmbedBuilder()
    .setColor(0x2b7cff)
	.setThumbnail(thumbnail)
    .setDescription(title ?? `**${displayName(row)}** on **${row.map}**`)
    .addFields(
      { name: "Skill", value: String(row.skill ?? "—"), inline: true },
      { name: "Kills", value: String(row.kills ?? 0), inline: true },
	  { name: "Kill-Death Ratio", value: String(kd), inline: true },
      { name: "Deaths", value: String(row.deaths ?? 0), inline: true },
      { name: "Suicides", value: String(row.suicides ?? 0), inline: true },
      { name: "Rounds Played", value: String(row.rounds ?? 0), inline: true }
    )
    .setFooter({ text: "XLRStats • B3 • " + (lastSeen === "—" ? "last seen unknown" : `last seen ${lastSeen}`) });
}

export function formatTopEmbed(rows, title = "Top by Skill", opts = {}) {
  const { thumbnail, offset = 0 } = opts; // <— add offset with default 0

  const embeds = [
    new EmbedBuilder().setColor(0x32d296).setTitle(title)
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
    if (r.suicides) embed.addFields({ name: "Suicides", value : String(r.suicides), inline : true });
    if (r.assists)  embed.addFields({ name: "Assists", value : String(r.assists), inline : true });
    if (r.rounds)   embed.addFields({ name: "Rounds Played", value : String(r.rounds), inline : true });

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

export function formatTopWeaponEmbed(rows, title = "Top by Kills", opts = {}) {
  const { thumbnail, offset = 0 } = opts; // <— add offset with default 0

  const embeds = [
    new EmbedBuilder().setColor(0x32d296).setTitle(title)
  ];

  rows.map((r, i) => {
	  
	const weapEmoji = resolveEmoji(r.label);
	const weap = weapEmoji ? `${weapEmoji} ${r.label}` : r.label;
	  
    let embed;
	
	if(i === 0) {
		
		embed = embeds[0];
		
	} else {
		
		embed = new EmbedBuilder()
			.setColor(0x32d296);
		embeds.push(embed);
		
	}
	
    const absoluteIndex = offset + i;               // <— absolute rank
    let rankDisplay = `#${absoluteIndex + 1}.`;       // e.g., 11, 12, ...
    

    embed.setDescription(`**${rankDisplay} ${weap}**`);
  embed.addFields(
		{
			name : `Kills`,
			value : String(r.kills),
			inline : true
		},
		{
			name : `Suicides`,
			value : String(r.suicides),
			inline : true
		}
	);
  });

  embeds[embeds.length-1].setFooter({ text: "XLRStats • B3" });

  if (thumbnail) {
    embeds[0].setThumbnail(thumbnail);
  }
  
  if(!rows.length) {
	embeds[0].setDescription("_No weapons found_");
  }
  return embeds;
}

export function formatTopMapEmbed(rows, title = "Top by Rounds Played", offset = 0) {
 
  const embeds = [
    new EmbedBuilder().setColor(0x32d296).setTitle(title)
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
	
    const absoluteIndex = offset + i;               // <— absolute rank
    let rankDisplay = `#${absoluteIndex + 1}.`;       // e.g., 11, 12, ...
    

    embed.setDescription(`**${rankDisplay} ${r.label}**`);
  embed.addFields(
		{
			name : `Kills`,
			value : String(r.kills),
			inline : true
		},
		{
			name : `Suicides`,
			value : String(r.suicides),
			inline : true
		},
		{
			name : `Rounds Played`,
			value : String(r.rounds),
			inline : true
		}
	);
	
	if (r.thumbnail) {
		embed.setThumbnail(r.thumbnail);
	}
  });

  embeds[embeds.length-1].setFooter({ text: "XLRStats • B3" });

  if(!rows.length) {
	embeds[0].setDescription("_No maps found_");
  }
  return embeds;
}

export function formatAwardEmbed(rows, title = "Award Winner", emoji = null, props = [{ name : "Kills", prop : "kills" }], opts = {}) {
  const { thumbnail, offset = 0 } = opts; // <— add offset with default 0

  const awardEmote = resolveEmoji(emoji) ?? "";

  const embeds = [
    new EmbedBuilder().setColor(0x32d296).setTitle(`${awardEmote} ${title}`)
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
	
    const medals = ["🥇", "🥈", "🥉"];

    const absoluteIndex = offset + i;               // <— absolute rank
    let rankDisplay;
    if (absoluteIndex < 3) {                        // medals only for 1–3 overall
      rankDisplay = medals[absoluteIndex];
    } else {
      rankDisplay = `#${absoluteIndex + 1}.`;       // e.g., 11, 12, ...
    }

    embed.setDescription(`**${rankDisplay} ${r.name}**`);
	for(let z = 0; z < props.length; z++) {
		
	  embed.addFields(
			{
				name : props[z].name,
				value : String(r[props[z].prop]),
				inline : true
			}
		);
	}
    
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

export function formatAwardsEmbed(rows, title = "Awards") {

	const embeds = [
		new EmbedBuilder().setColor(0x32d296).setTitle(title)
	  ];

	rows.map((r,i) => {
		let embed;
	
		if(i === 0) {
			
			embed = embeds[0];
			
		} else {
			
			embed = new EmbedBuilder()
				.setColor(0x32d296);
			embeds.push(embed);
			
		}
		
		let emote = resolveEmoji(r.emoji) ?? "";
		
		embed.setDescription(`${emote} **${r.name}**`);
		embed.addFields( { name : "\u200B", value: r.description } );
	});

	embeds[embeds.length-1].setFooter({ text: "XLRStats • B3" });

	if(!rows.length) {
		embeds[0].setDescription("_No maps found_");
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

export function renderHomeEmbed({ totals }, data, tz, ip, port) {
  const { serverinfo, playerinfo, time_retrieved, mapimage } = data;
  const { totalPlayers, totalKills, totalRounds, favoriteWeapon, favoriteMap } = totals;
  
  const map = serverinfo?.mapname || "unknown";
  const mode = serverinfo?.g_gametype || "N/A";
  const hostname = serverinfo?.sv_hostname || "Unnamed Server";
  const playerCount = playerinfo?.length || 0;
  const maxPlayers = serverinfo?.sv_maxclients || "?";

  const timezone = tz || "UTC";
  const updatedTime = DateTime.fromSeconds(Number(time_retrieved)).setZone(timezone).toLocaleString(DateTime.DATETIME_MED_WITH_SECONDS);

  const imageUrl = `https://cod.pm/mp_maps/${mapimage}`;
  
  
  const embed1 = new EmbedBuilder()
      .setColor(0x2b7cff)
      .setTitle(sanitize(hostname))
	  .setImage(imageUrl)
      .addFields(
	    { name: "Total Players Seen", value: (totalPlayers ?? 0).toLocaleString(), inline: true },
        { name: "Total Kills", value: (totalKills ?? 0).toLocaleString(), inline: true },
        { name: "Total Rounds", value: (totalRounds ?? 0).toLocaleString(), inline: true },
        { name: "Favorite Weapon", value: `${favoriteWeapon?.label ?? "—"} — **${Number(favoriteWeapon?.kills ?? 0).toLocaleString()} kills**`, inline: true },
        { name: "Favorite Map", value: `${favoriteMap?.label ?? "—"} — **${Number(favoriteMap?.rounds ?? 0).toLocaleString()} rounds**`, inline: true },
      )
	  .setFooter({ text: `${mode} — ${map} — ${playerCount}/${maxPlayers} players` });
      
	
  const embed2 = new EmbedBuilder()
	.setColor(0x2b7cff)
	.setFooter({ text: ` ${updatedTime} | XLR App • Home` });
	
	if(playerCount){

	  const namePad = 30;
	  const scorePad = 6;
	  const pingPad = 6;
	  
	  const footer = `[See All Players...](https://cod.pm/server/${ip}/${port})`; 
	  
	  let chars = namePad + scorePad + pingPad + footer.length + 18;

	  const header = pad("Name", namePad) + pad("Score", scorePad) + pad("Ping", pingPad);
	  
	  playerinfo.sort((a,b) => b.score - a.score );
		  
	  const lines = playerinfo.map(p =>
		pad(sanitize(p.name), namePad) + pad(p.score, scorePad) + pad(p.ping, pingPad)
	  );
	  let flag = false;
	  let rows = "";
	  lines.forEach((line) => {
		let join = line + '\n';
		chars += 44;
		if(chars < 1024){
			rows += join;
		} else {
			flag = true;
		}
	  });
	  
	  let footerMd = flag ? footer : "";

	  const table = [header, "-".repeat(header.length), rows].join("\n");

	  
		
	  embed2.addFields({
		  name: `/connect ${ip}:${port}`,
		  value: `\`\`\`\n${table}\n\`\`\`\n${footerMd}`
		});
		
		
		
		
		
	}
	else {  
	
		embed2.addFields({
		  name: `/connect ${ip}:${port}`,
		  value: "Server is empty"
		});
	
	}
  return [embed1, embed2];
}

export function renderLadderEmbeds({ rows, page, title = "Top Players by Skill", thumbnail = null }) {
  
  const offset = page * 10;
  
  const embeds = formatTopEmbed(rows, `🏆 ${title}`, { thumbnail, offset });
  // Tag the page in the footer of the last embed (formatTopEmbed already sets a footer)
  if (embeds.length) {
    const last = embeds[embeds.length - 1];
    const footer = last.data.footer?.text || "XLRStats • B3";
    last.setFooter({ text: `${footer} • Ladder page ${page + 1}` });
  }
  return embeds;
}

export function renderAwardsEmbeds({ rows, page, title = "Awards", thumbnail = null }) {
  const embeds = formatAwardsEmbed(rows, `🏆 ${title}`);
  if (embeds.length) {
    const last = embeds[embeds.length - 1];
    const footer = last.data.footer?.text || "XLRStats • B3";
    last.setFooter({ text: `${footer} • Awards page ${page + 1}` });
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

export function renderWeaponsEmbeds({ rows, page, thumbnail = null }) {
	
  const offset = page * 10;
  
  const embeds = formatTopWeaponEmbed(rows, `🔫 Top Weapons by Kills`, { thumbnail, offset });
  // Tag the page in the footer of the last embed (formatTopEmbed already sets a footer)
  if (embeds.length) {
    const last = embeds[embeds.length - 1];
    const footer = last.data.footer?.text || "XLRStats • B3";
    last.setFooter({ text: `${footer} • Weapons page ${page + 1}` });
  }
  return embeds;
}

export function renderMapsEmbeds({ rows, page }) {
  const offset = page * 10;
  
  const embeds = formatTopMapEmbed(rows, `🗺️ Top Maps by Rounds Played`,  offset );
  // Tag the page in the footer of the last embed (formatTopEmbed already sets a footer)
  if (embeds.length) {
    const last = embeds[embeds.length - 1];
    const footer = last.data.footer?.text || "XLRStats • B3";
    last.setFooter({ text: `${footer} • Maps page ${page + 1}` });
  }
  return embeds;
}

