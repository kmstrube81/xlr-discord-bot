// src/queries.js
const PLAYERSTATS = "xlr_playerstats";
const PLAYERBODY  = "xlr_playerbody";
const HEADSHOT_ID = Number(5);

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
             COALESCE(a.alias, c.name) AS name,
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
             COALESCE(a.alias, c.name) AS name,
      c.discord_id AS discord_id,
           c.discord_id AS discord_id,
      c.discord_id AS discord_id,
           c.discord_id AS discord_id,
             s.skill AS skill,
             pm.kills AS kills,
             pm.deaths AS deaths,
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
      SELECT c.id AS client_id,
             COALESCE(a.alias, c.name) AS name,
      c.discord_id AS discord_id,
           c.discord_id AS discord_id,
      c.discord_id AS discord_id,
           c.discord_id AS discord_id,
             s.skill,
             s.kills,
             s.deaths,
             CASE WHEN s.deaths=0 THEN s.kills ELSE ROUND(s.kills/s.deaths, 2) END AS ratio,
             s.suicides,
             s.assists,
             s.rounds,
             NULL AS matched_label
    `;
    from = `FROM ${PLAYERSTATS} s`;
    joins = nameJoin;
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

function ui_ladderSlice(limit = 10, offset = 0) {
  const sql = `
    SELECT
      c.id AS client_id,
      COALESCE(a.alias, c.name) AS name,
      c.discord_id AS discord_id,
      c.discord_id AS discord_id,
           c.discord_id AS discord_id,
      agg.skill,
      agg.kills,
      agg.deaths,
      CASE WHEN agg.deaths = 0 THEN agg.kills ELSE ROUND(agg.kills / agg.deaths, 2) END AS ratio,
      agg.suicides,
      agg.assists,
      agg.rounds
    FROM (
      SELECT
        s.client_id,
        SUM(s.kills)    AS kills,
        SUM(s.deaths)   AS deaths,
        SUM(s.suicides) AS suicides,
        SUM(s.assists)  AS assists,
        SUM(s.rounds)   AS rounds,
        MAX(s.skill)    AS skill
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
      COALESCE(a.alias, c.name) AS name,
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
      COALESCE(a.alias, c.name) AS name,
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

export const queries = {
  // Top players by skill (no server_id filter)
  topBySkill: `
    SELECT c.id AS client_id,
           COALESCE(a.alias, c.name) AS name,
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
      COALESCE(a.alias, c.name) AS name,
      c.discord_id AS discord_id,
      c.discord_id AS discord_id,
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
      c.time_add, c.time_edit
    FROM clients c
    JOIN ${PLAYERSTATS} s
      ON s.client_id = c.id

    LEFT JOIN (
      SELECT player_id, SUM(kills) AS headshots
      FROM ${PLAYERBODY}
      WHERE bodypart_id = ${HEADSHOT_ID}
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
      COALESCE(a.alias, c.name) AS name,
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
      COALESCE(a.alias, c.name) AS name,
      c.discord_id AS discord_id,
      c.discord_id AS discord_id,
           c.discord_id AS discord_id,
      s.skill,
      msel.name AS map,
      pm.kills,
      pm.deaths,
      pm.suicides,
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

      COALESCE(kp.kills_vs, 0) AS kills_vs,
      COALESCE(ko.kills_vs, 0) AS deaths_vs

    FROM clients p
    JOIN ${PLAYERSTATS} sp ON sp.client_id = p.id

    JOIN clients o ON o.id = ?
    LEFT JOIN ${PLAYERSTATS} so ON so.client_id = o.id

    LEFT JOIN (
      SELECT SUM(kills) AS kills_vs
      FROM xlr_opponents
      WHERE killer_id = ? AND target_id = ?
    ) kp ON 1=1

    LEFT JOIN (
      SELECT SUM(kills) AS kills_vs
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
           COALESCE(a.alias, c.name) AS name,
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
