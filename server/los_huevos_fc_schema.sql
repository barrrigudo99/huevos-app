-- ============================================================
-- Los Huevos FC — esquema de base de datos
-- PostgreSQL (adaptable a MySQL/SQLite con pequeños cambios:
-- SERIAL -> AUTO_INCREMENT / INTEGER PRIMARY KEY, etc.)
-- ============================================================

-- ---------- Catálogos base ----------

CREATE TABLE positions (
    id          SERIAL PRIMARY KEY,
    name        VARCHAR(50) NOT NULL,   -- 'Portero', 'Defensa', 'Centrocampista', 'Delantero'
    short_code  VARCHAR(5) UNIQUE      -- 'POR','DEF','CEN','DEL'
);

CREATE TABLE clubs (
    id          SERIAL PRIMARY KEY,
    name        VARCHAR(100) NOT NULL UNIQUE,
    is_own      BOOLEAN NOT NULL DEFAULT FALSE,  -- TRUE solo para Los Huevos FC
    logo_url    TEXT,
    created_at  TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE seasons (
    id          SERIAL PRIMARY KEY,
    name        VARCHAR(20) NOT NULL,   -- '2025-2026'
    start_date  DATE,
    end_date    DATE,
    is_current  BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE competitions (
    id          SERIAL PRIMARY KEY,
    name        VARCHAR(100) NOT NULL   -- 'Liga Regional', 'Copa Amistad'
);

-- ---------- Jugadores ----------

CREATE TABLE players (
    id           SERIAL PRIMARY KEY,
    full_name    VARCHAR(100) NOT NULL,
    birth_date   DATE,
    position_id  INTEGER REFERENCES positions(id),
    phone        VARCHAR(20) UNIQUE,   -- solo dígitos (mismo formato que normalizePhone() en el código actual);
                                 -- clave de cruce para migrar los votos de WhatsApp a call_ups
    photo_url    TEXT,
    joined_date  DATE,
    active       BOOLEAN NOT NULL DEFAULT TRUE
);

-- Roster por temporada: permite altas/bajas y cambios de dorsal
CREATE TABLE player_season_roster (
    id             SERIAL PRIMARY KEY,
    player_id      INTEGER NOT NULL REFERENCES players(id),
    season_id      INTEGER NOT NULL REFERENCES seasons(id),
    dorsal_number  INTEGER,
    UNIQUE (player_id, season_id)
);

-- ---------- Usuarios y roles ----------

-- Si usas un proveedor de auth externo (ej. Supabase Auth), sustituye
-- password_hash por un FK a auth.users(id) y usa esta tabla como "profiles".
CREATE TABLE users (
    id             SERIAL PRIMARY KEY,
    email          VARCHAR(150) NOT NULL UNIQUE,
    password_hash  TEXT,
    full_name      VARCHAR(100),
    role           VARCHAR(20) NOT NULL DEFAULT 'jugador'
                    CHECK (role IN ('jugador','entrenador')),
    player_id      INTEGER REFERENCES players(id) ON DELETE SET NULL,
    created_at     TIMESTAMP NOT NULL DEFAULT now()
);
-- Nota: player_id es opcional. No todo jugador tiene cuenta,
-- y no todo usuario de la app es jugador (puede ser familia, aficion, etc.)

-- ---------- Calendario y resultados ----------

CREATE TABLE matchdays (
    id                 SERIAL PRIMARY KEY,
    season_id          INTEGER NOT NULL REFERENCES seasons(id),
    competition_id     INTEGER REFERENCES competitions(id),
    jornada_number     INTEGER NOT NULL,
    match_date         TIMESTAMP,
    opponent_club_id   INTEGER REFERENCES clubs(id),
    is_home            BOOLEAN NOT NULL DEFAULT TRUE,
    venue              VARCHAR(150),
    status             VARCHAR(20) NOT NULL DEFAULT 'scheduled'
                        CHECK (status IN ('scheduled','played','postponed','cancelled')),
    whatsapp_poll_id    VARCHAR(100),   -- id de la encuesta de WhatsApp asociada a esta jornada (vía Whapi)
    UNIQUE (season_id, competition_id, jornada_number)
);

-- Convocatorias: quién fue llamado a cada jornada y si finalmente asistió.
-- Se referencia a matchday (no a match) porque la convocatoria se hace
-- ANTES de saber si el partido se juega o cuál es el resultado.
CREATE TABLE call_ups (
    id               SERIAL PRIMARY KEY,
    matchday_id      INTEGER NOT NULL REFERENCES matchdays(id),
    player_id        INTEGER NOT NULL REFERENCES players(id),
    called           BOOLEAN NOT NULL DEFAULT TRUE,   -- fue convocado
    attended         BOOLEAN,                          -- asistio (NULL = aun no se sabe)
    role_in_squad    VARCHAR(20)
                      CHECK (role_in_squad IN ('titular','suplente','no_convocado')),
    reason_absence   VARCHAR(100),                     -- 'lesion','sancion','motivos personales', etc.
    created_at       TIMESTAMP NOT NULL DEFAULT now(),
    UNIQUE (matchday_id, player_id)
);

CREATE TABLE matches (
    id                        SERIAL PRIMARY KEY,
    matchday_id               INTEGER NOT NULL UNIQUE REFERENCES matchdays(id),
    goals_for                 INTEGER NOT NULL DEFAULT 0,
    goals_against              INTEGER NOT NULL DEFAULT 0,
    half_time_goals_for       INTEGER,
    half_time_goals_against   INTEGER,
    source                    VARCHAR(10) NOT NULL DEFAULT 'manual'
                              CHECK (source IN ('manual','simulado')),
                              -- 'manual' = anotado por el entrenador (estadisticas_personales.json),
                              -- 'simulado' = generado por el simulador de liga (resultados.json).
                              -- El manual manda siempre que exista para partidos de Los Huevos FC;
                              -- el simulado cubre los partidos entre el resto de equipos de la liga.
    notes                     TEXT
);

-- Estadísticas avanzadas de equipo por partido (opcional, si las llevas)
CREATE TABLE team_match_stats (
    id                SERIAL PRIMARY KEY,
    match_id          INTEGER NOT NULL UNIQUE REFERENCES matches(id),
    possession_pct    NUMERIC(5,2),
    shots             INTEGER,
    shots_on_target   INTEGER,
    corners           INTEGER,
    fouls             INTEGER
);

-- ---------- Estadísticas individuales ----------

CREATE TABLE player_match_stats (
    id               SERIAL PRIMARY KEY,
    match_id         INTEGER NOT NULL REFERENCES matches(id),
    player_id        INTEGER NOT NULL REFERENCES players(id),
    started          BOOLEAN NOT NULL DEFAULT FALSE,
    minutes_played   INTEGER NOT NULL DEFAULT 0,
    goals            INTEGER NOT NULL DEFAULT 0,
    assists          INTEGER NOT NULL DEFAULT 0,
    yellow_cards     INTEGER NOT NULL DEFAULT 0,
    red_cards        INTEGER NOT NULL DEFAULT 0,
    saves            INTEGER,   -- relevante solo para porteros
    UNIQUE (match_id, player_id)
);

-- ---------- Valoraciones ----------

-- Una fila por (partido, jugador valorado, votante). Cada criterio es una
-- escala 1..5 independiente y puede quedar NULL si ese votante no lo puntuó.
CREATE TABLE player_ratings (
    id            SERIAL PRIMARY KEY,
    match_id      INTEGER NOT NULL REFERENCES matches(id),
    player_id     INTEGER NOT NULL REFERENCES players(id),
    rated_by      VARCHAR(50),   -- 'entrenador', 'companeros', 'publico'
    rater_user_id INTEGER REFERENCES users(id),   -- quién puso esta valoración (una por votante/jugador/partido)
    impacto       SMALLINT CHECK (impacto   BETWEEN 1 AND 5),
    esfuerzo      SMALLINT CHECK (esfuerzo  BETWEEN 1 AND 5),
    equipo        SMALLINT CHECK (equipo    BETWEEN 1 AND 5),
    liderazgo     SMALLINT CHECK (liderazgo BETWEEN 1 AND 5),
    comments      TEXT,
    created_at    TIMESTAMP NOT NULL DEFAULT now(),
    UNIQUE (match_id, player_id, rater_user_id)
);

-- MVP del partido: cada votante elige un único jugador por partido.
CREATE TABLE match_mvp_votes (
    id            SERIAL PRIMARY KEY,
    match_id      INTEGER NOT NULL REFERENCES matches(id),
    rater_user_id INTEGER NOT NULL REFERENCES users(id),
    player_id     INTEGER NOT NULL REFERENCES players(id),
    created_at    TIMESTAMP NOT NULL DEFAULT now(),
    UNIQUE (match_id, rater_user_id)
);

CREATE TABLE team_ratings (
    id          SERIAL PRIMARY KEY,
    match_id    INTEGER NOT NULL REFERENCES matches(id),
    rated_by    VARCHAR(50),
    rating      NUMERIC(3,1) NOT NULL CHECK (rating BETWEEN 0 AND 10),
    comments    TEXT,
    created_at  TIMESTAMP NOT NULL DEFAULT now()
);

-- ============================================================
-- VISTAS: estadísticas agregadas (no se guardan, se calculan)
-- ============================================================

-- Clasificación / stats de equipo por temporada
CREATE VIEW season_team_standings AS
SELECT
    md.season_id,
    COUNT(*)                                                      AS played,
    SUM(CASE WHEN m.goals_for > m.goals_against THEN 1 ELSE 0 END) AS won,
    SUM(CASE WHEN m.goals_for = m.goals_against THEN 1 ELSE 0 END) AS drawn,
    SUM(CASE WHEN m.goals_for < m.goals_against THEN 1 ELSE 0 END) AS lost,
    SUM(m.goals_for)                                              AS goals_for,
    SUM(m.goals_against)                                          AS goals_against,
    SUM(CASE WHEN m.goals_for > m.goals_against THEN 3
             WHEN m.goals_for = m.goals_against THEN 1
             ELSE 0 END)                                          AS points
FROM matches m
JOIN matchdays md ON md.id = m.matchday_id
WHERE md.status = 'played'
GROUP BY md.season_id;

-- Estadísticas de cada jugador por temporada
CREATE VIEW season_player_stats AS
SELECT
    p.id                       AS player_id,
    p.full_name,
    md.season_id,
    COUNT(DISTINCT pms.match_id) AS matches_played,
    SUM(pms.minutes_played)      AS total_minutes,
    SUM(pms.goals)               AS total_goals,
    SUM(pms.assists)             AS total_assists,
    SUM(pms.yellow_cards)        AS total_yellow_cards,
    SUM(pms.red_cards)           AS total_red_cards,
    ROUND(AVG(pr.impacto), 2)    AS avg_impacto,
    ROUND(AVG(pr.esfuerzo), 2)   AS avg_esfuerzo,
    ROUND(AVG(pr.equipo), 2)     AS avg_equipo,
    ROUND(AVG(pr.liderazgo), 2)  AS avg_liderazgo
FROM player_match_stats pms
JOIN players p    ON p.id = pms.player_id
JOIN matches m    ON m.id = pms.match_id
JOIN matchdays md ON md.id = m.matchday_id
LEFT JOIN player_ratings pr
       ON pr.match_id = pms.match_id AND pr.player_id = pms.player_id
GROUP BY p.id, p.full_name, md.season_id;

-- Valoración media del equipo por temporada
CREATE VIEW season_team_rating AS
SELECT
    md.season_id,
    ROUND(AVG(tr.rating), 2) AS avg_team_rating,
    COUNT(tr.id)             AS ratings_count
FROM team_ratings tr
JOIN matches m    ON m.id = tr.match_id
JOIN matchdays md ON md.id = m.matchday_id
GROUP BY md.season_id;

-- Ratio de asistencia a convocatorias por jugador y temporada
CREATE VIEW season_call_up_attendance AS
SELECT
    p.id                          AS player_id,
    p.full_name,
    md.season_id,
    COUNT(*) FILTER (WHERE cu.called)                          AS times_called,
    COUNT(*) FILTER (WHERE cu.called AND cu.attended)          AS times_attended,
    ROUND(
        100.0 * COUNT(*) FILTER (WHERE cu.called AND cu.attended)
        / NULLIF(COUNT(*) FILTER (WHERE cu.called), 0), 1
    )                                                           AS attendance_pct
FROM call_ups cu
JOIN players p    ON p.id = cu.player_id
JOIN matchdays md ON md.id = cu.matchday_id
GROUP BY p.id, p.full_name, md.season_id;

-- ============================================================
-- ÍNDICES recomendados
-- ============================================================

CREATE INDEX idx_matchdays_season ON matchdays(season_id);
CREATE INDEX idx_matches_matchday ON matches(matchday_id);
CREATE INDEX idx_pms_match ON player_match_stats(match_id);
CREATE INDEX idx_pms_player ON player_match_stats(player_id);
CREATE INDEX idx_ratings_match ON player_ratings(match_id);
CREATE INDEX idx_ratings_player ON player_ratings(player_id);
CREATE INDEX idx_mvp_match ON match_mvp_votes(match_id);
CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_callups_matchday ON call_ups(matchday_id);
CREATE INDEX idx_callups_player ON call_ups(player_id);

-- ============================================================
-- SEMILLA: seasons y competitions no existen en ningún dato
-- actual (JSON/SQLite), así que se crean desde cero para poder
-- enlazar los matchdays migrados a algo. Ajusta las fechas/nombres
-- si no coinciden con tu temporada real.
-- ============================================================

INSERT INTO seasons (name, start_date, end_date, is_current)
VALUES ('2026-2027', '2026-09-01', '2027-06-30', TRUE);

INSERT INTO competitions (name)
VALUES ('Liga Regional');

-- ============================================================
-- MIGRACIÓN DE server/index.js A SUPABASE — tablas añadidas para esa
-- migración (no formaban parte del esquema original):
-- ============================================================

-- "Próximo partido" activo configurado a mano por el entrenador —
-- reemplaza el puntero "registro con updatedAt más reciente" que hoy vive
-- en server/db_convocatorias_aut.json. Fila única (id siempre TRUE).
CREATE TABLE app_state (
    id                  BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id = TRUE),
    active_matchday_id  INTEGER REFERENCES matchdays(id)
);

INSERT INTO app_state (id) VALUES (TRUE);

-- Liga completa simulada (los N equipos que sean, no solo Los Huevos FC).
-- Separada de matchdays/matches (que son el calendario/resultados reales
-- de nuestro club, con goals_for/against ya orientados "desde nuestra
-- perspectiva") para no romper esa forma con partidos entre terceros.
CREATE TABLE league_fixtures (
    id              SERIAL PRIMARY KEY,
    season_id       INTEGER NOT NULL REFERENCES seasons(id),
    competition_id  INTEGER REFERENCES competitions(id),
    jornada_number  INTEGER NOT NULL,
    match_date      TIMESTAMP,
    home_club_id    INTEGER NOT NULL REFERENCES clubs(id),
    away_club_id    INTEGER NOT NULL REFERENCES clubs(id),
    goals_home      INTEGER,
    goals_away      INTEGER,
    venue           VARCHAR(150),
    UNIQUE (season_id, competition_id, jornada_number, home_club_id, away_club_id)
);

-- ============================================================
-- PRIVILEGIOS: las tablas creadas a mano en el SQL Editor pertenecen
-- al rol `postgres` y no conceden acceso a `service_role` de forma
-- automática (a diferencia de las tablas creadas desde el Table
-- Editor de Supabase). Sin esto, cualquier cliente que use la
-- service_role key (p. ej. server/migrate-to-supabase.mjs) recibe
-- "permission denied" (42501) al leer o escribir.
-- ============================================================

GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;