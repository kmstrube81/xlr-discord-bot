import dayjs from "dayjs";
import { EmbedBuilder } from "discord.js";

export function formatPlayerEmbed(p) {
  const kd = p.deaths === 0 ? p.kills : (p.kills / p.deaths).toFixed(2);
  const lastSeen = p.time_edit ? dayjs.unix(p.time_edit).fromNow?.() || dayjs.unix(p.time_edit).format("YYYY-MM-DD HH:mm") : "—";
  return {
    color: 0x2b7cff,
    title: `📊 ${p.name}`,
    fields: [
      { name: "Skill", value: String(p.skill ?? "—"), inline: true },
      { name: "K/D", value: String(kd), inline: true },
      { name: "Kills / Deaths", value: `${p.kills ?? 0} / ${p.deaths ?? 0}`, inline: true },
	  { name: "Best Kill/Death Streak", value: `${p.winstreak ?? 0}/${p.losestreak ?? 0}`, inline: true },
      { name: "Rounds Played", value: `${p.rounds ?? 0}`, inline: true },
      { name: "Headshots", value: String(p.headshots ?? 0), inline: true },
      { name: "Connections", value: String(p.connections ?? 0), inline: true },
      { name: "Last Seen", value: lastSeen, inline: true }
    ],
    footer: { text: "XLRStats • B3" }
  };
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
		
	}
	
    const kd = r.deaths === 0 ? r.kills : (r.kills / r.deaths).toFixed(2);
	
	embed.addFields(
		{
			name : `#${i + 1}.`,
			value : String(r.name),
			inline : false
		},
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
    if (typeof r.assists === "number")  embed.addFields({ name: "Assits", value : String(r.assists), inline : true });
    if (typeof r.rounds === "number")   embed.addFields({ name: "Rounds Played", value : String(r.rounds), inline : true });

  });

  embeds[embeds.length-1].setFooter({ text: "XLRStats • B3" });

  if (thumbnail) {
    embeds[0].setThumbnail(thumbnail);
  }
  
  if(!lines) {
	embeds[0].setDescription("_No players found_");
  }
  return embeds;
}


export function formatLastSeenEmbed(rows) {
  const lines = rows.map(r => `**${r.name}** — <t:${r.time_edit}:R>`);
  return {
    color: 0xffa500,
    title: "🕒 Recently Seen",
    description: lines.join("\n") || "_No recent players_"
  };
}
