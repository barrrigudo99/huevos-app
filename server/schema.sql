-- =============================================================================
-- Huevos FC — esquema de base de datos (Supabase / PostgreSQL)
-- =============================================================================
-- Proyecto Supabase: pbpqgssevygwltqatmyn · esquema: public
-- Extraído de la base de datos real el 2026-10-12. Es DOCUMENTACIÓN de
-- referencia (para humanos y LLMs), no una migración: no lo ejecutes contra
-- producción. Si cambias el esquema en Supabase, regenera este archivo.
--
-- Acceso: todas las tablas tienen RLS activado y NINGUNA política, así que el
-- cliente anon no puede leer nada. Todo el acceso pasa por el backend Express
-- (server/index.js) con la clave service_role.
-- Recordatorio: cada tabla nueva creada a mano necesita
--   GRANT ALL ON ALL TABLES    IN SCHEMA public TO service_role;
--   GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
--
-- Mapa rápido:
--   seasons ─┬─ matchdays (jornada del calendario) ── matches (resultado, 0..1 por jornada)
--            │       │                                  ├─ player_match_stats
--            │       └─ call_ups (convocatoria)         ├─ player_ratings
--            │                                          ├─ match_mvp_votes
--            └─ player_season_roster ── players         ├─ team_match_stats
--                                          └─ users     └─ team_ratings
--   Casi todo cuelga de `matches` (el partido) o de `players` (el jugador).
--   Una jornada (matchdays) solo tiene fila en matches cuando hay resultado.
--
-- Filas a 2026-10-12 entre corchetes en cada tabla.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- TEMPORADA Y LIGA
-- -----------------------------------------------------------------------------

-- Temporadas. Solo una debería tener is_current = true.  [1 fila]
CREATE TABLE seasons (
    id          serial       PRIMARY KEY,
    name        varchar(20)  NOT NULL,             -- p. ej. '2026-27'
    start_date  date,
    end_date    date,
    is_current  boolean      NOT NULL DEFAULT false
);

-- Competiciones (liga y otra).  [2 filas]
CREATE TABLE competitions (
    id    serial        PRIMARY KEY,
    name  varchar(100)  NOT NULL
);

-- Los 12 equipos de la liga, incluido el propio (is_own = true).  [12 filas]
CREATE TABLE clubs (
    id          serial        PRIMARY KEY,
    name        varchar(100)  NOT NULL UNIQUE,
    is_own      boolean       NOT NULL DEFAULT false,  -- true = Huevos FC
    logo_url    text,
    created_at  timestamp     NOT NULL DEFAULT now()
);

-- Resultados del resto de la liga (partidos entre otros clubes), pensada para
-- la clasificación general. VACÍA: nada la rellena todavía.  [0 filas]
CREATE TABLE league_fixtures (
    id              serial        PRIMARY KEY,
    season_id       integer       NOT NULL REFERENCES seasons(id),
    competition_id  integer                REFERENCES competitions(id),
    jornada_number  integer       NOT NULL,
    match_date      timestamp,
    home_club_id    integer       NOT NULL REFERENCES clubs(id),
    away_club_id    integer       NOT NULL REFERENCES clubs(id),
    goals_home      integer,
    goals_away      integer,
    venue           varchar(150),
    UNIQUE (season_id, competition_id, jornada_number, home_club_id, away_club_id)
);


-- -----------------------------------------------------------------------------
-- JUGADORES Y CUENTAS
-- -----------------------------------------------------------------------------

-- Posiciones en el campo (portero, defensa...).  [5 filas]
CREATE TABLE positions (
    id          serial       PRIMARY KEY,
    name        varchar(50)  NOT NULL,
    short_code  varchar(5)   UNIQUE              -- abreviatura, p. ej. 'POR'
);

-- Ficha del jugador. Es la entidad central del lado "persona": convocatorias,
-- estadísticas, valoraciones y cuentas apuntan aquí.  [18 filas]
CREATE TABLE players (
    id           serial        PRIMARY KEY,
    full_name    varchar(100)  NOT NULL,         -- apodo en mayúsculas, p. ej. 'BARRI'
    birth_date   date,
    position_id  integer       REFERENCES positions(id),
    phone        varchar(20)   UNIQUE,           -- para cruzar con votos de WhatsApp
    photo_url    text,                           -- Supabase Storage
    joined_date  date,
    active       boolean       NOT NULL DEFAULT true
);

-- Plantilla por temporada: qué jugadores están y con qué dorsal.  [18 filas]
CREATE TABLE player_season_roster (
    id             serial   PRIMARY KEY,
    player_id      integer  NOT NULL REFERENCES players(id),
    season_id      integer  NOT NULL REFERENCES seasons(id),
    dorsal_number  integer,
    UNIQUE (player_id, season_id)
);

-- Cuentas de login. Se entra con el email; contraseña con bcrypt.
-- Cada cuenta se vincula (opcionalmente) a un jugador.  [18 filas]
CREATE TABLE users (
    id             serial        PRIMARY KEY,
    email          varchar(150)  NOT NULL UNIQUE,  -- usuario de inicio de sesión
    password_hash  text,                           -- bcrypt
    full_name      varchar(100),
    role           varchar(20)   NOT NULL DEFAULT 'jugador'
                   CHECK (role IN ('jugador', 'entrenador')),
    player_id      integer       REFERENCES players(id) ON DELETE SET NULL,
    created_at     timestamp     NOT NULL DEFAULT now()
);
CREATE INDEX idx_users_role ON users (role);


-- -----------------------------------------------------------------------------
-- JORNADAS Y CONVOCATORIAS
-- -----------------------------------------------------------------------------

-- Calendario de NUESTROS partidos: una fila por jornada, se haya jugado o no.
-- También guarda el estado de la convocatoria (encuesta de WhatsApp).  [22 filas]
CREATE TABLE matchdays (
    id                serial        PRIMARY KEY,
    season_id         integer       NOT NULL REFERENCES seasons(id),
    competition_id    integer                REFERENCES competitions(id),
    jornada_number    integer       NOT NULL,
    match_date        timestamp,
    opponent_club_id  integer                REFERENCES clubs(id),
    is_home           boolean       NOT NULL DEFAULT true,
    venue             varchar(150),
    status            varchar(20)   NOT NULL DEFAULT 'scheduled'
                      CHECK (status IN ('scheduled', 'played', 'postponed', 'cancelled')),
    whatsapp_poll_id  varchar(100),             -- id de la encuesta en Whapi.Cloud
    callup_status     varchar(12)   NOT NULL DEFAULT 'sin_encuesta'
                      CHECK (callup_status IN ('sin_encuesta', 'inscripcion', 'cerrada')),
    callup_opened_at  timestamp,
    callup_closed_at  timestamp,
    callup_closed_by  integer                REFERENCES users(id),  -- entrenador que cerró
    UNIQUE (season_id, competition_id, jornada_number),
    CONSTRAINT matchdays_callup_closed_chk
        CHECK (callup_status <> 'cerrada' OR callup_closed_at IS NOT NULL)
);
CREATE INDEX idx_matchdays_season        ON matchdays (season_id);
CREATE INDEX idx_matchdays_callup_status ON matchdays (callup_status);

-- Estado global de la app: una única fila (id siempre true) que dice cuál es
-- la jornada activa.  [1 fila]
CREATE TABLE app_state (
    id                  boolean  PRIMARY KEY DEFAULT true CHECK (id = true),
    active_matchday_id  integer  REFERENCES matchdays(id)
);

-- Convocatoria: una fila por jugador y jornada.
--   vote    = lo que votó en WhatsApp (solo informativo).
--   called  = convocatoria final, la decide el entrenador.
--   El % de asistencia cuenta solo `called`.  [18 filas]
CREATE TABLE call_ups (
    id              serial        PRIMARY KEY,
    matchday_id     integer       NOT NULL REFERENCES matchdays(id),
    player_id       integer       NOT NULL REFERENCES players(id),
    called          boolean       NOT NULL DEFAULT false,
    attended        boolean,
    role_in_squad   varchar(20)   CHECK (role_in_squad IN ('titular', 'suplente', 'no_convocado')),
    reason_absence  varchar(100),
    created_at      timestamp     NOT NULL DEFAULT now(),
    vote            varchar(4)    CHECK (vote IS NULL OR vote IN ('Si', 'No', 'Duda')),
    updated_at      timestamp     NOT NULL DEFAULT now(),
    UNIQUE (matchday_id, player_id)
);
CREATE INDEX idx_callups_matchday        ON call_ups (matchday_id);
CREATE INDEX idx_callups_player          ON call_ups (player_id);
CREATE INDEX idx_callups_matchday_called ON call_ups (matchday_id) WHERE called;
CREATE INDEX idx_callups_player_called   ON call_ups (player_id)   WHERE called;


-- -----------------------------------------------------------------------------
-- PARTIDO, ESTADÍSTICAS Y VALORACIONES
-- -----------------------------------------------------------------------------

-- Resultado de un partido jugado. Como mucho una fila por jornada; se crea al
-- guardar resultado o estadísticas (asegurarMatch en server/index.js).  [1 fila]
CREATE TABLE matches (
    id                       serial       PRIMARY KEY,
    matchday_id              integer      NOT NULL UNIQUE REFERENCES matchdays(id),
    goals_for                integer      NOT NULL DEFAULT 0,
    goals_against            integer      NOT NULL DEFAULT 0,
    half_time_goals_for      integer,
    half_time_goals_against  integer,
    source                   varchar(10)  NOT NULL DEFAULT 'manual'
                             CHECK (source IN ('manual', 'simulado')),
    notes                    text
);
CREATE INDEX idx_matches_matchday ON matches (matchday_id);

-- Estadísticas individuales por partido. Las guarda el entrenador desde
-- MatchStatsPanel (PUT /api/estadisticas-personales/:matchId): borra todas las
-- filas del partido y las vuelve a insertar, y SOLO inserta jugadores con algún
-- gol, asistencia o tarjeta. Nada escribe minutes_played, started ni saves.
-- [0 filas]
CREATE TABLE player_match_stats (
    id              serial   PRIMARY KEY,
    match_id        integer  NOT NULL REFERENCES matches(id),
    player_id       integer  NOT NULL REFERENCES players(id),
    started         boolean  NOT NULL DEFAULT false,
    minutes_played  integer  NOT NULL DEFAULT 0,
    goals           integer  NOT NULL DEFAULT 0,
    assists         integer  NOT NULL DEFAULT 0,
    yellow_cards    integer  NOT NULL DEFAULT 0,
    red_cards       integer  NOT NULL DEFAULT 0,
    saves           integer,
    UNIQUE (match_id, player_id)
);
CREATE INDEX idx_pms_match  ON player_match_stats (match_id);
CREATE INDEX idx_pms_player ON player_match_stats (player_id);

-- Estadísticas del equipo por partido. VACÍA: nada la rellena.  [0 filas]
CREATE TABLE team_match_stats (
    id               serial        PRIMARY KEY,
    match_id         integer       NOT NULL UNIQUE REFERENCES matches(id),
    possession_pct   numeric(5,2),
    shots            integer,
    shots_on_target  integer,
    corners          integer,
    fouls            integer
);

-- Valoración que un compañero (rater_user_id) pone a un jugador en un partido.
-- Cuatro atributos de 1 a 5. Se escribe desde RatingPanel
-- (POST /api/player-ratings/:matchId) como upsert sobre
-- (match_id, player_id, rater_user_id).  [30 filas]
CREATE TABLE player_ratings (
    id             serial       PRIMARY KEY,
    match_id       integer      NOT NULL REFERENCES matches(id),
    player_id      integer      NOT NULL REFERENCES players(id),   -- el valorado
    rated_by       varchar(50),                                    -- legado; usar rater_user_id
    comments       text,
    created_at     timestamp    NOT NULL DEFAULT now(),
    rater_user_id  integer      REFERENCES users(id),              -- quien valora
    impacto        smallint     CHECK (impacto   BETWEEN 1 AND 5),
    esfuerzo       smallint     CHECK (esfuerzo  BETWEEN 1 AND 5),
    equipo         smallint     CHECK (equipo    BETWEEN 1 AND 5),
    liderazgo      smallint     CHECK (liderazgo BETWEEN 1 AND 5),
    CONSTRAINT player_ratings_rater_unique UNIQUE (match_id, player_id, rater_user_id)
);
CREATE INDEX idx_ratings_match  ON player_ratings (match_id);
CREATE INDEX idx_ratings_player ON player_ratings (player_id);

-- Voto al MVP: un voto por usuario y partido. En caso de empate nadie se
-- lleva el punto.  [3 filas]
CREATE TABLE match_mvp_votes (
    id             serial     PRIMARY KEY,
    match_id       integer    NOT NULL REFERENCES matches(id),
    rater_user_id  integer    NOT NULL REFERENCES users(id),    -- quien vota
    player_id      integer    NOT NULL REFERENCES players(id),  -- el votado
    created_at     timestamp  NOT NULL DEFAULT now(),
    UNIQUE (match_id, rater_user_id)
);
CREATE INDEX idx_mvp_match ON match_mvp_votes (match_id);

-- Nota global al equipo por partido (0 a 10). VACÍA.  [0 filas]
CREATE TABLE team_ratings (
    id          serial        PRIMARY KEY,
    match_id    integer       NOT NULL REFERENCES matches(id),
    rated_by    varchar(50),
    rating      numeric(3,1)  NOT NULL CHECK (rating BETWEEN 0 AND 10),
    comments    text,
    created_at  timestamp     NOT NULL DEFAULT now()
);


-- -----------------------------------------------------------------------------
-- VISTAS (no guardan datos: se calculan cada vez que se leen)
-- -----------------------------------------------------------------------------

-- Totales por jugador y temporada. YA NO SE USA: desde 2026-10-12 el perfil
-- y el ranking calculan estos totales en server/index.js
-- (statsTemporadaPorJugador) por los problemas de abajo. Se puede borrar.
-- PROBLEMAS CONOCIDOS (2026-10-12):
--   1. Parte de player_match_stats: un jugador sin fila ahí no aparece, aunque
--      tenga valoraciones. Hoy la vista está vacía y los 30 ratings no se ven.
--   2. El LEFT JOIN con player_ratings duplica filas: con N valoraciones, los
--      goles/asistencias/tarjetas se suman N veces (las medias sí salen bien).
--   3. matches_played solo cuenta partidos con gol, asistencia o tarjeta.
--   4. No filtra matchdays.status = 'played'.
--   5. total_minutes siempre NULL/0 (nadie escribe minutes_played).
CREATE VIEW season_player_stats AS
SELECT p.id AS player_id,
       p.full_name,
       md.season_id,
       count(DISTINCT pms.match_id) AS matches_played,
       sum(pms.minutes_played)      AS total_minutes,
       sum(pms.goals)               AS total_goals,
       sum(pms.assists)             AS total_assists,
       sum(pms.yellow_cards)        AS total_yellow_cards,
       sum(pms.red_cards)           AS total_red_cards,
       round(avg(pr.impacto), 2)    AS avg_impacto,
       round(avg(pr.esfuerzo), 2)   AS avg_esfuerzo,
       round(avg(pr.equipo), 2)     AS avg_equipo,
       round(avg(pr.liderazgo), 2)  AS avg_liderazgo
FROM player_match_stats pms
JOIN players   p  ON p.id  = pms.player_id
JOIN matches   m  ON m.id  = pms.match_id
JOIN matchdays md ON md.id = m.matchday_id
LEFT JOIN player_ratings pr ON pr.match_id = pms.match_id AND pr.player_id = pms.player_id
GROUP BY p.id, p.full_name, md.season_id;

-- Asistencia: veces convocado (called) frente a partidos jugados por el equipo
-- en la temporada.
CREATE VIEW season_call_up_attendance AS
SELECT p.id AS player_id,
       p.full_name,
       md.season_id,
       count(*) FILTER (WHERE cu.called) AS times_called,
       played.total                      AS team_played,
       round(100.0 * count(*) FILTER (WHERE cu.called)::numeric
             / NULLIF(played.total, 0)::numeric, 1) AS attendance_pct
FROM call_ups cu
JOIN players   p  ON p.id  = cu.player_id
JOIN matchdays md ON md.id = cu.matchday_id AND md.status = 'played'
JOIN (SELECT season_id, count(*) AS total
      FROM matchdays
      WHERE status = 'played'
      GROUP BY season_id) played ON played.season_id = md.season_id
GROUP BY p.id, p.full_name, md.season_id, played.total;

-- Balance del equipo en la temporada (3 puntos victoria, 1 empate).
CREATE VIEW season_team_standings AS
SELECT md.season_id,
       count(*) AS played,
       sum(CASE WHEN m.goals_for >  m.goals_against THEN 1 ELSE 0 END) AS won,
       sum(CASE WHEN m.goals_for =  m.goals_against THEN 1 ELSE 0 END) AS drawn,
       sum(CASE WHEN m.goals_for <  m.goals_against THEN 1 ELSE 0 END) AS lost,
       sum(m.goals_for)     AS goals_for,
       sum(m.goals_against) AS goals_against,
       sum(CASE WHEN m.goals_for > m.goals_against THEN 3
                WHEN m.goals_for = m.goals_against THEN 1
                ELSE 0 END) AS points
FROM matches m
JOIN matchdays md ON md.id = m.matchday_id
WHERE md.status = 'played'
GROUP BY md.season_id;

-- Media de la nota al equipo por temporada (depende de team_ratings, vacía).
CREATE VIEW season_team_rating AS
SELECT md.season_id,
       round(avg(tr.rating), 2) AS avg_team_rating,
       count(tr.id)             AS ratings_count
FROM team_ratings tr
JOIN matches   m  ON m.id  = tr.match_id
JOIN matchdays md ON md.id = m.matchday_id
GROUP BY md.season_id;


-- -----------------------------------------------------------------------------
-- OTROS
-- -----------------------------------------------------------------------------
-- Función public.rls_auto_enable(): activa RLS automáticamente en tablas
-- nuevas del esquema public. No hay triggers de tabla.