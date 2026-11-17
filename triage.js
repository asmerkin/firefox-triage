// Estado en storage.local, clave "tasks":
// [{ id, text, note, url, order, ctx, container, comments: [{ id, text, at }], createdAt, doneAt|null }]
// ctx: "work" | "personal" (ver contexts.js). container: cookieStoreId de origen.
// "order" define la cola de pendientes (menor = antes). Las tareas sin "order"
// (viejas o creadas desde el menú contextual) usan createdAt, o sea van al final.
const KEY = "tasks";
const isSidebar = new URLSearchParams(location.search).get("view") === "sidebar";

let tasks = [];
let prefs = { ...DEFAULT_PREFS };
let containers = [];
let editingId = null;
const openComments = new Set();

const $ = (sel) => document.querySelector(sel);
const input = $("#new-task");
const taskTemplate = $("#task-template");
const commentTemplate = $("#comment-template");

// Íconos de Lucide: en la página y dentro de los templates (se clonan ya hidratados).
hydrateIcons();
hydrateIcons(taskTemplate.content);
hydrateIcons(commentTemplate.content);

if (isSidebar) {
  document.documentElement.classList.add("sidebar");
  input.placeholder = "Nueva tarea…";
}

// ---------- Persistencia ----------

async function load() {
  const data = await browser.storage.local.get(KEY);
  tasks = data[KEY] || [];
  prefs = await loadPrefs();
  containers = await getContainers();
  render();
}

function setPrefs(patch) {
  prefs = { ...prefs, ...patch };
  savePrefs(prefs);
}

// Si se crean/renombran/borran containers, refrescar.
for (const ev of ["onCreated", "onUpdated", "onRemoved"]) {
  browser.contextualIdentities?.[ev]?.addListener(async () => {
    containers = await getContainers();
    render();
  });
}

function save() {
  return browser.storage.local.set({ [KEY]: tasks });
}

// No re-renderizar mientras se escribe (editando texto o un comentario).
function busy() {
  const el = document.activeElement;
  return sorting || editingId !== null || (el?.classList.contains("comment-input") && el.value !== "");
}

// Sincroniza entre pestaña, sidebar y menú contextual.
browser.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes[PREFS_KEY]) prefs = { ...DEFAULT_PREFS, ...(changes[PREFS_KEY].newValue || {}) };
  if (!changes[KEY]) return;
  const incoming = changes[KEY].newValue || [];
  // Cambio propio que ya está renderizado: no re-renderizar (perdería el foco).
  if (JSON.stringify(incoming) === JSON.stringify(tasks)) return;
  tasks = incoming;
  if (!busy()) render();
});

// ---------- Helpers ----------

const orderOf = (t) => t.order ?? t.createdAt;

function pendingSorted() {
  return tasks.filter((t) => !t.doneAt).sort((a, b) => orderOf(a) - orderOf(b));
}

// Filtro Work/Personal: una sola cola, el filtro solo oculta.
// Las tareas viejas sin contexto se ven en todos los filtros.
const isVisible = (t) => prefs.filter === "all" || !t.ctx || t.ctx === prefs.filter;
const visiblePending = () => pendingSorted().filter(isVisible);

function relativeAge(ts) {
  const mins = Math.floor((Date.now() - ts) / 60000);
  if (mins < 1) return "ahora";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

// Re-renderiza animando los cambios de posición y guarda.
function commit(freshId) {
  flip(() => render(freshId));
  save();
}

function update(id, patch) {
  tasks = tasks.map((t) => (t.id === id ? { ...t, ...patch } : t));
  commit();
}

// ---------- Orden de la cola ----------

// Reescribe "order" de los pendientes según la lista de ids dada.
function applyOrder(ids, freshId) {
  const pos = new Map(ids.map((id, i) => [id, i]));
  tasks = tasks.map((t) => (pos.has(t.id) ? { ...t, order: pos.get(t.id) } : t));
  commit(freshId);
}

// Reordena solo las tareas visibles: las ocultas por el filtro mantienen su
// lugar en la cola global y las visibles se redistribuyen en sus huecos.
function reorderVisible(newVisible, freshId) {
  const full = pendingSorted().map((t) => t.id);
  const visibleSet = new Set(newVisible);
  let i = 0;
  applyOrder(full.map((id) => (visibleSet.has(id) ? newVisible[i++] : id)), freshId);
}

// Mueve "id" a la posición "index" de lo que se ve (se recorta al rango válido).
function moveTo(id, index, freshId) {
  const ids = visiblePending().map((t) => t.id).filter((x) => x !== id);
  ids.splice(Math.max(0, Math.min(index, ids.length)), 0, id);
  reorderVisible(ids, freshId);
}

function moveBy(id, delta) {
  const ids = visiblePending().map((t) => t.id);
  moveTo(id, ids.indexOf(id) + delta);
}

// Agrega una tarea al final de la cola y la ubica en "index" (de lo visible).
function insertTask(task, index = Infinity) {
  const pending = pendingSorted();
  task.order = pending.length ? orderOf(pending.at(-1)) + 1 : 0;
  tasks.push(task);
  moveTo(task.id, index, task.id);
}

// ---------- Render ----------

function render(freshId) {
  const pending = visiblePending();
  const done = tasks.filter((t) => t.doneAt && isVisible(t)).sort((a, b) => b.doneAt - a.doneAt);
  renderFilter();
  const [next, ...queue] = pending;

  $("#next").replaceChildren(...(next ? [renderTask(next, { fresh: next.id === freshId, isNext: true, isLast: queue.length === 0 })] : []));
  $("#next-section").hidden = !next;

  $("#queue").replaceChildren(...queue.map((t, i) =>
    renderTask(t, { fresh: t.id === freshId, isLast: i === queue.length - 1 })));
  $("#queue-section").hidden = queue.length === 0;
  $("#queue-count").textContent = `· ${queue.length}`;

  $("#empty").hidden = pending.length > 0;
  const where = prefs.filter === "all" ? "" : ` en ${CONTEXT_LABEL[prefs.filter]}`;
  $("#empty-text").textContent = (done.length ? "Todo resuelto" : "Nada pendiente") + where;
  $(".empty-icon").dataset.icon = done.length ? "party-popper" : "inbox";
  hydrateIcons($("#empty"));

  $("#done").replaceChildren(...done.map((t) => renderTask(t, { isDone: true })));
  $("#done-section").hidden = done.length === 0;
  $("#done-count").textContent = `· ${done.length}`;
  $("#done").hidden = !prefs.doneOpen;
  $("#done-toggle").setAttribute("aria-expanded", String(Boolean(prefs.doneOpen)));
  $("#pending-count").textContent = pending.length || "";

  document.title = pending.length ? `(${pending.length}) Triage` : "Triage";
}

function renderTask(task, { fresh = false, isNext = false, isLast = false, isDone = false } = {}) {
  const li = taskTemplate.content.firstElementChild.cloneNode(true);
  const q = (sel) => li.querySelector(sel);
  li.dataset.id = task.id;
  li.classList.toggle("fresh", fresh);
  li.classList.toggle("next", isNext);

  // Checkbox
  const toggle = q(".toggle");
  toggle.checked = isDone;
  toggle.addEventListener("change", () => update(task.id, { doneAt: toggle.checked ? Date.now() : null }));

  // Contexto: click alterna Work <-> Personal.
  const ctxBtn = q(".ctx-toggle");
  li.dataset.ctx = task.ctx || "none";
  ctxBtn.querySelector(".ctx-label").textContent = task.ctx ? CONTEXT_LABEL[task.ctx] : "Sin contexto";
  ctxBtn.title = task.ctx
    ? `${CONTEXT_LABEL[task.ctx]} — click para cambiar`
    : "Sin contexto — click para marcar";
  ctxBtn.addEventListener("click", () => {
    const ctx = task.ctx === "work" ? "personal" : "work";
    update(task.id, { ctx });
  });

  // Título
  const text = q(".text");
  // Si el título es una URL pelada, mostrarla legible.
  text.textContent = isUrl(task.text) ? prettyUrl(task.text) : task.text;

  // Link: el título se vuelve clickeable (click abre, doble click edita)
  // y abajo aparece un chip con el dominio.
  let clickTimer = null;
  text.addEventListener("dblclick", () => {
    clearTimeout(clickTimer);
    startEdit(text, task, "text");
  });
  if (task.url) {
    text.classList.add("linked");
    text.title = task.url;
    text.addEventListener("click", () => {
      if (text.isContentEditable) return;
      clearTimeout(clickTimer);
      clickTimer = setTimeout(() => openUrl(task.url, task), 250);
    });

    const chip = q(".link-chip");
    chip.href = task.url;
    chip.title = task.url;
    chip.querySelector(".link-host").textContent = hostOf(task.url);
    chip.hidden = false;
    chip.addEventListener("click", (e) => {
      e.preventDefault();
      openUrl(task.url, task);
    });
  }

  // Antigüedad (más de 1h sin resolver se marca)
  const age = q(".age");
  age.textContent = relativeAge(task.createdAt);
  age.title = new Date(task.createdAt).toLocaleString();
  if (!isDone && Date.now() - task.createdAt > 3600_000) age.classList.add("stale");
  if (isNext) {
    const since = document.createElement("span");
    const rel = relativeAge(task.createdAt);
    since.textContent = rel === "ahora" ? rel : `hace ${rel}`;
    since.title = age.title;
    q(".meta").append(since);
  }

  // Descripción
  const note = q(".note");
  if (task.note) {
    note.textContent = task.note;
    note.hidden = false;
  }
  note.addEventListener("dblclick", () => startEdit(note, task, "note"));
  q(".add-note").hidden = Boolean(task.note);
  q(".add-note").addEventListener("click", () => {
    note.hidden = false;
    startEdit(note, task, "note");
  });

  // Comentarios
  renderComments(li, task, isNext);

  // Acciones de orden
  q(".to-top").hidden = isNext || isDone;
  q(".down").hidden = isLast || isDone;
  q(".to-end").hidden = isLast || isDone;
  q(".to-top").addEventListener("click", () => moveTo(task.id, 0));
  q(".down").addEventListener("click", () => moveBy(task.id, 1));
  q(".to-end").addEventListener("click", () => moveTo(task.id, Infinity));
  q(".next-actions").hidden = !isNext || isLast;
  q(".push-down").addEventListener("click", () => moveBy(task.id, 1));
  q(".push-end").addEventListener("click", () => moveTo(task.id, Infinity));

  q(".delete").addEventListener("click", () => {
    tasks = tasks.filter((t) => t.id !== task.id);
    openComments.delete(task.id);
    commit();
  });

  if (!isDone) setupDrag(li, task.id);
  return li;
}

function renderComments(li, task, isNext) {
  const comments = task.comments || [];
  const panel = li.querySelector(".comments");
  const count = li.querySelector(".comment-count");
  const field = li.querySelector(".comment-input");

  // En la tarea "siguiente" los comentarios siempre están a la vista.
  panel.hidden = !(isNext || openComments.has(task.id));
  count.hidden = comments.length === 0 || isNext;
  count.querySelector(".comment-n").textContent = comments.length;

  const toggle = () => {
    if (openComments.has(task.id)) openComments.delete(task.id);
    else openComments.add(task.id);
    render();
    if (openComments.has(task.id)) focusComment(task.id);
  };
  count.addEventListener("click", toggle);
  li.querySelector(".open-comments").addEventListener("click", toggle);
  li.querySelector(".open-comments").hidden = isNext;

  li.querySelector(".comment-list").replaceChildren(...comments.map((c) => {
    const item = commentTemplate.content.firstElementChild.cloneNode(true);
    item.querySelector(".comment-text").textContent = c.text;
    const at = item.querySelector(".comment-age");
    at.textContent = relativeAge(c.at);
    at.title = new Date(c.at).toLocaleString();
    item.querySelector(".comment-delete").addEventListener("click", () => {
      update(task.id, { comments: comments.filter((x) => x.id !== c.id) });
    });
    return item;
  }));

  li.querySelector(".comment-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const value = field.value.trim();
    if (!value) return;
    field.value = "";
    update(task.id, { comments: [...comments, { id: crypto.randomUUID(), text: value, at: Date.now() }] });
    focusComment(task.id);
  });
  field.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { field.value = ""; field.blur(); }
  });
}

function focusComment(id) {
  document.querySelector(`[data-id="${id}"] .comment-input`)?.focus();
}

// ---------- Animaciones (FLIP) ----------

const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

// Ejecuta "mutate" (que mueve/re-renderiza tareas) y anima cada tarea desde
// donde estaba hasta su nuevo lugar. Las tareas se reconocen por data-id.
function flip(mutate) {
  if (reduceMotion) return mutate();
  const before = new Map();
  document.querySelectorAll("li.task[data-id]").forEach((el) => {
    before.set(el.dataset.id, el.getBoundingClientRect().top);
  });
  mutate();
  document.querySelectorAll("li.task[data-id]:not(.lifted)").forEach((el) => {
    const old = before.get(el.dataset.id);
    if (old === undefined) return;
    const dy = old - el.getBoundingClientRect().top;
    if (Math.abs(dy) < 1) return;
    el.animate(
      [{ transform: `translateY(${dy}px)` }, { transform: "none" }],
      { duration: 240, easing: "cubic-bezier(.2,.8,.2,1)" },
    );
  });
}

// ---------- Placeholder compartido (reordenar y soltar desde afuera) ----------

// Tareas pendientes visibles, en orden, sin contar la que se está arrastrando.
function pendingItems(exclude) {
  return [...document.querySelectorAll("#next > li.task, #queue > li.task")]
    .filter((el) => el !== exclude);
}

// Ubica el placeholder según la altura del puntero, animando el resto.
function placePlaceholder(ph, clientY, exclude) {
  const items = pendingItems(exclude);
  const target = items.find((el) => {
    const r = el.getBoundingClientRect();
    return clientY < r.top + r.height / 2;
  });
  // Si ya está en el lugar correcto, no tocar nada (evita parpadeos).
  if (target ? ph.nextElementSibling === target : ph.parentElement && !ph.nextElementSibling && ph.parentElement.id === "queue") return;
  if (!target && items.length === 0 && ph.parentElement) return;
  flip(() => {
    if (target) target.before(ph);
    else {
      $("#queue-section").hidden = false;
      $("#queue").append(ph);
    }
  });
}

function placeholderIndex(ph, exclude) {
  return [...document.querySelectorAll("#next > li, #queue > li")]
    .filter((el) => el !== exclude)
    .indexOf(ph);
}

function makePlaceholder(height) {
  const ph = document.createElement("li");
  ph.className = "placeholder";
  ph.style.height = `${height}px`;
  return ph;
}

function removePlaceholder(ph) {
  if (ph?.parentElement) flip(() => ph.remove());
}

// ---------- Reordenar arrastrando el handle (pointer events) ----------

let sorting = false;

function setupDrag(li, id) {
  const handle = li.querySelector(".handle");
  handle.addEventListener("pointerdown", (down) => {
    if (down.button !== 0 || editingId !== null) return;
    down.preventDefault();
    handle.setPointerCapture(down.pointerId);

    let ph = null;
    let offsetY = 0;
    let started = false;

    const start = () => {
      started = true;
      sorting = true;
      const rect = li.getBoundingClientRect();
      offsetY = down.clientY - rect.top;
      ph = makePlaceholder(rect.height);
      li.before(ph);
      Object.assign(li.style, {
        position: "fixed",
        left: `${rect.left}px`,
        top: `${rect.top}px`,
        width: `${rect.width}px`,
        zIndex: 10,
      });
      li.classList.add("lifted");
      document.body.classList.add("sorting");
    };

    const onMove = (e) => {
      // Umbral chico para que un click en el handle no "levante" la tarea.
      if (!started && Math.abs(e.clientY - down.clientY) < 4) return;
      if (!started) start();
      li.style.top = `${e.clientY - offsetY}px`;
      placePlaceholder(ph, e.clientY, li);
      autoScroll(e.clientY);
    };

    const onUp = () => {
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onUp);
      if (!started) return;

      const index = placeholderIndex(ph, li);
      const target = ph.getBoundingClientRect();
      const finish = () => {
        li.remove(); // el render nuevo la vuelve a crear en su lugar
        sorting = false;
        document.body.classList.remove("sorting");
        moveTo(id, index);
      };
      if (reduceMotion) return finish();
      // "Aterriza" suavemente sobre el placeholder antes de reordenar.
      li.animate(
        [{ top: li.style.top }, { top: `${target.top}px` }],
        { duration: 160, easing: "cubic-bezier(.2,.8,.2,1)" },
      ).onfinish = finish;
      li.style.top = `${target.top}px`;
      li.classList.add("landing");
    };

    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onUp);
  });
}

function autoScroll(y) {
  const edge = 48;
  if (y < edge) window.scrollBy(0, -8);
  else if (y > innerHeight - edge) window.scrollBy(0, 8);
}

// ---------- Soltar páginas, links o texto desde afuera ----------

// Al arrastrar una pestaña de la barra de pestañas, Firefox NO manda
// text/x-moz-url ni text/plain (para no crear accesos directos si la soltás en
// el escritorio): solo estos dos tipos, y el segundo puede llegar vacío.
const TAB_TYPES = ["application/x-moz-tabbrowser-tab", "text/x-moz-text-internal"];
const EXTERNAL_TYPES = ["text/x-moz-url", "text/uri-list", "text/plain", ...TAB_TYPES];
let externalPh = null;

function isExternalDrag(e) {
  return [...e.dataTransfer.types].some((t) => EXTERNAL_TYPES.includes(t));
}

const isTabDrag = (dt) => [...dt.types].some((t) => TAB_TYPES.includes(t));

function clearDropUI() {
  document.body.classList.remove("drag-over");
  removePlaceholder(externalPh);
  externalPh = null;
}

const isUrl = (s) => /^[a-z][\w+.-]*:\/\/\S+$/i.test(s.trim());
const clean = (s) => (s || "").replace(/\s+/g, " ").trim();

// Extrae { url, text } de lo que se soltó. Prueba varias fuentes porque cada
// origen (pestaña, link de una página, texto) manda datos distintos.
// Tiene que ser sincrónico: el DataTransfer deja de ser legible después del drop.
function parseDrop(dt) {
  const [mozUrl, mozTitle] = dt.getData("text/x-moz-url").split("\n");
  const uri = dt.getData("text/uri-list").split("\n").find((l) => l && !l.startsWith("#"));
  const plain = dt.getData("text/plain").trim();
  const url = clean(mozUrl) || clean(uri) || (isUrl(plain) ? plain : "");

  // Texto del <a> si vino como HTML (links arrastrados desde una página).
  let htmlText = "";
  const html = dt.getData("text/html");
  if (html) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    htmlText = doc.querySelector("a")?.textContent || doc.body.textContent;
  }

  const candidates = [mozTitle, dt.getData("text/x-moz-url-desc"), htmlText, isUrl(plain) ? "" : plain]
    .map(clean)
    .filter((t) => t && t !== url && !isUrl(t));
  return { url, text: candidates[0] || "" };
}

// Pestaña abierta con esa URL (para sacar título y container).
async function findOpenTab(url) {
  try {
    return (await browser.tabs.query({})).find((t) => t.url === url);
  } catch {
    return undefined;
  }
}

// "https://github.com/acme/api/pull/12" -> "github.com · acme/api/pull/12"
function prettyUrl(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    const path = decodeURIComponent(u.pathname).replace(/^\/|\/$/g, "").replace(/[-_]+/g, " ");
    return path ? `${host} · ${path}` : host;
  } catch {
    return url;
  }
}

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; }
}

// Abre el link en el container de la tarea (el de origen, o el de su contexto).
// Si ya hay una pestaña con esa URL en ese container, la enfoca.
async function openUrl(url, task = {}) {
  const cookieStoreId = containerForTask(task, prefs, containers);
  const tab = (await browser.tabs.query({}))
    .find((t) => t.url === url && (!cookieStoreId || t.cookieStoreId === cookieStoreId));
  if (tab) {
    await browser.tabs.update(tab.id, { active: true });
    await browser.windows.update(tab.windowId, { focused: true });
  } else {
    await browser.tabs.create(cookieStoreId ? { url, cookieStoreId } : { url });
  }
}

// Pestañas arrastradas desde la barra de pestañas. Al empezar a arrastrar,
// Firefox selecciona la pestaña, así que son las resaltadas de esta ventana
// (varias si arrastrás una selección con Ctrl/Shift+click).
async function draggedTabs(internalUrl) {
  let tabs = [];
  try {
    tabs = await browser.tabs.query({ highlighted: true, currentWindow: true });
  } catch {}
  // Si Firefox sí nos pasó la URL y no coincide con la selección, manda la URL.
  if (internalUrl && !tabs.some((t) => t.url === internalUrl)) {
    const tab = await findOpenTab(internalUrl);
    return tab ? [tab] : [{ url: internalUrl }];
  }
  return tabs.filter((t) => t.url && !t.url.startsWith("about:blank"));
}

// Lee el DataTransfer de forma sincrónica (deja de ser legible después del drop).
function readDrop(dt) {
  if (!isTabDrag(dt)) return { kind: "data", parsed: parseDrop(dt) };
  let internalUrl = "";
  try { internalUrl = clean(dt.getData("text/x-moz-text-internal").split("\n")[0]); } catch {}
  return { kind: "tabs", internalUrl: isUrl(internalUrl) ? internalUrl : "" };
}

// Crea la(s) tarea(s) en la posición "index" de la cola (por defecto, al final).
async function addFromDrop(drop, index = Infinity) {
  if (drop.kind === "tabs") {
    const tabs = await draggedTabs(drop.internalUrl);
    tabs.forEach((tab, i) => addDropped({ url: tab.url, text: "" }, tab, index + i));
    return;
  }
  const { url } = drop.parsed;
  addDropped(drop.parsed, url ? await findOpenTab(url) : undefined, index);
}

function addDropped({ text, url }, tab, index) {
  let needsTitle = false;
  if (!text) text = clean(tab?.title);
  if (!text && url) {
    text = prettyUrl(url);
    needsTitle = true;
  }
  if (!text) return;

  // Con un filtro activo, lo que soltás es de ese contexto (si no, desaparecería).
  // En "Todo", manda el container de la pestaña de origen.
  const container = containers.some((c) => c.id === tab?.cookieStoreId) ? tab.cookieStoreId : undefined;
  const ctx = CONTEXTS.includes(prefs.filter) ? prefs.filter : contextForNewTask(tab?.cookieStoreId, prefs, containers);
  const task = { id: crypto.randomUUID(), text, note: "", url: url || undefined, ctx, container, comments: [], createdAt: Date.now(), doneAt: null };
  insertTask(task, index);

  // Sin título real: deja el título seleccionado para que lo renombres al toque.
  if (needsTitle) {
    const el = document.querySelector(`[data-id="${task.id}"] .text`);
    if (el) startEdit(el, task, "text");
  }
}

document.addEventListener("dragover", (e) => {
  if (sorting || !isExternalDrag(e) || e.target === input) return;
  e.preventDefault();
  document.body.classList.add("drag-over");
  if (!externalPh) externalPh = makePlaceholder(isSidebar ? 34 : 44);
  placePlaceholder(externalPh, e.clientY);
});
document.addEventListener("dragleave", (e) => {
  if (!e.relatedTarget) clearDropUI();
});
document.addEventListener("drop", (e) => {
  if (sorting || !isExternalDrag(e) || e.target === input) return;
  e.preventDefault();
  const index = externalPh?.parentElement ? placeholderIndex(externalPh) : Infinity;
  document.body.classList.remove("drag-over");
  externalPh = null; // el render reemplaza el placeholder por la tarea nueva
  addFromDrop(readDrop(e.dataTransfer), index);
});

// ---------- Edición inline ----------

// field: "text" (título, obligatorio) o "note" (descripción, puede quedar vacía).
function startEdit(el, task, field) {
  editingId = task.id;
  el.contentEditable = "true";
  el.focus();
  document.getSelection().selectAllChildren(el);

  const original = task[field] || "";
  const finish = (accept) => {
    el.removeEventListener("keydown", onKey);
    el.removeEventListener("blur", onBlur);
    el.contentEditable = "false";
    editingId = null;
    const value = el.innerText.trim();
    const valid = field === "note" || value;
    if (accept && valid && value !== original) {
      update(task.id, { [field]: value });
    } else {
      render();
    }
  };
  const onKey = (e) => {
    // En la descripción, Shift+Enter hace salto de línea.
    if (e.key === "Enter" && !(field === "note" && e.shiftKey)) { e.preventDefault(); finish(true); }
    if (e.key === "Escape") { e.preventDefault(); finish(false); }
  };
  const onBlur = () => finish(true);
  el.addEventListener("keydown", onKey);
  el.addEventListener("blur", onBlur);
}

// ---------- Alta de tareas ----------

// "título // descripción" separa la descripción (con espacios, para no romper URLs).
// "!" al principio la pone primera en la cola; si no, va al final.
// "@w" / "@p" (en cualquier lugar) marca Work o Personal.
function parseInput(raw) {
  let value = raw.trim();
  let ctx = null;
  value = value.replace(/(^|\s)@(w|work|p|personal)\b/i, (_, pre, tag) => {
    ctx = tag[0].toLowerCase() === "w" ? "work" : "personal";
    return pre;
  }).trim();
  const urgent = value.startsWith("!");
  if (urgent) value = value.slice(1);
  const sep = value.search(/\s\/\/(\s|$)/);
  const text = (sep === -1 ? value : value.slice(0, sep)).trim();
  const note = sep === -1 ? "" : value.slice(sep).replace(/^\s\/\//, "").trim();
  return { text, note, urgent, ctx };
}

$("#add-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const parsed = parseInput(input.value);
  if (!parsed.text) return;

  // Contexto: el @w/@p explícito; si no, el filtro activo; en "Todo", Personal.
  const ctx = parsed.ctx || contextForNewTask(null, prefs, containers);

  const task = { id: crypto.randomUUID(), text: parsed.text, note: parsed.note, ctx, comments: [], createdAt: Date.now(), doneAt: null };
  input.value = "";
  insertTask(task, parsed.urgent ? 0 : Infinity);
});

input.addEventListener("keydown", (e) => {
  if (e.key === "Escape") { input.value = ""; input.blur(); }
});

$("#done-toggle").addEventListener("click", () => {
  setPrefs({ doneOpen: !prefs.doneOpen });
  render();
});

$("#clear-done").addEventListener("click", () => {
  tasks = tasks.filter((t) => !t.doneAt);
  commit();
});

// ---------- Filtro y containers ----------

// Menú propio (el <select> nativo no se puede estilizar).
const filterBtn = $("#filter-btn");
const filterMenu = $("#filter-menu");
const menuItems = () => [...filterMenu.querySelectorAll("[role^=menuitem]")];

function renderFilter() {
  const all = pendingSorted();
  const counts = {
    all: all.length,
    work: all.filter((t) => t.ctx === "work").length,
    personal: all.filter((t) => t.ctx === "personal").length,
  };
  $("#filter-label").textContent = prefs.filter === "all" ? "Todo" : CONTEXT_LABEL[prefs.filter];
  document.documentElement.dataset.filter = prefs.filter;
  filterMenu.querySelectorAll("[data-value]").forEach((item) => {
    item.setAttribute("aria-checked", String(item.dataset.value === prefs.filter));
    item.querySelector(".menu-count").textContent = counts[item.dataset.value] || "";
  });
}

function openMenu() {
  filterMenu.hidden = false;
  filterBtn.setAttribute("aria-expanded", "true");
  (filterMenu.querySelector("[aria-checked=true]") || menuItems()[0]).focus();
}

function closeMenu({ focusButton = false } = {}) {
  if (filterMenu.hidden) return;
  filterMenu.hidden = true;
  filterBtn.setAttribute("aria-expanded", "false");
  if (focusButton) filterBtn.focus();
}

filterBtn.addEventListener("click", () => (filterMenu.hidden ? openMenu() : closeMenu()));

filterMenu.addEventListener("click", (e) => {
  const item = e.target.closest("[role^=menuitem]");
  if (!item) return;
  closeMenu({ focusButton: true });
  if (item.dataset.action === "containers") return openContainersDialog();
  const filter = item.dataset.value;
  if (filter === prefs.filter) return;
  setPrefs({ filter });
  flip(() => render());
});

// Teclado: flechas para moverse, Esc/Tab para cerrar.
filterMenu.addEventListener("keydown", (e) => {
  const items = menuItems();
  const i = items.indexOf(document.activeElement);
  if (e.key === "ArrowDown") { e.preventDefault(); items[(i + 1) % items.length].focus(); }
  if (e.key === "ArrowUp") { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
  if (e.key === "Escape") { e.preventDefault(); closeMenu({ focusButton: true }); }
  if (e.key === "Tab") closeMenu();
});
filterBtn.addEventListener("keydown", (e) => {
  if (e.key === "ArrowDown") { e.preventDefault(); openMenu(); }
});

// Click afuera cierra.
document.addEventListener("pointerdown", (e) => {
  if (!e.target.closest("#filter")) closeMenu();
});

function openContainersDialog() {
  const list = $("#container-list");
  list.replaceChildren(...containers.map((c) => {
    const li = document.createElement("li");
    const dot = document.createElement("span");
    dot.className = "container-color";
    dot.style.background = c.color;
    const name = document.createElement("span");
    name.className = "container-name";
    name.textContent = c.name;
    const select = document.createElement("select");
    for (const ctx of CONTEXTS) select.add(new Option(CONTEXT_LABEL[ctx], ctx));
    select.value = contextOfContainer(c.id, prefs, containers);
    select.addEventListener("change", () => {
      setPrefs({ containerCtx: { ...prefs.containerCtx, [c.id]: select.value } });
    });
    li.append(dot, name, select);
    return li;
  }));
  $("#no-containers").hidden = containers.length > 0;
  $("#containers-dialog").showModal();
}

// Atajos globales para volver al input.
document.addEventListener("keydown", (e) => {
  const typing = e.target.closest?.("input[type=text], [contenteditable=true]");
  if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === "/" || e.key === "n") {
    e.preventDefault();
    input.focus();
  }
});

// Refresca las edades cada minuto.
setInterval(() => { if (!busy()) render(); }, 60_000);

load();
