// src/queries.js
const PLAYERSTATS = "xlr_playerstats";
const PLAYERBODY  = "xlr_playerbody";
const HEADSHOT_ID = Number(5);


export const SORTABLE = new Set(["skill", "kills", "deaths", "ratio", "suicides", "assists"]);

function orderExpr(sort) {
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

function asLike(term) { 
	return `%${term}%`; 
}

function asIdOrNeg1(term) {
  const n = Number(term);
  return Number.isInteger(n) ? n : -1;
}

/**
 * Build dynamic top list:
 * - weapon: pre-resolve ONE weapon (partial name LIKE or exact id), expose ws.name as matched_label
 * - map:    pre-resolve ONE map    (partial name LIKE or exact id), expose ms.name as matched_label
 * - global: no filter
 * Excludes pure-zero rows:
 *   - global: (s.kills > 0 OR s.deaths > 0 OR s.assists > 0)
 *   - weapon/map: (kills > 0 OR deaths > 0)
 */
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

  let select, from, joins = "", where = "", matchedLabel = null;

  if (weapon) {
    // Pre-resolve a single weapon row so LIKE matching is robust and we get canonical name
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
    matchedLabel = 'weapon';

  } else if (map) {
    // Pre-resolve a single map row so LIKE matching is robust and we get canonical name
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
    matchedLabel = 'map';

  } else {
    // Global
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

  return { sql, params, matchedLabel };
}

queries.topDynamic = topDynamic;


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