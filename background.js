const KEY = "tasks";

// Click en el ícono: muestra/oculta Triage en la barra lateral.
// toggle() tiene que llamarse directo en el handler (sin await antes),
// porque Firefox solo lo permite como respuesta a una acción del usuario.
browser.action.onClicked.addListener(() => {
  browser.sidebarAction.toggle();
});

// Menú contextual (click derecho). Se recrea cada vez que arranca el background,
// así no depende de que se haya disparado onInstalled.
async function setupMenus() {
  await browser.menus.removeAll();
  browser.menus.create({
    id: "triage-selection",
    title: "Agregar a Triage: “%s”",
    contexts: ["selection"],
  });
  browser.menus.create({
    id: "triage-link",
    title: "Agregar link a Triage",
    contexts: ["link"],
  });
  browser.menus.create({
    id: "triage-page",
    title: "Agregar esta página a Triage",
    contexts: ["page"],
  });
}
setupMenus();

browser.menus.onClicked.addListener(async (info, tab) => {
  let text;
  let url;

  if (info.menuItemId === "triage-selection") {
    text = info.selectionText;
    url = info.pageUrl;
  } else if (info.menuItemId === "triage-link") {
    text = info.linkText || info.linkUrl;
    url = info.linkUrl;
  } else if (info.menuItemId === "triage-page") {
    text = tab?.title || info.pageUrl;
    url = info.pageUrl;
  } else {
    return;
  }

  text = (text || "").trim().replace(/\s+/g, " ");
  if (!text) return;

  // Work/Personal según el container de la pestaña donde hiciste click derecho.
  const prefs = await loadPrefs();
  const containers = await getContainers();
  const container = containers.some((c) => c.id === tab?.cookieStoreId) ? tab.cookieStoreId : undefined;
  const ctx = contextForNewTask(tab?.cookieStoreId, prefs, containers);

  const data = await browser.storage.local.get(KEY);
  const tasks = data[KEY] || [];
  tasks.push({ id: crypto.randomUUID(), text, url, ctx, container, comments: [], createdAt: Date.now(), doneAt: null });
  await browser.storage.local.set({ [KEY]: tasks });

  // Feedback rápido en el ícono.
  await browser.action.setBadgeBackgroundColor({ color: "#e8553d" });
  await browser.action.setBadgeText({ text: "+1" });
  setTimeout(() => browser.action.setBadgeText({ text: "" }), 1500);
});
