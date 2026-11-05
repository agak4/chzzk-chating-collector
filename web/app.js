const storageKey = "chat-trace:server-settings";
const state = { settings: readSettings(), configuration: { targets: [], rooms: [] }, cursor: null };

const elements = {
  connection: document.querySelector("#connection-state"),
  dialog: document.querySelector("#settings-dialog"),
  settingsForm: document.querySelector("#settings-form"),
  targetList: document.querySelector("#target-list"),
  roomList: document.querySelector("#room-list"),
  targetCount: document.querySelector("#target-count"),
  roomCount: document.querySelector("#room-count"),
  targetFilter: document.querySelector("#target-filter"),
  roomFilter: document.querySelector("#room-filter"),
  search: document.querySelector("#search-input"),
  messageList: document.querySelector("#message-list"),
  loadMore: document.querySelector("#load-more"),
};

function readSettings() {
  try { return JSON.parse(localStorage.getItem(storageKey)) ?? {}; } catch { return {}; }
}
function saveSettings(settings) { localStorage.setItem(storageKey, JSON.stringify(settings)); }
function apiUrl(path, params = {}) {
  const url = new URL(path, `${state.settings.apiBase.replace(/\/$/, "")}/`);
  Object.entries(params).forEach(([key, value]) => value && url.searchParams.set(key, value));
  return url;
}
async function request(path, options = {}, params) {
  if (!state.settings.apiBase) throw new Error("수집 서버 URL을 먼저 설정하세요.");
  const response = await fetch(apiUrl(path, params), {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.admin ? { "x-admin-key": state.settings.adminKey } : {}), ...options.headers },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error ?? "서버 요청에 실패했습니다.");
  }
  return response.status === 204 ? null : response.json();
}
function setConnection(message, error = false) {
  elements.connection.textContent = message;
  elements.connection.style.color = error ? "#a64b3d" : "";
}
function initials(name) { return [...name].slice(0, 2).join(""); }
function renderEntities(kind, items) {
  const list = kind === "targets" ? elements.targetList : elements.roomList;
  list.replaceChildren(...items.map((item) => {
    const node = document.querySelector("#entity-template").content.firstElementChild.cloneNode(true);
    const image = node.querySelector("img");
    const fallback = node.querySelector(".avatar-fallback");
    image.src = item.avatarUrl || "";
    image.alt = `${item.name} 프로필`;
    image.onerror = () => { image.hidden = true; fallback.hidden = false; };
    if (!item.avatarUrl) { image.hidden = true; fallback.hidden = false; }
    fallback.textContent = initials(item.name);
    node.querySelector(".entity-name").textContent = item.name;
    node.querySelector(".remove-button").addEventListener("click", () => removeEntity(kind, item.channelId));
    return node;
  }));
  (kind === "targets" ? elements.targetCount : elements.roomCount).textContent = items.length;
}
function renderFilters() {
  for (const [element, values] of [[elements.targetFilter, state.configuration.targets], [elements.roomFilter, state.configuration.rooms]]) {
    const current = element.value;
    element.replaceChildren(new Option("전체", ""), ...values.map((item) => new Option(item.name, item.channelId)));
    element.value = current;
  }
}
function formatTime(value) {
  return new Intl.DateTimeFormat("ko-KR", { dateStyle: "short", timeStyle: "medium" }).format(new Date(value));
}
function renderMessages(messages, append = false) {
  if (!append) elements.messageList.replaceChildren();
  if (!messages.length && !append) {
    elements.messageList.innerHTML = '<div class="empty-state"><strong>표시할 기록이 없습니다.</strong><span>수집 대상이 실제로 채팅을 남기면 여기에 표시됩니다.</span></div>';
    return;
  }
  const fragment = document.createDocumentFragment();
  messages.forEach((message) => {
    const node = document.querySelector("#message-template").content.firstElementChild.cloneNode(true);
    node.querySelector(".target-name").textContent = message.targetName;
    node.querySelector(".room-name").textContent = message.roomName;
    node.querySelector("time").textContent = formatTime(message.sentAt);
    node.querySelector("time").dateTime = message.sentAt;
    node.querySelector(".message-content").textContent = message.content;
    fragment.append(node);
  });
  elements.messageList.append(fragment);
}
async function loadConfiguration() {
  const configuration = await request("/api/configuration");
  state.configuration = configuration;
  renderEntities("targets", configuration.targets);
  renderEntities("rooms", configuration.rooms);
  renderFilters();
}
async function loadMessages({ append = false } = {}) {
  const result = await request("/api/messages", {}, {
    target: elements.targetFilter.value,
    room: elements.roomFilter.value,
    q: elements.search.value.trim(),
    before: append ? state.cursor : "",
  });
  state.cursor = result.nextCursor;
  renderMessages(result.messages, append);
  elements.loadMore.hidden = !state.cursor || result.messages.length < 50;
}
async function refresh() {
  try {
    await loadConfiguration();
    await loadMessages();
    setConnection("연결됨");
  } catch (error) {
    setConnection(error.message, true);
  }
}
async function addEntity(kind, form) {
  try {
    const source = new FormData(form).get("source");
    await request(`/api/admin/${kind}`, { method: "POST", admin: true, body: JSON.stringify({ source }) });
    form.reset();
    await refresh();
  } catch (error) { window.alert(error.message); }
}
async function removeEntity(kind, channelId) {
  if (!window.confirm("이 항목을 삭제할까요? 기존 채팅 기록은 유지됩니다.")) return;
  try {
    await request(`/api/admin/${kind}/${channelId}`, { method: "DELETE", admin: true });
    await refresh();
  } catch (error) { window.alert(error.message); }
}

document.querySelector("#settings-button").addEventListener("click", () => {
  elements.settingsForm.apiBase.value = state.settings.apiBase ?? "";
  elements.settingsForm.adminKey.value = state.settings.adminKey ?? "";
  elements.dialog.showModal();
});
elements.settingsForm.addEventListener("submit", (event) => {
  if (event.submitter?.value === "cancel") return;
  event.preventDefault();
  state.settings = { apiBase: elements.settingsForm.apiBase.value.trim(), adminKey: elements.settingsForm.adminKey.value.trim() };
  saveSettings(state.settings);
  elements.dialog.close();
  void refresh();
});
document.querySelector("#target-form").addEventListener("submit", (event) => { event.preventDefault(); void addEntity("targets", event.currentTarget); });
document.querySelector("#room-form").addEventListener("submit", (event) => { event.preventDefault(); void addEntity("rooms", event.currentTarget); });
for (const element of [elements.targetFilter, elements.roomFilter]) element.addEventListener("change", () => { state.cursor = null; void loadMessages(); });
let searchTimer;
elements.search.addEventListener("input", () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { state.cursor = null; void loadMessages(); }, 250); });
elements.loadMore.addEventListener("click", () => void loadMessages({ append: true }));
document.querySelector("#collect-button").addEventListener("click", async () => {
  try { await request("/api/admin/collect", { method: "POST", admin: true }); await loadMessages(); } catch (error) { window.alert(error.message); }
});

if (state.settings.apiBase) void refresh();
