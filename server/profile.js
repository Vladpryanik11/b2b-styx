// Профиль клиента на сервере: юрлица и адреса доставки в том же виде, что в кабинете (app.js).
// Всё, что приходит из браузера, обрезается и проверяется здесь.
const text = (value, max) => (typeof value === "string" ? value.trim().slice(0, max) : "");

const MAX_COMPANIES = 30;
const MAX_ADDRESSES = 50;

function normalizeAddresses(list) {
  const items = (Array.isArray(list) ? list : [])
    .filter((item) => item && typeof item.address === "string" && item.address.trim())
    .slice(0, MAX_ADDRESSES)
    .map((item, index) => ({
      id: text(item.id, 60) || `addr-${Date.now()}-${index}`,
      label: text(item.label, 60),
      address: text(item.address, 300),
      isDefault: item.isDefault === true
    }));
  const defaultIndex = Math.max(0, items.findIndex((item) => item.isDefault));
  items.forEach((item, index) => { item.isDefault = index === defaultIndex; });
  return items;
}

/** Юрлицо: ИНН обязателен (10 или 12 цифр), остальное — реквизиты для бланка и письма. */
function normalizeCompany(item) {
  if (!item || typeof item !== "object") return null;
  const inn = text(item.inn, 12);
  if (!/^\d{10}(\d{2})?$/.test(inn)) return null;
  const kpp = text(item.kpp, 9);
  return {
    id: text(item.id, 80) || `company-${inn}-${kpp}`,
    name: text(item.name, 300) || text(item.value, 300) || `ИНН ${inn}`,
    value: text(item.value, 300),
    inn,
    kpp,
    ogrn: text(item.ogrn, 15),
    address: text(item.address, 500),
    deliveryAddresses: normalizeAddresses(item.deliveryAddresses)
  };
}

function normalizeProfile(raw) {
  const seen = new Set();
  const companies = (Array.isArray(raw?.companies) ? raw.companies : [])
    .map(normalizeCompany)
    .filter((company) => company && !seen.has(company.id) && seen.add(company.id))
    .slice(0, MAX_COMPANIES);
  const activeId = raw?.activeCompanyId;
  return {
    companies,
    activeCompanyId: activeId === "all" || companies.some((company) => company.id === activeId) ? activeId : companies[0]?.id || null
  };
}

module.exports = { normalizeProfile, normalizeCompany, text };
