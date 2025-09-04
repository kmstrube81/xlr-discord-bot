import dayjs from "dayjs";

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

export function formatTopEmbed(rows, title = "Top by Skill") {
  const lines = rows.map((r, i) => {
    const kd = r.deaths === 0 ? r.kills : (r.kills / r.deaths).toFixed(2);
    return `**${i + 1}. ${r.name}** — Skill: ${r.skill} • K/D: ${kd} • K:${r.kills} D:${r.deaths}`;
  }).join("\n");
  return {
    color: 0x32d296,
    title: `🏆 ${title}`,
    description: lines || "_No players found_",
    footer: { text: "XLRStats • B3" }
  };
}

export function formatLastSeenEmbed(rows) {
  const lines = rows.map(r => `**${r.name}** — <t:${r.time_edit}:R>`);
  return {
    color: 0xffa500,
    title: "🕒 Recently Seen",
    description: lines.join("\n") || "_No recent players_"
  };
}
