// src/queries.js
const PLAYERSTATS = "xlr_playerstats";
const PLAYERBODY  = "xlr_playerbody";
const HEADSHOT_ID = Number(5);

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
  `
};
