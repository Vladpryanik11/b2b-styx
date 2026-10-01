const STORAGE_KEY = "styx-b2b-account-v1";
const ACTIVE_VIEW_KEY = "styx-b2b-view-v1";

// DaData token должен оставаться на сервере. Клиент обращается к вашему proxy-методу.
// Ожидаемый ответ proxy: { suggestions: [{ value, data: { inn, name: { short_with_opf }, ... } }] }
const DADATA_PROXY_URL = "/api/dadata/party";
const ADDRESS_SUGGEST_URL = "/api/dadata/address";
const ADDRESS_CLEAN_URL = "/api/dadata/clean-address";
const ORDERS_URL = "/api/orders";
const SESSION_URL = "/api/session";
const ADDRESS_HINT = "Начните вводить адрес — появятся подсказки.";
// Значения переключателя юрлиц: «Все юрлица» и пункт «Добавить юрлицо…».
const ALL_COMPANIES = "all";
const MAX_COMPANIES = 30; // как на сервере (server/profile.js)
const ADD_COMPANY = "add";

const demoCompanies = [
  { value: "ООО «Северный Стикс»", inn: "7701234567", kpp: "770101001", address: "г. Москва, ул. Примерная, д. 1" },
  { value: "ООО «Ромашка»", inn: "7702345678", kpp: "770201001", address: "г. Москва, ул. Лесная, д. 12" },
  { value: "ИП Петрова Анна Сергеевна", inn: "770412345678", kpp: "", address: "г. Москва, ул. Сухонская, д. 11" },
  { value: "ООО «Салон Лотос»", inn: "7705123456", kpp: "770501001", address: "г. Москва, Ленинский пр-т, д. 30" }
];

// Опубликованный демо-пример (demo-seed.js) работает без сервера: поиск по ИНН идёт по тестовым организациям.
const IS_DEMO = Boolean(window.STYX_DEMO_SEED);
const DEMO_SEARCH_HINT = "В демо-версии поиск работает по тестовым организациям: ИНН 7701234567, 7702345678, 7705123456, 770412345678. В рабочем кабинете найдётся любая организация или ИП.";

let store = loadStore();
// Режим сервера: учётные записи, юрлица и заказы хранятся в базе server.js, вход — по cookie сессии.
// Без сервера (демо, открытый файл, статический хостинг) кабинет работает как прототип на localStorage.
let serverMode = false;
let accountSyncTimer = null;
let lastSyncedAccount = "";
let selectedCompany = null;
let searchTimer = null;
let searchController = null;
let searchRequestId = 0;
let suggestionItems = [];
let suggestionIndex = -1;
let toastTimer = null;
let lastFocusedElement = null;
let activeModal = null;
let catalogCategory = "all";
let catalogQuery = "";
let openedOrderNumber = null;
let addressTimer = null;
let addressController = null;
let addressItems = [];
let addressIndex = -1;
let editingAddressId = null;
let confirmDeleteAddressId = null;
let addressCompanyId = null;
let orderCompanyId = null;
let appliedPromo = null;
let companyAddTimer = null;
let companyAddController = null;
let companyAddItems = [];
// Поля адреса с подсказками DaData: в заказе и в форме сохранённого адреса.
const ADDRESS_FIELDS = {
  order: { input: "#order-address", list: "#address-suggestions", hint: "#address-hint" },
  saved: { input: "#address-edit-value", list: "#address-edit-suggestions", hint: "#address-edit-hint" }
};
const NEW_ADDRESS = "new";
// Адрес самовывоза STYX (офис в Москве из прайса).
const PICKUP_ADDRESS = "г. Москва, ул. Сущевская, д. 23";
// Промокоды на скидку к заказу, процент от суммы товаров. В прототипе список лежит в браузере,
// в production код проверяет и пересчитывает сервер.
const PROMO_CODES = { XSIZE: 10, LANDGROUP: 10 };

const COMPLETED_STATUS = "Завершён";
const CANCELLED_STATUS = "Отменён";
const NEW_STATUS = "Новый";
const NOT_SENT_STATUS = "Не отправлен";
const priceFormatter = new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 0 });
const formatPrice = (value) => priceFormatter.format(Number(value) || 0);

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

function loadStore() {
  // window.STYX_DEMO_SEED (demo-seed.js) подставляет готовый кабинет для показа, если в браузере ещё ничего не сохранено.
  const seed = window.STYX_DEMO_SEED || null;
  try {
    return normalizeStore(JSON.parse(localStorage.getItem(STORAGE_KEY)) || seed);
  } catch {
    return normalizeStore(seed);
  }
}

function normalizeStore(candidate) {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return { account: null, session: false, orders: [], cart: {} };
  }

  const rawAccount = candidate.account;
  const rawUser = rawAccount && typeof rawAccount.user === "object" ? rawAccount.user : null;
  const user = rawUser
    && typeof rawUser.name === "string"
    && typeof rawUser.email === "string"
    && typeof rawUser.passwordHash === "string"
    ? { ...rawUser }
    : null;
  // Раньше у кабинета было одно юрлицо (account.company) — переносим его в список account.companies.
  const rawCompanies = rawAccount && Array.isArray(rawAccount.companies)
    ? rawAccount.companies
    : rawAccount && rawAccount.company && typeof rawAccount.company === "object" ? [rawAccount.company] : [];
  const companies = normalizeCompanies(rawCompanies);
  let account = null;
  if (user && companies.length) {
    const { company: _legacyCompany, ...rest } = rawAccount;
    const activeId = rawAccount.activeCompanyId;
    account = {
      ...rest,
      user,
      companies,
      activeCompanyId: activeId === ALL_COMPANIES || companies.some((item) => item.id === activeId) ? activeId : companies[0].id
    };
  }
  const orders = Array.isArray(candidate.orders) ? candidate.orders.filter((order) => order && typeof order === "object") : [];
  // Заказы без юрлица (созданные до мульти-аккаунта) относим к первому юрлицу.
  if (account) orders.forEach((order) => {
    if (!account.companies.some((item) => item.id === order.companyId)) order.companyId = account.companies[0].id;
  });

  return {
    account,
    session: candidate.session === true && Boolean(account),
    orders,
    cart: normalizeCart(candidate.cart)
  };
}

function companyKey(company) {
  return `${company.inn}-${company.kpp || ""}`;
}

function normalizeCompanies(candidate) {
  const seen = new Set();
  return candidate
    .filter((item) => item && typeof item === "object" && typeof item.inn === "string" && item.inn)
    // Сырой ответ поиска (data) в кабинете не нужен: он только раздувает сохранение юрлиц.
    .map(({ data: _data, demo: _demo, ...item }) => ({
      ...item,
      id: typeof item.id === "string" && item.id ? item.id : `company-${companyKey(item)}`,
      deliveryAddresses: normalizeAddresses(item.deliveryAddresses)
    }))
    .filter((item) => !seen.has(item.id) && seen.add(item.id));
}

// ---------- Юрлица ----------

function companies() {
  return store.account?.companies || [];
}

function companyById(id) {
  return companies().find((item) => item.id === id) || null;
}

function isAllCompanies() {
  return companies().length > 1 && store.account?.activeCompanyId === ALL_COMPANIES;
}

// Текущее юрлицо из переключателя; в режиме «Все юрлица» — null.
function activeCompany() {
  if (isAllCompanies()) return null;
  return companyById(store.account?.activeCompanyId) || companies()[0] || null;
}

function companyTitle(company) {
  return company ? company.name || company.value || `ИНН ${company.inn}` : "";
}

function companyRequisites(company) {
  return [`ИНН ${company.inn}`, company.kpp && company.kpp !== "—" ? `КПП ${company.kpp}` : ""].filter(Boolean).join(" · ");
}

// Заказы, которые видны в кабинете при текущем выборе юрлица.
function visibleOrders() {
  const company = activeCompany();
  return (store.orders || []).filter((order) => !company || order.companyId === company.id);
}

// Адреса доставки организации: у каждого id, необязательное название, адрес; ровно один основной.
function normalizeAddresses(candidate) {
  if (!Array.isArray(candidate)) return [];
  const list = candidate
    .filter((item) => item && typeof item.address === "string" && item.address.trim())
    .slice(0, 50)
    .map((item, index) => ({
      id: typeof item.id === "string" && item.id ? item.id : `addr-${Date.now()}-${index}`,
      label: typeof item.label === "string" ? item.label.trim().slice(0, 60) : "",
      address: item.address.trim().slice(0, 300),
      isDefault: item.isDefault === true
    }));
  const defaultIndex = Math.max(0, list.findIndex((item) => item.isDefault));
  list.forEach((item, index) => { item.isDefault = index === defaultIndex; });
  return list;
}

// Адреса доставки юрлица: по умолчанию текущего, в заказе — выбранного в форме.
function deliveryAddresses(companyId = activeCompany()?.id) {
  return companyById(companyId)?.deliveryAddresses || [];
}

function defaultAddress(companyId) {
  return deliveryAddresses(companyId).find((item) => item.isDefault) || null;
}

function addressTitle(item) {
  return item.label || item.address;
}

function normalizeCart(candidate) {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return {};
  return Object.fromEntries(Object.entries(candidate)
    .map(([sku, qty]) => [sku, Math.min(999, Math.floor(Number(qty)))])
    .filter(([sku, qty]) => findVariant(sku) && qty > 0));
}

function findVariant(sku) {
  for (const product of CATALOG) {
    const variant = product.variants.find((item) => item.sku === sku);
    if (variant) return { product, variant };
  }
  return null;
}

function saveStore() {
  try {
    // На сервере в браузере остаётся только корзина: учётная запись и заказы живут в базе.
    localStorage.setItem(STORAGE_KEY, JSON.stringify(serverMode ? { cart: store.cart } : store));
  } catch {
    // Хранилище недоступно (приватный режим, запрет cookies): прототип продолжает работать в памяти.
  }
  if (serverMode) scheduleAccountSync();
}

// ---------- Сервер: сессия и сохранение кабинета ----------

async function apiRequest(method, url, body) {
  try {
    const response = await fetch(url, {
      method,
      credentials: "same-origin",
      headers: body === undefined ? { Accept: "application/json" } : { "Content-Type": "application/json", Accept: "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const data = await response.json().catch(() => ({}));
    return { ok: response.ok, status: response.status, data };
  } catch {
    return { ok: false, status: 0, data: { error: "Сервер недоступен. Проверьте соединение и попробуйте ещё раз." } };
  }
}

const accountSnapshot = () => (store.account ? JSON.stringify({ companies: store.account.companies, activeCompanyId: store.account.activeCompanyId }) : "");

// Юрлица и адреса сохраняются на сервере с небольшой задержкой, чтобы серия правок ушла одним запросом.
function scheduleAccountSync() {
  clearTimeout(accountSyncTimer);
  if (!store.session || accountSnapshot() === lastSyncedAccount) return;
  accountSyncTimer = setTimeout(syncAccount, 400);
}

// Возвращает true, если на сервере актуальная версия юрлиц и адресов.
async function syncAccount() {
  const snapshot = accountSnapshot();
  if (!snapshot || snapshot === lastSyncedAccount) return true;
  const { ok, status, data } = await apiRequest("PUT", "/api/account", { account: JSON.parse(snapshot) });
  if (ok) {
    lastSyncedAccount = snapshot;
    return true;
  }
  if (status === 401 || status === 403) {
    endServerSession(data.error || "Сессия закончилась. Войдите снова.");
    return false;
  }
  showToast(`Изменения не сохранены на сервере: ${data.error || "попробуйте ещё раз"}`);
  return false;
}

// Отправить отложенное сохранение сейчас, не дожидаясь паузы.
function flushAccountSync() {
  clearTimeout(accountSyncTimer);
  return syncAccount();
}

// Ответ сервера с пользователем превращается в тот же store, с которым работает весь кабинет.
function applyServerSession(data) {
  if (data.user?.role === "manager") {
    window.location.href = "/admin";
    return false;
  }
  if (!data.user || !data.account?.companies?.length) {
    store = { account: null, session: false, orders: [], cart: store.cart };
    lastSyncedAccount = "";
    return false;
  }
  const { name, email, phone } = data.user;
  store = normalizeStore({
    account: { user: { name, email, phone: phone || "", passwordHash: "" }, companies: data.account.companies, activeCompanyId: data.account.activeCompanyId },
    session: true,
    orders: Array.isArray(data.orders) ? data.orders.slice().reverse() : [],
    cart: store.cart
  });
  lastSyncedAccount = accountSnapshot();
  return Boolean(store.account);
}

function endServerSession(message) {
  store = { account: null, session: false, orders: [], cart: store.cart };
  lastSyncedAccount = "";
  closeModal({ restoreFocus: false });
  showAuth();
  switchAuthTab("login");
  if (message) setMessage("#login-message", message);
}

// Есть ли рядом server.js. Демо и открытый с диска файл сервер не спрашивают.
async function detectServer() {
  if (IS_DEMO || !/^https?:$/.test(location.protocol)) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(SESSION_URL, { credentials: "same-origin", headers: { Accept: "application/json" }, signal: controller.signal });
    const data = response.ok ? await response.json() : null;
    return data?.mode === "server" ? data : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function readView() {
  try { return localStorage.getItem(ACTIVE_VIEW_KEY); } catch { return null; }
}

function writeView(value) {
  try {
    if (value) localStorage.setItem(ACTIVE_VIEW_KEY, value);
    else localStorage.removeItem(ACTIVE_VIEW_KEY);
  } catch {}
}

function initials(name = "") {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "ST";
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#039;", '"': "&quot;" })[character]);
}

async function hashPassword(value) {
  if (window.crypto?.subtle) {
    const buffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
    return Array.from(new Uint8Array(buffer)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  // Только fallback для локального прототипа. В production пароль хэшируется на backend.
  return btoa(unescape(encodeURIComponent(value)));
}

function normalizeCompany(item) {
  const data = item.data || item;
  const name = data.name?.short_with_opf || data.name?.full_with_opf || data.name?.short || data.name || item.value || "Организация";
  const address = data.address?.unrestricted_value || data.address?.value || data.address || "Адрес не указан";
  return {
    value: item.value || name,
    name,
    inn: data.inn || item.inn || "",
    kpp: data.kpp || item.kpp || "—",
    address,
    data
  };
}

async function searchCompanies(query, signal) {
  const value = query.trim();
  if (value.length < 3) return [];
  if (IS_DEMO) return demoSearch(value);

  try {
    const response = await fetch(`${DADATA_PROXY_URL}?query=${encodeURIComponent(value)}`, {
      headers: { Accept: "application/json" },
      signal
    });
    // Прототип без сервера: 404 — прокси не запущен, 503 — не задан ключ поиска, работаем на тестовых данных.
    // На рабочем сервере тестовые организации не подставляем: зарегистрироваться можно только на настоящую.
    // Исключение — сервер, запущенный на своём компьютере для проверки (localhost).
    if (allowTestCompanies() && (response.status === 404 || response.status === 503)) return demoSearch(value);
    if (!response.ok) return { error: true };
    const payload = await response.json();
    const suggestions = payload.suggestions || payload.data || payload;
    if (Array.isArray(suggestions)) return suggestions.map(normalizeCompany).filter((company) => company.inn);
  } catch (error) {
    if (error.name === "AbortError") return null;
    // Сервер недоступен (например, страница открыта как файл) — локальный fallback для проверки прототипа.
    return allowTestCompanies() ? demoSearch(value) : { error: true };
  }
  return [];
}

const allowTestCompanies = () => !serverMode || ["localhost", "127.0.0.1"].includes(location.hostname);

function demoSearch(value) {
  const normalized = value.toLowerCase();
  return demoCompanies
    .filter((company) => `${company.value} ${company.inn}`.toLowerCase().includes(normalized))
    .map((company) => ({ ...normalizeCompany(company), demo: true }));
}

function renderCompanySuggestions(companies, query) {
  const container = $("#company-suggestions");
  suggestionItems = Array.isArray(companies) ? companies.slice(0, 6) : [];
  suggestionIndex = -1;
  if (companies.error) {
    suggestionItems = [];
    container.innerHTML = `<div class="suggestion-empty">Поиск организации временно недоступен. Попробуйте ещё раз через минуту.</div>`;
    container.hidden = false;
    container.setAttribute("aria-busy", "false");
    $("#company-query").setAttribute("aria-expanded", "true");
    return;
  }
  if (!companies.length) {
    const exactInn = query.replace(/\D/g, "");
    container.innerHTML = IS_DEMO
      ? `<div class="suggestion-empty">${DEMO_SEARCH_HINT}</div>`
      : exactInn.length >= 10
      ? `<div class="suggestion-empty">Организация не найдена. Проверьте ИНН или попробуйте ещё раз.</div>`
      : `<div class="suggestion-empty">Начните вводить ИНН или название организации.</div>`;
    container.hidden = false;
    container.setAttribute("aria-busy", "false");
    $("#company-query").setAttribute("aria-expanded", "true");
    return;
  }
  container.innerHTML = suggestionItems.map((company, index) => `
    <button class="suggestion" id="company-option-${index}" role="option" aria-selected="false" type="button" data-company-index="${index}">
      <strong>${escapeHtml(company.name || company.value)}${company.demo ? ` <span class="demo-badge">тест</span>` : ""}</strong>
      <small>ИНН ${escapeHtml(company.inn)} · ${escapeHtml(company.address)}</small>
    </button>`).join("");
  container.hidden = false;
  container.setAttribute("aria-busy", "false");
  $("#company-query").setAttribute("aria-expanded", "true");
  container.querySelectorAll("[data-company-index]").forEach((button, index) => {
    button.addEventListener("click", () => selectCompany(suggestionItems[index]));
  });
}

function updateSuggestionFocus() {
  const buttons = $$("#company-suggestions [role='option']");
  buttons.forEach((button, index) => button.setAttribute("aria-selected", String(index === suggestionIndex)));
  const input = $("#company-query");
  if (suggestionIndex >= 0 && buttons[suggestionIndex]) {
    input.setAttribute("aria-activedescendant", buttons[suggestionIndex].id);
  } else {
    input.removeAttribute("aria-activedescendant");
  }
}

function selectCompany(company) {
  selectedCompany = company;
  $("#company-query").value = company.inn || company.name;
  $("#company-suggestions").hidden = true;
  $("#company-query").setAttribute("aria-expanded", "false");
  $("#company-query").removeAttribute("aria-activedescendant");
  $("#company-selected").innerHTML = `
    <div><strong>${escapeHtml(company.name || company.value)}</strong><span>ИНН ${escapeHtml(company.inn)} · ${escapeHtml(company.address)}</span></div>
    <button type="button" data-action="clear-company">Изменить</button>`;
  $("#company-selected").hidden = false;
  $("[data-action='clear-company']").addEventListener("click", clearCompany);
}

function clearCompany() {
  selectedCompany = null;
  $("#company-selected").hidden = true;
  $("#company-query").value = "";
  $("#company-query").setAttribute("aria-expanded", "false");
  $("#company-suggestions").hidden = true;
  $("#company-query").focus();
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 3600);
}

function setMessage(selector, message, success = false) {
  const element = $(selector);
  element.textContent = message;
  element.classList.toggle("success", success);
}

const AUTH_TEXT = {
  login: ["Вход в кабинет", "Используйте email и пароль, чтобы продолжить."],
  register: ["Создайте кабинет", "Укажите ИНН — мы подставим реквизиты организации автоматически."],
  forgot: ["Восстановление пароля", "Укажите email кабинета — пришлём ссылку, чтобы задать новый пароль."],
  reset: ["Новый пароль", "Придумайте новый пароль для входа в кабинет."]
};

function switchAuthTab(tab) {
  $$('.auth-tab[data-auth-tab]').forEach((button) => {
    const isActive = button.dataset.authTab === tab;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-selected", String(isActive));
  });
  $(".auth-tabs").classList.toggle("is-hidden", tab === "forgot" || tab === "reset");
  ["login", "register", "forgot", "reset"].forEach((name) => {
    $(`#${name}-form`).classList.toggle("is-hidden", name !== tab);
    $(`#${name}-form`).setAttribute("aria-hidden", String(name !== tab));
    setMessage(`#${name}-message`, "");
  });
  $("#auth-title").textContent = AUTH_TEXT[tab][0];
  $("#auth-subtitle").textContent = AUTH_TEXT[tab][1];
}

function showApp() {
  $("#auth-screen").classList.add("is-hidden");
  $("#app-screen").classList.remove("is-hidden");
  renderAccount();
  navigateTo(readView() || "dashboard");
}

function showAuth() {
  $("#app-screen").classList.add("is-hidden");
  $("#auth-screen").classList.remove("is-hidden");
}

function renderAccount() {
  const account = store.account;
  if (!account) return;
  const user = account.user;
  const company = activeCompany();
  const all = isAllCompanies();
  $("#user-avatar").textContent = initials(user.name);
  $("#user-name").textContent = user.name;
  $("#user-email-short").textContent = user.email;
  $("#dashboard-name").textContent = user.name.trim().split(/\s+/)[0];
  renderCompanySwitch();

  // Карточка на главной: реквизиты текущего юрлица или список всех.
  $("#company-card-title").textContent = all ? `Юрлица (${companies().length})` : "Организация";
  $("#company-details").hidden = all;
  $("#company-overview").hidden = !all;
  if (all) {
    $("#company-overview").innerHTML = companies().map((item) => {
      const count = store.orders.filter((order) => order.companyId === item.id).length;
      return `<button type="button" class="company-overview-item" data-company-switch="${escapeHtml(item.id)}">
        <strong>${escapeHtml(companyTitle(item))}</strong>
        <span>${escapeHtml(companyRequisites(item))} · ${count} ${plural(count, ["заказ", "заказа", "заказов"])}</span>
      </button>`;
    }).join("");
  } else {
    $("#company-name").textContent = companyTitle(company);
    $("#company-inn").textContent = [company.inn, company.kpp && company.kpp !== "—" ? company.kpp : ""].filter(Boolean).join(" / ") || "—";
    $("#company-address").textContent = company.address || "Адрес не указан";
    $("#company-email").textContent = user.email;
    const main = defaultAddress();
    const others = deliveryAddresses().length - 1;
    $("#company-delivery").textContent = main
      ? `${addressTitle(main)}${others > 0 ? ` (ещё ${others} ${plural(others, ["адрес", "адреса", "адресов"])})` : ""}`
      : "Не добавлен";
  }
  $("#orders-subtitle").textContent = all
    ? "Заказы всех ваших юрлиц в одном месте."
    : companies().length > 1 ? `Заказы юрлица ${companyTitle(company)}.` : "Все заказы вашей организации в одном месте.";
  renderAddresses();
  renderCompaniesList();
  $("#profile-avatar").textContent = initials(user.name);
  $("#profile-name").textContent = user.name;
  $("#profile-email").textContent = user.email;
  $("#profile-phone").textContent = user.phone || "";
  $("#profile-phone").hidden = !user.phone;
  renderOrders();
}

// Переключатель в шапке: юрлица, «Все юрлица» (если их больше одного) и «Добавить юрлицо…».
function renderCompanySwitch() {
  const list = companies();
  const current = isAllCompanies() ? ALL_COMPANIES : activeCompany()?.id;
  $("#company-switch").innerHTML = list.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(companyTitle(item))}</option>`).join("")
    + (list.length > 1 ? `<option value="${ALL_COMPANIES}">Все юрлица (${list.length})</option>` : "")
    + `<option value="${ADD_COMPANY}">+ Добавить юрлицо…</option>`;
  $("#company-switch").value = current;
}

function setActiveCompany(id) {
  if (id !== ALL_COMPANIES && !companyById(id)) return;
  store.account.activeCompanyId = id;
  confirmDeleteAddressId = null;
  saveStore();
  renderAccount();
}

function renderCompaniesList() {
  const current = activeCompany();
  $("#companies-list").innerHTML = companies().map((item) => {
    const isCurrent = current?.id === item.id;
    return `<div class="company-list-item${isCurrent ? " is-current" : ""}">
      <div class="company-list-text">
        <strong>${escapeHtml(companyTitle(item))}${isCurrent ? ' <span class="address-default">Текущее</span>' : ""}</strong>
        <span>${escapeHtml(companyRequisites(item))}</span>
        <span>${escapeHtml(item.address || "Адрес не указан")}</span>
      </div>
      ${isCurrent ? "" : `<button type="button" class="text-button" data-company-switch="${escapeHtml(item.id)}">Перейти</button>`}
    </div>`;
  }).join("");
}

function renderOrders() {
  const orders = visibleOrders();
  const active = orders.filter((order) => order.status !== COMPLETED_STATUS && order.status !== CANCELLED_STATUS).length;
  const completed = orders.filter((order) => order.status === COMPLETED_STATUS).length;
  $("#orders-count").textContent = orders.length;
  $("#orders-active").textContent = active;
  $("#orders-completed").textContent = completed;
  const sum = orders.filter((order) => order.status !== CANCELLED_STATUS).reduce((acc, order) => acc + (typeof order.total === "number" ? order.total : 0), 0);
  $("#orders-sum").textContent = formatPrice(sum);
  const empty = `<div class="empty-state">${companies().length > 1 && !isAllCompanies() ? "У этого юрлица пока нет заказов." : "У вас пока нет заказов."} Создайте первый заказ, и он появится здесь.</div>`;
  const rows = orders.slice().reverse().map(orderRow).join("") || empty;
  $("#dashboard-orders").innerHTML = orders.length ? orders.slice().reverse().slice(0, 4).map(orderRow).join("") : empty;
  $("#all-orders").innerHTML = rows;
}

function orderTotalLabel(order) {
  return typeof order.total === "number" ? formatPrice(order.total) : "Сумма не указана";
}

function orderRow(order) {
  const statusClass = order.status === COMPLETED_STATUS ? "done"
    : order.status === NOT_SENT_STATUS || order.status === CANCELLED_STATUS ? "warn"
    : order.status === NEW_STATUS ? "new" : "work";
  const positions = Array.isArray(order.items) ? order.items.length : 0;
  const summary = positions ? ` · ${positions} ${plural(positions, ["позиция", "позиции", "позиций"])}` : "";
  // В режиме «Все юрлица» в строке видно, от какого юрлица заказ.
  const owner = isAllCompanies() ? companyById(order.companyId) : null;
  return `<button type="button" class="order-row" data-order="${escapeHtml(order.number)}" aria-label="Открыть заказ ${escapeHtml(order.number)}">
    <span class="order-number">${escapeHtml(order.number)}</span>
    <span class="order-date">${owner ? `${escapeHtml(companyTitle(owner))} · ` : ""}${escapeHtml(order.date)} · ${escapeHtml(order.delivery || "—")}${escapeHtml(summary)}</span>
    <span class="order-total">${escapeHtml(orderTotalLabel(order))}</span>
    <span class="order-status ${statusClass}">${escapeHtml(order.status || "В работе")}</span>
  </button>`;
}

function plural(count, [one, few, many]) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

function navigateTo(view) {
  const allowed = ["dashboard", "orders", "profile"];
  const target = allowed.includes(view) ? view : "dashboard";
  ["dashboard", "orders", "profile"].forEach((name) => $((`#${name}-view`)).classList.toggle("is-hidden", name !== target));
  $$('[data-nav]').forEach((button) => {
    const isActive = button.dataset.nav === target;
    button.classList.toggle("is-active", isActive);
    if (button.classList.contains("nav-link")) {
      if (isActive) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    }
  });
  writeView(target);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function openModal(id, focusSelector) {
  if (activeModal) closeModal({ restoreFocus: false });
  else lastFocusedElement = document.activeElement;
  const modal = $(`#${id}`);
  activeModal = modal;
  modal.classList.remove("is-hidden");
  modal.setAttribute("aria-hidden", "false");
  document.body.classList.add("has-modal");
  ($(focusSelector) || modal).focus();
}

function closeModal({ restoreFocus = true } = {}) {
  if (!activeModal) return;
  // Незавершённые поиски не должны показать результаты в уже закрытом окне.
  clearTimeout(companyAddTimer);
  companyAddController?.abort();
  clearTimeout(addressTimer);
  addressController?.abort();
  activeModal.classList.add("is-hidden");
  activeModal.setAttribute("aria-hidden", "true");
  activeModal = null;
  document.body.classList.remove("has-modal");
  if (restoreFocus && lastFocusedElement && document.contains(lastFocusedElement)) lastFocusedElement.focus();
  if (restoreFocus) lastFocusedElement = null;
}

// ---------- Оформление заказа ----------

// Юрлицо заказа: по умолчанию текущее, в режиме «Все юрлица» — первое; при нескольких юрлицах выбирается в форме.
function renderOrderCompany(companyId = activeCompany()?.id || companies()[0]?.id) {
  orderCompanyId = companyById(companyId) ? companyId : companies()[0].id;
  const list = companies();
  $("#order-company-field").hidden = list.length < 2;
  $("#order-company-select").innerHTML = list.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(companyTitle(item))}</option>`).join("");
  $("#order-company-select").value = orderCompanyId;
  const company = companyById(orderCompanyId);
  $("#order-company").innerHTML = `<strong>${escapeHtml(companyTitle(company))}</strong><span>${escapeHtml(companyRequisites(company))}</span>`;
}

function openOrderModal(companyId) {
  renderOrderCompany(companyId);
  setMessage("#order-message", "");
  $("#catalog-search").value = catalogQuery;
  renderCategories();
  renderCatalog();
  renderCart();
  renderOrderAddressOptions();
  toggleAddressField();
  openModal("order-modal", "#order-delivery");
}

// Значение списка: "all", id раздела прайса или "group:<id>" — вся группа разделов.
function categoryMatches(product, value = catalogCategory) {
  if (value === "all") return true;
  if (value.startsWith("group:")) {
    const category = CATALOG_CATEGORIES.find((item) => item.id === product.category);
    return category?.group === value.slice(6);
  }
  return product.category === value;
}

function positionsCount(value) {
  return CATALOG.filter((product) => categoryMatches(product, value))
    .reduce((sum, product) => sum + product.variants.length, 0);
}

function renderCategories() {
  const option = (value, label) => `<option value="${escapeHtml(value)}"${value === catalogCategory ? " selected" : ""}>${escapeHtml(label)} (${positionsCount(value)})</option>`;
  $("#catalog-category").innerHTML = option("all", "Все товары") + CATALOG_GROUPS.map((group) => `
    <optgroup label="${escapeHtml(group.label)}">
      ${option(`group:${group.id}`, "Вся группа")}
      ${CATALOG_CATEGORIES.filter((category) => category.group === group.id).map((category) => option(category.id, category.label)).join("")}
    </optgroup>`).join("");
}

function filteredCatalog() {
  const query = catalogQuery.trim().toLowerCase();
  return CATALOG.filter((product) => categoryMatches(product))
    .filter((product) => !query
      || product.name.toLowerCase().includes(query)
      || product.variants.some((variant) => variant.sku.includes(query)));
}

function renderCatalog() {
  const products = filteredCatalog();
  const positions = products.reduce((sum, product) => sum + product.variants.length, 0);
  $("#catalog-note").textContent = `${positions} ${plural(positions, ["позиция", "позиции", "позиций"])} · цены по прайсу от ${CATALOG_PRICE_DATE}`;
  if (!products.length) {
    $("#catalog-list").innerHTML = `<div class="empty-state">Ничего не нашли. Проверьте артикул или выберите другую категорию.</div>`;
    return;
  }
  // Товары идут блоками по категориям прайса, чтобы длинный список легко просматривался.
  const groups = CATALOG_CATEGORIES.filter((category) => category.id !== "all")
    .map((category) => ({ category, items: products.filter((product) => product.category === category.id) }))
    .filter((group) => group.items.length);
  const shownGroups = new Set(groups.map((group) => group.category.group));
  $("#catalog-list").innerHTML = groups.map((group, index) => `
    ${shownGroups.size > 1 && group.category.group !== groups[index - 1]?.category.group
      ? `<h3 class="catalog-supergroup">${escapeHtml(CATALOG_GROUPS.find((item) => item.id === group.category.group)?.label || "")}</h3>` : ""}
    <div class="catalog-group">
      <h4 class="catalog-group-title">${escapeHtml(group.category.label)}</h4>
      ${group.items.map((product) => `
        <article class="product">
          <h5>${escapeHtml(product.name)}</h5>
          ${product.variants.map(variantRow).join("")}
        </article>`).join("")}
    </div>`).join("");
}

function variantRow(variant) {
  const qty = store.cart[variant.sku] || 0;
  const label = `${escapeHtml(variant.volume)}, артикул ${escapeHtml(variant.sku)}`;
  const stepper = variant.inStock
    ? `<div class="stepper" role="group" aria-label="Количество: ${label}">
        <button type="button" data-cart-step="-1" data-sku="${escapeHtml(variant.sku)}" aria-label="Уменьшить" ${qty ? "" : "disabled"}>−</button>
        <input type="number" inputmode="numeric" min="0" max="999" value="${qty}" data-cart-input data-sku="${escapeHtml(variant.sku)}" aria-label="Количество" />
        <button type="button" data-cart-step="1" data-sku="${escapeHtml(variant.sku)}" aria-label="Увеличить">+</button>
      </div>`
    : `<span class="stock-out">Нет в наличии</span>`;
  return `<div class="variant${qty ? " is-selected" : ""}${variant.inStock ? "" : " is-disabled"}" data-variant="${escapeHtml(variant.sku)}">
    <div class="variant-info">
      <span><span class="variant-volume">${escapeHtml(variant.volume)}</span> <strong>${formatPrice(variant.price)}</strong></span>
      <small>арт. ${escapeHtml(variant.sku)}${variant.inStock ? "" : " · под заказ"}</small>
    </div>
    ${stepper}
  </div>`;
}

function cartLines() {
  return Object.entries(store.cart)
    .map(([sku, qty]) => {
      const match = findVariant(sku);
      return match ? { sku, qty, name: match.product.name, volume: match.variant.volume, price: match.variant.price } : null;
    })
    .filter(Boolean);
}

function promoDiscount(subtotal) {
  return appliedPromo ? Math.round(subtotal * appliedPromo.percent / 100) : 0;
}

function renderCart() {
  const lines = cartLines();
  const units = lines.reduce((sum, line) => sum + line.qty, 0);
  const subtotal = lines.reduce((sum, line) => sum + line.qty * line.price, 0);
  const discount = promoDiscount(subtotal);
  $("#cart-count").textContent = units;
  $("#cart-positions").textContent = lines.length
    ? `${lines.length} ${plural(lines.length, ["позиция", "позиции", "позиций"])} · ${units} шт.`
    : "Товары не выбраны";
  $("#cart-discount").hidden = !appliedPromo;
  $("#cart-discount").textContent = appliedPromo ? `Скидка ${appliedPromo.percent}% по ${appliedPromo.code}: −${formatPrice(discount)}` : "";
  $("#cart-total").textContent = formatPrice(subtotal - discount);
}

// Применяет промокод из поля; пустое поле снимает скидку. Возвращает false, если код не найден.
function applyPromo() {
  const code = $("#order-promo").value.trim().toUpperCase();
  const hint = $("#promo-hint");
  if (!code) {
    appliedPromo = null;
    hint.textContent = "";
    hint.dataset.tone = "";
    renderCart();
    return true;
  }
  const percent = PROMO_CODES[code];
  appliedPromo = percent ? { code, percent } : null;
  $("#order-promo").value = code;
  hint.textContent = percent ? `Промокод применён: скидка ${percent}% на товары.` : "Такого промокода нет. Проверьте написание.";
  hint.dataset.tone = percent ? "ok" : "error";
  renderCart();
  return Boolean(percent);
}

function resetPromo() {
  appliedPromo = null;
  $("#order-promo").value = "";
  $("#promo-hint").textContent = "";
  $("#promo-hint").dataset.tone = "";
}

function setCartQty(sku, qty) {
  const match = findVariant(sku);
  if (!match || !match.variant.inStock) return;
  const value = Math.max(0, Math.min(999, Math.floor(Number(qty) || 0)));
  if (value) store.cart[sku] = value;
  else delete store.cart[sku];
  saveStore();
  const row = $(`[data-variant="${CSS.escape(sku)}"]`);
  if (row) {
    row.classList.toggle("is-selected", value > 0);
    const input = row.querySelector("[data-cart-input]");
    if (input && document.activeElement !== input) input.value = value;
    const minus = row.querySelector("[data-cart-step='-1']");
    const minusHadFocus = document.activeElement === minus;
    minus.disabled = value === 0;
    if (minusHadFocus && value === 0) row.querySelector("[data-cart-step='1']").focus();
  }
  renderCart();
}

function toggleAddressField() {
  const isDelivery = $("#order-delivery").value === "Доставка";
  $("#order-address-field").hidden = !isDelivery;
  $("#order-pickup-info").hidden = $("#order-delivery").value !== "Самовывоз";
  if (isDelivery) syncOrderAddressMode();
  else hideAddressSuggestions();
}

// Список сохранённых адресов в заказе; «Другой адрес…» открывает поле с подсказками DaData.
function renderOrderAddressOptions(preferredAddress = "") {
  const list = deliveryAddresses(orderCompanyId);
  const select = $("#order-saved-address");
  const match = preferredAddress ? list.find((item) => item.address === preferredAddress) : null;
  select.innerHTML = list.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.label ? `${item.label} — ${item.address}` : item.address)}</option>`).join("")
    + `<option value="${NEW_ADDRESS}">Другой адрес…</option>`;
  select.value = match ? match.id : preferredAddress ? NEW_ADDRESS : (defaultAddress(orderCompanyId)?.id || NEW_ADDRESS);
  // Без сохранённых адресов подставляем юридический адрес, как раньше.
  const fallback = list.length ? "" : companyById(orderCompanyId)?.address || "";
  $("#order-address").value = select.value === NEW_ADDRESS ? (preferredAddress || fallback) : "";
  $("#order-save-address").checked = !list.length;
  syncOrderAddressMode();
}

function syncOrderAddressMode() {
  const hasSaved = deliveryAddresses(orderCompanyId).length > 0;
  const isNew = !hasSaved || $("#order-saved-address").value === NEW_ADDRESS;
  $("#order-saved-address-wrap").hidden = !hasSaved;
  $("#order-new-address").hidden = !isNew;
  $("#order-address-label").textContent = hasSaved ? "Новый адрес *" : "Адрес доставки *";
  if (!isNew) hideAddressSuggestions();
}

function selectedOrderAddress() {
  const select = $("#order-saved-address");
  if (deliveryAddresses(orderCompanyId).length && select.value !== NEW_ADDRESS) {
    const saved = deliveryAddresses(orderCompanyId).find((item) => item.id === select.value);
    return { address: saved?.address || "", isNew: false };
  }
  return { address: $("#order-address").value.trim(), isNew: true };
}

// Отправка заказа на сервер: он делит заказ по юрлицам STYX и отправляет менеджеру письмо с бланками.
// Возвращает { sent: true } или { sent: false, reason } — заказ тогда сохраняется в кабинете как «Не отправлен».
// { error } — сервер отклонил заказ (например, позиции нет в каталоге), сохранять его нельзя.
async function sendOrder(order, company) {
  if (IS_DEMO) return { sent: false, reason: "в демо-версии письмо не отправляется" };
  const user = store.account.user;
  try {
    const response = await fetch(ORDERS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        number: order.number,
        date: order.date,
        company: { name: companyTitle(company), inn: company.inn, kpp: company.kpp, address: company.address },
        contact: { name: user.name, email: user.email, phone: user.phone || "" },
        delivery: order.delivery,
        address: order.address,
        comment: order.comment,
        items: order.items.map(({ sku, qty }) => ({ sku, qty })),
        promoCode: order.promoCode || ""
      })
    });
    const payload = await response.json().catch(() => ({}));
    if (response.ok) return { sent: true };
    if (response.status === 400) return { error: payload.error || "Сервер не принял заказ." };
    const reasons = { 404: "сервер заказов недоступен", 503: "почта для заказов на сервере не настроена" };
    return { sent: false, reason: reasons[response.status] || "письмо менеджеру не отправилось" };
  } catch {
    return { sent: false, reason: "сервер заказов недоступен" };
  }
}

// На сервере номер, цены и статус заказа назначает сервер; письмо менеджеру уходит оттуда же.
// Даже если письмо не ушло, заказ сохранён в базе и виден менеджеру в кабинете.
async function sendServerOrder(order) {
  const { ok, status, data } = await apiRequest("POST", ORDERS_URL, {
    companyId: order.companyId,
    delivery: order.delivery,
    address: order.address,
    comment: order.comment,
    items: order.items.map(({ sku, qty }) => ({ sku, qty })),
    promoCode: order.promoCode || ""
  });
  if (ok) return { sent: data.mailStatus === "sent", order: data.order };
  if (status === 401 || status === 403) {
    closeModal({ restoreFocus: false });
    endServerSession(data.error || "Сессия закончилась. Войдите снова — корзина сохранена.");
  }
  return { error: data.error || "сервер не ответил, попробуйте ещё раз." };
}

async function handleCreateOrder(event) {
  event.preventDefault();
  const submitButton = $("#order-submit");
  if (submitButton.disabled) return;
  const delivery = $("#order-delivery").value;
  const { address, isNew: isNewAddress } = selectedOrderAddress();
  const comment = $("#order-comment").value.trim();
  const items = cartLines();
  if (!delivery) {
    setMessage("#order-message", "Выберите способ получения.");
    $("#order-delivery").focus();
    return;
  }
  if (delivery === "Доставка" && !address) {
    setMessage("#order-message", "Укажите адрес доставки.");
    $(isNewAddress ? "#order-address" : "#order-saved-address").focus();
    return;
  }
  if (!items.length) {
    setMessage("#order-message", "Добавьте хотя бы один товар.");
    $("#catalog-search").focus();
    return;
  }
  // Код введён, но не применён кнопкой — применяем сейчас; неверный код не даём отправить молча.
  const typedPromo = $("#order-promo").value.trim().toUpperCase();
  if (typedPromo !== (appliedPromo?.code || "") && !applyPromo()) {
    setMessage("#order-message", "Промокод не найден. Исправьте его или очистите поле.");
    $("#order-promo").focus();
    return;
  }
  const lastNumber = store.orders.reduce((max, order) => Math.max(max, Number(String(order.number).replace(/\D/g, "")) || 0), 0);
  const orderNumber = `STYX-${String(lastNumber + 1).padStart(5, "0")}`;
  const subtotal = items.reduce((sum, line) => sum + line.qty * line.price, 0);
  const discount = promoDiscount(subtotal);
  const total = subtotal - discount;
  const company = companyById(orderCompanyId);
  const order = {
    number: orderNumber,
    companyId: company.id,
    companyName: companyTitle(company),
    date: new Intl.DateTimeFormat("ru-RU").format(new Date()),
    createdAt: new Date().toISOString(),
    delivery,
    address: delivery === "Доставка" ? address : PICKUP_ADDRESS,
    comment,
    items,
    subtotal,
    ...(appliedPromo ? { promoCode: appliedPromo.code, discountPercent: appliedPromo.percent, discount } : {}),
    total,
    status: "В работе"
  };
  submitButton.disabled = true;
  setMessage("#order-message", "Отправляем заказ…");
  // Только что добавленное юрлицо должно попасть на сервер раньше заказа на него.
  if (serverMode && !(await flushAccountSync())) {
    submitButton.disabled = false;
    setMessage("#order-message", "Не удалось сохранить юрлица на сервере. Проверьте соединение и попробуйте ещё раз.");
    return;
  }
  const result = serverMode ? await sendServerOrder(order) : await sendOrder(order, company);
  if (result.order) Object.assign(order, result.order);
  submitButton.disabled = false;
  if (result.error) {
    setMessage("#order-message", `Заказ не отправлен: ${result.error}`);
    return;
  }
  setMessage("#order-message", "");
  if (!result.sent && !serverMode) order.status = IS_DEMO ? order.status : NOT_SENT_STATUS;
  store.orders.push(order);
  if (delivery === "Доставка" && isNewAddress && $("#order-save-address").checked) {
    saveDeliveryAddress({ companyId: company.id, label: "", address, isDefault: !deliveryAddresses(company.id).length });
  }
  store.cart = {};
  // Заказ от другого юрлица: переключаем кабинет на него, чтобы новый заказ был виден в списке.
  if (!isAllCompanies() && activeCompany()?.id !== company.id) store.account.activeCompanyId = company.id;
  saveStore();
  $("#order-form").reset();
  resetPromo();
  renderOrderAddressOptions();
  setAddressHint(ADDRESS_HINT);
  catalogQuery = "";
  toggleAddressField();
  renderAccount();
  closeModal({ restoreFocus: false });
  lastFocusedElement = null;
  navigateTo("orders");
  $("#orders-view h1").focus();
  const saved = companies().length > 1 ? `Заказ ${order.number} от ${companyTitle(company)}` : `Заказ ${order.number}`;
  showToast(result.sent ? `${saved} отправлен менеджеру` : serverMode ? `${saved} принят — менеджер увидит его в своём кабинете` : `${saved} сохранён, но ${result.reason}`);
}

// ---------- Адрес доставки: подсказки и стандартизация DaData ----------

function addressField(key = "order") {
  const config = ADDRESS_FIELDS[key];
  return { key, input: $(config.input), list: $(config.list), hint: $(config.hint) };
}

function setAddressHint(message, tone = "", key = "order") {
  const { hint } = addressField(key);
  hint.textContent = message;
  hint.dataset.tone = tone;
}

// Без ключа закрывает подсказки во всех полях адреса.
function hideAddressSuggestions(key) {
  (key ? [key] : Object.keys(ADDRESS_FIELDS)).forEach((name) => {
    const { input, list } = addressField(name);
    list.hidden = true;
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
  });
  addressIndex = -1;
}

async function fetchAddressSuggestions(query, signal) {
  try {
    const response = await fetch(`${ADDRESS_SUGGEST_URL}?query=${encodeURIComponent(query)}`, { headers: { Accept: "application/json" }, signal });
    if (!response.ok) return [];
    const payload = await response.json();
    return Array.isArray(payload.suggestions) ? payload.suggestions.filter((item) => item && item.value) : [];
  } catch (error) {
    if (error.name === "AbortError") return null;
    return []; // Сервер не запущен — подсказки просто не показываются, адрес можно ввести вручную.
  }
}

function renderAddressSuggestions(items, key = "order") {
  const { input, list } = addressField(key);
  addressItems = items.slice(0, 6);
  addressIndex = -1;
  if (!addressItems.length) return hideAddressSuggestions(key);
  list.innerHTML = addressItems.map((item, index) => `
    <button class="suggestion" id="${key}-address-option-${index}" role="option" aria-selected="false" type="button" data-address-index="${index}">
      <strong>${escapeHtml(item.value)}</strong>
      ${item.postal_code ? `<small>Индекс ${escapeHtml(item.postal_code)}</small>` : ""}
    </button>`).join("");
  list.hidden = false;
  input.setAttribute("aria-expanded", "true");
}

function selectAddress(item, key = "order") {
  addressField(key).input.value = item.unrestricted_value || item.value;
  hideAddressSuggestions(key);
  setAddressHint("Адрес выбран из подсказок.", "ok", key);
}

async function cleanAddress(key = "order") {
  const { input } = addressField(key);
  const button = $(`[data-action='clean-address'][data-address-field='${key}']`);
  const address = input.value.trim();
  const hint = (message, tone) => setAddressHint(message, tone, key);
  if (!address) {
    hint("Сначала введите адрес.", "warn");
    input.focus();
    return;
  }
  hideAddressSuggestions(key);
  button.disabled = true;
  button.textContent = "Проверяем…";
  try {
    const response = await fetch(ADDRESS_CLEAN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ address })
    });
    if (response.status === 404 || response.status === 405 || response.status === 501) {
      hint("Проверка адреса сейчас недоступна. Проверьте адрес вручную.", "warn");
      return;
    }
    if (response.status === 503) {
      hint("Проверка адреса сейчас недоступна. Проверьте адрес вручную.", "warn");
      return;
    }
    if (!response.ok) {
      hint("Проверка адреса сейчас недоступна. Проверьте адрес вручную.", "warn");
      return;
    }
    const data = await response.json();
    if (data.qc === 2 || !data.result) {
      hint("Не удалось распознать адрес. Уточните город, улицу и дом.", "error");
      return;
    }
    input.value = data.result;
    hint(data.qc === 0
      ? "Адрес проверен."
      : "Адрес распознан неуверенно — проверьте результат.", data.qc === 0 ? "ok" : "warn");
  } catch {
    hint("Проверка адреса сейчас недоступна. Проверьте адрес вручную.", "warn");
  } finally {
    button.disabled = false;
    button.textContent = "Проверить адрес";
  }
}

// ---------- Адреса доставки организации ----------

function saveDeliveryAddress({ companyId = activeCompany()?.id, id = null, label, address, isDefault }) {
  const company = companyById(companyId);
  const list = company.deliveryAddresses || [];
  const existing = id ? list.find((item) => item.id === id) : list.find((item) => item.address === address);
  if (existing) {
    // При правке адреса название можно и стереть; при сохранении адреса из заказа прежнее название сохраняется.
    existing.label = id ? label : label || existing.label;
    existing.address = address;
    if (isDefault) list.forEach((item) => { item.isDefault = item === existing; });
  } else {
    const created = { id: `addr-${Date.now()}`, label, address, isDefault: isDefault || !list.length };
    if (created.isDefault) list.forEach((item) => { item.isDefault = false; });
    list.push(created);
  }
  company.deliveryAddresses = normalizeAddresses(list);
  saveStore();
}

function addressItemsHtml(company) {
  const list = company.deliveryAddresses;
  const companyAttr = `data-company-id="${escapeHtml(company.id)}"`;
  return list.length ? list.map((item) => `
    <div class="address-item">
      <div class="address-item-text">
        <strong>${escapeHtml(addressTitle(item))}${item.isDefault ? ' <span class="address-default">Основной</span>' : ""}</strong>
        ${item.label ? `<span>${escapeHtml(item.address)}</span>` : ""}
      </div>
      <div class="address-item-actions">
        ${item.isDefault ? "" : `<button type="button" class="text-button" data-address-action="default" ${companyAttr} data-address-id="${escapeHtml(item.id)}">Сделать основным</button>`}
        <button type="button" class="text-button" data-address-action="edit" ${companyAttr} data-address-id="${escapeHtml(item.id)}">Изменить</button>
        <button type="button" class="text-button text-button-danger" data-address-action="delete" ${companyAttr} data-address-id="${escapeHtml(item.id)}">${confirmDeleteAddressId === item.id ? "Точно удалить?" : "Удалить"}</button>
      </div>
    </div>`).join("")
    : `<div class="empty-state">Адресов пока нет. Добавьте склад, магазин или офис, куда привозить заказы.</div>`;
}

// У каждого юрлица свои адреса; в режиме «Все юрлица» они показаны блоками по юрлицам.
function renderAddresses() {
  const all = isAllCompanies();
  const current = activeCompany();
  $("#add-address-button").hidden = all;
  $("#addresses-title").textContent = all || companies().length < 2 ? "Адреса доставки" : `Адреса доставки — ${companyTitle(current)}`;
  $("#addresses-list").innerHTML = all
    ? companies().map((company) => `
      <div class="address-group">
        <div class="address-group-head">
          <h3>${escapeHtml(companyTitle(company))}</h3>
          <button type="button" class="text-button" data-action="add-address" data-company-id="${escapeHtml(company.id)}">Добавить адрес</button>
        </div>
        ${addressItemsHtml(company)}
      </div>`).join("")
    : addressItemsHtml(current);
}

function openAddressModal(id = null, companyId = activeCompany()?.id) {
  addressCompanyId = companyById(companyId) ? companyId : companies()[0].id;
  const item = id ? deliveryAddresses(addressCompanyId).find((entry) => entry.id === id) : null;
  editingAddressId = item ? item.id : null;
  $("#address-modal-title").textContent = item ? "Изменить адрес" : "Новый адрес";
  $("#address-edit-label").value = item?.label || "";
  $("#address-edit-value").value = item?.address || "";
  $("#address-edit-default").checked = item ? item.isDefault : !deliveryAddresses(addressCompanyId).length;
  // Основной адрес есть всегда: снять отметку можно, только выбрав основным другой адрес.
  const onlyDefault = item ? item.isDefault : !deliveryAddresses(addressCompanyId).length;
  $("#address-edit-default").disabled = onlyDefault;
  $("#address-default-hint").hidden = !onlyDefault;
  $("#address-modal .eyebrow").textContent = companies().length > 1 ? `Адреса доставки · ${companyTitle(companyById(addressCompanyId))}` : "Адреса доставки";
  setAddressHint(ADDRESS_HINT, "", "saved");
  setMessage("#address-message", "");
  openModal("address-modal", item ? "#address-edit-value" : "#address-edit-label");
}

function handleAddressSave(event) {
  event.preventDefault();
  const label = $("#address-edit-label").value.trim();
  const address = $("#address-edit-value").value.trim();
  if (address.length < 5) {
    setMessage("#address-message", "Укажите адрес: город, улицу и дом.");
    $("#address-edit-value").focus();
    return;
  }
  const duplicate = deliveryAddresses(addressCompanyId).find((item) => item.address === address && item.id !== editingAddressId);
  if (duplicate) {
    setMessage("#address-message", `Такой адрес уже есть в списке: «${addressTitle(duplicate)}».`);
    return;
  }
  saveDeliveryAddress({ companyId: addressCompanyId, id: editingAddressId, label, address, isDefault: $("#address-edit-default").checked });
  const wasEditing = Boolean(editingAddressId);
  editingAddressId = null;
  renderAccount();
  closeModal();
  showToast(wasEditing ? "Адрес обновлён" : "Адрес добавлен");
}

function handleAddressAction(button) {
  const id = button.dataset.addressId;
  const company = companyById(button.dataset.companyId) || activeCompany();
  const action = button.dataset.addressAction;
  if (action === "edit") return openAddressModal(id, company.id);
  if (action === "default") {
    company.deliveryAddresses.forEach((item) => { item.isDefault = item.id === id; });
    confirmDeleteAddressId = null;
    saveStore();
    renderAccount();
    showToast("Основной адрес изменён");
    return;
  }
  if (action === "delete") {
    // Удаление в два нажатия: первое спрашивает подтверждение прямо на кнопке.
    if (confirmDeleteAddressId !== id) {
      confirmDeleteAddressId = id;
      renderAddresses();
      $(`[data-address-action='delete'][data-address-id='${CSS.escape(id)}']`)?.focus();
      return;
    }
    confirmDeleteAddressId = null;
    company.deliveryAddresses = normalizeAddresses(company.deliveryAddresses.filter((item) => item.id !== id));
    saveStore();
    renderAccount();
    showToast("Адрес удалён");
  }
}

// ---------- Добавление юрлица по ИНН ----------

function openCompanyModal() {
  clearTimeout(companyAddTimer);
  companyAddController?.abort();
  companyAddController = null;
  $("#company-add-query").value = "";
  $("#company-add-results").innerHTML = "";
  companyAddItems = [];
  setMessage("#company-message", "");
  openModal("company-modal", "#company-add-query");
}

function renderCompanyResults(items) {
  companyAddItems = items.slice(0, 6);
  const existing = new Set(companies().map(companyKey));
  $("#company-add-results").innerHTML = companyAddItems.length
    ? companyAddItems.map((item, index) => {
      const added = existing.has(companyKey(item));
      return `<button type="button" class="company-result" data-company-result="${index}" ${added ? "disabled" : ""}>
        <strong>${escapeHtml(companyTitle(item))}${item.demo ? ' <span class="demo-badge">тест</span>' : ""}</strong>
        <span>${escapeHtml(companyRequisites(item))}${added ? " · уже в кабинете" : ""}</span>
        <span>${escapeHtml(item.address || "")}</span>
      </button>`;
    }).join("")
    : `<div class="suggestion-empty">${IS_DEMO ? DEMO_SEARCH_HINT : "Ничего не нашли. Проверьте ИНН."}</div>`;
}

function addCompany(item) {
  if (companies().some((company) => companyKey(company) === companyKey(item))) {
    setMessage("#company-message", "Это юрлицо уже есть в кабинете.");
    return;
  }
  if (companies().length >= MAX_COMPANIES) {
    setMessage("#company-message", `В кабинете может быть не больше ${MAX_COMPANIES} юрлиц.`);
    return;
  }
  const { demo: _demo, ...clean } = item;
  const company = normalizeCompanies([clean])[0];
  store.account.companies.push(company);
  store.account.activeCompanyId = company.id;
  saveStore();
  renderAccount();
  closeModal();
  showToast(`${companyTitle(company)} добавлено и выбрано в кабинете`);
}

// ---------- Карточка заказа ----------

function openOrderDetails(number) {
  const order = store.orders.find((item) => item.number === number);
  if (!order) return;
  openedOrderNumber = number;
  const items = Array.isArray(order.items) ? order.items : [];
  $("#order-details-title").textContent = order.number;
  const owner = companies().length > 1 ? companyTitle(companyById(order.companyId)) || order.companyName : "";
  const place = order.address || (order.delivery === "Самовывоз" ? PICKUP_ADDRESS : "");
  $("#order-details-meta").textContent = [owner, order.date, order.status, order.delivery, place].filter(Boolean).join(" · ");
  const rows = items.map((line) => `<tr>
      <td><strong>${escapeHtml(line.name)}</strong><small>${escapeHtml(line.volume)} · арт. ${escapeHtml(line.sku)}</small></td>
      <td class="num">${escapeHtml(line.qty)} шт.</td>
      <td class="num">${formatPrice(line.qty * line.price)}</td>
    </tr>`).join("");
  $("#order-details-body").innerHTML = `${items.length
    ? `<table class="order-table"><thead><tr><th>Товар</th><th class="num">Кол-во</th><th class="num">Сумма</th></tr></thead><tbody>${rows}</tbody></table>`
    : `<div class="empty-state">Состав заказа не сохранён — заказ создан в прошлой версии кабинета.</div>`}
    ${order.discount ? `<p class="order-discount"><span>Товары ${formatPrice(order.subtotal)} · скидка ${escapeHtml(order.discountPercent)}% по промокоду ${escapeHtml(order.promoCode)}</span><strong>−${formatPrice(order.discount)}</strong></p>` : ""}
    ${order.comment ? `<p class="order-comment"><span>Комментарий</span>${escapeHtml(order.comment)}</p>` : ""}`;
  $("#order-details-total").textContent = orderTotalLabel(order);
  $("[data-action='repeat-order']").hidden = !items.length;
  $("[data-action='resend-order']").hidden = order.status !== NOT_SENT_STATUS || !items.length;
  openModal("order-details-modal", "#order-details-modal .modal-close");
}

// Повторная отправка заказа, который не ушёл менеджеру (сервер был недоступен или почта не настроена).
async function resendOrder() {
  const order = store.orders.find((item) => item.number === openedOrderNumber);
  const button = $("[data-action='resend-order']");
  if (!order || button.disabled) return;
  button.disabled = true;
  const result = await sendOrder(order, companyById(order.companyId) || { name: order.companyName });
  button.disabled = false;
  if (result.sent) {
    order.status = "В работе";
    saveStore();
    renderAccount();
    openOrderDetails(order.number);
  }
  showToast(result.sent ? `Заказ ${order.number} отправлен менеджеру` : `Заказ ${order.number} не отправлен: ${result.error || result.reason}`);
}

function repeatOrder() {
  const order = store.orders.find((item) => item.number === openedOrderNumber);
  if (!order || !Array.isArray(order.items)) return;
  const skipped = [];
  order.items.forEach((line) => {
    const match = findVariant(line.sku);
    const qty = Math.floor(Number(line.qty)) || 0;
    if (match && match.variant.inStock && qty > 0) store.cart[line.sku] = Math.min(999, (store.cart[line.sku] || 0) + qty);
    else skipped.push(line.name);
  });
  saveStore();
  catalogCategory = "all";
  catalogQuery = "";
  $("#catalog-search").value = "";
  openOrderModal(order.companyId);
  $("#order-delivery").value = order.delivery || "";
  renderOrderAddressOptions(order.delivery === "Доставка" ? order.address || "" : "");
  toggleAddressField();
  if (skipped.length) setMessage("#order-message", `Нет в наличии и не добавлено: ${skipped.join(", ")}.`);
  showToast("Товары из заказа добавлены к корзине — цены актуальные");
}

// ---------- Профиль ----------

function openProfileModal() {
  const user = store.account.user;
  $("#profile-edit-name").value = user.name;
  $("#profile-edit-email").value = user.email;
  $("#profile-edit-phone").value = user.phone || "";
  setMessage("#profile-message", "");
  openModal("profile-modal", "#profile-edit-name");
}

async function handleProfileSave(event) {
  event.preventDefault();
  const name = $("#profile-edit-name").value.trim();
  const email = $("#profile-edit-email").value.trim().toLowerCase();
  const phone = $("#profile-edit-phone").value.trim();
  if (!name) {
    setMessage("#profile-message", "Укажите имя.");
    return;
  }
  if (!EMAIL_PATTERN.test(email)) {
    setMessage("#profile-message", "Проверьте email.");
    return;
  }
  if (phone && phone.replace(/\D/g, "").length < 10) {
    setMessage("#profile-message", "Проверьте номер телефона.");
    return;
  }
  if (serverMode) {
    const button = event.submitter;
    if (button) button.disabled = true;
    const { ok, data } = await apiRequest("PUT", "/api/account", { user: { name, email, phone } });
    if (button) button.disabled = false;
    if (!ok) {
      setMessage("#profile-message", data.error || "Профиль не сохранён.");
      return;
    }
  }
  store.account.user = { ...store.account.user, name, email, phone };
  saveStore();
  renderAccount();
  closeModal();
  showToast("Профиль обновлён");
}

async function handleRegister(event) {
  event.preventDefault();
  setMessage("#register-message", "");
  const name = $("#register-name").value.trim();
  const email = $("#register-email").value.trim().toLowerCase();
  const password = $("#register-password").value;
  const confirmation = $("#register-password-confirm").value;
  if (!selectedCompany) {
    setMessage("#register-message", "Выберите организацию из подсказок.");
    return;
  }
  if (name.length < 2) {
    setMessage("#register-message", "Укажите ваше имя.");
    return;
  }
  if (!EMAIL_PATTERN.test(email)) {
    setMessage("#register-message", "Проверьте email.");
    return;
  }
  if (password.length < 8) {
    setMessage("#register-message", "Пароль должен быть не короче 8 символов.");
    return;
  }
  if (password !== confirmation) {
    setMessage("#register-message", "Пароли не совпадают.");
    return;
  }
  if (serverMode) return registerOnServer(event, { name, email, password });
  if (store.account?.user?.email === email) {
    setMessage("#register-message", "Этот email уже зарегистрирован. Войдите в кабинет.");
    return;
  }
  // Прототип хранит один кабинет на браузер: новая регистрация заменяет прежний вместе с заказами — только с согласия.
  if (store.account && !window.confirm(`В этом браузере уже есть кабинет ${store.account.user.email}${store.orders.length ? ` с заказами (${store.orders.length})` : ""}. Заменить его новым? Прежний кабинет и его заказы удалятся.`)) {
    setMessage("#register-message", `Войдите как ${store.account.user.email} или подтвердите замену кабинета.`);
    return;
  }

  const passwordHash = await hashPassword(password);
  const firstCompany = normalizeCompanies([selectedCompany])[0];
  store.account = { user: { name, email, passwordHash }, companies: [firstCompany], activeCompanyId: firstCompany.id };
  store.orders = [];
  store.cart = {};
  store.session = true;
  saveStore();
  selectedCompany = null;
  event.target.reset();
  showToast("Кабинет создан — реквизиты сохранены");
  showApp();
}

async function registerOnServer(event, { name, email, password }) {
  const button = event.submitter;
  if (button) button.disabled = true;
  const company = normalizeCompanies([selectedCompany])[0];
  const { ok, data } = await apiRequest("POST", "/api/auth/register", { name, email, password, company, consent: $("#register-consent").checked });
  if (button) button.disabled = false;
  if (!ok) {
    setMessage("#register-message", data.error || "Не удалось создать кабинет.");
    return;
  }
  selectedCompany = null;
  event.target.reset();
  if (data.status === "pending") {
    // Кабинет откроется после проверки менеджером — клиенту придёт письмо.
    switchAuthTab("login");
    $("#login-email").value = email;
    setMessage("#login-message", data.message, true);
    return;
  }
  applyServerSession(data);
  showToast("Кабинет создан — реквизиты сохранены");
  showApp();
}

async function handleLogin(event) {
  event.preventDefault();
  const email = $("#login-email").value.trim().toLowerCase();
  if (serverMode) {
    const button = event.submitter;
    if (button) button.disabled = true;
    const { ok, data } = await apiRequest("POST", "/api/auth/login", { email, password: $("#login-password").value });
    if (button) button.disabled = false;
    if (!ok) {
      setMessage("#login-message", data.error || "Не удалось войти.");
      return;
    }
    event.target.reset();
    if (applyServerSession(data)) showApp();
    return;
  }
  const passwordHash = await hashPassword($("#login-password").value);
  if (!store.account || store.account.user.email !== email || store.account.user.passwordHash !== passwordHash) {
    setMessage("#login-message", "Неверный email или пароль.");
    return;
  }
  store.session = true;
  saveStore();
  event.target.reset();
  showApp();
}

async function handleForgot(event) {
  event.preventDefault();
  const button = event.submitter;
  if (button) button.disabled = true;
  const { ok, data } = await apiRequest("POST", "/api/auth/forgot", { email: $("#forgot-email").value.trim() });
  if (button) button.disabled = false;
  setMessage("#forgot-message", data.message || data.error || "Не удалось отправить ссылку.", ok);
}

async function handleReset(event) {
  event.preventDefault();
  const password = $("#reset-password").value;
  if (password.length < 8) {
    setMessage("#reset-message", "Пароль должен быть не короче 8 символов.");
    return;
  }
  const token = new URLSearchParams(location.search).get("reset");
  const { ok, data } = await apiRequest("POST", "/api/auth/reset", { token, password });
  if (!ok) {
    setMessage("#reset-message", data.error || "Не удалось сменить пароль.");
    return;
  }
  history.replaceState(null, "", location.pathname);
  event.target.reset();
  switchAuthTab("login");
  setMessage("#login-message", data.message, true);
}

function bindEvents() {
  $$('[data-auth-tab]').forEach((button) => button.addEventListener("click", () => switchAuthTab(button.dataset.authTab)));
  $("#login-form").addEventListener("submit", handleLogin);
  $("#forgot-form").addEventListener("submit", handleForgot);
  $("#reset-form").addEventListener("submit", handleReset);
  $("#register-form").addEventListener("submit", handleRegister);
  $("#order-form").addEventListener("submit", handleCreateOrder);
  $("#profile-form").addEventListener("submit", handleProfileSave);
  $("#order-delivery").addEventListener("change", () => { toggleAddressField(); setMessage("#order-message", ""); });

  Object.keys(ADDRESS_FIELDS).forEach((key) => {
    const { input, list } = addressField(key);
    input.addEventListener("input", (event) => {
      setAddressHint(ADDRESS_HINT, "", key);
      setMessage(key === "order" ? "#order-message" : "#address-message", "");
      clearTimeout(addressTimer);
      addressController?.abort();
      const query = event.target.value.trim();
      if (query.length < 3) return hideAddressSuggestions(key);
      const controller = new AbortController();
      addressController = controller;
      addressTimer = setTimeout(async () => {
        const items = await fetchAddressSuggestions(query, controller.signal);
        if (!items || controller !== addressController || event.target.value.trim() !== query) return;
        renderAddressSuggestions(items, key);
      }, 300);
    });
    input.addEventListener("keydown", (event) => {
      const buttons = Array.from(list.querySelectorAll("[role='option']"));
      if (event.key === "Escape" && !list.hidden) {
        event.preventDefault();
        event.stopPropagation();
        hideAddressSuggestions(key);
        return;
      }
      if (event.key === "Enter") event.preventDefault();
      if (list.hidden || !buttons.length) return;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const direction = event.key === "ArrowDown" ? 1 : -1;
        addressIndex = addressIndex < 0 ? (direction === 1 ? 0 : buttons.length - 1) : (addressIndex + direction + buttons.length) % buttons.length;
        buttons.forEach((button, index) => button.setAttribute("aria-selected", String(index === addressIndex)));
        event.target.setAttribute("aria-activedescendant", buttons[addressIndex].id);
      }
      if (event.key === "Enter" && addressIndex >= 0) selectAddress(addressItems[addressIndex], key);
    });
    // Фокус остаётся в поле при клике по подсказке; при уходе из поля список закрывается.
    list.addEventListener("mousedown", (event) => event.preventDefault());
    input.addEventListener("blur", () => hideAddressSuggestions(key));
    list.addEventListener("click", (event) => {
      const option = event.target.closest("[data-address-index]");
      if (option) selectAddress(addressItems[Number(option.dataset.addressIndex)], key);
    });
  });
  $("#order-saved-address").addEventListener("change", () => {
    syncOrderAddressMode();
    setMessage("#order-message", "");
    if ($("#order-saved-address").value === NEW_ADDRESS) $("#order-address").focus();
  });
  $("#address-form").addEventListener("submit", handleAddressSave);
  $("#company-switch").addEventListener("change", (event) => {
    if (event.target.value === ADD_COMPANY) {
      renderCompanySwitch();
      openCompanyModal();
      return;
    }
    setActiveCompany(event.target.value);
    showToast(isAllCompanies() ? "Показаны все юрлица" : `Выбрано: ${companyTitle(activeCompany())}`);
  });
  $("#order-company-select").addEventListener("change", (event) => {
    renderOrderCompany(event.target.value);
    renderOrderAddressOptions();
    toggleAddressField();
    setMessage("#order-message", "");
  });
  $("#company-form").addEventListener("submit", (event) => event.preventDefault());
  $("#company-add-query").addEventListener("input", (event) => {
    clearTimeout(companyAddTimer);
    companyAddController?.abort();
    setMessage("#company-message", "");
    const query = event.target.value.trim();
    if (query.length < 3) {
      $("#company-add-results").innerHTML = "";
      $("#company-add-spinner").classList.remove("is-loading");
      return;
    }
    const controller = new AbortController();
    companyAddController = controller;
    $("#company-add-spinner").classList.add("is-loading");
    companyAddTimer = setTimeout(async () => {
      const items = await searchCompanies(query, controller.signal);
      if (controller !== companyAddController) return;
      $("#company-add-spinner").classList.remove("is-loading");
      if (!items) return;
      if (items.error) {
        $("#company-add-results").innerHTML = `<div class="suggestion-empty">Поиск организации временно недоступен. Попробуйте ещё раз через минуту.</div>`;
        return;
      }
      renderCompanyResults(items);
    }, 300);
  });
  $("#company-add-results").addEventListener("click", (event) => {
    const button = event.target.closest("[data-company-result]");
    if (button) addCompany(companyAddItems[Number(button.dataset.companyResult)]);
  });
  $("#addresses-list").addEventListener("click", (event) => {
    const button = event.target.closest("[data-address-action]");
    if (button) handleAddressAction(button);
  });
  document.addEventListener("mousedown", (event) => {
    if (!event.target.closest(".address-field")) hideAddressSuggestions();
  });

  // Enter в поиске и комментарии не должен отправлять заказ.
  ["#catalog-search", "#order-comment"].forEach((selector) => $(selector).addEventListener("keydown", (event) => {
    if (event.key === "Enter") event.preventDefault();
  }));
  $("#order-promo").addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    applyPromo();
  });
  $("#order-promo").addEventListener("input", () => {
    // Код изменили после применения — скидка снимается до нового «Применить».
    if (appliedPromo && $("#order-promo").value.trim().toUpperCase() !== appliedPromo.code) {
      appliedPromo = null;
      $("#promo-hint").textContent = "";
      renderCart();
    }
    setMessage("#order-message", "");
  });
  $("#catalog-search").addEventListener("input", (event) => {
    catalogQuery = event.target.value;
    renderCatalog();
  });
  $("#catalog-category").addEventListener("change", (event) => {
    catalogCategory = event.target.value;
    renderCatalog();
  });
  $("#catalog-list").addEventListener("click", (event) => {
    const step = event.target.closest("[data-cart-step]");
    if (!step) return;
    setCartQty(step.dataset.sku, (store.cart[step.dataset.sku] || 0) + Number(step.dataset.cartStep));
    setMessage("#order-message", "");
  });
  $("#catalog-list").addEventListener("change", (event) => {
    const input = event.target.closest("[data-cart-input]");
    if (!input) return;
    setCartQty(input.dataset.sku, input.value);
    input.value = store.cart[input.dataset.sku] || 0;
  });
  $("#catalog-list").addEventListener("keydown", (event) => {
    if (event.key === "Enter" && event.target.matches("[data-cart-input]")) {
      event.preventDefault();
      event.target.dispatchEvent(new Event("change", { bubbles: true }));
    }
  });

  $$('[data-password-toggle]').forEach((button) => button.addEventListener("click", () => {
    const input = $(button.dataset.passwordToggle);
    input.type = input.type === "password" ? "text" : "password";
    button.textContent = input.type === "password" ? "Показать" : "Скрыть";
    button.setAttribute("aria-label", input.type === "password" ? "Показать пароль" : "Скрыть пароль");
  }));

  $("#company-query").addEventListener("input", (event) => {
    selectedCompany = null;
    $("#company-selected").hidden = true;
    $("#company-suggestions").hidden = true;
    event.target.setAttribute("aria-expanded", "false");
    event.target.removeAttribute("aria-activedescendant");
    suggestionItems = [];
    suggestionIndex = -1;
    clearTimeout(searchTimer);
    searchRequestId += 1;
    searchController?.abort();
    searchController = null;
    const query = event.target.value;
    if (query.trim().length < 3) {
      $("#company-spinner").classList.remove("is-loading");
      $("#company-suggestions").setAttribute("aria-busy", "false");
      return;
    }
    $("#company-spinner").classList.add("is-loading");
    $("#company-suggestions").setAttribute("aria-busy", "true");
    const requestId = searchRequestId;
    const controller = new AbortController();
    searchController = controller;
    searchTimer = setTimeout(async () => {
      try {
        const companies = await searchCompanies(query, controller.signal);
        if (requestId !== searchRequestId || query !== $("#company-query").value || !companies) return;
        renderCompanySuggestions(companies, query);
      } finally {
        if (requestId === searchRequestId) {
          $("#company-spinner").classList.remove("is-loading");
          $("#company-suggestions").setAttribute("aria-busy", "false");
        }
      }
    }, 280);
  });

  $("#company-query").addEventListener("keydown", (event) => {
    const container = $("#company-suggestions");
    const buttons = $$("#company-suggestions [role='option']");
    if (event.key === "Escape") {
      container.hidden = true;
      event.currentTarget.setAttribute("aria-expanded", "false");
      event.currentTarget.removeAttribute("aria-activedescendant");
      suggestionIndex = -1;
      return;
    }
    if (container.hidden || !buttons.length) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const direction = event.key === "ArrowDown" ? 1 : -1;
      suggestionIndex = suggestionIndex < 0
        ? (direction === 1 ? 0 : buttons.length - 1)
        : (suggestionIndex + direction + buttons.length) % buttons.length;
      updateSuggestionFocus();
    }
    if (event.key === "Enter" && suggestionIndex >= 0) {
      event.preventDefault();
      selectCompany(suggestionItems[suggestionIndex]);
    }
  });

  document.addEventListener("click", (event) => {
    const orderButton = event.target.closest("[data-order]");
    if (orderButton) openOrderDetails(orderButton.dataset.order);
    const switchButton = event.target.closest("[data-company-switch]");
    if (switchButton) {
      setActiveCompany(switchButton.dataset.companySwitch);
      showToast(`Выбрано: ${companyTitle(activeCompany())}`);
    }
    const nav = event.target.closest("[data-nav]");
    if (nav) { event.preventDefault(); navigateTo(nav.dataset.nav); }
    const action = event.target.closest("[data-action]")?.dataset.action;
    if (!action) return;
    if (action === "logout") {
      if (serverMode) {
        apiRequest("POST", "/api/auth/logout", {});
        // При выходе корзина и промокод не переходят к следующему, кто войдёт с этого компьютера.
        store.cart = {};
        resetPromo();
        endServerSession("");
        saveStore();
        writeView(null);
        showToast("Вы вышли из кабинета");
        return;
      }
      store.session = false;
      saveStore();
      writeView(null);
      showAuth();
      switchAuthTab("login");
      showToast("Вы вышли из кабинета");
    }
    if (action === "new-order") openOrderModal();
    if (action === "close-modal") closeModal();
    if (action === "repeat-order") repeatOrder();
    if (action === "resend-order") resendOrder();
    if (action === "clean-address") cleanAddress(event.target.closest("[data-action]").dataset.addressField || "order");
    if (action === "add-address") openAddressModal(null, event.target.closest("[data-action]").dataset.companyId || activeCompany()?.id);
    if (action === "add-company") openCompanyModal();
    if (action === "apply-promo") applyPromo();
    if (action === "forgot-password") {
      if (serverMode) {
        switchAuthTab("forgot");
        $("#forgot-email").value = $("#login-email").value;
        $("#forgot-email").focus();
      } else {
        showToast(IS_DEMO ? "В демо-версии восстановление пароля не работает: письмо со ссылкой отправляет сервер." : "Восстановление пароля работает, когда кабинет запущен на сервере. Сейчас напишите менеджеру STYX.");
      }
    }
    if (action === "edit-profile") openProfileModal();
  });

  $$(".modal-backdrop").forEach((modal) => modal.addEventListener("mousedown", (event) => {
    if (event.target === modal) closeModal();
  }));
  document.addEventListener("keydown", (event) => {
    if (!activeModal) return;
    if (event.key === "Escape") {
      event.preventDefault();
      closeModal();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = Array.from(activeModal.querySelectorAll("button, select, textarea, input"))
      .filter((element) => !element.disabled && !element.closest("[hidden]") && element.offsetParent !== null);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!activeModal.contains(document.activeElement) || document.activeElement === activeModal) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    } else if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
}

async function boot() {
  document.body.classList.add("is-booting");
  bindEvents();
  const server = await detectServer();
  document.body.classList.remove("is-booting");
  if (server) {
    serverMode = true;
    // Учётную запись прототипа из браузера не используем и стираем: на сервере остаётся только корзина.
    store = { account: null, session: false, orders: [], cart: store.cart };
    saveStore();
    if (new URLSearchParams(location.search).get("reset")) {
      showAuth();
      switchAuthTab("reset");
      $("#reset-password").focus();
      return;
    }
    if (!applyServerSession(server)) return;
  }
  if (store.session && store.account) {
    showApp();
    // Прямая ссылка на оформление заказа: .../#new-order
    if (location.hash === "#new-order") openOrderModal();
  }
}

boot();
