// Заполнение бланков заказа STYX в формате Excel (.xlsx).
// Шаблоны — JSON, снятые с оригинальных бланков .xls скриптом tools/extract-blank.py:
// значения ячеек, стили, высота строк и ширина колонок. Колонки бланка: A — пометка «*Д*»,
// B — артикул, C — наименование, D — цена, E — заказ (количество).
const fs = require("node:fs");
const path = require("node:path");
const ExcelJS = require("exceljs");

const BLANKS_DIR = path.join(__dirname, "..", "blanks");
const COL = { mark: 0, sku: 1, name: 2, price: 3, qty: 4 };

const templateCache = new Map();

// Артикулы прайса, которые в бланке записаны иначе.
const SKU_ALIASES = { "13281Ч": "13281" };

// Артикул из бланка и из каталога сравниваем как строку без пробелов: 82019 и "82019", "0431" и "0431".
function skuKey(value) {
  const key = String(value ?? "").replace(/\s+/g, "").toUpperCase();
  return SKU_ALIASES[key] || key;
}

function loadTemplate(file) {
  if (!templateCache.has(file)) {
    const template = JSON.parse(fs.readFileSync(path.join(BLANKS_DIR, file), "utf8"));
    const value = (row, col) => template.rows[row]?.cells[col]?.[0];
    const headerRow = template.rows.findIndex((row, index) => value(index, COL.sku) === "АРТ.");
    const counterpartyRow = template.rows.findIndex((row, index) => String(value(index, COL.name)).startsWith("Контрагент"));
    if (headerRow < 0 || counterpartyRow < 0) throw new Error(`Бланк ${file}: не найдены строки «АРТ.» или «Контрагент»`);
    const items = new Map();
    template.rows.forEach((row, index) => {
      const sku = skuKey(value(index, COL.sku));
      if (index > headerRow && sku && !items.has(sku)) items.set(sku, index);
    });
    templateCache.set(file, { ...template, headerRow, counterpartyRow, items });
  }
  return templateCache.get(file);
}

function excelStyle(style = {}) {
  const argb = (hex) => ({ argb: `FF${hex}` });
  const font = { name: style.font?.name || "Arial", size: style.font?.size || 9 };
  if (style.font?.bold) font.bold = true;
  if (style.font?.italic) font.italic = true;
  if (style.font?.color) font.color = argb(style.font.color);
  const result = { font };
  if (style.fill) result.fill = { type: "pattern", pattern: "solid", fgColor: argb(style.fill) };
  if (style.align) result.alignment = { horizontal: style.align, vertical: "middle" };
  if (style.border) result.border = Object.fromEntries(Object.entries(style.border).map(([side, kind]) => [side, { style: kind }]));
  if (style.numFmt) result.numFmt = style.numFmt;
  return result;
}

function applyStyle(cell, style) {
  const { font, fill, alignment, border, numFmt } = excelStyle(style);
  cell.font = font;
  if (fill) cell.fill = fill;
  if (alignment) cell.alignment = alignment;
  if (border) cell.border = border;
  if (numFmt) cell.numFmt = numFmt;
}

function addLogos(workbook, sheet, logos = []) {
  logos.forEach(({ file, tl, width, height }) => {
    const imageId = workbook.addImage({ filename: path.join(BLANKS_DIR, file), extension: "png" });
    sheet.addImage(imageId, { tl, ext: { width, height }, editAs: "oneCell" });
  });
}

/**
 * Собирает заполненный бланк.
 * form: { template, sheetName?, logos?, autoFilter? }
 * data: {
 *   counterparty: строка в ячейку «Контрагент»,
 *   info: строки с данными заказа (номер, доставка, комментарий…), вставляются под «Контрагентом»,
 *   lines: [{ sku, name, price, qty }] — позиции этого бланка
 * }
 * Позиции, которых нет в бланке, дописываются в конец отдельным разделом.
 * Цена в заполненной строке — цена заказа (действующий прайс), чтобы сумма бланка совпала с заказом.
 */
async function buildBlank(form, data) {
  const template = loadTemplate(form.template);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "STYX B2B";
  const sheet = workbook.addWorksheet(form.sheetName || template.sheet);
  template.widths.forEach((width, index) => { sheet.getColumn(index + 1).width = width; });

  const linesBySku = new Map();
  const extras = [];
  data.lines.forEach((line) => {
    const key = skuKey(line.sku);
    if (template.items.has(key) && !linesBySku.has(key)) linesBySku.set(key, line);
    else extras.push(line);
  });

  const infoStyle = { font: { name: "Arial", size: 9 }, align: "left" };
  const infoBoldStyle = { font: { name: "Arial", size: 9, bold: true }, align: "left" };
  let out = 0; // номер строки в итоговом листе (с 1)
  let firstItemRow = 0;
  let lastItemRow = 0;
  let sumCell = null;

  const writeRow = (cells, height) => {
    out += 1;
    const row = sheet.getRow(out);
    if (height) row.height = height;
    cells.forEach(([value, style], col) => {
      const cell = row.getCell(col + 1);
      if (value !== "" && value !== null && value !== undefined) cell.value = value;
      applyStyle(cell, style);
    });
    return row;
  };

  // В оригинале после последней позиции идут пустые отформатированные строки — их не переносим.
  const lastRow = template.rows.findLastIndex((row) => row.cells.some(([value]) => value !== ""));
  template.rows.slice(0, lastRow + 1).forEach((tplRow, index) => {
    const cells = tplRow.cells.map(([value, styleId]) => [value, template.styles[styleId]]);
    if (index === template.counterpartyRow) {
      cells[COL.name] = [data.counterparty, cells[COL.name][1]];
      const row = writeRow(cells, tplRow.height);
      // Длинное название организации ужимаем в ячейку, чтобы оно не наезжало на «Сумма:».
      row.getCell(COL.name + 1).alignment = { horizontal: "center", vertical: "middle", shrinkToFit: true };
      sumCell = row.getCell(COL.qty + 1);
      (data.info || []).forEach(({ text, bold }) => {
        const infoRow = writeRow([["", infoStyle], ["", infoStyle], [text, bold ? infoBoldStyle : infoStyle]]);
        infoRow.getCell(COL.name + 1).alignment = { horizontal: "left", vertical: "middle" };
      });
      return;
    }
    const key = index > template.headerRow ? skuKey(cells[COL.sku][0]) : "";
    const line = key && template.items.get(key) === index ? linesBySku.get(key) : null;
    if (line) {
      cells[COL.price] = [line.price, cells[COL.price][1]];
      cells[COL.qty] = [line.qty, cells[COL.qty][1]];
    }
    const row = writeRow(cells, tplRow.height);
    const email = cells.find(([value]) => typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value));
    if (email) {
      const cell = row.getCell(cells.indexOf(email) + 1);
      cell.value = { text: email[0], hyperlink: `mailto:${email[0]}` };
    }
    if (key) {
      firstItemRow ||= out;
      lastItemRow = out;
    }
  });

  if (extras.length) {
    const itemIndex = template.items.values().next().value;
    const sectionIndex = template.headerRow + 1;
    const itemStyles = template.rows[itemIndex].cells.map(([, styleId]) => template.styles[styleId]);
    const sectionStyles = template.rows[sectionIndex].cells.map(([, styleId]) => template.styles[styleId]);
    writeRow(sectionStyles.map((style, col) => [col === COL.name ? "НЕТ В БЛАНКЕ (добавлено из заказа)" : "", style]));
    extras.forEach((line) => {
      writeRow(itemStyles.map((style, col) => [["", line.sku, line.name, line.price, line.qty][col] ?? "", style]));
      lastItemRow = out;
    });
  }

  const total = data.lines.reduce((sum, line) => sum + line.price * line.qty, 0);
  if (sumCell && firstItemRow) {
    sumCell.value = { formula: `SUMPRODUCT(D${firstItemRow}:D${lastItemRow},E${firstItemRow}:E${lastItemRow})`, result: total };
    sumCell.numFmt = "#,##0";
  }
  if (form.autoFilter) sheet.autoFilter = { from: { row: template.headerRow + 1 + (data.info || []).length, column: 1 }, to: { row: template.headerRow + 1 + (data.info || []).length, column: 5 } };
  sheet.views = [{ state: "frozen", ySplit: template.headerRow + 1 + (data.info || []).length }];
  addLogos(workbook, sheet, form.logos);
  return { buffer: Buffer.from(await workbook.xlsx.writeBuffer()), total };
}

module.exports = { buildBlank, loadTemplate, skuKey };
