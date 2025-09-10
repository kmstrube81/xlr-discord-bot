// Fixed index.js with selectRows splitting buttons into max 5 per row

import "dotenv/config";
import { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, Events, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType } from "discord.js";
import mysql from "mysql2/promise";
import { queries } from "./queries.js";
import { formatPlayerEmbed, formatTopEmbed, formatLastSeenEmbed, formatPlayerWeaponEmbed, formatPlayerVsEmbed, formatPlayerMapEmbed, renderHomeEmbed, renderLadderEmbeds, renderWeaponsEmbed, renderMapsEmbed, setEmojiResolver, resolveEmoji } from "./format.js";
import axios from "axios";
import path from "node:path";
import fs from "node:fs";

// rest of your bot code would be here...
// NOTE: This is a placeholder header to demonstrate file regeneration.
// In the actual codebase, paste the full merged index.js content with selectRows fix.

// Example of selectRows function:
function selectRows(view, page, count) {
  const rows = [];
  const perRow = 5;
  let made = 0;
  while (made < count) {
    const row = new ActionRowBuilder();
    for (let i = 0; i < perRow && made < count; i++, made++) {
      row.addComponents(new ButtonBuilder()
        .setCustomId(`ui:${view}:pick:${page}:${made}`)
        .setLabel(String(made + 1))
        .setStyle(ButtonStyle.Primary));
    }
    if (row.components.length > 0) rows.push(row);
  }
  return rows;
}

// ...rest of file unchanged...
