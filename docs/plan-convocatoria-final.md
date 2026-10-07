# Plan de implementación: convocatoria final

> Fecha: 2026-10-04 · Estado: propuesta, sin implementar.
> Las referencias `archivo:línea` corresponden al commit `9bc8624` («subida final - 021026»).

---

## 1. Objetivo y flujo final

Hoy la encuesta de WhatsApp sirve a la vez como inscripción y como convocatoria. Además, los votos se copian a `call_ups` sin avisar cuando cambia el «partido activo» o cuando se marca un partido como jugado (`server/index.js:931`, `server/index.js:1170`).

El objetivo es separar las dos cosas:

- **Inscripción**: encuesta de WhatsApp sin límite de plazas. Es **solo informativa**.
- **Convocatoria final**: la lista que decide el entrenador. Es la **única** que cuenta para Alineación, Estadísticas, el perfil y el ranking.

Cada jornada (`matchdays`) tiene su propia convocatoria con un estado explícito. Todas las acciones van **por el `matchId` de la jornada que se ve en pantalla**, nunca por `app_state.active_matchday_id`.

### Estados

```
 sin_encuesta ──(Generar inscripción)──▶ inscripcion ──(Guardar convocatoria final)──▶ cerrada ──(Marcar jugado)──▶ cerrada + matchdays.status='played'
                                             ▲                                            │
                                             └────────────────(Reabrir)───────────────────┘   (solo si no está jugado)
```

| Paso | Quién | Qué pasa |
|---|---|---|
| Generar inscripción | Entrenador | Se crea la encuesta Sí/No/Duda en WhatsApp. `callup_status = 'inscripcion'`. |
| Votar | Jugadores, en WhatsApp | Sin límite. La app muestra los votos en directo, solo como información. |
| Crear convocatoria final | Entrenador | Panel con los votos: los «Sí» aparecen arriba y marcados; Duda, No y sin voto aparecen debajo, sin marcar. Se guarda `call_ups.called` y `call_ups.vote`, y queda `callup_status = 'cerrada'`. Opcionalmente se envía la lista al grupo. |
| Reabrir | Entrenador | Vuelve a `inscripcion` sin borrar filas. Solo si el partido no está jugado. |
| Marcar jugado | Entrenador | Exige que la convocatoria esté `cerrada`. Ya no copia votos. |
| Editar tras jugado | Entrenador | Se permite, con un aviso de confirmación. Si alguien convocado no vino, se le desmarca y cuenta como No. |

### Reglas de negocio

1. Inscripción sin límite. No hay máximo de convocados ni avisos de límite.
2. La convocatoria final la decide el entrenador y puede añadir a cualquier jugador, haya votado o no.
3. `call_ups.vote` es informativo. **No** cuenta para estadísticas ni para el ranking.
4. % de asistencia = jornadas jugadas con `called = true` / jornadas jugadas por el equipo. Votar Sí y no ser convocado cuenta como No. `attended` no se rellena.
5. Sin titular ni suplente. `role_in_squad` se queda en `NULL`.

---

## 2. Base de datos

### 2.1 Copia de seguridad (antes de nada)

Opción A, en el SQL Editor de Supabase (es la más rápida):

```sql
CREATE TABLE backup_call_ups_20261004  AS SELECT * FROM call_ups;
CREATE TABLE backup_matchdays_20261004 AS SELECT * FROM matchdays;
CREATE TABLE backup_app_state_20261004 AS SELECT * FROM app_state;

-- Verificación: los recuentos deben coincidir
SELECT (SELECT count(*) FROM call_ups)  AS call_ups,  (SELECT count(*) FROM backup_call_ups_20261004)  AS backup_cu,
       (SELECT count(*) FROM matchdays) AS matchdays, (SELECT count(*) FROM backup_matchdays_20261004) AS backup_md;
```

Opción B, con un volcado fuera de Supabase (recomendable además de la A):

```bash
pg_dump "$SUPABASE_DB_URL" --data-only --table=public.call_ups --table=public.matchdays --table=public.app_state \
  > backup_convocatorias_20261004.sql
```

También se puede exportar `call_ups` a CSV desde el Table Editor de Supabase.

Para restaurar si algo sale mal:

```sql
BEGIN;
TRUNCATE call_ups;
INSERT INTO call_ups SELECT * FROM backup_call_ups_20261004;
COMMIT;
```

### 2.2 Migración de esquema (fase 2)

```sql
BEGIN;

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

-- `called` pasa a significar "convocado por el entrenador": por defecto false
ALTER TABLE call_ups ALTER COLUMN called SET DEFAULT FALSE;

-- Índices para las consultas nuevas (convocados por jornada y % de asistencia)
CREATE INDEX idx_callups_matchday_called ON call_ups(matchday_id) WHERE called;
CREATE INDEX idx_callups_player_called   ON call_ups(player_id)   WHERE called;
CREATE INDEX idx_matchdays_callup_status ON matchdays(callup_status);

COMMIT;
```

Ya existen `idx_callups_matchday` e `idx_callups_player` (`server/los_huevos_fc_schema.sql:278-279`) y `UNIQUE (matchday_id, player_id)` (`server/los_huevos_fc_schema.sql:106`). No hay que tocarlos.

### 2.3 Migración de los datos existentes (fase 2, justo después de 2.2)

Hoy `attended` guarda el voto (`server/index.js:862-872`): Sí → `true`, No → `false`, Duda o sin voto → `NULL`.

```sql
BEGIN;

-- 1) vote a partir de attended. Duda y "sin voto" se guardaban igual (NULL),
--    así que no se pueden distinguir: ambos quedan como vote = NULL.
UPDATE call_ups SET vote = CASE WHEN attended IS TRUE  THEN 'Si'
                                WHEN attended IS FALSE THEN 'No'
                                ELSE NULL END;

-- 2) called = (attended = true): el histórico asume que se convocó a quien votó Sí
UPDATE call_ups SET called = (attended IS TRUE);

-- 3) attended deja de usarse (regla 4): se vacía para que nadie lo lea como voto
UPDATE call_ups SET attended = NULL, updated_at = now();

-- 4) Estado de las jornadas
--    a) con filas en call_ups -> cerrada (fecha de cierre = la fila más reciente)
UPDATE matchdays md
SET callup_status    = 'cerrada',
    callup_closed_at = sub.closed_at
FROM (SELECT matchday_id, max(created_at) AS closed_at FROM call_ups GROUP BY matchday_id) sub
WHERE md.id = sub.matchday_id;

--    b) con encuesta y sin call_ups -> inscripcion
UPDATE matchdays
SET callup_status = 'inscripcion'
WHERE callup_status = 'sin_encuesta' AND whatsapp_poll_id IS NOT NULL;

COMMIT;

-- Verificación
SELECT callup_status, status, count(*) FROM matchdays GROUP BY 1, 2 ORDER BY 1, 2;
SELECT vote, called, count(*) FROM call_ups GROUP BY 1, 2 ORDER BY 1, 2;
```

**Revisar a mano antes del paso 4:** las jornadas `status = 'played'` sin filas en `call_ups` quedarán como `sin_encuesta` o `inscripcion` aunque ya se hayan jugado. Para listarlas:

```sql
SELECT id, jornada_number, match_date, whatsapp_poll_id
FROM matchdays md
WHERE status = 'played' AND NOT EXISTS (SELECT 1 FROM call_ups cu WHERE cu.matchday_id = md.id);
```

El entrenador puede crear su convocatoria final después desde el panel (se permite editar tras jugado).

### 2.4 Vista `season_call_up_attendance`

La vista de `server/los_huevos_fc_schema.sql:248-262` calcula `called AND attended`. Como `attended` se vacía, daría 0 %. Hay que redefinirla con el criterio nuevo (convocado / jornadas jugadas):

```sql
CREATE OR REPLACE VIEW season_call_up_attendance AS
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
```

(El código actual no lee esta vista; el cambio es para mantenerla coherente.)

### 2.5 Fase 3 (opcional): quitar el partido activo

Cuando ningún endpoint lea `app_state.active_matchday_id`:

```sql
ALTER TABLE app_state DROP COLUMN active_matchday_id;  -- o DROP TABLE app_state si no queda nada más
```

Hay que actualizar `server/los_huevos_fc_schema.sql` (tablas en `:78-107`, vista en `:248`, `app_state` en `:300-305`) con todo lo anterior.

---

## 3. Backend

### 3.1 Convenciones

- Las escrituras usan `requireEntrenador()` (`server/index.js:87`), que lee la cabecera `X-User-Id`.
- Errores en formato `{ error: string, code?: string }`. El `code` permite al frontend distinguir los 409.
- Códigos HTTP: 400 entrada inválida · 401/403 permisos · 404 jornada inexistente · 409 conflicto de estado · 502 Whapi.

### 3.2 Endpoints nuevos

#### `GET /api/matchdays/:id/convocatoria` (fases 2 y 3)

- **Permisos:** ninguno (igual que el resto de GET actuales).
- **Respuesta 200:**
  ```json
  {
    "matchId": 103,
    "status": "sin_encuesta | inscripcion | cerrada",
    "jugado": false,
    "whatsappPollId": "abc…",
    "openedAt": "2026-10-01T18:00:00", "closedAt": null, "closedBy": null,
    "jugadores": [
      { "playerId": 7, "name": "…", "phone": "346…", "vote": "Si|No|Duda|null", "called": true }
    ],
    "votosSinJugador": [ { "phone": "346…", "vote": "Si" } ],
    "jugadoresSinTelefono": [12, 15]
  }
  ```
- **De dónde salen los datos según el estado:**
  - `sin_encuesta`: `vote = null` y `called = false` para todos.
  - `inscripcion`: `vote` viene de `fetchPollVotes` (en directo). `called` es la propuesta: `vote === 'Si'`.
  - `cerrada`: todo sale de `call_ups`. **No** se consulta Whapi.
- **Errores:** 400 si el id no es numérico · 404 si la jornada no existe · 502 si Whapi falla en `inscripcion`. En ese caso se devuelve `{ error, code: 'WHAPI_ERROR' }` y el panel lo muestra sin proponer convocados.

#### `POST /api/matchdays/:id/poll` (fase 1; sustituye a `POST /api/next-match/poll`)

- **Permisos:** entrenador.
- **Body:** `{ "confirmarReemplazo": false }`.
- **Qué hace:** crea la encuesta con `createPollMessage` (`server/whatsappPollService.js:103`), guarda `whatsapp_poll_id` y, desde la fase 2, pone `callup_status = 'inscripcion'` y `callup_opened_at = now()`.
- **Respuesta 200:** `{ matchId, rival, date, whatsappPollId, status }`.
- **Errores:**
  - 400 `SIN_RIVAL`: la jornada no tiene rival.
  - 404: la jornada no existe.
  - 409 `POLL_EXISTS`: ya tiene encuesta y no se envía `confirmarReemplazo: true`.
  - 409 `CONVOCATORIA_CERRADA`: la convocatoria ya está cerrada (hay que reabrir antes). Desde la fase 2.
  - 409 `PARTIDO_JUGADO`: el partido ya está jugado.
  - 502 `WHAPI_ERROR`.

#### `PUT /api/matchdays/:id/convocatoria` (fase 2)

- **Permisos:** entrenador.
- **Body:**
  ```json
  { "convocados": [7, 9, 12], "enviarAlGrupo": false, "confirmarEdicionJugado": false }
  ```
- **Qué hace:**
  1. Valida que todos los ids existen en `players`.
  2. Obtiene los votos:
     - en `inscripcion`, con `fetchPollVotes`. **Si falla, devuelve 502 y no escribe nada**;
     - en `cerrada` (edición), reutiliza `call_ups.vote` y no vuelve a llamar a Whapi.
  3. Hace un `upsert` en `call_ups` con una fila por jugador de la plantilla: `{ matchday_id, player_id, called: convocados.includes(id), vote, updated_at: now() }` (`onConflict: 'matchday_id,player_id'`). Se mantienen las filas de jugadores que ya no están en la plantilla.
  4. Pone `callup_status = 'cerrada'`, `callup_closed_at = now()` y `callup_closed_by = X-User-Id`.
  5. Si `enviarAlGrupo` vale `true`, envía el mensaje con `sendTextMessage` (nuevo, ver 3.4). **Si falla el envío no se deshace nada**: la respuesta incluye `aviso`.
- **Respuesta 200:** el mismo cuerpo que el GET, más `{ "aviso": "No se pudo enviar la lista al grupo: …" }` cuando corresponda.
- **Errores:**
  - 400 `IDS_INVALIDOS`: algún id no existe.
  - 404: la jornada no existe.
  - 409 `SIN_ENCUESTA`: la jornada está en `sin_encuesta`.
  - 409 `PARTIDO_JUGADO`: el partido está jugado y no se envía `confirmarEdicionJugado: true`.
  - 502 `WHAPI_ERROR`.

#### `PUT /api/matchdays/:id/convocatoria/reabrir` (fase 2)

- **Permisos:** entrenador.
- **Qué hace:** `callup_status = 'inscripcion'` y `callup_closed_at`/`callup_closed_by` a `NULL`. **No borra** filas de `call_ups`. Al volver a cerrar se reescriben.
- **Respuesta 200:** el mismo cuerpo que el GET.
- **Errores:** 404 · 409 `NO_CERRADA` si no está cerrada · 409 `PARTIDO_JUGADO` (tras jugar se edita directamente, no se reabre).

#### `PUT /api/matchdays/:id` (fase 3; sustituye a la parte de fecha y hora de `PUT /api/next-match`)

- **Permisos:** entrenador.
- **Body:** `{ "date": "YYYY-MM-DD", "time": "HH:MM" }`.
- **Qué hace:** actualiza `match_date` con `combinarFechaHora` (`server/index.js:757`).
- **Errores:** 400 si la fecha o la hora no son válidas · 404.

### 3.3 Endpoints modificados

| Endpoint | Ubicación | Cambio | Fase |
|---|---|---|---|
| `PUT /api/next-match` | `server/index.js:900-953` | F1: ignorar `whatsappPollId` del body; el id de la encuesta solo lo escribe el servidor. F2: quitar la llamada a `archivarVotos` (`:931-933`). F3: eliminar el endpoint. | 1 → 3 |
| `POST /api/next-match/poll` | `server/index.js:1024-1041` | F1: sustituido por `POST /api/matchdays/:id/poll`. Se elimina, o se deja devolviendo 410 durante una versión. | 1 |
| `GET /api/call-ups/:matchdayId` | `server/index.js:1005-1018` | Filtrar `.eq('called', true)` en vez de `.eq('attended', true)` (`:1012`). Así Estadísticas y Alineación usan la convocatoria final sin más cambios. | 2 |
| `PUT /api/calendario/:matchId/jugado` | `server/index.js:1159-1177` | Quitar `archivarVotos` (`:1169-1172`). Antes de actualizar, si `callup_status <> 'cerrada'`, devolver 409 `CONVOCATORIA_NO_CERRADA`, salvo con body `{ forzar: true }` (para jornadas antiguas sin convocatoria). | 2 |
| `PUT /api/calendario/:matchId/no-jugado` | `server/index.js:1185-1196` | Sin cambios. La convocatoria sigue `cerrada`. | — |
| `GET /api/convocatoria-history` | `server/index.js:955-999` | Devolver solo jornadas `cerrada` y jugadas: `[{ id, rival, date, convocados: [playerId] }]` a partir de `called = true`. Ya no hace falta saltarse el partido activo (`:974`). | 3 |
| `GET /api/stats/ranking` y `GET /api/players/:id/profile` | `server/index.js:1317+`, `:310+` | No cambian, pero su % pasa a contar `called` por el cambio en `contarAsistenciasPorJugador`. | 2 |

### 3.4 Funciones internas

| Función | Ubicación | Cambio | Fase |
|---|---|---|---|
| `archivarVotos` | `server/index.js:877-885` | F1: **quitar el `try/catch` que se traga el error** (`:879-883`). Si `fetchPollVotes` falla, se lanza el error y no se escribe en `call_ups`. F2: se elimina, porque no queda ningún sitio que la llame. | 1 → 2 |
| `guardarCallUpsDesdeVotos` | `server/index.js:862-872` | F1: no tocar filas de jornadas con `called` ya decidido. F2: sustituida por `guardarConvocatoriaFinal(matchdayId, convocadosIds, votes)`, que escribe `called` + `vote` y deja `attended` en `NULL`. | 1 → 2 |
| `contarAsistenciasPorJugador` | `server/index.js:246-256` | `.eq('attended', true)` → `.eq('called', true)` (`:251`). El denominador (`getPlayedMatchdayIds`, `:233`) se mantiene. | 2 |
| `fetchPollVotes` | `server/whatsappPollService.js:50` | F3: normalizar las claves con `normalizarTelefono()` (solo dígitos; si tiene 9 dígitos, añadir el prefijo `34`). | 3 |
| `sendTextMessage({ body })` | `server/whatsappPollService.js` (nueva) | `POST ${WHAPI_BASE}/messages/text` con `{ to: WHAPI_TO, body }`. Mismo manejo de errores que `createPollMessage`. Con `WHAPI_MOCK_VOTES` activo, solo escribe en el log y no envía. | 2 |
| `normalizarTelefono(tel)` | nueva (por ejemplo en `whatsappPollService.js`, exportada) | La usan `fetchPollVotes`, el GET de convocatoria (cruce con `players.phone`) y `setMockPlayerPhonesProvider` (`server/index.js:155`). | 3 |
| `getActiveMatchdayId` / `setActiveMatchdayId` | `server/index.js:732-741` | Se eliminan. | 3 |
| `resolverMatchdayActivo` / `crearMatchdayAdHoc` | `server/index.js:840-856` / `:788-830` | Se eliminan. Ya no se crean jornadas a partir del texto del rival (el formulario no lo permite desde la UI, ver diagnóstico 13). | 3 |

Texto del mensaje al grupo (`enviarAlGrupo`):

```
Convocatoria vs {rival} — {fecha larga} {hora}
1. Nombre (dorsal)
2. …
Total: N convocados
```

### 3.5 Lo que se elimina en la fase 3

`GET/PUT /api/next-match` (`:887`, `:900`), `GET /api/next-match/poll` (`:1045`), `GET /api/convocatoria-por-fecha` (`:1200`), las funciones del apartado 3.4 marcadas para eliminar, y la columna `app_state.active_matchday_id`. **`GET /api/next-match/auto` (`:1127`) se mantiene**: decide qué jornada se muestra al abrir la app.

---

## 4. Frontend

### 4.1 `src/api.js`

- `request` (`:7-17`): conservar el `code` del error. Por ejemplo `const err = new Error(data?.error || …); err.code = data?.code; err.status = res.status; throw err`. Lo necesita el panel para distinguir `POLL_EXISTS`, `PARTIDO_JUGADO`, etc.
- Funciones nuevas:
  - `fetchConvocatoria(matchId)` → `GET /matchdays/:id/convocatoria` (`cache: 'no-store'`).
  - `generarInscripcion(matchId, userId, { confirmarReemplazo })` → `POST /matchdays/:id/poll`. **Cambia la firma** de la actual (`:116`).
  - `saveConvocatoria(matchId, { convocados, enviarAlGrupo, confirmarEdicionJugado }, userId)` → `PUT /matchdays/:id/convocatoria`.
  - `reabrirConvocatoria(matchId, userId)` → `PUT /matchdays/:id/convocatoria/reabrir`.
  - `updateMatchday(matchId, { date, time }, userId)` → `PUT /matchdays/:id` (fase 3).
- Se eliminan en la fase 3: `fetchNextMatch` (`:78`), `updateNextMatch` (`:102`), `fetchPollStatus` (`:110`), `fetchConvocatoriaPorFecha` (`:182`). `updateClub` (`:166`) se queda sin uso (ver riesgos).
- `markMatchAsPlayed` (`:88`): aceptar `{ forzar }` y mandarlo en el body.

### 4.2 Nuevo `src/components/ConvocatoriaFinalPanel.jsx` (fase 2)

Props: `{ matchId, jugado, currentUser, onSaved }`. Se muestra dentro del `BottomSheet` existente (`src/components/BottomSheet.jsx`).

- Al montarse llama a `fetchConvocatoria(matchId)`. Mientras carga, muestra un esqueleto; si hay error, un mensaje con botón «Reintentar».
- **Estado local:** `seleccion: Set<playerId>`, que se inicializa con `called` del GET (en `inscripcion` equivale a los que votaron Sí).
- **Secciones**, en este orden:
  1. **Sí**: marcados por defecto.
  2. **Duda**.
  3. **No**.
  4. **Sin voto**: incluye a los jugadores sin teléfono, con la etiqueta «sin teléfono».
  5. (Fase 3) **Votos sin jugador**: solo informativo («3460000… votó Sí y no está en la plantilla»).

  Cada fila tiene avatar (`PlayerAvatar`), nombre, una etiqueta con el voto y una casilla. Cualquier jugador se puede marcar.
- **Pie:** contador «N convocados», casilla **«Enviar lista al grupo»** (desmarcada por defecto) y botón **«Guardar convocatoria final»**. Si ya está cerrada: botón **«Guardar cambios»** y, si no está jugado, **«Reabrir inscripción»**.
- **Tras jugar:** al guardar se muestra `window.confirm('El partido ya está jugado. Cambiar la convocatoria modifica el % de asistencia del ranking. ¿Continuar?')` y se reenvía con `confirmarEdicionJugado: true`.
- Si la respuesta trae `aviso`, se muestra sin cerrar el panel. Si no, se llama a `onSaved(convocatoria)` y se cierra.

### 4.3 `src/components/PlantillaScreen.jsx`

| Zona | Cambio | Fase |
|---|---|---|
| `matchForm` (`:67`) y el input «ID del mensaje de la encuesta (Whapi)» (`:477-481`) | Quitar `whatsappPollId` del estado y el input. | 1 |
| `handleGenerarInscripcion` (`:296-307`) | Llamar a `generarInscripcion(partidoMostrado.matchId, …)`. Si devuelve `POLL_EXISTS`, `confirm('Ya hay una encuesta para esta jornada. Si generas otra, los votos de la anterior dejarán de verse. ¿Continuar?')` y reintentar con `confirmarReemplazo: true`. Después, volver a cargar la convocatoria de la jornada. | 1 |
| Botón «Generar inscripción» (`:494-500`) | `disabled` según `!partidoMostrado?.rival` (no `nextMatch?.rival`). Texto «Regenerar inscripción» si ya hay encuesta. | 1 |
| Bloque Club (`:505-521`), estados `showClubForm`/`clubForm`/`clubSaving`/`clubError` (`:74-77`), `handleSaveClub` (`:309-322`) e import de `updateClub` (`:13`) | **Se eliminan.** Se **mantienen** `club`/`setClub` (`:73`) y `fetchClub` (`:229-236`), porque `NextMatchCard` usa `club?.name` (`:338`). | 2 |
| En el sitio del bloque Club | Botón nuevo (ver 4.4) + `BottomSheet` con `ConvocatoriaFinalPanel matchId={partidoMostrado.matchId}`. Estado nuevo `showConvocatoriaFinal`. Va **fuera** del `{!partidoMostrado?.jugado && …}` (`:458`) para poder editar después de jugado, pero dentro de `{isEntrenador && …}` (`:396`). | 2 |
| `convocatoria`/`convocatoriaConfigured` (`:91-94`) y el efecto con `fetchConvocatoriaPorFecha` (`:188-205`) | Se sustituyen por un único estado `convocatoriaJornada` (la respuesta de `fetchConvocatoria(partidoMostrado.matchId)`), dependiente de `partidoMostrado?.matchId`. Se vuelve a cargar tras generar la inscripción, guardar o reabrir. | 3 |
| Lista de jugadores (`:379-393`) | Si `status === 'cerrada'`: etiqueta «Convocado» o «No convocado» y el voto como información secundaria. Si no: el punto de color del voto, como ahora. | 3 |
| `convocadosDelPartido` (`:212-215`) | Si está `cerrada`, los jugadores con `called`. Si no, los que votaron Sí (como ahora, solo como propuesta). | 2 |
| Formulario de fecha y hora (`:459-492`) | Quitar el input de rival (diagnóstico 13). Guardar con `updateMatchday(partidoMostrado.matchId, …)`. Quitar `nextMatch`/`fetchNextMatch` (`:55`, `:110-122`). | 3 |
| Props `votes`, `pollLoading`, `pollError`, `pollConfigured` (`:42-44`) | Se eliminan (vienen de `useConvocatoria`). | 3 |

### 4.4 Estados del botón nuevo

| Situación de la jornada mostrada | Texto | Estado |
|---|---|---|
| No hay jornada (`!partidoMostrado?.matchId`) | «Crear convocatoria final» | desactivado |
| `sin_encuesta` | «Crear convocatoria final» + texto «Primero genera la inscripción» | desactivado |
| Cargando la convocatoria | «Cargando convocatoria…» | desactivado |
| `inscripcion` | «Crear convocatoria final (N inscritos)» (N = votos Sí) | activo, `btn-primary` |
| `cerrada`, no jugado | «Ver / editar convocatoria final · N convocados» | activo, `btn-outline` |
| `cerrada`, jugado | «Editar convocatoria final · N convocados» | activo, `btn-outline` (con aviso al guardar) |
| Jugado y sin convocatoria (jornadas antiguas) | «Crear convocatoria final» | activo (el backend lo permite con `confirmarEdicionJugado`; requiere `inscripcion`/`cerrada`, ver riesgos 7.5) |

### 4.5 Otros archivos

| Archivo | Cambio | Fase |
|---|---|---|
| `src/components/NextMatchCard.jsx` | Contador (`:140`, `:192-196`): si `cerrada`, «N convocados»; si `inscripcion`, «N inscritos (Sí)»; si `sin_encuesta`, ocultarlo. Recibe `convocatoria` en lugar de `votes` (prop `:51`). | 3 |
| `src/hooks/useConvocatoria.js` | Se elimina. | 3 |
| `src/App.jsx` | Quitar `useConvocatoria` (`:12`, `:37`) y las props de votos que se pasan a `PlantillaScreen` (`:103-106`). | 3 |
| `src/components/StatsScreen.jsx` | No cambia la lógica: `fetchAsistentesConvocatoria` (`:95`) pasa a devolver los `called`. Actualizar el comentario de `:85-89`. Al marcar jugado, gestionar el 409 `CONVOCATORIA_NO_CERRADA` (ofrecer «Crear convocatoria» o «Marcar igualmente», que manda `forzar`). | 2 |
| `src/components/MatchStatsPanel.jsx` | `handleMarcarJugado` (`:66-77`): el mismo manejo del 409. Texto vacío (`:138-140`): «No hay convocados en esta jornada. Crea la convocatoria final desde Plantilla.» | 2 |
| `src/components/AlineacionScreen.jsx` | `convocadosDelPartido` sigue llegando por prop y no cambia. `fetchConvocatoriaHistory` (`:159`) recibe la forma nueva (fase 3). | 3 |
| `src/utils/attendance.js` | `calculateAttendance` cuenta `h.convocados.includes(player.id)` en vez de `h.votes[phone] === 'Si'`. Así coincide con el ranking. | 3 |

---

## 5. Plan por fases

### Fase 1: dejar de perder y mezclar datos (sin cambiar la base de datos)

**Tareas, en orden:**
1. `archivarVotos`: propagar el error de Whapi en lugar de escribir `{}` (`server/index.js:877-885`).
2. `PUT /api/next-match`: ignorar `whatsappPollId` del body (`server/index.js:935`). Conservar siempre el id que ya tiene la jornada.
3. Nuevo `POST /api/matchdays/:id/poll` con `confirmarReemplazo` y 409 `POLL_EXISTS`. Retirar `POST /api/next-match/poll`.
4. `api.js`: `request` con `code`; `generarInscripcion(matchId, …)`.
5. `PlantillaScreen`: quitar el input del id de Whapi; generar con `partidoMostrado.matchId`; pedir confirmación al regenerar; `disabled` según la jornada mostrada.

**Archivos:** `server/index.js`, `src/api.js`, `src/components/PlantillaScreen.jsx`.

**Riesgos:**
- Si Whapi falla al marcar jugado o al cambiar de partido, ahora saldrá un error en lugar de «funcionar» en silencio. El entrenador tendrá que reintentar.
- Una jornada que ya tenga mal asignado el id de encuesta de otra no se arregla sola. Hay que revisarlo con:
  ```sql
  SELECT whatsapp_poll_id, array_agg(id) FROM matchdays
  WHERE whatsapp_poll_id IS NOT NULL GROUP BY 1 HAVING count(*) > 1;
  ```

**Cómo probarla:**
- Con `WHAPI_MOCK_VOTES=all-si npm run dev:full`: generar la inscripción en la jornada que se ve en pantalla (no en la activa) y comprobar en Supabase que `whatsapp_poll_id` cae en el `matchId` correcto.
- Generar dos veces: debe pedir confirmación.
- Sin mock, con `WHAPI_TOKEN` inválido: marcar jugado una jornada con encuesta debe dar error y **no** cambiar `call_ups` (comparar `SELECT * FROM call_ups WHERE matchday_id = X` antes y después).
  - Ojo: el mock ignora `WHAPI_TOKEN`, así que el caso de fallo hay que probarlo **sin** `WHAPI_MOCK_VOTES`.
- Navegar a otra jornada, guardar fecha y hora: la jornada nueva no hereda el id de la encuesta.

### Fase 2: estado de la convocatoria y convocatoria final

**Tareas, en orden:**
1. Copia de seguridad (2.1).
2. Migración de esquema (2.2) y de datos (2.3); redefinir la vista (2.4); actualizar `los_huevos_fc_schema.sql`.
3. Backend: `GET` y `PUT /api/matchdays/:id/convocatoria`, `/reabrir`, `guardarConvocatoriaFinal`, `sendTextMessage`.
4. Backend: `/api/call-ups` por `called`; `contarAsistenciasPorJugador` por `called`; `jugado` sin archivar y con 409; quitar `archivarVotos` de `PUT /api/next-match`; poll con cambio de `callup_status`.
5. Frontend: `api.js` (nuevas funciones y `forzar`), `ConvocatoriaFinalPanel.jsx`, sustituir el bloque Club en `PlantillaScreen`, `convocadosDelPartido`, manejo del 409 en `StatsScreen` y `MatchStatsPanel`.

**Archivos:** `server/los_huevos_fc_schema.sql`, `server/index.js`, `server/whatsappPollService.js`, `src/api.js`, `src/components/ConvocatoriaFinalPanel.jsx` (nuevo), `src/components/PlantillaScreen.jsx`, `src/components/StatsScreen.jsx`, `src/components/MatchStatsPanel.jsx`.

**Riesgos:**
- La migración cambia el significado de `called` y vacía `attended`. Por eso hace falta la copia de seguridad.
- El % de asistencia histórico cambia (ver 7.2).
- Backend y frontend deben desplegarse juntos: un frontend antiguo llamaría a endpoints que ya no existen.
- `server/migrate-to-supabase.mjs:486-487` sigue escribiendo con el criterio antiguo (`called: true`, `attended` = voto). No debe volver a ejecutarse contra la base migrada, o hay que adaptarlo.

**Cómo probarla:**
- Primero en una rama de Supabase o en un proyecto de pruebas: aplicar 2.2 y 2.3 y ejecutar las consultas de verificación.
- `WHAPI_MOCK_VOTES=./votos.json` con una mezcla de Sí, No y Duda, más un teléfono que no esté en la plantilla. Abrir el panel y comprobar el orden de las secciones y que los Sí vienen marcados.
- Desmarcar un Sí, marcar un No y guardar: en `call_ups`, `called` refleja la selección y `vote` el voto original.
- Ir a Estadísticas, anotar estadísticas: solo aparecen los convocados. En Alineación, igual.
- El ranking y el perfil cambian su % según `called`.
- Reabrir, cambiar y cerrar otra vez: se sobrescribe sin duplicados.
- Marcar jugado con la convocatoria abierta: 409 y opción de forzar.
- Editar después de jugado: aparece el aviso y se guarda.
- «Enviar lista al grupo» con el mock: solo sale en el log. Sin mock, en un grupo de pruebas (`WHAPI_TO`).

### Fase 3: una sola fuente de datos y limpieza

**Tareas, en orden:**
1. `normalizarTelefono` y su uso en `fetchPollVotes`, el GET de convocatoria y el proveedor del mock.
2. `votosSinJugador` y `jugadoresSinTelefono` en el GET y en el panel.
3. `PlantillaScreen`, `NextMatchCard` y la lista de jugadores leen todo de `fetchConvocatoria(partidoMostrado.matchId)`.
4. `convocatoria-history` con la forma nueva y `calculateAttendance` con `convocados`.
5. `PUT /api/matchdays/:id` para fecha y hora; formulario sin rival.
6. Eliminar `useConvocatoria`, `GET/PUT /api/next-match`, `GET /api/next-match/poll`, `/api/convocatoria-por-fecha`, las funciones del partido activo y (opcional) la columna `active_matchday_id`.

**Archivos:** `server/index.js`, `server/whatsappPollService.js`, `src/api.js`, `src/App.jsx`, `src/hooks/useConvocatoria.js` (se borra), `src/components/PlantillaScreen.jsx`, `src/components/NextMatchCard.jsx`, `src/components/AlineacionScreen.jsx`, `src/utils/attendance.js`, `server/los_huevos_fc_schema.sql`.

**Riesgos:**
- Es la fase que más código elimina. Antes de borrar cada endpoint, hacer `grep -rn "<función>" src server` para confirmar que nada lo usa.
- Normalizar teléfonos puede hacer aparecer votos que antes se perdían. Es lo esperado, pero cambia lo que se ve en jornadas abiertas.

**Cómo probarla:**
- La tarjeta, la lista y el panel muestran las mismas cifras al navegar entre jornadas.
- Una jornada cerrada no cambia aunque cambien los votos del mock (editar `votos.json`).
- Un jugador con el teléfono guardado como `+34 600…` aparece con su voto.
- Un número desconocido aparece en «Votos sin jugador».
- Alineación ordena por % de asistencia igual que el ranking.
- Recargar la app: abre en la jornada de `/api/next-match/auto`.

---

## 6. Problemas del diagnóstico resueltos por fase

| # | Problema | F1 | F2 | F3 |
|---|---|:-:|:-:|:-:|
| 1 | Una copia de votos puede borrar datos (error de Whapi tragado) | ✔ (error en vez de `{}`) | ✔ (las convocatorias cerradas no se sobrescriben; las copias sin avisar desaparecen) | |
| 2 | Una jornada hereda la encuesta de otra | ✔ | | |
| 3 | «Generar inscripción» usa el partido activo | ✔ | | |
| 4 | Regenerar la encuesta sin avisar | ✔ | | |
| 5 | El contador y la lista no coinciden | | | ✔ |
| 6 | Plantilla lee de Whapi tras el cierre | | parcial (Stats y Alineación usan `called`) | ✔ |
| 7 | El partido jugado sigue activo y se vuelve a copiar | | ✔ (ya no se copia) | ✔ (el partido activo desaparece) |
| 8 | Búsqueda por fecha (dos partidos el mismo día) | | | ✔ |
| 9 | No hay estado de convocatoria | | ✔ | |
| 10 | `attended` guarda el voto | | ✔ | |
| 11 | El entrenador no puede corregir la convocatoria | | ✔ | |
| 12 | Votos cruzados por teléfono | | parcial (sin teléfono visible en el panel) | ✔ |
| 13 | El campo rival no sirve / jornadas creadas a mano | | | ✔ |

---

## 7. Riesgos y consecuencias

1. **Se pierde el botón de Club.** Ya no se podrá cambiar el nombre del club desde la app. `GET /api/club` (`server/index.js:1717`) se sigue usando (`NextMatchCard`, `StatsScreen:55`, `MarcadorScreen:56`). `PUT /api/club` (`:1723`) y `updateClub` (`src/api.js:166`) quedan sin uso. Si hace falta, se cambia en Supabase (`UPDATE clubs SET name = … WHERE is_own`) o más adelante se lleva a otra pantalla.
2. **Cambia el % de asistencia histórico.**
   - Hoy el ranking cuenta `attended = true` (votó Sí). Tras la migración cuenta `called`, que para el histórico es igual (`called = attended IS TRUE`), así que **el % del ranking no debería cambiar el día de la migración**.
   - Sí cambia en `AlineacionScreen` (`calculateAttendance`), que hoy divide entre las convocatorias guardadas y pasará a dividir entre las jornadas jugadas.
   - Y cambiará cada vez que el entrenador edite una convocatoria pasada.
   - Antes de migrar, guardar una captura o un export del ranking para poder comparar.
3. **Duda y sin voto no se distinguen en el histórico.** Los dos se guardaban como `NULL`, así que `vote` queda `NULL` en ambos casos.
4. **Las jornadas jugadas sin convocatoria** se quedan sin convocados en Estadísticas y Alineación hasta que el entrenador cree su convocatoria. Hay que listarlas con la consulta de 2.3.
5. **Jornadas jugadas en `sin_encuesta`.** `PUT /convocatoria` exige `inscripcion` o `cerrada`. Para poder crear la convocatoria de una jornada antigua sin encuesta hay dos opciones: (a) permitir `sin_encuesta` cuando el partido está jugado y llega `confirmarEdicionJugado` (todos con `vote = NULL`), o (b) pasarlas a `inscripcion` en la migración. **Recomendación: (a).**
6. **Despliegue coordinado.** En las fases 2 y 3 hay que desplegar a la vez backend (servidor Express) y frontend (Vercel). Con un frontend antiguo en caché, la PWA (`dev-dist`) puede llamar a endpoints eliminados: conviene forzar la actualización del service worker.
7. **Whapi.**
   - Más llamadas de envío (`sendTextMessage`): revisar los límites del plan.
   - El texto `/messages/text` hay que comprobarlo contra la documentación actual de Whapi.
   - La encuesta de WhatsApp sigue abierta tras el cierre: los votos tardíos no cuentan y solo se ven en el estado `inscripcion`.
8. **`server/migrate-to-supabase.mjs`** queda desalineado con el nuevo significado de `call_ups` (`:486-487`). No debe volver a ejecutarse sin adaptarlo.
9. **Mock en producción.** `isMockVotesActive` ya se desactiva con `NODE_ENV=production` (`server/whatsappPollService.js:18`). Hay que comprobar que el servidor de producción lo define.

---

## 8. Checklist final de pruebas manuales

**Preparación**
- [ ] Copia de seguridad hecha y verificada (recuentos iguales).
- [ ] Export o captura del ranking y de los perfiles antes de migrar.
- [ ] Migración aplicada; consultas de verificación revisadas.
- [ ] `WHAPI_MOCK_VOTES=./votos.json` con Sí, No, Duda, un teléfono desconocido y un jugador sin voto.

**Inscripción**
- [ ] Como jugador (no entrenador): no se ven ni «Generar inscripción» ni «Crear convocatoria final».
- [ ] Como entrenador: navegar a una jornada distinta de la próxima y generar la inscripción. El `whatsapp_poll_id` queda en esa jornada.
- [ ] Regenerar: pide confirmación; al cancelar no cambia nada.
- [ ] El estado pasa a `inscripcion`; el botón dice «Crear convocatoria final (N inscritos)».
- [ ] La tarjeta muestra «N inscritos» y la lista los puntos de voto; todo coincide.

**Convocatoria final**
- [ ] Panel: Sí arriba y marcados; Duda, No y sin voto debajo y sin marcar; sin teléfono marcado como tal; votos sin jugador listados.
- [ ] Desmarcar un Sí y añadir un No y un sin voto. Guardar.
- [ ] `call_ups`: `called` según la selección, `vote` según la encuesta, `attended` en `NULL`.
- [ ] El estado pasa a `cerrada` con `callup_closed_at` y `callup_closed_by`.
- [ ] El botón dice «Ver / editar convocatoria final · N convocados»; la lista muestra Convocado / No convocado.
- [ ] Cambiar votos en `votos.json`: la jornada cerrada no cambia.
- [ ] «Enviar lista al grupo»: con el mock solo aparece en el log; sin mock, llega al grupo de pruebas; si falla, aparece el aviso y la convocatoria queda guardada igualmente.
- [ ] Reabrir: vuelve a `inscripcion` sin perder filas; cerrar de nuevo sin duplicados.

**Partido jugado**
- [ ] Marcar jugado con la convocatoria en `inscripcion`: aviso 409 con las opciones «Crear convocatoria» / «Marcar igualmente».
- [ ] Marcar jugado con la convocatoria cerrada: funciona y `call_ups` no cambia.
- [ ] Anotar estadísticas: solo aparecen los convocados.
- [ ] Alineación: solo aparecen los convocados.
- [ ] Editar la convocatoria después de jugado: aparece el aviso; quitar a un convocado; su % baja en ranking y perfil.
- [ ] «Reabrir» no aparece en una jornada jugada.
- [ ] Desmarcar como jugado: la convocatoria sigue `cerrada`.

**Robustez**
- [ ] Sin mock y con `WHAPI_TOKEN` inválido: abrir el panel en `inscripcion` muestra el error y no propone convocados; guardar devuelve 502 y no escribe nada.
- [ ] Jornada antigua jugada sin convocatoria: se puede crear su convocatoria (con aviso).
- [ ] Recargar la app: abre en la próxima jornada por fecha; las cifras coinciden entre tarjeta, lista y panel.
- [ ] Ranking: % = convocado / jugadas por el equipo; votar Sí sin ser convocado no suma.
- [ ] El nombre del club sigue apareciendo en la tarjeta, en Estadísticas y en Marcador.
