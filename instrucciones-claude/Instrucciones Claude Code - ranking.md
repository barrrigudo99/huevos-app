# Tarea: sustituir `scorers-card` por el ranking de plantilla

En `StatsScreen.jsx` la sección "Máximos goleadores" es una lista plana de goleadores (`.scorers-card` / `.scorer-row`). Hay que sustituirla por una tabla-ranking de toda la plantilla con goles, asistencias, % de convocatorias asistidas, MVPs y valoración media, ordenable y con detalle desplegable por jugador.

El componente ya está diseñado y escrito: **`TeamRankingCard.jsx`** (adjunto). No lo rediseñes; solo colócalo y aliméntalo.

## 1. Colocar el componente

- Copia `TeamRankingCard.jsx` a `src/components/` (usa `PlayerAvatar` del mismo directorio, ajusta el import si tu ruta difiere).
- En `StatsScreen.jsx`, sustituye **todo** el bloque:

```jsx
<div>
  <p className="stats-section-title">Máximos goleadores</p>
  {scorers.length === 0 ? ( ... ) : ( <div className="scorers-card"> ... </div> )}
</div>
```

por:

```jsx
<div>
  <TeamRankingCard rows={ranking} />
</div>
```

El título va dentro del componente, así que no dejes el `<p className="stats-section-title">` duplicado fuera. Elimina también la variable `scorers` si ya no se usa en ningún otro sitio.

## 2. Endpoint nuevo: `GET /api/stats/ranking?season=`

Por defecto, la temporada con `seasons.is_current = true`. Una fila por jugador activo de la plantilla de esa temporada.

Esquema real (verificado en Supabase, proyecto `huevos-supabase`):

- Vista `season_player_stats(player_id, full_name, season_id, matches_played, total_minutes, total_goals, total_assists, total_yellow_cards, total_red_cards, avg_impacto, avg_esfuerzo, avg_equipo, avg_liderazgo)`
- Vista `season_call_up_attendance(player_id, full_name, season_id, times_called, times_attended, attendance_pct)`
- `match_mvp_votes(id, match_id, rater_user_id, player_id, created_at)` — **son votos, no ganadores**: el MVP de un partido es el jugador más votado en ese `match_id`.
- `players(id, full_name, photo_url, active)`, `player_season_roster(player_id, season_id, dorsal_number)`

```sql
WITH mvp AS (
  SELECT DISTINCT ON (match_id) match_id, player_id
  FROM (
    SELECT match_id, player_id, COUNT(*) AS votos
    FROM match_mvp_votes
    GROUP BY match_id, player_id
  ) t
  ORDER BY match_id, votos DESC
),
mvp_count AS (
  SELECT player_id, COUNT(*) AS mvps FROM mvp GROUP BY player_id
)
SELECT p.id                                   AS "id",
       p.full_name                            AS "name",
       p.photo_url                            AS "photo",
       COALESCE(sps.total_goals, 0)::int      AS "goals",
       COALESCE(sps.total_assists, 0)::int    AS "assists",
       sca.attendance_pct                     AS "attendancePct",
       COALESCE(mc.mvps, 0)::int              AS "mvps",
       CASE WHEN sps.avg_impacto IS NULL THEN NULL
            ELSE ROUND((sps.avg_impacto + sps.avg_esfuerzo
                      + sps.avg_equipo  + sps.avg_liderazgo) / 4, 2)
       END                                    AS "rating"
FROM players p
JOIN player_season_roster psr ON psr.player_id = p.id AND psr.season_id = $1
LEFT JOIN season_player_stats sps       ON sps.player_id = p.id AND sps.season_id = $1
LEFT JOIN season_call_up_attendance sca ON sca.player_id = p.id AND sca.season_id = $1
LEFT JOIN mvp_count mc                  ON mc.player_id = p.id
WHERE p.active
ORDER BY "rating" DESC NULLS LAST;
```

Nota: `mvp_count` cuenta MVPs de **todas** las temporadas. Si quieres acotarlo, une `matches → matchdays` y filtra por `md.season_id`.

Si el servidor no ejecuta SQL crudo y va por `supabase.from(...)`, replica la misma semántica en JS: lee las dos vistas, agrupa `match_mvp_votes` por `match_id` quedándote con el más votado, y cuenta por jugador.

## 3. Cableado en el front

- `src/api.js`: `export function fetchRanking(season) { /* GET /api/stats/ranking */ }`
- `StatsScreen.jsx`: cárgalo en el `Promise.all` del `useEffect` inicial, junto a `fetchCalendario/fetchClub/fetchEstadisticasPersonales`, y guárdalo en un estado `ranking` (array vacío por defecto).
- Si la petición falla, `ranking` se queda vacío: el componente ya pinta "Todavía no hay estadísticas registradas." y el resto de la pantalla sigue funcionando. No bloquees el render por esto.

## 4. Lo que NO hay que tocar

- La rejilla de métricas de arriba (Goles / Tarjetas) se queda como está.
- `HistorialJornadas`, `MatchStatsPanel`, `MatchResultPanel`, `AlineacionScreen` y los dos `BottomSheet`: intactos.
- Nada de rediseñar el componente nuevo: colores, tamaños y comportamiento del desplegable vienen ya decididos.

## 5. Limpieza

Si `.scorers-card`, `.scorer-row`, `.scorer-name` y `.scorer-goals` no se usan en ninguna otra pantalla, bórralas de `styles.css`. Compruébalo con un grep antes.

## 6. Terminado cuando

- La sección muestra la plantilla completa ordenada por valoración; los chips reordenan y el chip activo se ve en dorado.
- Tocar una fila despliega Goles / Asist. / Conv. / MVP / Val. y tocarla otra vez la cierra; solo una fila abierta a la vez.
- Un jugador sin votos muestra `—` en Val., no `0,00` ni `NaN`.
- `vite build` sin warnings nuevos.
