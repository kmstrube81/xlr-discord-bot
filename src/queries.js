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
    case "rounds":    return "rounds DESC";   // <— new
    case "skill":
    default:          return "skill DESC";
  }
}

const asLike = t => `%${t}%`;
const asIdOrNeg1 = t => (Number.isInteger(Number(t)) ? Number(t) : -1);

/** Robust top list with weapon/map pre-resolution + non-zero filter + matched_label */
export function topDynamic({ limit, sort = "skill", weapon = null, map = null }) {
  const safeSort = SORTABLE.has(sort) ? sort : "skill";
  const orderBy  = `ORDER BY ${orderExpr(safeSort)}`;
  const params   = [];

  const nameJoin = `
    JOIN clients c ON c.id = s.client_id
    LEFT JOIN (
      SELECT aa.client_id, aa.alias
      FROM aliases aa
      JOIN (
        SELECT client_id, MAX(num_used) AS max_used
        FROM aliases
        GROUP BY client_id
      ) uu ON uu.client_id=aa.client_id AND uu.max_used=aa.num_used
    ) a ON a.client_id = c.id
  `;

  let select, from, joins = "", where = "";

  if (weapon) {
    select = `
      SELECT c.id AS client_id,
             COALESCE(a.alias, c.name) AS name,
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



export const queries = {
  // Top players by skill (no server_id filter)
  topBySkill: `
    SELECT c.id AS client_id,
           COALESCE(a.alias, c.name) AS name,
           s.skill, s.kills, s.deaths,
           CASE WHEN s.deaths=0 THEN s.kills ELSE ROUND(s.kills/s.deaths, 2) END AS ratio
    FROM ${PLAYERSTATS} s
    JOIN clients c ON c.id = s.client_id
    LEFT JOIN (
      SELECT aa.client_id, aa.alias
      FROM aliases aa
      JOIN (
        SELECT client_id, MAX(num_used) AS max_used
        FROM aliases
        GROUP BY client_id
      ) uu ON uu.client_id=aa.client_id AND uu.max_used=aa.num_used
    ) a ON a.client_id = c.id
    ORDER BY s.skill DESC
    LIMIT ?
  `,

  // Find a player by (partial) name in aliases or clients
  findPlayer: `
    SELECT c.id AS client_id, COALESCE(a.alias, c.name) AS name
    FROM clients c
    LEFT JOIN (
      SELECT client_id, alias, num_used
      FROM aliases
    ) a ON a.client_id=c.id
    WHERE (c.name LIKE ? OR a.alias LIKE ?)
    GROUP BY c.id
    ORDER BY MAX(a.num_used) DESC
    LIMIT 10
  `,

    // Detailed line for a single player, extended with fav weapon, assists, and nemesis
  playerCard: `
    SELECT
      c.id AS client_id,
      COALESCE(a.alias, c.name) AS name,
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

    
    LEFT JOIN (
      SELECT aa.client_id, aa.alias
      FROM aliases aa
      JOIN (
        SELECT client_id, MAX(num_used) AS max_used
        FROM aliases
        GROUP BY client_id
      ) uu ON uu.client_id = aa.client_id AND uu.max_used = aa.num_used
    ) a ON a.client_id = c.id

    
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
    LEFT JOIN (
      SELECT aa.client_id, aa.alias
      FROM aliases aa
      JOIN (
        SELECT client_id, MAX(num_used) AS max_used
        FROM aliases
        GROUP BY client_id
      ) uu ON uu.client_id = aa.client_id AND uu.max_used = aa.num_used
    ) ka ON ka.client_id = kc.id

    WHERE c.id = ?
    LIMIT 1
  `,
  // Player + specific weapon usage (weapon resolved by LIKE or exact id)
  playerWeaponCard: `
    SELECT
      c.id AS client_id,
      COALESCE(a.alias, c.name) AS name,
      s.skill,
      wsel.name AS weapon,
      wu.kills,
      wu.deaths,
      wu.suicides,
      c.time_edit
    FROM clients c
    JOIN ${PLAYERSTATS} s ON s.client_id = c.id
    LEFT JOIN (
      SELECT aa.client_id, aa.alias
      FROM aliases aa
      JOIN (
        SELECT client_id, MAX(num_used) AS max_used
        FROM aliases
        GROUP BY client_id
      ) uu ON uu.client_id = aa.client_id AND uu.max_used = aa.num_used
    ) a ON a.client_id = c.id
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

  // Player vs Opponent head-to-head summary from xlr_opponents
  playerVsCard: `
    SELECT
      p.id  AS player_id,
      COALESCE(pa.alias, p.name) AS player_name,
      sp.skill AS player_skill,
      o.id  AS opponent_id,
      COALESCE(oa.alias, o.name) AS opponent_name,
      so.skill AS opp_skill,
      COALESCE(ov.kills_by_player, 0)   AS kills_vs,
      COALESCE(ov.kills_by_opponent, 0) AS deaths_vs
    FROM clients p
    JOIN ${PLAYERSTATS} sp ON sp.client_id = p.id
    JOIN clients o ON o.id = ?
    LEFT JOIN ${PLAYERSTATS} so ON so.client_id = o.id
    LEFT JOIN (
      SELECT
        SUM(CASE WHEN killer_id = ? AND target_id = ? THEN kills ELSE 0 END) AS kills_by_player,
        SUM(CASE WHEN killer_id = ? AND target_id = ? THEN kills ELSE 0 END) AS kills_by_opponent
      FROM xlr_opponents
    ) ov ON 1=1
    LEFT JOIN (
      SELECT aa.client_id, aa.alias
      FROM aliases aa
      JOIN (
        SELECT client_id, MAX(num_used) AS max_used
        FROM aliases
        GROUP BY client_id
      ) uu ON uu.client_id = aa.client_id AND uu.max_used = aa.num_used
    ) pa ON pa.client_id = p.id
    LEFT JOIN (
      SELECT aa.client_id, aa.alias
      FROM aliases aa
      JOIN (
        SELECT client_id, MAX(num_used) AS max_used
        FROM aliases
        GROUP BY client_id
      ) uu ON uu.client_id = aa.client_id AND uu.max_used = aa.num_used
    ) oa ON oa.client_id = o.id
    WHERE p.id = ?
    LIMIT 1
  `,



  // Recently seen players (from clients)
  lastSeen: `
    SELECT c.id AS client_id,
           COALESCE(a.alias, c.name) AS name,
           c.time_edit
    FROM clients c
    LEFT JOIN (
      SELECT aa.client_id, aa.alias
      FROM aliases aa
      JOIN (
        SELECT client_id, MAX(num_used) AS max_used
        FROM aliases
        GROUP BY client_id
      ) uu ON uu.client_id=aa.client_id AND uu.max_used=aa.num_used
    ) a ON a.client_id=c.id
    WHERE c.time_edit IS NOT NULL
    ORDER BY c.time_edit DESC
    LIMIT ?
  `,
  topDynamic
};