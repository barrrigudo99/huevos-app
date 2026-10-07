-- ============================================================
-- Convocatoria final (fase 2 de docs/plan-convocatoria-final.md)
-- Fecha: 2026-10-04
--
-- Qué hace:
--   0) Copia de seguridad de call_ups, matchdays y app_state.
--   1) Esquema: estado de convocatoria por jornada (matchdays) y voto
--      informativo separado de la convocatoria (call_ups.vote).
--   2) Vista season_call_up_attendance con el criterio nuevo
--      (convocado / jornadas jugadas por el equipo).
--   3) Limpieza: las convocatorias y votaciones actuales son de prueba,
--      así que NO se migran: se vacía call_ups y todas las jornadas vuelven
--      a 'sin_encuesta' sin encuesta. players, matchdays (calendario y
--      resultados), users y clubs se conservan.
--
-- Ejecutar en el SQL Editor de Supabase, de una vez. Todo va en una sola
-- transacción: si algo falla, no se aplica nada (salvo el paso 0, que va
-- fuera a propósito para que la copia exista aunque falle lo demás).
-- ============================================================


-- ------------------------------------------------------------
-- 0) Copia de seguridad (se puede borrar cuando todo esté probado:
--    DROP TABLE backup_call_ups_20261004, backup_matchdays_20261004,
--               backup_app_state_20261004;)
-- ------------------------------------------------------------
CREATE TABLE backup_call_ups_20261004  AS SELECT * FROM call_ups;
CREATE TABLE backup_matchdays_20261004 AS SELECT * FROM matchdays;
CREATE TABLE backup_app_state_20261004 AS SELECT * FROM app_state;


BEGIN;

-- ------------------------------------------------------------
-- 1) Esquema
-- ------------------------------------------------------------

-- Estado de la convocatoria por jornada
ALTER TABLE matchdays
  ADD COLUMN callup_status     VARCHAR(12) NOT NULL DEFAULT 'sin_encuesta',
  ADD COLUMN callup_opened_at  TIMESTAMP,
  ADD COLUMN callup_closed_at  TIMESTAMP,
  ADD COLUMN callup_closed_by  INTEGER REFERENCES users(id);

ALTER TABLE matchdays
  ADD CONSTRAINT matchdays_callup_status_chk
    CHECK (callup_status IN ('sin_encuesta','inscripcion','cerrada'));

-- Una convocatoria cerrada debe tener fecha de cierre
ALTER TABLE matchdays
  ADD CONSTRAINT matchdays_callup_closed_chk
    CHECK (callup_status <> 'cerrada' OR callup_closed_at IS NOT NULL);

-- Voto informativo de WhatsApp, separado de la convocatoria
ALTER TABLE call_ups
  ADD COLUMN vote       VARCHAR(4),
  ADD COLUMN updated_at TIMESTAMP NOT NULL DEFAULT now();

ALTER TABLE call_ups
  ADD CONSTRAINT call_ups_vote_chk CHECK (vote IS NULL OR vote IN ('Si','No','Duda'));

-- called pasa a significar "convocado por el entrenador": por defecto false
ALTER TABLE call_ups ALTER COLUMN called SET DEFAULT FALSE;

-- Índices para las consultas nuevas (convocados por jornada y % de asistencia)
CREATE INDEX idx_callups_matchday_called ON call_ups(matchday_id) WHERE called;
CREATE INDEX idx_callups_player_called   ON call_ups(player_id)   WHERE called;
CREATE INDEX idx_matchdays_callup_status ON matchdays(callup_status);


-- ------------------------------------------------------------
-- 2) Vista de asistencia: convocado / jornadas jugadas por el equipo.
--    Se borra y se crea de nuevo porque cambian las columnas
--    (times_attended -> team_played) y CREATE OR REPLACE no lo permite.
--    El código no lee esta vista; se mantiene coherente con el ranking.
-- ------------------------------------------------------------
DROP VIEW IF EXISTS season_call_up_attendance;

CREATE VIEW season_call_up_attendance AS
SELECT p.id AS player_id, p.full_name, md.season_id,
       COUNT(*) FILTER (WHERE cu.called)                         AS times_called,
       played.total                                              AS team_played,
       ROUND(100.0 * COUNT(*) FILTER (WHERE cu.called) / NULLIF(played.total, 0), 1) AS attendance_pct
FROM call_ups cu
JOIN players p    ON p.id = cu.player_id
JOIN matchdays md ON md.id = cu.matchday_id AND md.status = 'played'
JOIN (SELECT season_id, count(*) AS total FROM matchdays WHERE status = 'played' GROUP BY season_id) played
     ON played.season_id = md.season_id
GROUP BY p.id, p.full_name, md.season_id, played.total;


-- ------------------------------------------------------------
-- 3) Limpieza de datos de prueba
-- ------------------------------------------------------------
DELETE FROM call_ups;

UPDATE matchdays
SET callup_status    = 'sin_encuesta',
    whatsapp_poll_id = NULL,
    callup_opened_at = NULL,
    callup_closed_at = NULL,
    callup_closed_by = NULL;

COMMIT;


-- ------------------------------------------------------------
-- Verificación (ejecutar después; no modifica nada)
-- ------------------------------------------------------------
-- Debe dar 0:
SELECT count(*) AS call_ups_restantes FROM call_ups;
-- Debe dar una sola fila: sin_encuesta / 0 encuestas, con todas las jornadas:
SELECT callup_status, count(*) AS jornadas, count(whatsapp_poll_id) AS con_encuesta
FROM matchdays GROUP BY callup_status;
-- Calendario y resultados intactos (comparar con la copia):
SELECT (SELECT count(*) FROM matchdays) AS matchdays,
       (SELECT count(*) FROM backup_matchdays_20261004) AS backup_matchdays,
       (SELECT count(*) FROM matchdays WHERE status = 'played') AS jugadas,
       (SELECT count(*) FROM backup_matchdays_20261004 WHERE status = 'played') AS backup_jugadas;
-- Columnas nuevas presentes:
SELECT table_name, column_name, data_type, column_default
FROM information_schema.columns
WHERE (table_name = 'matchdays' AND column_name LIKE 'callup_%')
   OR (table_name = 'call_ups'  AND column_name IN ('vote','updated_at','called'))
ORDER BY table_name, column_name;
