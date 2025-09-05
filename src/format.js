import dayjs from "dayjs";
import { EmbedBuilder } from "discord.js";

export function formatPlayerEmbed(p) {
  const kd = p.deaths === 0 ? p.kills : (p.kills / p.deaths).toFixed(2);
  const lastSeen = p.time_edit ? dayjs.unix(p.time_edit).fromNow?.() || dayjs.unix(p.time_edit).format("YYYY-MM-DD HH:mm") : "—";
  return new EmbedBuilder().
	setColor(0x2b7cff).
    setTitle(`**${p.name}**`).
    addFields(
      { name: "Skill", value: String(p.skill ?? "—"), inline: true },
	  { name: "Fav Weapon", value: String(p.fav ?? "—"), inline: true },
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

export function formatPlayerWeaponEmbed(row) {
  const kd = row.deaths === 0 ? row.kills : (row.kills / row.deaths).toFixed(2);
  const lastSeen = row.time_edit ? dayjs.unix(row.time_edit).fromNow?.() || dayjs.unix(row.time_edit).format("YYYY-MM-DD HH:mm") : "—";
  return new EmbedBuilder()
    .setColor(0x2b7cff)
    .setDescription(`**${row.name}**`)
    .addFields(
      { name: "Skill", value: String(row.skill ?? "—"), inline: true },
      { name: "Weapon", value: String(row.weapon ?? "—"), inline: true },
      { name: "\u200B", value: "\u200B", inline: true },
      { name: "Kills", value: String(row.kills ?? 0), inline: true },
      { name: "Killed By", value: String(row.deaths ?? 0), inline: true },
      { name: "Suicides By", value: String(row.suicides ?? 0), inline: true }
    )
    .setFooter({ text: "XLRStats • B3" });
}

export function formatPlayerVsEmbed(row) {
  return new EmbedBuilder()
    .setColor(0x2b7cff)
    .setDescription(`**${row.player_name}** vs. **${row.opponent_name}**`)
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


export function formatTopEmbed(rows, title = "Top by Skill", opts = {}) {
  const { thumbnail } = opts;

  const embeds = [
	new EmbedBuilder()
	.setColor(0x32d296)
	.setTitle(`🏆 ${title}`)
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

	let rankDisplay;
	if (i < 3) {
	  // Use medal for 1st, 2nd, 3rd
	  rankDisplay = medals[i];
	} else {
	  // Use #<rank> for everything else
	  rankDisplay = `#${i + 1}.`;
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


export function formatLastSeenEmbed(rows) {
  const lines = rows.map(r => `**${r.name}** — <t:${r.time_edit}:R>`);
  return new EmbedBuilder().
    setColor(0xffa500).
    setTitle("🕒 Recently Seen").
    setDescription(lines.join("\n") || "_No recent players_");
}
