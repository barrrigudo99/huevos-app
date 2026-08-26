# Informe: dónde y cómo se guarda la información de Huevos FC

Fecha del análisis: 2026-08-25. Alcance: solo inspección del código y los datos tal como están hoy en el repositorio local (`~/programacion-barri/huevos_fc/huevos-app`) y en `origin` (GitHub). No se ha modificado ningún archivo de código para este informe.

## Resumen rápido

Toda la app (jugadores, usuarios, calendario, convocatorias, estadísticas) se guarda en **archivos JSON planos leídos y escritos con `fs.readFile`/`fs.writeFile`**, repartidos entre `server/` y `simulador/`. Hay una base de datos SQLite (`server/futbol7.db`) con un esquema completo ya creado, pero **no la usa ni la lee nadie** — es un intento de migración aparcado. El hallazgo más urgente no es de arquitectura sino de seguridad: **`server/db.json`, con emails y contraseñas en texto plano de los 19 usuarios, está commiteado en un repositorio de GitHub público**, y hay un segundo archivo (`server/db_simulator.json`) con la misma clase de datos que además **se sirve entero por una API sin autenticación** (`GET /api/league`).

---

## 1. Inventario de almacenamiento

### `server/` — estado de la app (jugadores, usuarios, convocatorias)

| Archivo | Contenido | Acceso | ¿En uso real? |
|---|---|---|---|
| `db.json` | `players` (19, con teléfono), `users` (19, con email + **contraseña en texto plano**), `club` (nombre del club). Antes también tenía `nextMatch`/`convocatoriaHistory`; se migraron a `db_convocatorias_aut.json` en esta sesión. `matchEvents` (goles/asistencias/tarjetas por partido) vive aquí pero hoy está vacío — nadie lo ha usado todavía. | `fs.readFile`/`writeFile`, archivo completo en cada lectura y escritura | **Sí**, es el almacén principal: jugadores, login/registro, club, sucesos de partido. |
| `db_convocatorias_aut.json` | Array con un registro por partido (`matchId`, `rival`, `date`, `whatsappPollId`, `generatedAt`/`updatedAt`, snapshot de `votes`, y los arrays `convocados`/`duda`/`descartados`/`sinResponder`, hoy vacíos porque todavía no hay ningún proceso que los rellene). | `fs.readFile`/`writeFile` | **Sí**, añadido en esta misma sesión de trabajo; sustituye al viejo `nextMatch`/`convocatoriaHistory` de `db.json`. Todavía **no está en git** (archivo nuevo, sin `git add`). |
| `db_simulator.json` | Copia de semilla con `players` (19, con teléfono), `users` (19, con email+contraseña), `nextMatch`, `club`, `matchEvents`, `convocatoriaHistory` — prácticamente un duplicado antiguo de `db.json` — más los metadatos fijos de la liga simulada (temporada, formato, `total_jornadas`). | `fs.readFile` (solo lectura, vía `readSimDb()`) | **Parcialmente.** Solo se usan sus metadatos de liga; `players`/`users`/`nextMatch`/etc. son restos sin uso previsto — pero **sí se leen y se sirven igualmente** (ver riesgo en la sección 3, es un hallazgo serio). |
| `futbol7.db` + `futbol7.db-shm` + `futbol7.db-wal` | Base de datos SQLite con un esquema completo (`club`, `equipos`, `posiciones`, `jugadores`, `jugador_posiciones`, `partidos`, `convocatorias`, `votos`, `eventos_partido`, índices) creado por `crear_tablas.mjs` (raíz del proyecto). Solo tiene precargadas las 5 posiciones (POR/LAT/CEN/VOL/DEL); ninguna otra tabla tiene filas. | `better-sqlite3` | **No.** `server/index.js` no importa `better-sqlite3` ni abre este archivo en ningún punto — confirmado por grep sobre todo el código del servidor. Es un intento de migración a SQLite que se aparcó tras crear el esquema, antes de conectarlo al backend. El `.wal` está vacío (0 bytes), lo que además confirma que nadie ha escrito en la base desde que se creó. |

### `simulador/` — datos "de partido" (calendario, resultados, estadísticas)

| Archivo | Contenido | Acceso | ¿En uso real? |
|---|---|---|---|
| `1_equipos.json` | Los 12 equipos de la liga simulada (id + nombre), incluido "LOS HUEVOS FC" como equipo id 1 (el club real). | `fs.readFile`, solo lectura | Sí — de aquí sale el nombre exacto que usa el resto del código para reconocer "nuestros" partidos. |
| `2_calendario.json` | Las 22 jornadas de la temporada: `id`, `jornada`, `fecha`, `equipo_local`, `equipo_visitante`, `resultado`, `ganador`, `jugado`. | `fs.readFile` para lectura; `fs.writeFile` cuando el entrenador marca un partido como jugado (`PUT /api/calendario/:matchId/jugado`) | Sí, es la fuente de verdad del calendario y del "próximo partido automático". |
| `3_convocatorias.json` | Convocatorias simuladas (votos "Sí"/"No" de ejemplo) por fecha/`whatsappPollId`. Hoy está vacío (`[]`). | `fs.readFile`, solo lectura | Solo si `USAR_CONVOCATORIA_SIMULADA = true` en `server/index.js` (hoy está en `false`, así que no se lee en ningún endpoint real). |
| `4_tendencias_asistencia.json` | Archivo vacío (`{}`). | — | No, ningún endpoint ni componente lo lee (confirmado por grep). Resto sin usar. |
| `resultados.json` | Resultados simulados de todos los partidos de la liga (`[]` hoy, vacío). | `fs.readFile`, solo lectura, vía `readSimDb()` | Sí, alimenta la clasificación de la pestaña Marcador — pero como está vacío, esa clasificación hoy no tiene partidos jugados que contar. |
| `estadisticas_personales.json` | Detalle jugador a jugador (goles, asistencias, amarillas, roja) de cada partido con estadísticas registradas por el entrenador, más `jornada`/`rival`/`fecha`/`esLocal`/`resultado` del propio partido. Hoy tiene 1 partido registrado. | `fs.readFile`/`writeFile` | Sí, es el archivo que rellena `MatchStatsPanel`/`MatchResultPanel` y el perfil de jugador. |
| `-1generador_de_calendario.mjs`, `-2generador_de_convocatoria_desde_calendario.mjs`, `-3generador_de_partidos.mjs`, `-4generador_de_resultados.mjs` | Scripts de un solo uso para generar los JSON de arriba (no forman parte del servidor en marcha). | — | Herramientas de desarrollo, no de producción. |

**Resumen del patrón**: no hay ninguna base de datos real en funcionamiento. Todo pasa por `fs.readFile`/`fs.writeFile` sobre 8 archivos JSON distintos (contando `db.json` y `db_convocatorias_aut.json` como los dos "vivos" de `server/`, más los 6 de `simulador/`), cada uno leído/escrito entero en cada petición que lo toca. `futbol7.db` es la única base de datos de verdad del proyecto y está completamente desconectada del código que corre hoy.

---

## 2. Cómo se accede a esos datos

Todos los endpoints viven en `server/index.js`. Los que escriben están protegidos con `requireEntrenador()` (exige la cabecera `X-User-Id` de un usuario con rol `entrenador`, comprobado leyendo `db.json` en cada petición — no hay tokens ni sesión real).

**Jugadores** (`db.json` → `players`)
- `GET /api/players` — lista completa.
- `POST /api/players` — añade un jugador (solo entrenador).

**Usuarios / autenticación** (`db.json` → `users`)
- `POST /api/register` — crea un usuario nuevo (público, sin rol requerido); comprueba email duplicado leyendo todo `db.json`.
- `POST /api/login` — compara email + contraseña en texto plano contra `db.json`.

**Club** (`db.json` → `club`)
- `GET /api/club` — nombre del club.
- `PUT /api/club` — lo actualiza (solo entrenador).

**Sucesos de partido** (`db.json` → `matchEvents`)
- `GET /api/match-events` — todos los sucesos, indexados por id de partido.
- `POST /api/match-events/:matchId` — añade un suceso (gol/asistencia/tarjeta) a un jugador (solo entrenador).
- `DELETE /api/match-events/:matchId/:eventId` — lo borra (solo entrenador).

**Próximo partido / convocatoria por WhatsApp** (`server/db_convocatorias_aut.json`)
- `GET /api/next-match` — el registro con `updatedAt` más reciente ("partido activo").
- `PUT /api/next-match` — configura rival/fecha a mano (solo entrenador); si cambia de partido, archiva un snapshot de votos del anterior.
- `POST /api/next-match/poll` — crea de verdad la encuesta de WhatsApp vía Whapi.Cloud y guarda su `whatsappPollId` (solo entrenador; deshabilitado si `USAR_CONVOCATORIA_SIMULADA=true`).
- `GET /api/next-match/poll` — consulta en vivo (sin caché) los votos de la encuesta activa, vía Whapi.Cloud.
- `GET /api/convocatoria-history` — todos los registros salvo el activo (el "historial").
- `GET /api/convocatoria-por-fecha?fecha=...` — votos de un partido concreto por fecha, vía Whapi.Cloud.

**Calendario y estadísticas** (`simulador/*.json`)
- `GET /api/calendario` — calendario completo.
- `GET /api/next-match/auto` — próximo partido calculado por fecha (sin depender de configuración manual).
- `PUT /api/calendario/:matchId/jugado` — marca un partido como jugado (solo entrenador).
- `GET /api/league` — liga simulada (equipos + resultados) — **ver riesgo abajo**.
- `GET /api/player-match-stats` — estadísticas agregadas por jugador.
- `GET /api/estadisticas-personales` — detalle partido a partido.
- `PUT /api/estadisticas-personales/:matchId` — guarda estadísticas de jugadores de un partido (solo entrenador).
- `PUT /api/estadisticas-personales/:matchId/resultado` — guarda el marcador final (solo entrenador).

---

## 3. Riesgos actuales

### Concurrencia — sin bloqueo, riesgo real de pérdida de datos

`readDb()`/`writeDb()` no usan ningún lock. El patrón en **todos** los endpoints de escritura es: leer el archivo entero → modificar el objeto en memoria → escribir el archivo entero (`JSON.stringify` completo, sin escritura atómica ni fsync). Si dos peticiones que tocan `db.json` se solapan (por ejemplo, el entrenador guarda el club justo cuando otro usuario se registra), es un caso clásico de **"lost update"**: la segunda escritura que termine pisa por completo lo que hubiera escrito la primera, porque cada una parte de su propia copia en memoria leída antes de que la otra escribiera. Con 14-16 usuarios y peticiones humanas (no simultáneas al segundo), la probabilidad de colisión es baja hoy, pero **existe** y no hay ningún mecanismo — ni de lock de archivo, ni de cola de escritura, ni de reintento — que la evite. `writeFile` tampoco escribe en un archivo temporal + rename atómico: escribe directamente sobre `db.json`, así que una escritura que se corte a medias deja el archivo tal cual quedó.

### Tamaño y rendimiento — sobra de margen para este volumen, pero ya no escala en limpio

Con 19 jugadores/usuarios y `db.json` en ~6 KB, leer y volver a escribir el archivo entero en cada petición (incluida la lectura de autenticación en `requireEntrenador()`, que hace su propio `readDb()` aparte) es irrelevante en tiempo de proceso — estamos hablando de microsegundos. **No hay ninguna señal de que el tamaño actual sea un problema de rendimiento.** El problema es otro: cada escritura reescribe TODO el archivo aunque el cambio sea añadir un solo suceso a `matchEvents`, lo cual es ineficiente en términos de diseño (no de rendimiento medible a este tamaño) y es precisamente lo que hace más doloroso el riesgo de concurrencia de arriba. Para 14-16 usuarios activos, con uso esporádico (una vez por semana, un partido), este patrón aguanta sin problema real.

### Durabilidad — sin backups, sin escritura atómica, sin versionado más allá de git

- Si el proceso de Node muere a mitad de un `writeFile`, `db.json` puede quedar con JSON incompleto/corrupto — la siguiente petición que haga `JSON.parse` sobre él tumbaría el endpoint (o el servidor entero, según el caso, porque no hay try/catch alrededor de esos `JSON.parse`).
- No hay ninguna copia de seguridad automática ni rotación de versiones de los archivos JSON. El único "historial" es git, y solo para lo que esté commiteado — los datos reales del día a día (votos nuevos, jugadores añadidos, club actualizado) se pisan en el propio archivo de trabajo sin dejar rastro de la versión anterior salvo que alguien haga `git commit` a mano después de cada cambio, cosa que aquí no ocurre (ver el `git status` de la sección siguiente).

### Secretos — hallazgo confirmado y serio

- **Confirmado**: las contraseñas de `users` en `db.json` están en texto plano (`"password": "123456"`), sin hash ni salt. La comparación en `POST /api/login` es un `===` directo.
- **`server/db.json` está commiteado en git y el repositorio remoto (`github.com/barrrigudo99/huevos-app`) es PÚBLICO.** El commit ya subido (`HEAD`) tiene los 19 emails reales y la contraseña `123456` para todos ellos, en texto plano, visible para cualquiera en GitHub ahora mismo. Además, en el árbol de trabajo local hay cambios sin commitear a `db.json` con teléfonos reales de más jugadores (en `HEAD` la mayoría de teléfonos ya estaban anonimizados con `346000000XX`, pero el archivo local actual los tiene reales) — si en algún momento se hace `git add -A && git commit && git push`, esos teléfonos reales también quedarían públicos.
- **`server/db_simulator.json` (también público en el repo) tiene la misma clase de datos duplicados** (`players` con teléfono, `users` con email+contraseña) — y este archivo, a diferencia de `db.json`, **se sirve completo por una API sin ninguna autenticación**: `GET /api/league` hace `{ ...meta, equipos, partidos, jornadas_simuladas }`, y como `meta` es "todo lo que no sea `partidos`/`equipos`" del archivo, ahí se cuelan `players`, `users` (con contraseñas), `nextMatch`, `matchEvents` y `convocatoriaHistory` enteros. Lo he verificado en vivo: una petición `GET /api/league` sin ninguna cabecera devuelve el array `users` completo con emails y contraseñas en texto plano. Esto es un hallazgo de API tanto como de almacenamiento, pero nace directamente de tener datos sensibles duplicados en un archivo que no debería servirse tal cual.
- `.env` (con `WHAPI_TOKEN` y `WHAPI_TO`) **sí está correctamente en `.gitignore`** y no está trackeado — ese secreto en concreto está bien gestionado.
- No hay tokens ni contraseñas hardcodeadas dentro del código JS/JSX versionado (comprobado por grep); todo lo sensible en código pasa por `process.env`.

---

## 4. Qué implica alojarlo fuera de mi máquina

Hoy `db.json`, `db_convocatorias_aut.json` y todo `simulador/*.json` viven como archivos sueltos en el disco de tu WSL local. Si este mismo backend (Express + lectura/escritura de JSON) se despliega tal cual en un servidor remoto, lo primero que cambia es **dónde vive ese disco**, y de eso depende todo lo demás:

- **Si el hosting reinicia el contenedor/máquina y el disco no es persistente** (el caso por defecto en muchas plataformas "serverless" o de contenedores efímeros: cada deploy o reinicio parte de la imagen limpia), **los JSON se resetean a lo que haya en la imagen/commit**, perdiendo cualquier cambio hecho en producción desde el último deploy. Esto es válido incluso sin caídas: un simple redeploy (subir un cambio de código) puede bastar para perder datos si el disco no está marcado explícitamente como persistente.
- **Si el hosting sí ofrece disco persistente** (un volumen que sobrevive a reinicios y redeploys), el mismo patrón de archivos JSON puede seguir funcionando, pero sigue arrastrando los mismos riesgos de la sección 3 (sin backups automáticos, sin lock de concurrencia) — solo que ahora además dependes de que ese volumen en concreto no se pierda nunca, sin tener ninguna copia aparte.

En términos de categorías de opción, sin entrar en proveedores concretos:

1. **VPS/contenedor con disco persistente barato** (el tipo de opción más simple y más parecida a lo que tienes en WSL: sigues con archivos JSON, solo que ahora en un servidor remoto con volumen persistente). Encaja bien si quieres cambiar lo mínimo posible del código actual. El trade-off es que sigues sin backups automáticos ni protección de concurrencia — hay que añadirlos tú (por ejemplo, un cron que copie los JSON a otro sitio cada cierto tiempo).
2. **Migrar a una base de datos gestionada** (un servicio de base de datos como servicio, separado del propio backend). Requiere reescribir la capa de acceso a datos (`readDb`/`writeDb` y equivalentes) para hablar con esa base en vez de con archivos, pero a cambio obtienes de fábrica backups automáticos, algo de control de concurrencia real, y que los datos sobrevivan a cualquier reinicio/redeploy del servidor sin que dependan del mismo disco.

La diferencia real entre las dos categorías no es "cuál escala más" (con 14-16 usuarios ninguna de las dos tiene problema de escala), sino **quién se hace cargo de la durabilidad**: con JSON plano, eres tú quien tiene que montar backups y cuidar el disco persistente a mano; con una base de datos gestionada, buena parte de eso viene incluido.

---

## 5. Recomendación

Para el tamaño real de este proyecto (14-16 personas, uso esporádico, sin previsión de crecer a cientos de usuarios simultáneos), **no hace falta migrar a una base de datos de verdad todavía**. El cuello de botella no es de rendimiento ni de volumen — es de cuidado operativo. `futbol7.db`/SQLite ya tiene el esquema listo y sería una migración con menos fricción que otras (la dependencia `better-sqlite3` ya está instalada, y `crear_tablas.mjs` ya modela casi todo lo que hoy vive en JSON), así que si en algún momento el equipo crece o empieza a doler la falta de transacciones/backups, esa migración ya tiene medio camino hecho — pero no es urgente hoy.

Lo que sí es urgente, y no tiene que ver con dónde alojes el servidor sino con arreglar antes de mover nada:

1. **Sacar `server/db.json` y `server/db_simulator.json` de git ahora mismo** (o al menos reescribir las contraseñas/teléfonos reales antes de cualquier próximo commit) — ese repo es público y ya hay un email+contraseña real filtrado en el historial. Nota: quitarlos de `HEAD` no borra el historial anterior de git; si te preocupa lo ya subido, habría que reescribir historial o rotar esas contraseñas.
2. **Cerrar la fuga de `GET /api/league`**: que no devuelva `players`/`users`/`matchEvents`/`nextMatch`/`convocatoriaHistory` de `db_simulator.json`, solo `equipos`/`partidos`/metadatos de liga.
3. **Hashear las contraseñas** (aunque sea con algo simple tipo bcrypt) antes de que este backend salga de tu máquina — hoy cualquiera con acceso al archivo (o, mientras exista el punto 2, a la API) tiene la contraseña real de los 19 usuarios en texto plano.
4. Ya alojado donde sea, **backups periódicos de los JSON** (un cron simple que copie `server/*.json` y `simulador/*.json` a otro sitio cada día) son perfectamente suficientes como red de seguridad para este volumen — no hace falta más que eso.

En resumen: el JSON plano aguanta de sobra el volumen de este equipo: el riesgo real no es de escala, es de que ahora mismo hay contraseñas y teléfonos reales en texto plano en un repositorio público y en una API sin autenticación — eso hay que arreglarlo exista o no un servidor remoto de por medio.
