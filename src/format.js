import dayjs from "dayjs";
import { EmbedBuilder, AttachmentBuilder } from "discord.js";
import {
  generateBanner,
  DEFAULT_THUMB,
  BACKGROUNDS,
  EMBLEMS,
  CALLSIGNS
} from "./banner.js";
import { DateTime } from "luxon";
import path from "node:path";

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
/* ***************************************************************
buildEmbed( 	template: type-object [required],
				data: type-array [required]
				)
return a discord js embed

---
A standardized way of building discord.js embeds using a passed in template.
Template is a object with these properties
.color - the color for the discord embed
.title - the title of the embed
.description - the description for the embed
.thumbnail - the  thumbnail
.fields - an array of field names and the property from the data
.images - an array of images to attach to the embed
.footerText - the text for footer embed
**************************************************************** */
function buildEmbed(template = {})
{
	const { color, title, description, thumbnail,
	  fields, images, footerText } = template;
	const embed = new EmbedBuilder();
	//set color
	if(color)
		embed.setColor(color);
	//Set title
	if(title)
		embed.setTitle(title);
	//set description
	if(description)
		embed.setDescription(description);
	//set thumbnail
	if(thumbnail){
		embed.setThumbnail(thumbnail.uri);
	}
	//set fields
	if(fields)
		fields.map((f, i) => {
			embed.addFields({
				name: f.name,
				value: f.value,
				inline: f.inline
			});
		});
	//set image
	if(images)
		images.map((m,i) => {
			embed.setImage(m.uri);
		});
	//set footer text
	if(footerText)
		embed.setFooter({text: footerText});
	
	return embed;
}

export function editEmbed(embed, template = {}, mode = "edit")
{
	const { color, title, description, thumbnail,
	  fields, images, footerText } = template;
	  
	//set color
	if(color)
		embed.setColor(color);
	//Set title
	if(title && embed.data?.title){
		if(mode === "append"){
			embed.setTitle([embed.data.title, title].join("\n"));
		}
		else
			embed.setTitle(title);
	}
	//set description
	if(description && embed.data?.description){
		if(mode === "append"){
			embed.setDescription([embed.data?.description, description].join("\n"));
		}
		else
			embed.setDescription(description);
	}
	//set thumbnail
	if(thumbnail)
		embed.setThumbnail(thumbnail.uri);
	//set fields
	if(fields){
		if(mode !== "append"){
			embed.data.fields = [];
		}
		fields.map((f, i) => {
			embed.addFields({
				name: f.name,
				value: f.value,
				inline: f.inline
			});
		});
	}
	//set image
	if(images){
		
		images.map((m,i) => {
			embed.setImage(m.uri);
		});
	}
	//set footer text
	if(footerText){
		if(mode === "append"){
			embed.setFooter({text: [embed.data?.footer.text, footerText].join("\n")});
		}
		else 
			embed.setFooter({text: footerText});
	}
	return embed;
}

export async function formatPlayerEmbed(p, opts = {}) {
  const { thumbnail } = opts;
  
  const kd = p.deaths === 0 ? p.kills : (p.kills / p.deaths).toFixed(2);
  const lastSeen = p.time_edit ? dayjs.unix(p.time_edit).fromNow?.() || dayjs.unix(p.time_edit).format("YYYY-MM-DD HH:mm") : "—";
  const favWeapEmoji = resolveEmoji(p.fav);
  const favWeap = favWeapEmoji ? `${favWeapEmoji} ${p.fav}` : p.fav;
  
  const wins       = Number(p.wins ?? 0);
  const losses     = Number(p.losses ?? 0);
  const games      = wins + losses;
  const winPct     = games ? ((wins / games) * 100).toFixed(1) : ".000";
  const wawaWins   = Number(p.wawa_wins ?? 0);
  const wawaLosses = Number(p.wawa_losses ?? 0);
  const wagames    = wawaWins + wawaLosses;
  const wawinPct   = wagames ? (wawaWins / wagames).toFixed(31) : ".000";
  
  const bg = Number(p?.bg ?? 0) || 0;
  const em = Number(p?.em ?? 0) || 0;
  const cs = Number(p?.cs ?? 0) || 0;

  const files = [];
  // Generate the banner
  const { buffer, filename } = await generateBanner({
	background: bg,
	emblem: em,
	callsign: cs,
	playerName: p.name,              
	kills: Number(p.kills) || 0,
	deaths: Number(p.deaths) || 0,
	skill: Number(p.skill) || 0
  });
  
  const file = new AttachmentBuilder(buffer, { name: filename });
  
  files.push(file);
  
  const color = 0x2b7cff;
  const title = `**${p.name}**`;
  const fields = [{ name: "Skill", value: String(p.skill ?? "—"), inline: true },
				  { name: "Fav Weapon", value: String( favWeap ?? "—"), inline: true },
				  { name: "Nemesis", value: p.nemesis ? `${p.nemesis}${typeof p.nemesis_kills === "number" ? ` (${p.nemesis_kills})` : ""}` : "—", inline: true },
				  { name: "Kills", value: `${p.kills ?? 0}`, inline: true },
				  { name: "Best Killstreak", value: `${p.winstreak ?? 0}`, inline: true },
				  { name: "KDR", value: String(kd), inline: true },
				  { name: "Headshots", value: String(p.headshots ?? 0), inline: true },
				  { name: "Assists", value: String(p.assists ?? 0), inline: true },
				  { name: "Deaths", value: String(p.deaths ?? 0), inline: true },
				  { name: "Rounds Played", value: `${p.rounds ?? 0}`, inline: true },
				  { name: "W-L (Win%)", value: `${wins}-${losses} (${winPct}%)`, inline: true },
				  { name: "wawa W-L (Win%)", value: `${wawaWins}-${wawaLosses} (${wawinPct})`, inline: true },
				  { name: "Connections", value: String(p.connections ?? 0), inline: true },
				  { name: "Last Seen", value: lastSeen, inline: true }
				 ];
  const images = [ { filename: filename, uri: `attachment://${filename}` }];
  const footerText = "XLRStats • B3";
  return [ buildEmbed({color,title,fields,images,footerText,thumbnail}),
	files ];
}

export function formatPlayerWeaponEmbed(row, opts = {}) {
  const { thumbnail } = opts;
  const kd = row.deaths === 0 ? row.kills : (row.kills / row.deaths).toFixed(2);
  const lastSeen = row.time_edit ? dayjs.unix(row.time_edit).fromNow?.() || dayjs.unix(row.time_edit).format("YYYY-MM-DD HH:mm") : "—";
  const weapEmoji = resolveEmoji(row.weapon);
  const weap = weapEmoji ? `${weapEmoji} ${row.weapon}` : row.weapon;
  return new EmbedBuilder()
    .setColor(0x2b7cff)
    .setDescription(`**${row.name}**`)
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
  const pWw = Number(row.player_wawa_wins ?? 0);
  const pWl = Number(row.player_wawa_losses ?? 0);
  return new EmbedBuilder()
    .setColor(0x2b7cff)
    .setDescription(`**${row.player_name}** vs. **${row.opponent_name}**`)
    .addFields(
      { name: "Kills", value: String(row.kills_vs ?? 0), inline: true },
      { name: "Skill", value: String(row.player_skill ?? "—"), inline: true },
      { name: "\u200B", value: "\u200B", inline: true },
      { name: "Killed By", value: String(row.deaths_vs ?? 0), inline: true },
      { name: "Opponent Skill", value: String(row.opp_skill ?? "—"), inline: true },
      { name: "\u200B", value: "\u200B", inline: true },
	  { name: "wawa W-L", value: `${pWw}-${pWl}`, inline: true },
    )
    .setFooter({ text: "XLRStats • B3" });
}

export function formatPlayerMapEmbed(row, title = null, opts = {}) {
  const { thumbnail } = opts;
  const lastSeen = row.time_edit
    ? (dayjs.unix(row.time_edit).fromNow?.() || dayjs.unix(row.time_edit).format("YYYY-MM-DD HH:mm"))
    : "—";
  const kd = row.deaths === 0 ? row.kills : (row.kills / row.deaths).toFixed(2);
  const wins       = Number(row.wins ?? 0);
  const losses     = Number(row.losses ?? 0);
  const games      = wins + losses;
  const winPct     = games ? (wins / games).toFixed(3) : ".000";

  return new EmbedBuilder()
    .setColor(0x2b7cff)
	.setThumbnail(thumbnail)
    .setDescription(title ?? `**${row.name}** on **${row.map}**`)
    .addFields(
      { name: "Skill", value: String(row.skill ?? "—"), inline: true },
      { name: "Kills", value: String(row.kills ?? 0), inline: true },
	  { name: "Kill-Death Ratio", value: String(kd), inline: true },
      { name: "Deaths", value: String(row.deaths ?? 0), inline: true },
      { name: "Suicides", value: String(row.suicides ?? 0), inline: true },
	  { name: "W-L (Win%)", value: `${wins}-${losses} (${winPct})`, inline: true },
      { name: "Rounds Played", value: String(row.rounds ?? 0), inline: true }
    )
    .setFooter({ text: "XLRStats • B3 • " + (lastSeen === "—" ? "last seen unknown" : `last seen ${lastSeen}`) });
}

export function formatTopEmbed(rows, titleText = "Top by Skill", opts = {}) {
	const { thumbnail, offset = 0, footerText } = opts;

	const embeds = [];
	const files = [];
	const last = rows.length - 1;
	
	rows.map((r, i) => {
		
		const template = {};
		template.color = 0x32d296;
		
		if(i === 0)
			template.title = titleText;
		
		const medals = ["🥇", "🥈", "🥉"];

		const absoluteIndex = offset + i;               // <— absolute rank
		let rankDisplay;
		if (absoluteIndex < 3) {                        // medals only for 1–3 overall
			rankDisplay = medals[absoluteIndex];
		} else {
			rankDisplay = `#${absoluteIndex + 1}.`;       // e.g., 11, 12, ...
		}
		template.description = [`**${rankDisplay} ${r.name}**`, sanitize(CALLSIGNS[r.cs])].join("\n");
		
		const kd = r.deaths === 0 ? r.kills : (r.kills / r.deaths).toFixed(2);
		
		template.fields = [{
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
						}];
		if (r.suicides) template.fields.push({ name: "Suicides", value : String(r.suicides), inline : true });
		if (r.assists)  template.fields.push({ name: "Assists", value : String(r.assists), inline : true });
    
		if (typeof r.wins !== "undefined" && typeof r.losses !== "undefined") {
			const w = Number(r.wins || 0), l = Number(r.losses || 0);
			const gp = w + l;
			const pct = gp ? ((w / gp)).toFixed(3) : ".000";
			template.fields.push({ name: "W-L (Win%)", value: `${w}-${l} (${pct})`, inline: true });
		}
		if (typeof r.wawa_wins !== "undefined" && typeof r.wawa_losses !== "undefined") {
			const w = Number(r.wawa_wins || 0), l = Number(r.wawa_losses || 0);
			const gp = w + l;
			const pct = gp ? ((w / gp)).toFixed(3) : ".000";
			template.fields.push({ name: "wawa W-L (Win%)", value: `${w}-${l} (${pct})`, inline: true });
		}
	
		if (r.rounds)   template.fields.push({ name: "Rounds Played", value : String(r.rounds), inline : true });

		if(i === last)
			template.footerText = footerText;
		
		if(!thumbnail || thumbnail === DEFAULT_THUMB){
			const thumbpath = EMBLEMS[r.em];
			const abs = path.resolve(process.cwd(), thumbpath);
			const thumbname = `emblem_${r.client_id || i}.png`;
			template.thumbnail = {filename: thumbname, uri: `attachment://${thumbname}`};
			const file = new AttachmentBuilder(abs, { name: thumbname });
			files.push(file);
		} else {
			template.thumbnail = {filename: "thumbname", uri: thumbnail};
		}
		embeds.push(buildEmbed(template));
	});
  
	if(!rows.length) {
		embeds.push(buildEmbed({description:"_No players found_"}));
	}
	return [embeds,files];
}

export function formatTopWeaponEmbed(rows, title = "Top by Kills", opts = {}) {
	const { thumbnail, offset = 0, footerText } = opts;

	const embeds = [];
	const files = [];
	const last = rows.length - 1;

	rows.map((r, i) => {
	  
		const weapEmoji = resolveEmoji(r.label);
		const weap = weapEmoji ? `${weapEmoji} ${r.label}` : r.label;
	  
		const template = {};
		template.color = 0x32d296;

		const absoluteIndex = offset + i;
		let rankDisplay = `#${absoluteIndex + 1}.`;
    

		template.description = `**${rankDisplay} ${weap}**`;
		template.fields =
			[
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
			];
		//if there is no specified thumbnail and there is an emblem match
		if((!thumbnail || thumbnail === DEFAULT_THUMB) && EMBLEMS.some(emblem => emblem.includes(r.label))){ 
			const thumbpath = EMBLEMS.find(emblem => emblem.includes(r.label));
			const abs = path.resolve(process.cwd(), thumbpath);
			const thumbname = `emblem_${i}.png`;
			template.thumbnail = {filename: thumbname, uri: `attachment://${thumbname}`};
			const file = new AttachmentBuilder(abs, { name: thumbname });
			files.push(file);
		} else {
			template.thumbnail = {uri: thumbnail};
		}
		
		if(i === last)
			template.footerText = footerText;
		
		embeds.push(buildEmbed(template));
	});
	
	if(!rows.length) {
		embeds.push(buildEmbed({description:"_No weapons found_"}));
	}
	return [embeds, files];
}

export function formatTopMapEmbed(rows, title = "Top by Rounds Played", opts) {
 
	const { thumbnail, offset = 0, footerText } = opts;

	const embeds = [];
	const files = [];
	const last = rows.length - 1;

	rows.map((r, i) => {
	   
		const template = {};
		template.color = 0x32d296;

		const absoluteIndex = offset + i;
		let rankDisplay = `#${absoluteIndex + 1}.`;


		template.description = `**${rankDisplay} ${r.label}**`;
		template.fields =
			[
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
			];
			
		if(!thumbnail || thumbnail === DEFAULT_THUMB){
			//use map thumbnail
			const thumbname = `thumbnail_${r.label || i}.png`;
			template.thumbnail = {filename: thumbname, uri: r.thumbnail};
		
		} else {
			//used passed in thumbnail
			template.thumbnail = {filename: "thumbname", uri: thumbnail};
		}
		
		if(i === last)
			template.footerText = footerText;
		
		embeds.push(buildEmbed(template));
	});
	
	if(!rows.length) {
		embeds.push(buildEmbed({description:"_No weapons found_"}));
	}
	return [embeds, files];
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
		
		if (r.top) {
		  const props = (r.properties || [])
			.map(p => `**${p.name}:** ${String(r.top[p.prop] ?? "0")}`)
			.join(" • ");
		  const leaderName = r.top?.name || "—";
		  embed.addFields({ name: "\u200B", value: `${leaderName}${props ? " — " + props : ""}` });
		}

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

	const embeds = [];
	const template = {};
	template.color = 0x2b7cff;
	template.title = sanitize(hostname);
	template.fields =
		[
			{ name: "Total Players Seen", value: (totalPlayers ?? 0).toLocaleString(), inline: true },
			{ name: "Total Kills", value: (totalKills ?? 0).toLocaleString(), inline: true },
			{ name: "Total Rounds", value: (totalRounds ?? 0).toLocaleString(), inline: true },
			{ name: "Favorite Weapon", value: `${favoriteWeapon?.label ?? "—"} — **${Number(favoriteWeapon?.kills ?? 0).toLocaleString()} kills**`, inline: true },
			{ name: "Favorite Map", value: `${favoriteMap?.label ?? "—"} — **${Number(favoriteMap?.rounds ?? 0).toLocaleString()} rounds**`, inline: true },
		];
	template.images = [{uri: imageUrl}];
	template.footerText = `${mode} — ${map} — ${playerCount}/${maxPlayers} players`;

	embeds.push(buildEmbed(template));   

	template.footerText = ` ${updatedTime} | XLR App • Home`;
	template.title = null;
	template.images = null;
	template.fields = null;
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
		
		template.fields =
		[{
			name: `/connect ${ip}:${port}`,
			value: `\`\`\`\n${table}\n\`\`\`\n${footerMd}`
		}];	
	}
	else {  
		template.fields =
		[{
			name: `/connect ${ip}:${port}`,
			value: "Server is empty"
		}];
	}
	embeds.push(buildEmbed(template));
	return embeds;
}

export function renderLadderEmbeds({ rows, page, title = "Top Players by Skill", thumbnail = null }) {
  
	const offset = page * 10;

	const [embeds, files] = formatTopEmbed(rows, `🏆 ${title}`, { thumbnail, offset, footerText: `XLRStats • B3 • Ladder page ${page + 1}` });

	return [embeds, files];
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

	return formatTopWeaponEmbed(rows, `🔫 Top Weapons by Kills`, { thumbnail, offset, footerText: `XLRStats • B3 • Weapons page ${page + 1}` });

}

export function renderMapsEmbeds({ rows, page, thumbnail = null }) {
  const offset = page * 10;
  
  return formatTopMapEmbed(rows, `🗺️ Top Maps by Rounds Played`,  { thumbnail, offset, footerText: `XLRStats • B3 • Weapons page ${page + 1}` });

}

export function formatLoadEmbed() {
	const embed = new EmbedBuilder()
      .setColor(0x2b7cff)
      .setTitle("Please Wait...")
      .setDescription("Loading...");
	  
	 return embed;
}