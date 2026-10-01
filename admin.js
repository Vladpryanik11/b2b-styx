// Кабинет менеджера STYX B2B: вход сотрудника, заказы (статусы, бланки, повторная отправка письма)
// и клиенты (подтверждение регистрации, блокировка). Работает только с сервером (server.js), без демо-режима.
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));
const escapeHtml = (value = "") => String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#039;", '"': "&quot;" })[character]);
const priceFormatter = new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 0 });
const formatPrice = (value) => priceFormatter.format(Number(value) || 0);
const formatDateTime = (iso) => (iso ? new Intl.DateTimeFormat("ru-RU", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Moscow" }).format(new Date(iso)) : "—");

const CLIENT_STATUS = { pending: ["Ждёт подтверждения", "work"], active: ["Активен", "done"], blocked: ["Заблокирован", "warn"] };
const MAIL_STATUS = { sent: ["Письмо ушло", "ok"], failed: ["Письмо не ушло", "bad"], off: ["Почта не настроена", "bad"], pending: ["Письмо не отправлялось", "bad"] };

const state = { user: null, orders: [], statuses: [], clients: [], tab: "orders", clientFilter: "", query: "", statusFilter: "" };
let toastTimer = null;

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 3600);
}

function setMessage(selector, message, success = false) {
  $(selector).textContent = message;
  $(selector).classList.toggle("success", success);
}

async function api(method, path, body) {
  let response;
  try {
    response = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: body === undefined ? { Accept: "application/json" } : { "Content-Type": "application/json", Accept: "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
  } catch {
    return { ok: false, status: 0, data: { error: "Сервер недоступен. Проверьте соединение." } };
  }
  const data = await response.json().catch(() => ({}));
  if (response.status === 401 && !path.startsWith("/api/auth/")) {
    // Сессия закончилась посреди работы: возвращаемся ко входу и объясняем почему.
    if (state.user) {
      showAuth("login");
      setMessage("#admin-login-message", "Сессия закончилась. Войдите снова.");
    }
  }
  return { ok: response.ok, status: response.status, data };
}

// ---------- Вход ----------

function showAuth(mode) {
  state.user = null;
  if (mode !== "reset" && new URLSearchParams(window.location.search).has("reset")) history.replaceState(null, "", "/admin");
  ["login", "forgot", "reset"].forEach((name) => setMessage(`#admin-${name}-message`, ""));
  $("#admin-app").classList.add("is-hidden");
  $("#admin-auth").classList.remove("is-hidden");
  ["login", "forgot", "reset"].forEach((name) => $(`#admin-${name}-form`).classList.toggle("is-hidden", name !== mode));
  $("#admin-auth-title").textContent = { login: "Вход для сотрудников", forgot: "Восстановление пароля", reset: "Новый пароль" }[mode];
  $(`#admin-${mode}-form input`).focus();
}

async function showApp(user) {
  state.user = user;
  $("#admin-auth").classList.add("is-hidden");
  $("#admin-app").classList.remove("is-hidden");
  $("#admin-user-name").textContent = user.name;
  await refresh();
  $(`#${state.tab}-title`).focus();
}

async function handleLogin(event) {
  event.preventDefault();
  const button = event.submitter || $("#admin-login-form [type=submit]");
  button.disabled = true;
  const { ok, data } = await api("POST", "/api/auth/login", { email: $("#admin-login-email").value.trim(), password: $("#admin-login-password").value });
  button.disabled = false;
  if (!ok) return setMessage("#admin-login-message", data.error || "Не удалось войти.");
  if (data.user?.role !== "manager") {
    // Клиент открыл адрес менеджера — отправляем в свой кабинет, сессия уже открыта.
    window.location.href = "/";
    return;
  }
  setMessage("#admin-login-message", "");
  $("#admin-login-form").reset();
  showApp(data.user);
}

async function handleForgot(event) {
  event.preventDefault();
  const button = $("#admin-forgot-form [type=submit]");
  if (button.disabled) return;
  button.disabled = true;
  const { ok, data } = await api("POST", "/api/auth/forgot", { email: $("#admin-forgot-email").value.trim() });
  button.disabled = false;
  setMessage("#admin-forgot-message", data.message || data.error || "Не удалось отправить ссылку.", ok);
}

async function handleReset(event) {
  event.preventDefault();
  if ($("#admin-reset-password").value.length < 8) return setMessage("#admin-reset-message", "Пароль должен быть не короче 8 символов.");
  const token = new URLSearchParams(window.location.search).get("reset");
  const { ok, data } = await api("POST", "/api/auth/reset", { token, password: $("#admin-reset-password").value });
  if (!ok) return setMessage("#admin-reset-message", data.error || "Не удалось сменить пароль.");
  showAuth("login");
  setMessage("#admin-login-message", data.message, true);
}

async function logout() {
  await api("POST", "/api/auth/logout", {});
  showAuth("login");
}

// ---------- Данные ----------

async function refresh() {
  const [orders, clients] = await Promise.all([api("GET", "/api/admin/orders"), api("GET", "/api/admin/clients")]);
  if (!orders.ok || !clients.ok) {
    if (orders.status !== 401 && clients.status !== 401) showToast(orders.data.error || clients.data.error || "Не удалось загрузить данные.");
    return;
  }
  state.orders = orders.data.orders;
  state.statuses = orders.data.statuses;
  state.clients = clients.data.clients;
  const filter = $("#orders-status-filter");
  if (filter.options.length === 1) filter.insertAdjacentHTML("beforeend", state.statuses.map((status) => `<option>${escapeHtml(status)}</option>`).join(""));
  render();
}

function render() {
  const pending = state.clients.filter((client) => client.status === "pending").length;
  $("#pending-badge").hidden = !pending;
  $("#pending-badge-count").textContent = pending;
  $("#pending-badge-label").textContent = `, ждут подтверждения: ${pending}`;
  renderOrders();
  renderClients();
}

// ---------- Заказы ----------

function orderMatches(order) {
  if (state.statusFilter && order.status !== state.statusFilter) return false;
  if (!state.query) return true;
  const haystack = [order.number, order.companyName, order.company?.inn, order.client?.name, order.client?.email].join(" ").toLowerCase();
  return haystack.includes(state.query);
}

function orderItem(order) {
  const [mailLabel, mailTone] = MAIL_STATUS[order.mailStatus] || MAIL_STATUS.pending;
  const company = order.company || {};
  const options = state.statuses.map((status) => `<option${status === order.status ? " selected" : ""}>${escapeHtml(status)}</option>`).join("");
  const lines = order.items.map((line) => `<tr><td>${escapeHtml(line.sku)}</td><td>${escapeHtml(line.name)}${line.volume ? `, ${escapeHtml(line.volume)}` : ""}</td><td>${line.qty}</td><td>${formatPrice(line.price * line.qty)}</td></tr>`).join("");
  const blanks = (order.blanks || []).map((blank) => `<a class="secondary-button compact" href="/api/admin/orders/${encodeURIComponent(order.number)}/blank/${encodeURIComponent(blank.id)}">Бланк ${escapeHtml(blank.title)} · ${formatPrice(blank.total)}</a>`).join("");
  return `<article class="admin-item" data-order="${escapeHtml(order.number)}">
    <div class="admin-item-head">
      <span class="admin-number">${escapeHtml(order.number)}<br /><span class="admin-meta">${escapeHtml(formatDateTime(order.createdAt))}</span></span>
      <span class="admin-item-title"><strong>${escapeHtml(order.companyName)}</strong><span>${escapeHtml(order.client ? `${order.client.name} · ${order.client.email}` : "Клиент удалён")}</span></span>
      <span class="admin-sum">${formatPrice(order.total)}</span>
      <span class="mail-flag ${mailTone}">${escapeHtml(mailLabel)}</span>
      <label><span class="visually-hidden">Статус заказа ${escapeHtml(order.number)}</span>
        <select class="admin-status-select" data-status-for="${escapeHtml(order.number)}">${options}</select>
      </label>
    </div>
    <details class="admin-details">
      <summary>Состав и реквизиты</summary>
      <div class="admin-details-body">
        <dl class="admin-facts">
          <dt>Юрлицо</dt><dd>${escapeHtml(company.name || order.companyName)}</dd>
          <dt>Реквизиты</dt><dd>ИНН ${escapeHtml(company.inn || "—")}${company.kpp && company.kpp !== "—" ? `, КПП ${escapeHtml(company.kpp)}` : ""}</dd>
          <dt>Юр. адрес</dt><dd>${escapeHtml(company.address || "—")}</dd>
          <dt>Контакт</dt><dd>${escapeHtml(order.client ? [order.client.name, order.client.phone, order.client.email].filter(Boolean).join(", ") : "—")}</dd>
          <dt>Получение</dt><dd>${escapeHtml(order.delivery)}: ${escapeHtml(order.address || "—")}</dd>
          <dt>Комментарий</dt><dd>${escapeHtml(order.comment || "—")}</dd>
          ${order.promoCode ? `<dt>Промокод</dt><dd>${escapeHtml(order.promoCode)} (−${order.discountPercent}%, ${formatPrice(order.discount)})</dd>` : ""}
        </dl>
        <div>
          <table class="admin-lines">
            <thead><tr><th>Артикул</th><th>Товар</th><th>Кол-во</th><th>Сумма</th></tr></thead>
            <tbody>${lines}</tbody>
          </table>
          <div class="admin-actions">
            ${blanks}
            <button type="button" class="secondary-button compact" data-resend="${escapeHtml(order.number)}">Отправить письмо ещё раз</button>
          </div>
        </div>
      </div>
    </details>
  </article>`;
}

function renderOrders() {
  const orders = state.orders.filter(orderMatches);
  $("#orders-list").innerHTML = orders.map(orderItem).join("")
    || `<div class="empty-state">${state.orders.length ? "Нет заказов по этому фильтру." : "Заказов пока нет."}</div>`;
  $("#orders-count").textContent = state.orders.length ? `Показано заказов: ${orders.length} из ${state.orders.length}` : "";
}

// После перерисовки списка фокус возвращается на тот же элемент, чтобы не терять место при работе с клавиатуры.
function refocus(selector) {
  const element = $(selector);
  element?.focus();
  return Boolean(element);
}

async function changeOrderStatus(select) {
  const number = select.dataset.statusFor;
  const order = state.orders.find((item) => item.number === number);
  select.disabled = true;
  const { ok, data } = await api("POST", `/api/admin/orders/${encodeURIComponent(number)}/status`, { status: select.value });
  select.disabled = false;
  if (!ok) {
    select.value = order.status;
    return showToast(data.error || "Статус не сохранён.");
  }
  Object.assign(order, data.order);
  showToast(`${number}: статус «${order.status}». Клиент увидит его в кабинете.`);
  // Сумма клиента не учитывает отменённые заказы — обновляем карточки клиентов.
  const clients = await api("GET", "/api/admin/clients");
  if (clients.ok) { state.clients = clients.data.clients; renderClients(); }
  if (state.statusFilter) {
    const opened = select.closest("details")?.open;
    renderOrders();
    if (opened) $(`[data-order="${CSS.escape(number)}"] details`)?.setAttribute("open", "");
    refocus(`[data-status-for="${CSS.escape(number)}"]`) || $("#orders-status-filter").focus();
  }
}

async function resendOrder(button) {
  const number = button.dataset.resend;
  button.disabled = true;
  const { ok, data } = await api("POST", `/api/admin/orders/${encodeURIComponent(number)}/resend`, {});
  button.disabled = false;
  const order = state.orders.find((item) => item.number === number);
  if (order && data.mailStatus) order.mailStatus = data.mailStatus;
  const opened = button.closest("details")?.open;
  renderOrders();
  if (opened) $(`[data-order="${CSS.escape(number)}"] details`).open = true;
  refocus(`[data-resend="${CSS.escape(number)}"]`);
  showToast(ok ? `Письмо по заказу ${number} отправлено` : data.error || "Письмо не отправлено.");
}

// ---------- Клиенты ----------

function clientItem(client) {
  const [label, tone] = CLIENT_STATUS[client.status] || CLIENT_STATUS.pending;
  const companies = client.companies.map((company) => `<div>${escapeHtml(company.name)}<br /><span>ИНН ${escapeHtml(company.inn)}${company.kpp ? `, КПП ${escapeHtml(company.kpp)}` : ""}</span></div>`).join("");
  const actions = {
    pending: `<button type="button" class="primary-button compact" data-client="${client.id}" data-set-status="active">Подтвердить</button><button type="button" class="secondary-button compact danger-button" data-client="${client.id}" data-set-status="blocked">Отклонить</button>`,
    active: `<button type="button" class="secondary-button compact danger-button" data-client="${client.id}" data-set-status="blocked">Заблокировать</button>`,
    blocked: `<button type="button" class="secondary-button compact" data-client="${client.id}" data-set-status="active">Разблокировать</button>`
  }[client.status] || "";
  return `<article class="admin-item" data-client-card="${client.id}" tabindex="-1" aria-label="${escapeHtml(client.name)}">
    <div class="admin-item-head client-head">
      <span class="admin-item-title"><strong>${escapeHtml(client.name)}</strong><span>${escapeHtml([client.email, client.phone].filter(Boolean).join(" · "))}</span><span>Регистрация: ${escapeHtml(formatDateTime(client.createdAt))} · Вход: ${escapeHtml(formatDateTime(client.lastLoginAt))}</span></span>
      <span class="client-companies">${companies || "—"}</span>
      <span class="admin-item-title"><strong>${client.ordersCount} ${plural(client.ordersCount, ["заказ", "заказа", "заказов"])}</strong><span>${formatPrice(client.ordersTotal)}</span></span>
      <span class="client-state"><span class="order-status ${tone}">${label}</span>${actions}</span>
    </div>
  </article>`;
}

function plural(count, [one, few, many]) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

function renderClients() {
  const clients = state.clients.filter((client) => !state.clientFilter || client.status === state.clientFilter);
  $("#clients-list").innerHTML = clients.map(clientItem).join("")
    || `<div class="empty-state">${state.clients.length ? "Нет клиентов по этому фильтру." : "Клиентов пока нет."}</div>`;
}

async function setClientStatus(button) {
  const client = state.clients.find((item) => item.id === Number(button.dataset.client));
  const status = button.dataset.setStatus;
  const wasPending = client.status === "pending";
  const question = wasPending
    ? `Отклонить заявку ${client.name} (${client.email})? Войти в кабинет будет нельзя.`
    : `Закрыть доступ к кабинету для ${client.name}? Клиент сразу выйдет из кабинета.`;
  if (status === "blocked" && !window.confirm(question)) return;
  // Соседние карточки — запасная цель фокуса, если эта уйдёт из отфильтрованного списка.
  const cards = $$("[data-client-card]");
  const index = cards.findIndex((card) => card.dataset.clientCard === String(client.id));
  const neighbour = cards[index + 1] || cards[index - 1];
  button.disabled = true;
  const { ok, status: code, data } = await api("POST", `/api/admin/clients/${client.id}/status`, { status, from: client.status });
  button.disabled = false;
  if (code === 409) {
    // Другой менеджер уже решил по этому клиенту: показываем актуальный список, ничего не меняя.
    const fresh = await api("GET", "/api/admin/clients");
    if (fresh.ok) state.clients = fresh.data.clients;
    render();
    refocus(`[data-client-card="${client.id}"]`) || refocus("#clients-title");
    return showToast(data.error);
  }
  if (!ok) return showToast(data.error || "Не удалось изменить доступ.");
  const firstApproval = !client.approvedAt && status === "active";
  client.status = data.client.status;
  if (firstApproval) client.approvedAt = new Date().toISOString();
  render();
  refocus(`[data-client-card="${client.id}"] [data-set-status]`)
    || refocus(`[data-client-card="${client.id}"]`)
    || (neighbour && refocus(`[data-client-card="${neighbour.dataset.clientCard}"] [data-set-status]`))
    || refocus("[data-client-filter].is-active");
  showToast(status === "active"
    ? (firstApproval ? `Кабинет открыт, ${client.email} получит письмо` : "Доступ восстановлен")
    : (wasPending ? "Заявка отклонена" : "Доступ закрыт"));
}

// ---------- Навигация ----------

function switchTab(tab) {
  state.tab = tab;
  $$("[data-tab]").forEach((button) => {
    const active = button.dataset.tab === tab;
    button.classList.toggle("is-active", active);
    if (active) button.setAttribute("aria-current", "page"); else button.removeAttribute("aria-current");
  });
  $("#orders-tab").classList.toggle("is-hidden", tab !== "orders");
  $("#clients-tab").classList.toggle("is-hidden", tab !== "clients");
  $(`#${tab}-title`).focus();
}

function bindEvents() {
  $("#admin-login-form").addEventListener("submit", handleLogin);
  $("#admin-forgot-form").addEventListener("submit", handleForgot);
  $("#admin-reset-form").addEventListener("submit", handleReset);
  $$("[data-auth-mode]").forEach((button) => button.addEventListener("click", () => showAuth(button.dataset.authMode)));
  $$("[data-tab]").forEach((button) => button.addEventListener("click", () => switchTab(button.dataset.tab)));
  $("[data-action='logout']").addEventListener("click", logout);
  $("[data-action='refresh']").addEventListener("click", async ({ currentTarget: button }) => {
    button.disabled = true;
    await refresh();
    button.disabled = false;
  });
  $("#orders-search").addEventListener("input", (event) => { state.query = event.target.value.trim().toLowerCase(); renderOrders(); });
  $("#orders-status-filter").addEventListener("change", (event) => { state.statusFilter = event.target.value; renderOrders(); });
  $("#orders-list").addEventListener("change", (event) => { if (event.target.matches("[data-status-for]")) changeOrderStatus(event.target); });
  $("#orders-list").addEventListener("click", (event) => { const button = event.target.closest("[data-resend]"); if (button) resendOrder(button); });
  $("#clients-list").addEventListener("click", (event) => { const button = event.target.closest("[data-set-status]"); if (button) setClientStatus(button); });
  $$("[data-client-filter]").forEach((chip) => chip.addEventListener("click", () => {
    state.clientFilter = chip.dataset.clientFilter;
    $$("[data-client-filter]").forEach((item) => {
      item.classList.toggle("is-active", item === chip);
      item.setAttribute("aria-pressed", String(item === chip));
    });
    renderClients();
  }));
}

async function init() {
  bindEvents();
  if (new URLSearchParams(window.location.search).get("reset")) return showAuth("reset");
  const { ok, data } = await api("GET", "/api/session");
  if (!ok || data.mode !== "server") {
    showAuth("login");
    setMessage("#admin-login-message", "Кабинет менеджера работает только на сервере. Запустите server.js.");
    return;
  }
  if (data.user?.role === "manager") return showApp(data.user);
  if (data.user) { window.location.href = "/"; return; }
  showAuth("login");
}

init();
