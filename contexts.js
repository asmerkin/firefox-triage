// Contextos Work / Personal y su relación con los containers de Firefox.
// Lo usan la página (triage.js) y el background (menú contextual).

const PREFS_KEY = "prefs";
const CONTEXTS = ["work", "personal"];
const CONTEXT_LABEL = { work: "Work", personal: "Personal" };

// filter: "all" | "work" | "personal"
// containerCtx: { [cookieStoreId]: "work" | "personal" } elegido a mano
// doneOpen: si la lista de resueltas está desplegada
const DEFAULT_PREFS = { filter: "all", containerCtx: {}, doneOpen: false };

async function loadPrefs() {
  const data = await browser.storage.local.get(PREFS_KEY);
  return { ...DEFAULT_PREFS, ...(data[PREFS_KEY] || {}) };
}

function savePrefs(prefs) {
  return browser.storage.local.set({ [PREFS_KEY]: prefs });
}

// Containers del usuario: [{ id, name, color }]. Vacío si están desactivados.
async function getContainers() {
  try {
    const list = await browser.contextualIdentities.query({});
    return (list || []).map((c) => ({ id: c.cookieStoreId, name: c.name, color: c.colorCode, colorName: c.color }));
  } catch {
    return [];
  }
}

// Si no se eligió a mano en "Containers…": los containers violetas son Work;
// el resto (y las pestañas sin container), Personal.
const WORK_COLORS = ["purple"];
const DEFAULT_STORE = "firefox-default";

function contextOfContainer(cookieStoreId, prefs, containers) {
  if (cookieStoreId === DEFAULT_STORE) return "personal"; // pestaña sin container
  const container = containers.find((c) => c.id === cookieStoreId);
  if (!container) return null; // desconocido (p. ej. ventana privada)
  if (prefs.containerCtx[cookieStoreId]) return prefs.containerCtx[cookieStoreId];
  return WORK_COLORS.includes(container.colorName) ? "work" : "personal";
}

// Contexto para una tarea nueva: el container de origen manda; si no se sabe,
// el filtro activo; y si el filtro es "Todo", Personal.
function contextForNewTask(cookieStoreId, prefs, containers) {
  return contextOfContainer(cookieStoreId, prefs, containers)
    || (CONTEXTS.includes(prefs.filter) ? prefs.filter : "personal");
}

// Container donde abrir una tarea: el de origen si sigue existiendo; si no,
// Work se abre en el primer container de trabajo y Personal sin container.
function containerForTask(task, prefs, containers) {
  if (task.container && containers.some((c) => c.id === task.container)) return task.container;
  if (task.ctx !== "work") return undefined;
  return containers.find((c) => contextOfContainer(c.id, prefs, containers) === "work")?.id;
}
