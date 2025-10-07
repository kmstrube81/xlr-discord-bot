// src/queries.js
const PLAYERSTATS = "xlr_playerstats";
const PLAYERBODY  = "xlr_playerbody";

export const SORTABLE = new Set(["skill", "kills", "deaths", "ratio", "suicides", "assists", "rounds"]);

function orderExpr(sort) {
  switch (sort) {
    case "kills":     return "kills DESC";
    case "deaths":    return "deaths DESC";
    case "ratio":     return "ratio DESC";
    case "suicides":  return "suicides DESC";
    case "assists":   return "assists DESC";
    case "rounds":    return "rounds DESC";
    case "skill":
    default:          return "skill DESC";
  }
}

const asLike = t => `%${t}%`;
const asIdOrNeg1 = t => (Number.isInteger(Number(t)) ? Number(t) : -1);

/**
 * Preferred-alias join:
 * - Choose the alias with highest num_used
 * - Tie-break with latest time_edit
 * - Returns exactly one row per client_id
 *
 * @param {string} as         Subquery alias name (e.g. 'a', 'pa', 'oa', 'ka')
 * @param {string} clientRef  Column to join on (default 'c.id')
 */
const preferredAliasJoin = (as = "a", clientRef = "c.id") => `
LEFT JOIN (
  SELECT
    client_id,
    SUBSTRING_INDEX(
      GROUP_CONCAT(alias ORDER BY num_used DESC, time_edit DESC SEPARATOR '||'),
      '||', 1
    ) AS alias
  FROM aliases
  GROUP BY client_id
) ${as} ON ${as}.client_id = ${clientRef}
`;

/** Shared name join for lists that show player names */
const nameJoin = `
  JOIN clients c ON c.id = s.client_id
  ${preferredAliasJoin("a", "c.id")}
`;

/** Robust top list with weapon/map pre-resolution + non-zero filter + matched_label */
export function topDynamic({ limit, sort = "skill", weapon = null, map = null }) {
  const safeSort = SORTABLE.has(sort) ? sort : "skill";
  const orderBy  = `ORDER BY ${orderExpr(safeSort)}`;
  const params   = [];

  let select, from, joins = "", where = "";

  if (weapon) {
    select = `
      SELECT c.id AS client_id,
             COALESCE(NULLIF(c.preferred_name,''), a.alias, c.name) AS name,
      c.discord_id AS discord_id,
           c.discord_id AS discord_id,
      c.discord_id AS discord_id,
           c.discord_id AS discord_id,
             s.skill AS skill,
             wu.kills AS kills,
             wu.deaths AS deaths,
             CASE WHEN wu.deaths=0 THEN wu.kills ELSE ROUND(wu.kills / wu.deaths, 2) END AS ratio,
             wu.suicides AS suicides,
             NULL AS assists,
             NULL AS rounds,
             wsel.name AS matched_label
    `;
    from = `FROM ${PLAYERSTATS} s`;
    joins = `
      ${nameJoin}
      JOIN (
        SELECT id, name
        FROM xlr_weaponstats
        WHERE (name LIKE ? OR id = ?)
        ORDER BY name
        LIMIT 1
      ) wsel ON 1=1
      JOIN xlr_weaponusage wu ON wu.weapon_id = wsel.id AND wu.player_id = c.id
    `;
    params.push(asLike(weapon), asIdOrNeg1(weapon));
    where = `WHERE (wu.kills > 0 OR wu.deaths > 0)`;

  } else if (map) {
    select = `
      SELECT c.id AS client_id,
             COALESCE(NULLIF(c.preferred_name,''), a.alias, c.name) AS name,
      c.discord_id AS discord_id,
           c.discord_id AS discord_id,
      c.discord_id AS discord_id,
           c.discord_id AS discord_id,
             s.skill AS skill,
             pm.kills AS kills,
             pm.deaths AS deaths,
			 pm.wins,
             pm.losses,
             CASE WHEN pm.deaths=0 THEN pm.kills ELSE ROUND(pm.kills / pm.deaths, 2) END AS ratio,
             pm.suicides AS suicides,
             NULL AS assists,
             pm.rounds AS rounds,
             msel.name AS matched_label
    `;
    from = `FROM ${PLAYERSTATS} s`;
    joins = `
      ${nameJoin}
      JOIN (
        SELECT id, name
        FROM xlr_mapstats
        WHERE (name LIKE ? OR id = ?)
        ORDER BY name
        LIMIT 1
      ) msel ON 1=1
      JOIN xlr_playermaps pm ON pm.map_id = msel.id AND pm.player_id = c.id
    `;
    params.push(asLike(map), asIdOrNeg1(map));
    where = `WHERE (pm.kills > 0 OR pm.deaths > 0)`;

  } else {
    select = `
      SELECT
        c.id AS client_id,
        COALESCE(NULLIF(c.preferred_name,''), a.alias, c.name) AS name,
        c.discord_id AS discord_id,
        s.skill,
        s.kills,
        s.deaths,
        CASE WHEN s.deaths = 0 THEN s.kills ELSE ROUND(s.kills / s.deaths, 2) END AS ratio,
        s.suicides,
        s.assists,
        s.rounds,
        s.wins,
        s.losses,
        s.wawa_wins,
        s.wawa_losses,
        NULL AS matched_label
    `;
    from = `FROM ${PLAYERSTATS} s`;
    joins = `
      JOIN clients c ON c.id = s.client_id
      ${preferredAliasJoin("a", "c.id")}
    `;
    where = `WHERE (s.kills > 0 OR s.deaths > 0 OR s.assists > 0)`;
  }


  const sql = `
    ${select}
    ${from}
    ${joins}
    ${where}
    ${orderBy}
    LIMIT ?
  `;
  params.push(limit);

  return { sql, params };
}

const ui_totalKills = `
  SELECT SUM(kills) AS totalKills
  FROM xlr_playerstats
`;

const ui_totalRounds = `
  SELECT SUM(rounds) AS totalRounds
  FROM xlr_playerstats
`;

const ui_totalPlayers = `
  SELECT COUNT(*) AS totalPlayers
  FROM clients s
`;

const ui_favoriteWeapon = `
  SELECT w.name AS label, SUM(wu.kills) AS kills
  FROM xlr_weaponusage wu
  JOIN xlr_weaponstats w ON w.id = wu.weapon_id
  GROUP BY w.id, w.name
  ORDER BY kills DESC
  LIMIT 1
`;

const ui_favoriteMap = `
  SELECT m.name AS label, SUM(pm.rounds) AS rounds
  FROM xlr_playermaps pm
  JOIN xlr_mapstats m ON m.id = pm.map_id
  GROUP BY m.id, m.name
  ORDER BY rounds DESC
  LIMIT 1
`;

// Core stats + banner settings for a single player (by clients.id)
const playerCoreAndBannerById = `
  SELECT
    c.id AS client_id,
    COALESCE(NULLIF(c.preferred_name,''), a.alias, c.name) AS name,
    COALESCE(ROUND(s.skill, 2), 0) AS skill,
    COALESCE(s.kills,  0) AS kills,
    COALESCE(s.deaths, 0) AS deaths,
    COALESCE(pc.background, 0) AS background,
    COALESCE(pc.emblem,     0) AS emblem,
    COALESCE(pc.callsign,   0) AS callsign
  FROM clients c
  LEFT JOIN ${PLAYERSTATS} s ON s.client_id = c.id
  ${preferredAliasJoin("a", "c.id")}
  LEFT JOIN xlr_playercards pc ON pc.player_id = c.id
  WHERE c.id = ?
  LIMIT 1
`;


function ui_ladderSlice(limit = 10, offset = 0) {
  const sql = `
    SELECT
      c.id AS client_id,
      COALESCE(NULLIF(c.preferred_name,''), a.alias, c.name) AS name,
      c.discord_id AS discord_id,
      agg.skill,
      agg.kills,
      agg.deaths,
      CASE WHEN agg.deaths = 0 THEN agg.kills ELSE ROUND(agg.kills / agg.deaths, 2) END AS ratio,
      agg.suicides,
      agg.assists,
      agg.rounds,
      agg.wins,
      agg.losses,
      agg.wawa_wins,
      agg.wawa_losses
    FROM (
      SELECT
        s.client_id,
        SUM(s.kills)        AS kills,
        SUM(s.deaths)       AS deaths,
        SUM(s.suicides)     AS suicides,
        SUM(s.assists)      AS assists,
        SUM(s.rounds)       AS rounds,
        SUM(s.wins)         AS wins,
        SUM(s.losses)       AS losses,
        SUM(s.wawa_wins)    AS wawa_wins,
        SUM(s.wawa_losses)  AS wawa_losses,
        MAX(s.skill)        AS skill
      FROM ${PLAYERSTATS} s
      GROUP BY s.client_id
      HAVING (SUM(s.kills) > 0 OR SUM(s.deaths) > 0 OR SUM(s.assists) > 0)
    ) agg
    JOIN clients c ON c.id = agg.client_id
    ${preferredAliasJoin("a", "c.id")}
    ORDER BY agg.skill DESC
    LIMIT ? OFFSET ?
  `;
  return { sql, params: [limit, offset] };
}

function ui_playerWeaponSlice(weapon, limit = 10, offset = 0) {
  const sql = `
    SELECT
      c.id AS client_id,
      COALESCE(NULLIF(c.preferred_name,''), a.alias, c.name) AS name,
      c.discord_id AS discord_id,
      c.discord_id AS discord_id,
           c.discord_id AS discord_id,
      sagg.skill AS skill,
      wuagg.kills AS kills,
      wuagg.deaths AS deaths,
      CASE WHEN wuagg.deaths = 0 THEN wuagg.kills ELSE ROUND(wuagg.kills / wuagg.deaths, 2) END AS ratio,
      wuagg.suicides AS suicides,
      NULL AS assists,
      NULL AS rounds,
      wsel.name AS matched_label
    FROM (
      SELECT client_id, MAX(skill) AS skill
      FROM ${PLAYERSTATS}
      GROUP BY client_id
    ) sagg
    JOIN clients c ON c.id = sagg.client_id
    ${preferredAliasJoin("a", "c.id")}
    JOIN (
      SELECT id, name
      FROM xlr_weaponstats
      WHERE (name LIKE ? OR id = ?)
      ORDER BY name
      LIMIT 1
    ) wsel ON 1=1
    JOIN (
      SELECT player_id, weapon_id,
             SUM(kills) AS kills,
             SUM(deaths) AS deaths,
             SUM(suicides) AS suicides
      FROM xlr_weaponusage
      GROUP BY player_id, weapon_id
    ) wuagg ON wuagg.weapon_id = wsel.id AND wuagg.player_id = c.id
    WHERE (wuagg.kills > 0 OR wuagg.deaths > 0)
    ORDER BY wuagg.kills DESC
    LIMIT ? OFFSET ?
  `;
  return { sql, params: [asLike(weapon), asIdOrNeg1(weapon), limit, offset] };
}

function ui_weaponsSlice(limit = 10, offset = 0) {
  const sql = `
    SELECT w.name AS label, SUM(wu.kills) AS kills, SUM(wu.suicides) AS suicides
    FROM xlr_weaponusage wu
    JOIN xlr_weaponstats w ON w.id = wu.weapon_id
    GROUP BY w.id, w.name
    ORDER BY kills DESC
    LIMIT ? OFFSET ?
  `;
  return { sql, params: [limit, offset] };
}

function ui_playerMapsSlice(map, limit = 10, offset = 0) {
  const sql = `
    SELECT
      c.id AS client_id,
      COALESCE(NULLIF(c.preferred_name,''), a.alias, c.name) AS name,
      c.discord_id AS discord_id,
      c.discord_id AS discord_id,
           c.discord_id AS discord_id,
      sagg.skill AS skill,
      pmagg.kills AS kills,
      pmagg.deaths AS deaths,
      CASE WHEN pmagg.deaths = 0 THEN pmagg.kills ELSE ROUND(pmagg.kills / pmagg.deaths, 2) END AS ratio,
      pmagg.suicides AS suicides,
      NULL AS assists,
      pmagg.rounds AS rounds,
      msel.name AS matched_label
    FROM (
      SELECT client_id, MAX(skill) AS skill
      FROM ${PLAYERSTATS}
      GROUP BY client_id
    ) sagg
    JOIN clients c ON c.id = sagg.client_id
    ${preferredAliasJoin("a", "c.id")}
    JOIN (
      SELECT id, name
      FROM xlr_mapstats
      WHERE (name LIKE ? OR id = ?)
      ORDER BY name
      LIMIT 1
    ) msel ON 1=1
    JOIN (
      SELECT player_id, map_id,
             SUM(kills) AS kills,
             SUM(deaths) AS deaths,
             SUM(suicides) AS suicides,
             SUM(rounds) AS rounds
      FROM xlr_playermaps
      GROUP BY player_id, map_id
    ) pmagg ON pmagg.map_id = msel.id AND pmagg.player_id = c.id
    WHERE (pmagg.kills > 0 OR pmagg.deaths > 0)
    ORDER BY pmagg.rounds DESC
    LIMIT ? OFFSET ?
  `;
  return { sql, params: [asLike(map), asIdOrNeg1(map), limit, offset] };
}

function ui_mapsSlice(limit = 10, offset = 0) {
  const sql = `
    SELECT m.name AS label, SUM(pm.rounds) AS rounds, SUM(pm.kills) AS kills, SUM(pm.suicides) AS suicides
    FROM xlr_playermaps pm
    JOIN xlr_mapstats m ON m.id = pm.map_id
    GROUP BY m.id, m.name
    ORDER BY rounds DESC
    LIMIT ? OFFSET ?
  `;
  return { sql, params: [limit, offset] };
}

const ui_ladderCount = `
  SELECT COUNT(*) AS cnt
  FROM (
    SELECT s.client_id
    FROM ${PLAYERSTATS} s
    GROUP BY s.client_id
    HAVING (SUM(s.kills) > 0 OR SUM(s.deaths) > 0 OR SUM(s.assists) > 0)
  ) t
`;

const ui_weaponsCount = `
  SELECT COUNT(*) AS cnt
  FROM xlr_weaponstats s
`;

const ui_weaponsAll = `
  SELECT w.name AS label, SUM(wu.kills) AS kills, SUM(wu.suicides) AS suicides
  FROM xlr_weaponusage wu
  JOIN xlr_weaponstats w ON w.id = wu.weapon_id
  GROUP BY w.id, w.name
  ORDER BY kills DESC
`;

const ui_playerWeaponCount = `
  SELECT COUNT(*) AS cnt
  FROM (
    SELECT wu.player_id
    FROM (
      SELECT id
      FROM xlr_weaponstats
      WHERE (name LIKE ? OR id = ?)
      ORDER BY name
      LIMIT 1
    ) wsel
    JOIN (
      SELECT player_id, weapon_id,
             SUM(kills) AS kills,
             SUM(deaths) AS deaths
      FROM xlr_weaponusage
      GROUP BY player_id, weapon_id
    ) wu ON wu.weapon_id = wsel.id
    GROUP BY wu.player_id
    HAVING (SUM(wu.kills) > 0 OR SUM(wu.deaths) > 0)
  ) t
`;

const ui_mapsAll = `
  SELECT m.name AS label, SUM(pm.rounds) AS rounds
  FROM xlr_playermaps pm
  JOIN xlr_mapstats m ON m.id = pm.map_id
  GROUP BY m.id, m.name
  ORDER BY rounds DESC
`;

const ui_mapsCount = `
  SELECT COUNT(*) AS cnt
  FROM xlr_mapstats s
`;

const ui_playerMapsCount = `
  SELECT COUNT(*) AS cnt
  FROM (
    SELECT pm.player_id
    FROM (
      SELECT id
      FROM xlr_mapstats
      WHERE (name LIKE ? OR id = ?)
      ORDER BY name
      LIMIT 1
    ) msel
    JOIN (
      SELECT player_id, map_id,
             SUM(kills) AS kills,
             SUM(deaths) AS deaths
      FROM xlr_playermaps
      GROUP BY player_id, map_id
    ) pm ON pm.map_id = msel.id
    GROUP BY pm.player_id
    HAVING (SUM(pm.kills) > 0 OR SUM(pm.deaths) > 0)
  ) t
`;

export const registerDiscordByGuid = `UPDATE clients SET discord_id = ? WHERE guid = ?`;

// === AWARDS ===

// 1) Most Headshot Kills
export const award_headshot = `
  SELECT
    c.id AS client_id,
    COALESCE(NULLIF(c.preferred_name,''), a.alias, c.name) AS name,
    c.discord_id AS discord_id,
    hs.kills AS kills
  FROM clients c
  ${preferredAliasJoin("a","c.id")}
  JOIN (
    SELECT player_id, SUM(kills) AS kills
    FROM ${PLAYERBODY}
    WHERE bodypart_id = (SELECT id FROM xlr_bodyparts WHERE name = 'head')
    GROUP BY player_id
  ) hs ON hs.player_id = c.id
  ORDER BY hs.kills DESC
  LIMIT ? OFFSET ?
`;

// 2) Best Kill-Death Ratio (gate by engagements)
export const award_ratio = `
  SELECT
    c.id AS client_id,
    COALESCE(NULLIF(c.preferred_name,''), a.alias, c.name) AS name,
    c.discord_id AS discord_id,
    agg.kills,
    agg.deaths,
    CASE WHEN agg.deaths=0 THEN agg.kills ELSE ROUND(agg.kills/agg.deaths, 2) END AS ratio
  FROM (
    SELECT client_id,
           SUM(kills)  AS kills,
           SUM(deaths) AS deaths
    FROM ${PLAYERSTATS}
    GROUP BY client_id
    HAVING (SUM(kills) + SUM(deaths)) >= 20
  ) agg
  JOIN clients c ON c.id = agg.client_id
  ${preferredAliasJoin("a","c.id")}
  ORDER BY ratio DESC, kills DESC
  LIMIT ? OFFSET ?
`;

// 3) Highest Skill Rating
export const award_skill = `
  SELECT
    c.id AS client_id,
    COALESCE(NULLIF(c.preferred_name,''), a.alias, c.name) AS name,
    c.discord_id AS discord_id,
    smax.skill AS skill
  FROM (
    SELECT client_id, MAX(skill) AS skill
    FROM ${PLAYERSTATS}
    GROUP BY client_id
  ) smax
  JOIN clients c ON c.id = smax.client_id
  ${preferredAliasJoin("a","c.id")}
  ORDER BY smax.skill DESC
  LIMIT ? OFFSET ?
`;

// 4) Most Kill Assists
export const award_assists = `
  SELECT
    c.id AS client_id,
    COALESCE(NULLIF(c.preferred_name,''), a.alias, c.name) AS name,
    c.discord_id AS discord_id,
    SUM(s.assists) AS assists
  FROM ${PLAYERSTATS} s
  JOIN clients c ON c.id = s.client_id
  ${preferredAliasJoin("a","c.id")}
  GROUP BY c.id, a.alias, c.name, c.discord_id
  HAVING SUM(s.assists) > 0
  ORDER BY assists DESC
  LIMIT ? OFFSET ?
`;

// 5) Most Melee Kills
export const award_melee = `
  SELECT
    c.id AS client_id,
    COALESCE(NULLIF(c.preferred_name,''), a.alias, c.name) AS name,
    c.discord_id AS discord_id,
    SUM(wu.kills) AS kills
  FROM xlr_weaponusage wu
  JOIN xlr_weaponstats w ON w.id = wu.weapon_id
  JOIN clients c ON c.id = wu.player_id
  ${preferredAliasJoin("a","c.id")}
  WHERE w.name = 'mod_melee'
  GROUP BY c.id, a.alias, c.name, c.discord_id
  HAVING SUM(wu.kills) > 0
  ORDER BY kills DESC
  LIMIT ? OFFSET ?
`;

// 6) Most deaths with KDR < 1.00
export const award_deaths = `
  SELECT
    c.id AS client_id,
    COALESCE(NULLIF(c.preferred_name,''), a.alias, c.name) AS name,
    c.discord_id AS discord_id,
    agg.kills,
    agg.deaths,
    CASE WHEN agg.deaths=0 THEN agg.kills ELSE ROUND(agg.kills/agg.deaths, 2) END AS ratio
  FROM (
    SELECT client_id,
           SUM(kills)  AS kills,
           SUM(deaths) AS deaths
    FROM ${PLAYERSTATS}
    GROUP BY client_id
  ) agg
  JOIN clients c ON c.id = agg.client_id
  ${preferredAliasJoin("a","c.id")}
  WHERE (agg.deaths > 0) AND (CASE WHEN agg.deaths=0 THEN agg.kills ELSE agg.kills/agg.deaths END) < 1.0
  ORDER BY agg.deaths DESC, agg.kills ASC
  LIMIT ? OFFSET ?
`;

// 7) Most Aliases
export const award_alias = `
  SELECT
    c.id AS client_id,
    COALESCE(NULLIF(c.preferred_name,''), a.alias, c.name) AS name,
    c.discord_id AS discord_id,
    COUNT(al.alias) AS num_alias
  FROM clients c
  ${preferredAliasJoin("a","c.id")}
  JOIN aliases al ON al.client_id = c.id
  GROUP BY c.id, a.alias, c.name, c.discord_id
  ORDER BY num_alias DESC
  LIMIT ? OFFSET ?
`;

// 8) Most Bomb Plants — xlr_actionstats + xlr_playeractions
export const award_plant = `
  SELECT
    c.id AS client_id,
    COALESCE(NULLIF(c.preferred_name,''), a.alias, c.name) AS name,
    c.discord_id AS discord_id,
    SUM(pa.count) AS num_plant
  FROM clients c
  ${preferredAliasJoin("a","c.id")}
  JOIN xlr_playeractions pa ON pa.player_id = c.id
  JOIN xlr_actionstats act ON act.id = pa.action_id
  WHERE act.name = 'bomb_plant'
  GROUP BY c.id, a.alias, c.name, c.discord_id
  HAVING SUM(pa.count) > 0
  ORDER BY num_plant DESC
  LIMIT ? OFFSET ?
`;

// 9) Most Bomb Defusals — xlr_actionstats + xlr_playeractions
export const award_defuse = `
  SELECT
    c.id AS client_id,
    COALESCE(NULLIF(c.preferred_name,''), a.alias, c.name) AS name,
    c.discord_id AS discord_id,
    SUM(pa.count) AS num_defuse
  FROM clients c
  ${preferredAliasJoin("a","c.id")}
  JOIN xlr_playeractions pa ON pa.player_id = c.id
  JOIN xlr_actionstats act ON act.id = pa.action_id
  WHERE act.name = 'bomb_defuse'
  GROUP BY c.id, a.alias, c.name, c.discord_id
  HAVING SUM(pa.count) > 0
  ORDER BY num_defuse DESC
  LIMIT ? OFFSET ?
`;

// 10) Most chat messages — chatlog table
export const award_chat = `
  SELECT
    c.id AS client_id,
    COALESCE(NULLIF(c.preferred_name,''), a.alias, c.name) AS name,
    c.discord_id AS discord_id,
    COUNT(*) AS num_chat
  FROM chatlog ch
  JOIN clients c ON c.id = ch.client_id
  ${preferredAliasJoin("a","c.id")}
  GROUP BY c.id, a.alias, c.name, c.discord_id
  ORDER BY num_chat DESC
  LIMIT ? OFFSET ?
`;

// 11) Most Final Killcams — xlr_playeractions (activity = 'final_killcam')
export const award_killcam = `
  SELECT
    c.id AS client_id,
    COALESCE(NULLIF(c.preferred_name,''), a.alias, c.name) AS name,
    c.discord_id AS discord_id,
    SUM(pa.count) AS num_killcam
  FROM clients c
  ${preferredAliasJoin("a","c.id")}
  JOIN xlr_playeractions pa ON pa.player_id = c.id
  JOIN xlr_actionstats act ON act.id = pa.action_id
  WHERE act.name = 'final_killcam'
  GROUP BY c.id, a.alias, c.name, c.discord_id
  HAVING SUM(pa.count) > 0
  ORDER BY num_killcam DESC
  LIMIT ? OFFSET ?
`;

// 12) Most SD Clutches — xlr_playeractions (activity = 'sd_clutch')
export const award_clutch = `
  SELECT
    c.id AS client_id,
    COALESCE(NULLIF(c.preferred_name,''), a.alias, c.name) AS name,
    c.discord_id AS discord_id,
    SUM(pa.count) AS clutches
  FROM clients c
  ${preferredAliasJoin("a","c.id")}
  JOIN xlr_playeractions pa ON pa.player_id = c.id
  JOIN xlr_actionstats act ON act.id = pa.action_id
  WHERE act.name = 'sd_clutch'
  GROUP BY c.id, a.alias, c.name, c.discord_id
  HAVING SUM(pa.count) > 0
  ORDER BY clutches DESC
  LIMIT ? OFFSET ?
`;

// 13) Most SD Aces — xlr_playeractions (activity = 'sd_ace')
export const award_ace = `
  SELECT
    c.id AS client_id,
    COALESCE(NULLIF(c.preferred_name,''), a.alias, c.name) AS name,
    c.discord_id AS discord_id,
    SUM(pa.count) AS aces
  FROM clients c
  ${preferredAliasJoin("a","c.id")}
  JOIN xlr_playeractions pa ON pa.player_id = c.id
  JOIN xlr_actionstats act ON act.id = pa.action_id
  WHERE act.name = 'sd_ace'
  GROUP BY c.id, a.alias, c.name, c.discord_id
  HAVING SUM(pa.count) > 0
  ORDER BY aces DESC
  LIMIT ? OFFSET ?
`;

// 14) Most Wins — xlr_playerstats
// NOTE: alias is "win" (singular) to match index.js properties
export const award_wins = `
  SELECT
    c.id AS client_id,
    COALESCE(NULLIF(c.preferred_name,''), a.alias, c.name) AS name,
    c.discord_id AS discord_id,
    SUM(s.wins) AS win
  FROM ${PLAYERSTATS} s
  JOIN clients c ON c.id = s.client_id
  ${preferredAliasJoin("a","c.id")}
  GROUP BY c.id, a.alias, c.name, c.discord_id
  HAVING SUM(s.wins) > 0
  ORDER BY win DESC
  LIMIT ? OFFSET ?
`;

// 15) Best Win % (min 10 games) — xlr_playerstats
export const award_winper = `
  WITH agg AS (
    SELECT
      s.client_id,
      SUM(s.wins)   AS wins,
      SUM(s.losses) AS losses
    FROM ${PLAYERSTATS} s
    GROUP BY s.client_id
  )
  SELECT
    c.id AS client_id,
    COALESCE(NULLIF(c.preferred_name,''), a.alias, c.name) AS name,
    c.discord_id AS discord_id,
    agg.wins    AS wins,
    agg.losses  AS losses,
    ROUND(100.0 * agg.wins / NULLIF(agg.wins + agg.losses, 0), 2) AS winper
  FROM agg
  JOIN clients c ON c.id = agg.client_id
  ${preferredAliasJoin("a","c.id")}
  WHERE (agg.wins + agg.losses) >= 10
  ORDER BY winper DESC, wins DESC
  LIMIT ? OFFSET ?
`;

// 16) Worst Win % (min 10 games) — xlr_playerstats
export const award_lossper = `
  WITH agg AS (
    SELECT
      s.client_id,
      SUM(s.wins)   AS wins,
      SUM(s.losses) AS losses
    FROM ${PLAYERSTATS} s
    GROUP BY s.client_id
  )
  SELECT
    c.id AS client_id,
    COALESCE(NULLIF(c.preferred_name,''), a.alias, c.name) AS name,
    c.discord_id AS discord_id,
    agg.wins    AS wins,
    agg.losses  AS losses,
    ROUND(100.0 * agg.wins / NULLIF(agg.wins + agg.losses, 0), 2) AS winper
  FROM agg
  JOIN clients c ON c.id = agg.client_id
  ${preferredAliasJoin("a","c.id")}
  WHERE (agg.wins + agg.losses) >= 10
  ORDER BY winper ASC, losses DESC
  LIMIT ? OFFSET ?
`;
// 17) Headshot % — total headshots / total kills
// Headshot % — (headshots from xlr_playerbody) / (kills from xlr_playerstats)
// Minimum 50 kills to avoid tiny-sample outliers
export const award_headper = `
  WITH kills_agg AS (
    SELECT
      s.client_id,
      SUM(s.kills) AS kills
    FROM ${PLAYERSTATS} s
    GROUP BY s.client_id
  ),
  hs_agg AS (
    SELECT
      pb.player_id AS client_id,
      SUM(pb.kills) AS headshots
    FROM ${PLAYERBODY} pb
    WHERE pb.bodypart_id = (
      SELECT id FROM xlr_bodyparts WHERE name = 'head'
    )
    GROUP BY pb.player_id
  )
  SELECT
    c.id AS client_id,
    COALESCE(NULLIF(c.preferred_name,''), a.alias, c.name) AS name,
    c.discord_id AS discord_id,
    kills_agg.kills,
    COALESCE(hs_agg.headshots, 0) AS headshots,
    ROUND(100.0 * COALESCE(hs_agg.headshots, 0) / NULLIF(kills_agg.kills, 0), 2) AS percent
  FROM kills_agg
  JOIN clients c ON c.id = kills_agg.client_id
  ${preferredAliasJoin("a","c.id")}
  LEFT JOIN hs_agg ON hs_agg.client_id = kills_agg.client_id
  WHERE kills_agg.kills >= 50
  ORDER BY percent DESC, kills_agg.kills DESC
  LIMIT ? OFFSET ?
`;


// --- Award rank builders ---
export function awardRank(index, clientId) {
  const array = [ {
        sql: `
          WITH per AS (
            SELECT c.id AS client_id, COALESCE(NULLIF(c.preferred_name,''), a.alias, c.name) AS name, c.discord_id AS discord_id, SUM(pb.kills) AS kills
            FROM clients c
            ${preferredAliasJoin("a","c.id")}
            JOIN ${PLAYERBODY} pb ON pb.player_id = c.id
            WHERE pb.bodypart_id = (SELECT id FROM xlr_bodyparts WHERE name='head')
            GROUP BY c.id, a.alias, c.name, c.discord_id
          ),
          me AS ( SELECT * FROM per WHERE client_id = ? )
          SELECT me.client_id, me.name, me.discord_id, me.kills,
                 1 + (SELECT COUNT(*) FROM per p WHERE p.kills > me.kills) AS rank
          FROM me
        `,
        params: [clientId]
      },{
        sql: `
          WITH agg AS (
            SELECT s.client_id,
                   SUM(s.kills) AS kills,
                   SUM(s.deaths) AS deaths
            FROM ${PLAYERSTATS} s
            GROUP BY s.client_id
            HAVING (SUM(s.kills) + SUM(s.deaths)) >= 20
          ),
          per AS (
            SELECT c.id AS client_id, COALESCE(NULLIF(c.preferred_name,''), a.alias, c.name) AS name, c.discord_id AS discord_id,
                   agg.kills, agg.deaths,
                   CASE WHEN agg.deaths=0 THEN agg.kills ELSE ROUND(agg.kills/agg.deaths,2) END AS ratio
            FROM agg
            JOIN clients c ON c.id = agg.client_id
            ${preferredAliasJoin("a","c.id")}
          ),
          me AS ( SELECT * FROM per WHERE client_id = ? )
          SELECT me.client_id, me.name, me.discord_id, me.kills, me.deaths, me.ratio,
                 1 + (SELECT COUNT(*) FROM per p WHERE p.ratio > me.ratio) AS rank
          FROM me
        `,
        params: [clientId]
      },{
        sql: `
          WITH per AS (
            SELECT c.id AS client_id, COALESCE(NULLIF(c.preferred_name,''), a.alias, c.name) AS name, c.discord_id AS discord_id,
                   MAX(s.skill) AS skill
            FROM ${PLAYERSTATS} s
            JOIN clients c ON c.id = s.client_id
            ${preferredAliasJoin("a","c.id")}
            GROUP BY c.id, a.alias, c.name, c.discord_id
          ),
          me AS ( SELECT * FROM per WHERE client_id = ? )
          SELECT me.client_id, me.name, me.discord_id, me.skill,
                 1 + (SELECT COUNT(*) FROM per p WHERE p.skill > me.skill) AS rank
          FROM me
        `,
        params: [clientId]
      },{
        sql: `
          WITH per AS (
            SELECT c.id AS client_id, COALESCE(NULLIF(c.preferred_name,''), a.alias, c.name) AS name, c.discord_id AS discord_id, SUM(s.assists) AS assists
            FROM ${PLAYERSTATS} s
            JOIN clients c ON c.id = s.client_id
            ${preferredAliasJoin("a","c.id")}
            GROUP BY c.id, a.alias, c.name, c.discord_id
          ),
          me AS ( SELECT * FROM per WHERE client_id = ? )
          SELECT me.client_id, me.name, me.discord_id, me.assists,
                 1 + (SELECT COUNT(*) FROM per p WHERE p.assists > me.assists) AS rank
          FROM me
        `,
        params: [clientId]
      },{
        sql: `
          WITH per AS (
            SELECT c.id AS client_id, COALESCE(NULLIF(c.preferred_name,''), a.alias, c.name) AS name, c.discord_id AS discord_id, SUM(wu.kills) AS kills
            FROM xlr_weaponusage wu
            JOIN xlr_weaponstats w ON w.id = wu.weapon_id
            JOIN clients c ON c.id = wu.player_id
            ${preferredAliasJoin("a","c.id")}
            WHERE w.name = 'mod_melee'
            GROUP BY c.id, a.alias, c.name, c.discord_id
          ),
          me AS ( SELECT * FROM per WHERE client_id = ? )
          SELECT me.client_id, me.name, me.discord_id, me.kills,
                 1 + (SELECT COUNT(*) FROM per p WHERE p.kills > me.kills) AS rank
          FROM me
        `,
        params: [clientId]
      },{
        sql: `
          WITH agg AS (
            SELECT client_id, SUM(kills) AS kills, SUM(deaths) AS deaths
            FROM ${PLAYERSTATS}
            GROUP BY client_id
          ),
          per AS (
            SELECT c.id AS client_id, COALESCE(NULLIF(c.preferred_name,''), a.alias, c.name) AS name, c.discord_id AS discord_id,
                   agg.kills, agg.deaths,
                   CASE WHEN agg.deaths=0 THEN agg.kills ELSE agg.kills/agg.deaths END AS ratio
            FROM agg
            JOIN clients c ON c.id = agg.client_id
            ${preferredAliasJoin("a","c.id")}
            WHERE (agg.deaths > 0) AND (CASE WHEN agg.deaths=0 THEN agg.kills ELSE agg.kills/agg.deaths END) < 1.0
          ),
          me AS ( SELECT * FROM per WHERE client_id = ? )
          SELECT me.client_id, me.name, me.discord_id, me.kills, me.deaths, ROUND(me.ratio,2) AS ratio,
                 1 + (SELECT COUNT(*) FROM per p WHERE (p.deaths > me.deaths) OR (p.deaths = me.deaths AND p.kills < me.kills)) AS rank
          FROM me
        `,
        params: [clientId]
      },{
        sql: `
          WITH per AS (
            SELECT c.id AS client_id, COALESCE(NULLIF(c.preferred_name,''), a.alias, c.name) AS name, c.discord_id AS discord_id, COUNT(al.alias) AS num_alias
            FROM clients c
            ${preferredAliasJoin("a","c.id")}
            JOIN aliases al ON al.client_id = c.id
            GROUP BY c.id, a.alias, c.name, c.discord_id
          ),
          me AS ( SELECT * FROM per WHERE client_id = ? )
          SELECT me.client_id, me.name, me.discord_id, me.num_alias,
                 1 + (SELECT COUNT(*) FROM per p WHERE p.num_alias > me.num_alias) AS rank
          FROM me
        `,
        params: [clientId]
      },{
        sql: `
          WITH per AS (
            SELECT c.id AS client_id, COALESCE(NULLIF(c.preferred_name,''), a.alias, c.name) AS name, c.discord_id AS discord_id, SUM(pa.count) AS num_plant
            FROM clients c
            ${preferredAliasJoin("a","c.id")}
            JOIN xlr_playeractions pa ON pa.player_id = c.id
            JOIN xlr_actionstats act ON act.id = pa.action_id
            WHERE act.name = 'bomb_plant'
            GROUP BY c.id, a.alias, c.name, c.discord_id
          ),
          me AS ( SELECT * FROM per WHERE client_id = ? )
          SELECT me.client_id, me.name, me.discord_id, me.num_plant,
                 1 + (SELECT COUNT(*) FROM per p WHERE p.num_plant > me.num_plant) AS rank
          FROM me
        `,
        params: [clientId]
      },{
        sql: `
          WITH per AS (
            SELECT c.id AS client_id, COALESCE(NULLIF(c.preferred_name,''), a.alias, c.name) AS name, c.discord_id AS discord_id, SUM(pa.count) AS num_defuse
            FROM clients c
            ${preferredAliasJoin("a","c.id")}
            JOIN xlr_playeractions pa ON pa.player_id = c.id
            JOIN xlr_actionstats act ON act.id = pa.action_id
            WHERE act.name = 'bomb_defuse'
            GROUP BY c.id, a.alias, c.name, c.discord_id
          ),
          me AS ( SELECT * FROM per WHERE client_id = ? )
          SELECT me.client_id, me.name, me.discord_id, me.num_defuse,
                 1 + (SELECT COUNT(*) FROM per p WHERE p.num_defuse > me.num_defuse) AS rank
          FROM me
        `,
        params: [clientId]
      },{
        sql: `
          WITH per AS (
            SELECT c.id AS client_id, COALESCE(NULLIF(c.preferred_name,''), a.alias, c.name) AS name, c.discord_id AS discord_id, COUNT(*) AS num_chat
            FROM chatlog ch
            JOIN clients c ON c.id = ch.client_id
            ${preferredAliasJoin("a","c.id")}
            GROUP BY c.id, a.alias, c.name, c.discord_id
          ),
          me AS ( SELECT * FROM per WHERE client_id = ? )
          SELECT me.client_id, me.name, me.discord_id, me.num_chat,
                 1 + (SELECT COUNT(*) FROM per p WHERE p.num_chat > me.num_chat) AS rank
          FROM me
        `,
        params: [clientId]
      }      ,{
        // 10 → Most Final Killcams
        sql: `
          WITH per AS (
            SELECT c.id AS client_id, COALESCE(NULLIF(c.preferred_name,''), a.alias, c.name) AS name, c.discord_id AS discord_id, SUM(pa.count) AS num_killcam
            FROM clients c
            ${preferredAliasJoin("a","c.id")}
            JOIN xlr_playeractions pa ON pa.player_id = c.id
            JOIN xlr_actionstats act ON act.id = pa.action_id
            WHERE act.name = 'final_killcam'
            GROUP BY c.id, a.alias, c.name, c.discord_id
          ),
          me AS ( SELECT * FROM per WHERE client_id = ? )
          SELECT me.client_id, me.name, me.discord_id, me.num_killcam,
                 1 + (SELECT COUNT(*) FROM per p WHERE p.num_killcam > me.num_killcam) AS rank
          FROM me
        `,
        params: [clientId]
      },{
        // 11 → Most SD Clutches
        sql: `
          WITH per AS (
            SELECT c.id AS client_id, COALESCE(NULLIF(c.preferred_name,''), a.alias, c.name) AS name, c.discord_id AS discord_id, SUM(pa.count) AS clutches
            FROM clients c
            ${preferredAliasJoin("a","c.id")}
            JOIN xlr_playeractions pa ON pa.player_id = c.id
            JOIN xlr_actionstats act ON act.id = pa.action_id
            WHERE act.name = 'sd_clutch'
            GROUP BY c.id, a.alias, c.name, c.discord_id
          ),
          me AS ( SELECT * FROM per WHERE client_id = ? )
          SELECT me.client_id, me.name, me.discord_id, me.clutches,
                 1 + (SELECT COUNT(*) FROM per p WHERE p.clutches > me.clutches) AS rank
          FROM me
        `,
        params: [clientId]
      },{
        // 12 → Most SD Aces
        sql: `
          WITH per AS (
            SELECT c.id AS client_id, COALESCE(NULLIF(c.preferred_name,''), a.alias, c.name) AS name, c.discord_id AS discord_id, SUM(pa.count) AS aces
            FROM clients c
            ${preferredAliasJoin("a","c.id")}
            JOIN xlr_playeractions pa ON pa.player_id = c.id
            JOIN xlr_actionstats act ON act.id = pa.action_id
            WHERE act.name = 'sd_ace'
            GROUP BY c.id, a.alias, c.name, c.discord_id
          ),
          me AS ( SELECT * FROM per WHERE client_id = ? )
          SELECT me.client_id, me.name, me.discord_id, me.aces,
                 1 + (SELECT COUNT(*) FROM per p WHERE p.aces > me.aces) AS rank
          FROM me
        `,
        params: [clientId]
      },{
        // 13 → Most Wins
        sql: `
          WITH per AS (
            SELECT c.id AS client_id, COALESCE(NULLIF(c.preferred_name,''), a.alias, c.name) AS name, c.discord_id AS discord_id,
                   SUM(s.wins) AS win
            FROM ${PLAYERSTATS} s
            JOIN clients c ON c.id = s.client_id
            ${preferredAliasJoin("a","c.id")}
            GROUP BY c.id, a.alias, c.name, c.discord_id
          ),
          me AS ( SELECT * FROM per WHERE client_id = ? )
          SELECT me.client_id, me.name, me.discord_id, me.win,
                 1 + (SELECT COUNT(*) FROM per p WHERE p.win > me.win) AS rank
          FROM me
        `,
        params: [clientId]
      },{
        // 14 → Best Win %
        sql: `
          WITH agg AS (
            SELECT client_id, SUM(wins) AS wins, SUM(losses) AS losses
            FROM ${PLAYERSTATS}
            GROUP BY client_id
          ),
          per AS (
            SELECT c.id AS client_id, COALESCE(NULLIF(c.preferred_name,''), a.alias, c.name) AS name, c.discord_id AS discord_id,
                   agg.wins AS wins, agg.losses AS losses,
                   ROUND(100.0 * agg.wins / NULLIF(agg.wins + agg.losses, 0), 2) AS winper
            FROM agg
            JOIN clients c ON c.id = agg.client_id
            ${preferredAliasJoin("a","c.id")}
            WHERE (agg.wins + agg.losses) >= 10
          ),
          me AS ( SELECT * FROM per WHERE client_id = ? )
          SELECT me.client_id, me.name, me.discord_id, me.wins, me.losses, me.winper,
                 1 + (SELECT COUNT(*) FROM per p WHERE p.winper > me.winper) AS rank
          FROM me
        `,
        params: [clientId]
      },{
        // 15 → Worst Win %
        sql: `
          WITH agg AS (
            SELECT client_id, SUM(wins) AS wins, SUM(losses) AS losses
            FROM ${PLAYERSTATS}
            GROUP BY client_id
          ),
          per AS (
            SELECT c.id AS client_id, COALESCE(NULLIF(c.preferred_name,''), a.alias, c.name) AS name, c.discord_id AS discord_id,
                   agg.wins AS wins, agg.losses AS losses,
                   ROUND(100.0 * agg.wins / NULLIF(agg.wins + agg.losses, 0), 2) AS winper
            FROM agg
            JOIN clients c ON c.id = agg.client_id
            ${preferredAliasJoin("a","c.id")}
            WHERE (agg.wins + agg.losses) >= 10
          ),
          me AS ( SELECT * FROM per WHERE client_id = ? )
          SELECT me.client_id, me.name, me.discord_id, me.wins, me.losses, me.winper,
                 1 + (SELECT COUNT(*) FROM per p WHERE p.winper < me.winper) AS rank
          FROM me
        `,
        params: [clientId]
      },{
        // 16 Headshot %
        sql: `
          WITH kills_agg AS (
            SELECT client_id, SUM(kills) AS kills
            FROM ${PLAYERSTATS}
            GROUP BY client_id
          ),
          hs_agg AS (
            SELECT pb.player_id AS client_id, SUM(pb.kills) AS headshots
            FROM ${PLAYERBODY} pb
            WHERE pb.bodypart_id = (SELECT id FROM xlr_bodyparts WHERE name = 'head')
            GROUP BY pb.player_id
          ),
          per AS (
            SELECT
              c.id AS client_id,
              COALESCE(NULLIF(c.preferred_name,''), a.alias, c.name) AS name,
              c.discord_id AS discord_id,
              kills_agg.kills,
              COALESCE(hs_agg.headshots, 0) AS headshots,
              ROUND(100.0 * COALESCE(hs_agg.headshots, 0) / NULLIF(kills_agg.kills, 0), 2) AS percent
            FROM kills_agg
            JOIN clients c ON c.id = kills_agg.client_id
            ${preferredAliasJoin("a","c.id")}
            LEFT JOIN hs_agg ON hs_agg.client_id = kills_agg.client_id
            WHERE kills_agg.kills >= 50
          ),
          me AS ( SELECT * FROM per WHERE client_id = ? )
          SELECT me.client_id, me.name, me.discord_id, me.kills, me.headshots, me.percent,
                 1 + (SELECT COUNT(*) FROM per p WHERE p.percent > me.percent) AS rank
          FROM me
        `,
        params: [clientId]
      }


];
	  
	  return array[index];
}

export const queries = {
	
  getPlayerCardRow: `
    SELECT player_id, background, emblem, callsign, updated_at
    FROM xlr_playercards
    WHERE player_id = ?
    LIMIT 1
  `,
  // --- Player card upserts (field-specific, do not touch other columns) ---
  setPlayerCardBackground: `
    INSERT INTO xlr_playercards (player_id, background)
    VALUES (?, ?)
    ON DUPLICATE KEY UPDATE
      background = VALUES(background),
      updated_at = CURRENT_TIMESTAMP
  `,
  setPlayerCardEmblem: `
    INSERT INTO xlr_playercards (player_id, emblem)
    VALUES (?, ?)
    ON DUPLICATE KEY UPDATE
      emblem = VALUES(emblem),
      updated_at = CURRENT_TIMESTAMP
  `,
  setPlayerCardCallsign: `
    INSERT INTO xlr_playercards (player_id, callsign)
    VALUES (?, ?)
    ON DUPLICATE KEY UPDATE
      callsign = VALUES(callsign),
      updated_at = CURRENT_TIMESTAMP
  `,
  playerCoreAndBannerById,
  awardRank,
  award_headshot,
  award_ratio,
  award_skill,
  award_assists,
  award_melee,
  award_deaths,
  award_alias,
  award_plant,
  award_defuse,
  award_chat,
  award_killcam,
  award_clutch,
  award_ace,
  award_wins,
  award_winper,
  award_lossper,
  award_headper,
  // Top players by skill (no server_id filter)
  topBySkill: `
    SELECT c.id AS client_id,
           COALESCE(NULLIF(c.preferred_name,''), a.alias, c.name) AS name,
      c.discord_id AS discord_id,
           c.discord_id AS discord_id,
      c.discord_id AS discord_id,
           c.discord_id AS discord_id,
           s.skill, s.kills, s.deaths,
           CASE WHEN s.deaths=0 THEN s.kills ELSE ROUND(s.kills/s.deaths, 2) END AS ratio
    FROM ${PLAYERSTATS} s
    JOIN clients c ON c.id = s.client_id
    ${preferredAliasJoin("a", "c.id")}
    ORDER BY s.skill DESC
    LIMIT ?
  `,

  // Find a player by (partial) name in aliases or clients.
  // Filter against *all* aliases but display the preferred alias.
  findPlayer: `
    SELECT
      c.id AS client_id,
      COALESCE(pa.alias, c.name) AS name,
      c.discord_id AS discord_id
    FROM clients c
    ${preferredAliasJoin("pa", "c.id")}
    LEFT JOIN aliases af ON af.client_id = c.id
    WHERE (c.name LIKE ? OR af.alias LIKE ?)
    GROUP BY c.id
    ORDER BY MAX(af.num_used) DESC, MAX(af.time_edit) DESC
    LIMIT 10
  `,

  // Detailed line for a single player, extended with fav weapon, assists, and nemesis
    playerCard: `
    SELECT
      c.id AS client_id,
      COALESCE(NULLIF(c.preferred_name,''), a.alias, c.name) AS name,
      c.discord_id AS discord_id,
      s.skill, s.kills, s.deaths,
      s.rounds,
      s.winstreak, s.losestreak,
      s.assists,
      COALESCE(pb.headshots, 0) AS headshots,
      fw.fav_weapon AS fav,
      COALESCE(ka.alias, kc.name) AS nemesis,
      nem.kills AS nemesis_kills,
      c.connections,
      c.time_add, c.time_edit,
      s.wins,
      s.losses,
      s.wawa_wins,
      s.wawa_losses
    FROM clients c
    JOIN ${PLAYERSTATS} s
      ON s.client_id = c.id

    LEFT JOIN (
      SELECT player_id, SUM(kills) AS headshots
      FROM ${PLAYERBODY}
      WHERE bodypart_id = (SELECT id FROM xlr_bodyparts WHERE name = 'head')
      GROUP BY player_id
    ) pb ON pb.player_id = c.id

    ${preferredAliasJoin("a", "c.id")}

    LEFT JOIN (
      SELECT wu.player_id, w.name AS fav_weapon, wu.kills
      FROM xlr_weaponusage wu
      JOIN xlr_weaponstats w ON w.id = wu.weapon_id
      WHERE wu.player_id = ?
      ORDER BY wu.kills DESC
      LIMIT 1
    ) fw ON fw.player_id = c.id

    LEFT JOIN (
      SELECT o.target_id AS player_id, o.killer_id, SUM(o.kills) AS kills
      FROM xlr_opponents o
      WHERE o.target_id = ?
      GROUP BY o.killer_id
      ORDER BY kills DESC
      LIMIT 1
    ) nem ON nem.player_id = c.id
    LEFT JOIN clients kc ON kc.id = nem.killer_id
    ${preferredAliasJoin("ka", "kc.id")}

    WHERE c.id = ?
    LIMIT 1
  `,


  // Player + specific weapon usage (weapon resolved by LIKE or exact id)
  playerWeaponCard: `
    SELECT
      c.id AS client_id,
      COALESCE(NULLIF(c.preferred_name,''), a.alias, c.name) AS name,
      c.discord_id AS discord_id,
      c.discord_id AS discord_id,
           c.discord_id AS discord_id,
      s.skill,
      wsel.name AS weapon,
      wu.kills,
      wu.deaths,
      wu.suicides,
      c.time_edit
    FROM clients c
    JOIN ${PLAYERSTATS} s ON s.client_id = c.id
    ${preferredAliasJoin("a", "c.id")}
    JOIN xlr_weaponusage wu ON wu.player_id = c.id
    JOIN (
      SELECT id, name
      FROM xlr_weaponstats
      WHERE (name LIKE ? OR id = ?)
      ORDER BY name
      LIMIT 1
    ) wsel ON wsel.id = wu.weapon_id
    WHERE c.id = ?
    LIMIT 1
  `,

  playerMapCard: `
    SELECT
      c.id AS client_id,
      COALESCE(NULLIF(c.preferred_name,''), a.alias, c.name) AS name,
      c.discord_id AS discord_id,
      c.discord_id AS discord_id,
           c.discord_id AS discord_id,
      s.skill,
      msel.name AS map,
      pm.kills,
      pm.deaths,
      pm.suicides,
	  pm.wins,
	  pm.losses,
      pm.rounds,
      c.time_edit
    FROM clients c
    JOIN ${PLAYERSTATS} s ON s.client_id = c.id
    ${preferredAliasJoin("a", "c.id")}
    JOIN (
      SELECT id, name
      FROM xlr_mapstats
      WHERE (name LIKE ? OR id = ?)
      ORDER BY name
      LIMIT 1
    ) msel ON 1=1
    JOIN xlr_playermaps pm
      ON pm.player_id = c.id
     AND pm.map_id    = msel.id
    WHERE c.id = ?
    LIMIT 1
  `,

  // Player vs Opponent head-to-head summary from xlr_opponents
    playerVsCard: `
    SELECT
      p.id  AS player_id,
      COALESCE(pa.alias, p.name) AS player_name,
      sp.skill AS player_skill,

      o.id  AS opponent_id,
      COALESCE(oa.alias, o.name) AS opponent_name,
      so.skill AS opp_skill,
      o.discord_id AS opponent_discord_id,

      COALESCE(kp.kills_vs, 0) AS kills_vs,
      COALESCE(ko.kills_vs, 0) AS deaths_vs,

      COALESCE(ko.wawa_wins_vs,   0) AS player_wawa_wins,
      COALESCE(ko.wawa_losses_vs, 0) AS player_wawa_losses,

      COALESCE(kp.wawa_wins_vs,   0) AS opp_wawa_wins,
      COALESCE(kp.wawa_losses_vs, 0) AS opp_wawa_losses

    FROM clients p
    JOIN ${PLAYERSTATS} sp ON sp.client_id = p.id

    JOIN clients o ON o.id = ?
    LEFT JOIN ${PLAYERSTATS} so ON so.client_id = o.id

    /* player -> opponent */
    LEFT JOIN (
      SELECT
        SUM(kills)       AS kills_vs,
        SUM(wawa_wins)   AS wawa_wins_vs,
        SUM(wawa_losses) AS wawa_losses_vs
      FROM xlr_opponents
      WHERE killer_id = ? AND target_id = ?
    ) kp ON 1=1

    /* opponent -> player */
    LEFT JOIN (
      SELECT
        SUM(kills)       AS kills_vs,
        SUM(wawa_wins)   AS wawa_wins_vs,
        SUM(wawa_losses) AS wawa_losses_vs
      FROM xlr_opponents
      WHERE killer_id = ? AND target_id = ?
    ) ko ON 1=1

    ${preferredAliasJoin("pa", "p.id")}
    ${preferredAliasJoin("oa", "o.id")}

    WHERE p.id = ?
    LIMIT 1
  `,


  // Recently seen players (from clients)
  lastSeen: `
    SELECT c.id AS client_id,
           COALESCE(NULLIF(c.preferred_name,''), a.alias, c.name) AS name,
      c.discord_id AS discord_id,
           c.discord_id AS discord_id,
      c.discord_id AS discord_id,
           c.discord_id AS discord_id,
           c.time_edit
    FROM clients c
    ${preferredAliasJoin("a", "c.id")}
    WHERE c.time_edit IS NOT NULL
    ORDER BY c.time_edit DESC
    LIMIT ?
  `,

  topDynamic,

  // UI — Home
  ui_totalPlayers,
  ui_totalKills,
  ui_totalRounds,
  ui_favoriteWeapon,
  ui_favoriteMap,

  // UI — Ladder / Weapons / Maps
  ui_ladderSlice,   // function -> { sql, params }
  ui_ladderCount,
  ui_playerWeaponSlice,
  ui_playerWeaponCount,
  ui_weaponsSlice,
  ui_weaponsCount,
  ui_weaponsAll,
  ui_mapsAll,
  ui_mapsCount,
  ui_mapsSlice,
  ui_playerMapsSlice,
  ui_playerMapsCount
};
