# Arquitectura: Jugadores y Convocatoria

Diagnóstico previo a cambios. No incluye implementación, solo el mapa actual y una propuesta a decidir.

## 1. Modelo `Player`

**Esquema (persistido en `server/db.json`, array `players`):**

```json
{
  "id": 1,
  "name": "Carlos Barrientos",
  "positions": ["DEL"],
  "number": 12,
  "phone": "34684015410",
  "birthDate": null,
  "photo": "/players/1.jpg"
}
```

No hay una base de datos real: `server/db.json` es un archivo JSON leído/escrito directamente (`readDb`/`writeDb` en `server/index.js`). `phone` se normaliza a solo dígitos (`normalizePhone`) y es la **clave de unión** con los votos de WhatsApp (los votos vienen indexados por número de teléfono, no por `playerId`).

**Endpoints (`server/index.js` → expuestos en `src/api.js`):**

| Endpoint | api.js | Uso |
|---|---|---|
| `GET /api/players` | `fetchPlayers()` | lista completa |
| `POST /api/players` (requiere entrenador) | `addPlayer(player, userId)` | alta de jugador |

No hay `PUT`/`DELETE /api/players/:id` — no se puede editar ni borrar un jugador todavía.

**Componentes que consumen `players`:**

- `App.jsx` — dueño del estado (`useState([])`, se llena una vez con `fetchPlayers()` al hacer login). Es el único punto de fetch; se pasa por props hacia abajo a todo lo demás.
- `PlantillaScreen.jsx` — lista, alta (`setPlayers`), y navegación a `PlayerProfileScreen`.
- `AlineacionScreen.jsx` — filtra por convocados, arma el once.
- `MarcadorScreen.jsx` — selector de jugador para registrar eventos.
- `StatsScreen.jsx` — goleadores.
- `PlayerProfileScreen.jsx` — recibe un único `player`, no la lista.

## 2. Convocatoria (votos "Sí"/"No")

**Origen del dato — siempre fetch en vivo, sin caché:**

```
Cliente: fetchPollStatus()  [src/api.js]
   → GET /api/next-match/poll   (server/index.js, res.set('Cache-Control', 'no-store'))
      → fetchPollVotes(pollId)  [server/whatsappPollService.js]
         → GET https://gate.whapi.cloud/messages/:messageId  (Bearer WHAPI_TOKEN)
```

`whatsappPollService.js` aplana `poll.results[].voters[]` en un objeto `{ [telefono]: "Si" | "No" }`. **No hay ninguna capa de caché ni persistencia en esta ruta**: cada llamada a `fetchPollStatus()` dispara una petición real a Whapi. Si el mensaje de la encuesta se borra o expira en WhatsApp, este endpoint deja de funcionar y no queda ningún rastro local.

**Respuesta real de Whapi (verificada en vivo, no asumida)** — llamé al endpoint con el `whatsappPollId` que ya está configurado en `db.json` ("Convocatoria Partido X"):

```json
{
  "id": "PrDHHaGypkO5lg-wooBq53ih_2wLQ",
  "timestamp": 1786098604,
  "type": "poll",
  "poll": {
    "title": "Encuesta",
    "options": ["Si", "No"],
    "results": [
      { "name": "Si", "voters": ["34684015410", "34622619406"], "count": 2, "id": "..." },
      { "name": "No", "voters": ["34684394949"], "count": 1, "id": "..." }
    ]
  }
}
```

**Hallazgo clave: no hay timestamp por voto.** El único `timestamp` de la respuesta es el del *mensaje de la encuesta* (cuándo se creó/envió la encuesta), no de cuándo cada persona votó. `voters` es solo un array plano de números de teléfono, sin fecha asociada. **Whapi no expone ni expondrá cuándo votó cada jugador** — esto es un hecho de la API externa, no una limitación de cómo la estamos consumiendo.

**Persistencia — solo existe un snapshot puntual, no un histórico continuo:**

En `PUT /api/next-match` (al configurar un partido nuevo), si el partido anterior tenía `whatsappPollId`, el servidor hace **una última lectura** de esa encuesta y archiva el resultado en `db.convocatoriaHistory`:

```json
{ "id": 1, "rival": "...", "date": "...", "whatsappPollId": "...", "votes": {...}, "archivedAt": "2026-08-08T13:40:19.558Z" }
```

Esto es frágil: solo se archiva **como efecto secundario de configurar el siguiente partido**. Si el entrenador nunca vuelve a tocar "Configurar convocatoria", el histórico de ese partido nunca se guarda. `archivedAt` es la hora en que el servidor archivó, no la hora en que cada jugador votó (mismo hueco de información que arriba).

## 3. Estados locales derivados de la convocatoria — mapa completo

Encontré **tres** sitios, no dos:

1. **`useConvocatoria.js`** (ya centralizado, llamado una vez en `App.jsx`) — `votes`, `listaConvocados` (memo sobre `votes`), `pollLoading/Error/Configured`. Se pasa por props a `PlantillaScreen` y `AlineacionScreen`.

2. **`AlineacionScreen.jsx` → `convocados`** — `useState(() => listaConvocados.map(p => p.id))`. Es una **copia editable** de `listaConvocados`, no una referencia. Dos problemas de desincronización reales:
   - El inicializador perezoso de `useState` solo corre **una vez, al montar**. Si `votes` cambia después (alguien vota tarde, o se re-consulta la encuesta), `convocados` en esta pantalla **no se entera**, salvo que el componente se desmonte y remonte (cambiar de pestaña y volver), momento en el que se resetea desde `listaConvocados` **descartando cualquier ajuste manual** que el entrenador hubiera hecho a mano en esa pantalla.
   - Es decir: hay dos fuentes de verdad de "quién juega" — el voto de WhatsApp y la lista editada a mano en Alineación — y no hay ningún mecanismo que las reconcilie ni avise cuando divergen.

3. **`useConvocatoria.js` en sí mismo** — el `useEffect` que llama a `fetchPollStatus()` tiene deps `[]`: se ejecuta **una sola vez**, al montar `App`. No hay refetch periódico ni al cambiar de pantalla. Esto significa que **toda la app** trabaja sobre una foto fija de la encuesta tomada en el momento del login, aunque el propio endpoint del servidor sea "en vivo". Es un problema transversal, no solo de `AlineacionScreen`.

4. **`PlayerProfileScreen.jsx`** — un cuarto punto, de naturaleza distinta: hace su propio fetch independiente de `fetchConvocatoriaHistory()` (`GET /api/convocatoria-history`) y calcula `% convocatorias "Sí"` filtrando `history` por `h.votes?.[player.phone] === 'Si'`. No usa `useConvocatoria` ni las props de convocatoria que ya viajan desde `App.jsx` — tiene su propio `loading`/`error` y su propia llamada de red, desacoplada del resto. No es estrictamente "desincronizable" con `votes` (trabaja con histórico archivado, no con la encuesta activa), pero es una tercera vía de acceso a datos de convocatoria con su propio ciclo de vida, y es candidato a integrarse en cualquier estructura centralizada que se decida.

## 4. Propuesta — dos caminos, a decidir

**Lo que no cambia con ninguna de las dos opciones:** el hallazgo del punto 2 es un hecho de la API de Whapi, no de esta app — nunca vas a tener "la hora exacta en que el jugador pulsó Sí en WhatsApp". Como mucho, se puede tener "la hora en que *nuestro sistema* detectó por primera vez ese voto", que es una aproximación razonable y probablemente suficiente.

### Opción A — mantener fetch en vivo, arreglar los dos bugs de sincronización encontrados
- Exponer un `refetch()` desde `useConvocatoria` y llamarlo al entrar en cada pantalla que lo use (o con un intervalo corto), en vez de fetch único en el mount de `App`.
- En `AlineacionScreen`, usar un `useEffect` que resincronice `convocados` cuando cambie `listaConvocados` *solo si el entrenador no ha tocado nada manualmente* (o, más simple, añadir un botón explícito "Recargar convocatoria de WhatsApp" en vez de auto-sincronizar en silencio — evita sorprender al entrenador borrándole cambios manuales).
- Coste bajo, no toca el servidor ni el esquema de datos.
- Sigue dependiendo de que el mensaje de encuesta en WhatsApp siga vivo y accesible. Sin histórico real de "quién se apuntó y cuándo" más allá del snapshot puntual que ya existe en `convocatoriaHistory`.

### Opción B — persistir la convocatoria en BD (tabla `convocatoria: { matchId, playerId, vote, respondedAt }`)
- Un job (poll periódico desde el servidor, no desde el cliente) llama a `fetchPollVotes()`, compara contra lo último guardado por `phone`, y cuando detecta un voto nuevo o cambiado, hace upsert con `respondedAt = now()`. Esto convierte el mecanismo de archivo puntual que ya existe (`convocatoriaHistory` en el `PUT /api/next-match`) en un proceso continuo, en vez de "solo al configurar el siguiente partido".
- Todas las pantallas (`PlantillaScreen`, `AlineacionScreen`, `PlayerProfileScreen`) leerían de una única fuente en BD vía un endpoint propio, sin llamar a Whapi en cada render — desaparece el problema de "snapshot fijo del login" del punto 3 y el de las dos fuentes de verdad del punto 2, porque ya no habría copia local editable divergente: `AlineacionScreen` leería siempre el estado persistido (con opción de override manual explícito, guardado también en BD si se quiere).
- Sobrevive aunque el mensaje de WhatsApp se borre o caduque.
- Coste más alto: nuevo endpoint, tabla/colección, y sobre todo un **proceso en segundo plano** (cron o similar) — el patrón "fetch bajo demanda cuando el usuario abre la pantalla" no sirve para poblar `respondedAt` de forma fiable, porque si nadie abre la app entre que alguien vota y el siguiente partido, ese voto nunca se detecta a tiempo.

**Mi lectura:** si lo único que falta es no perder el histórico y evitar los dos bugs de desincronización, la Opción A es más barata y ya resuelve el 90%. La Opción B solo se justifica si de verdad quieres reportar (aunque sea aproximado) *cuándo* se apuntó cada jugador, y si estás dispuesto a mantener un job en segundo plano — para eso, dime cómo prefieres decidir.
