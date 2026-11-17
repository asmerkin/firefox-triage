# Triage

Extensión de Firefox para anotar tareas rápidas y resolverlas en el momento, desde la barra lateral.

Una sola cola: arriba está la tarea **Siguiente**, abajo **En cola**, y lo hecho pasa a **Resueltas**. Cada tarea es **Work** o **Personal**, y eso sale solo del container de Firefox desde donde la agregaste.

## Qué hace

- **Barra lateral**: se abre con el ícono de la barra de herramientas o con `Alt+Shift+T`.
- **Agregar tareas**:
  - escribiendo arriba y Enter;
  - con click derecho en una página, un link o un texto seleccionado ("Agregar a Triage");
  - arrastrando una pestaña, un link o un texto a la lista.
- **Ordenar**: arrastrando la manija de cada tarea, o con los botones que aparecen al pasar el mouse. En "Siguiente", **Ahora no** la baja un lugar y **Al final** la manda al fondo.
- **Links**: si la tarea tiene URL, click en el título la abre. Si ya está abierta en una pestaña, va a esa pestaña; si no, abre una nueva en el container correcto.
- **Descripción y comentarios**: cada tarea tiene una nota y comentarios con hora. Doble click en el título o la nota para editar.
- **Work / Personal**: un maletín azul es Work y una casa naranja es Personal. Click en la etiqueta alterna entre las dos. El filtro "Todo ⌄" muestra todo o un solo contexto.

## Atajos al escribir

| Escribís | Resultado |
|---|---|
| `!Llamar al banco` | Va primera en la cola |
| `@w Revisar PR` / `@p Turno médico` | La marca como Work o Personal |
| `Revisar PR // ver el fix del cupón` | Título y descripción |
| `/` o `n` (fuera del input) | Foco en "Nueva tarea" |

## Work / Personal y containers

Usa los containers de Firefox (Multi-Account Containers):

- Una pestaña en un container **violeta** es **Work**.
- Cualquier otro container, o una pestaña sin container, es **Personal**.
- En el filtro, **Containers…** permite elegir a mano el contexto de cada container.

Si una tarea nueva no tiene container de origen (por ejemplo, si la escribiste a mano), toma el contexto del filtro activo, y si no hay ninguno queda como Personal.

## Instalar

### Para desarrollo (temporal)

1. Abrí `about:debugging#/runtime/this-firefox`.
2. Hacé click en **Load Temporary Add-on…** y elegí `manifest.json`.
3. Después de cada cambio, hacé click en **Reload**.

Una extensión temporal se borra al reiniciar Firefox.

### Permanente (firmada, sin publicar)

Necesitás las claves de la API de AMO: https://addons.mozilla.org/developers/addon/api/key/

```bash
export WEB_EXT_API_KEY="user:xxxx"
export WEB_EXT_API_SECRET="xxxx"
npx web-ext sign --channel=unlisted
```

Esto deja un `.xpi` en `web-ext-artifacts/`. Para instalarlo, en `about:addons` andá al engranaje y elegí **Install Add-on From File…**.

Para actualizar, subí `"version"` en `manifest.json`, firmá de nuevo e instalá el `.xpi` nuevo encima. Las tareas se mantienen porque el ID (`triage@asmerkin.local`) no cambia.

Requiere Firefox 140 o más nuevo.

### Con GitHub Actions

El workflow `.github/workflows/release.yml` hace lo mismo en GitHub: firma la extensión y publica el `.xpi` en un Release.

1. Una sola vez: cargá las claves de AMO como secretos del repo (`AMO_API_KEY` y `AMO_API_SECRET`).
2. Subí `"version"` en `manifest.json` y commiteá.
3. Creá y pusheá el tag con esa versión:

   ```bash
   git tag v0.1.3 && git push origin main v0.1.3
   ```

Si el tag no coincide con la versión del manifest, el workflow falla antes de firmar.

## Datos

Todo se guarda en `browser.storage.local`, en tu perfil de Firefox. Nada sale de tu máquina.

- `tasks` guarda la lista de tareas.
- `prefs` guarda el filtro activo, el contexto elegido para cada container y si "Resueltas" está desplegada.

Para hacer un backup, abrí la consola de la extensión (**Inspect** en `about:debugging`) y corré:

```js
copy(JSON.stringify(await browser.storage.local.get()))
```

## Archivos

| Archivo | Qué es |
|---|---|
| `manifest.json` | Manifest V3: permisos, barra lateral, atajo |
| `background.js` | Botón de la barra de herramientas y menú de click derecho |
| `contexts.js` | Reglas de Work/Personal y containers (lo usan la página y el background) |
| `triage.html` / `triage.css` / `triage.js` | La barra lateral |
| `icons.js` | Íconos de [Lucide](https://lucide.dev) (licencia ISC, ver `LICENSE-lucide.txt`) |

Sin dependencias ni build: es HTML, CSS y JS planos.

Para revisar la extensión con el linter de Mozilla:

```bash
npx web-ext lint --self-hosted
```
