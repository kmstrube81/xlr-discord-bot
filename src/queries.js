// src/queries.js
const PLAYERSTATS = "xlr_playerstats";
const PLAYERBODY  = "xlr_playerbody";
const HEADSHOT_ID = Number(5);


export const SORTABLE = new Set(["skill", "kills", "deaths", "ratio", "suicides", "assists"]);

function orderExpr(sort) {
  // all SELECTs below expose these aliases, so ORDER BY works uniformly
  switch (sort) {
    case "kills":     return "kills DESC";
    case "deaths":    return "deaths DESC";
    case "ratio":     return "ratio DESC";
    case "suicides":  return "suicides DESC";
    case "assists":   return "assists DESC";
    case "skill":
    default:          return "skill DESC";
  }
}

function toLike(term) {
  return `%${term}%`;
}

function toNumericOrNeg1(term) {
  const n = Number(term);
  return Number.isInteger(n) ? n : -1; // -1 never matches an id
}

export const topDynamic = ({ limit, sort = "skill", weapon = null, map = null }) => {
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

  let titleSuffix = "by Skill";
  let select, from, joins = "";

  if (weapon) {
    titleSuffix = "by Weapon";
    const like = toLike(weapon);
    const idEq = toNumericOrNeg1(weapon);

    select = `
      SELECT c.id AS client_id,
             COALESCE(a.alias, c.name) AS name,
             s.skill AS skill,
             wu.kills AS kills,
             wu.deaths AS deaths,
             CASE WHEN wu.deaths=0 THEN wu.kills ELSE ROUND(wu.kills / wu.deaths, 2) END AS ratio,
             wu.suicides AS suicides,
             NULL AS assists,
             NULL AS rounds
    `;
    from = `FROM ${PLAYERSTATS} s`;
    joins = `
      ${nameJoin}
      JOIN xlr_weaponstats ws ON (ws.name LIKE ? OR ws.id = ?)
      JOIN xlr_weaponusage wu ON wu.weapon_id = ws.id AND wu.player_id = c.id
    `;
    params.push(like, idEq);

  } else if (map) {
    titleSuffix = "by Map";
    const like = toLike(map);
    const idEq = toNumericOrNeg1(map);

    select = `
      SELECT c.id AS client_id,
             COALESCE(a.alias, c.name) AS name,
             s.skill AS skill,
             pm.kills AS kills,
             pm.deaths AS deaths,
             CASE WHEN pm.deaths=0 THEN pm.kills ELSE ROUND(pm.kills / pm.deaths, 2) END AS ratio,
             pm.suicides AS suicides,
             NULL AS assists,
             pm.rounds AS rounds
    `;
    from = `FROM ${PLAYERSTATS} s`;
    joins = `
      ${nameJoin}
      JOIN xlr_mapstats ms ON (ms.name LIKE ? OR ms.id = ?)
      JOIN xlr_playermaps pm ON pm.map_id = ms.id AND pm.player_id = c.id
    `;
    params.push(like, idEq);

  } else {
    // Global
    titleSuffix = `by ${safeSort.charAt(0).toUpperCase() + safeSort.slice(1)}`;
    select = `
      SELECT c.id AS client_id,
             COALESCE(a.alias, c.name) AS name,
             s.skill,
             s.kills,
             s.deaths,
             CASE WHEN s.deaths=0 THEN s.kills ELSE ROUND(s.kills/s.deaths, 2) END AS ratio,
             s.suicides,
             s.assists,
             s.rounds
    `;
    from = `FROM ${PLAYERSTATS} s`;
    joins = nameJoin;
  }

  const sql = `
    ${select}
    ${from}
    ${joins}
    ${orderBy}
    LIMIT ?
  `;
  params.push(limit);

  return { sql, params, titleSuffix };
};


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

  // Detailed line for a single player (no server_id join)
   playerCard: `
    SELECT
      c.id AS client_id,
      COALESCE(a.alias, c.name) AS name,
      s.skill, s.kills, s.deaths,
      s.rounds, 
      s.winstreak, s.losestreak, 
      COALESCE(pb.headshots, 0) AS headshots,
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
    WHERE c.id = ?
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