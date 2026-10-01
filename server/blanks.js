// Заполнение бланков заказа STYX (.xlsx) без изменения самих бланков.
// Шаблоны blanks/*.xlsx — ваши бланки, один раз переведённые из .xls в .xlsx (LibreOffice, см. README).
// В файле меняются только ячейки: «Контрагент» и количество в колонке «ЗАКАЗ» (E) у заказанных позиций.
// Оформление, логотипы, формула «Сумма» (SUMPRODUCT), автофильтр, поля печати остаются как в оригинале:
// правим XML листа точечно, а Excel пересчитывает формулы при открытии.
const fs = require("node:fs");
const path = require("node:path");
const JSZip = require("jszip");

const BLANKS_DIR = path.join(__dirname, "..", "blanks");
const SHEET = "xl/worksheets/sheet1.xml";

// Артикулы прайса, которые в бланке записаны иначе.
const SKU_ALIASES = { "13281Ч": "13281" };

// Артикул из бланка и из каталога сравниваем как строку без пробелов: 82019 и "82019", "0431" и "0431".
function skuKey(value) {
  const key = String(value ?? "").replace(/\s+/g, "").toUpperCase();
  return SKU_ALIASES[key] || key;
}

const xmlUnescape = (text) => text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const xmlEscape = (text) => String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Общие строки: текст и исходный XML (строка может состоять из кусков с разным шрифтом).
function sharedStrings(xml) {
  return [...xml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map(([, si]) => {
    const text = new String(xmlUnescape([...si.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join("")));
    text.xml = si;
    return text;
  });
}

// Значение ячейки из XML листа: число, общая строка (t="s") или строка в ячейке.
function cellValue(cellXml, strings) {
  const value = cellXml.match(/<v>([\s\S]*?)<\/v>/)?.[1];
  if (/\bt="s"/.test(cellXml)) return value === undefined ? "" : String(strings[Number(value)]);
  if (/\bt="inlineStr"/.test(cellXml)) return xmlUnescape(cellXml.match(/<t[^>]*>([\s\S]*?)<\/t>/)?.[1] || "");
  return value === undefined ? "" : xmlUnescape(value);
}

const CELL = String.raw`(?: [^>]*?)?(?:/>|>[\s\S]*?</c>)`;
const cellPattern = (ref) => new RegExp(`<c r="${ref}"${CELL}`);

const templateCache = new Map();

/** Читает бланк: где позиции (артикул → строка и цена), где «Контрагент» и формула суммы. */
async function loadTemplate(file) {
  if (!templateCache.has(file)) {
    const buffer = fs.readFileSync(path.join(BLANKS_DIR, file));
    const zip = await JSZip.loadAsync(buffer);
    const sheet = await zip.file(SHEET).async("string");
    const strings = sharedStrings(await zip.file("xl/sharedStrings.xml").async("string"));
    const valueAt = (ref) => {
      const cell = sheet.match(cellPattern(ref))?.[0];
      return cell ? cellValue(cell, strings) : "";
    };
    let headerRow = 0;
    const items = new Map();
    for (const [cell, row] of sheet.matchAll(new RegExp(`<c r="B(\\d+)"${CELL}`, "g"))) {
      const value = cellValue(cell, strings);
      if (value === "АРТ.") headerRow = Number(row);
      else if (headerRow && value !== "" && !items.has(skuKey(value))) {
        items.set(skuKey(value), { row: Number(row), price: Number(valueAt(`D${row}`)) || 0 });
      }
    }
    const counterparty = [...sheet.matchAll(new RegExp(`<c r="(C\\d+)"${CELL}`, "g"))]
      .map(([cell, ref]) => ({ ref, cell }))
      .find(({ cell }) => cellValue(cell, strings).trim().startsWith("Контрагент"));
    const counterpartyRef = counterparty?.ref;
    // Шрифты строки «Контрагент ____» сохраняем: подчёркивания заменяются названием организации.
    const counterpartyXml = counterparty && /\bt="s"/.test(counterparty.cell)
      ? strings[Number(counterparty.cell.match(/<v>(\d+)<\/v>/)[1])].xml
      : "<t>Контрагент ____</t>";
    const sumRef = sheet.match(/<c r="([A-Z]+\d+)"[^>]*><f[^>]*>SUMPRODUCT\(/)?.[1];
    if (!headerRow || !counterpartyRef || !sumRef) throw new Error(`Бланк ${file}: не найдены «АРТ.», «Контрагент» или формула суммы`);
    templateCache.set(file, { file, buffer, items, counterpartyRef, counterpartyXml, sumRef });
  }
  return templateCache.get(file);
}

// Ставит значение в существующую ячейку, сохраняя её стиль (s="…").
function setCell(sheet, ref, valueXml, type) {
  const pattern = cellPattern(ref);
  const cell = sheet.match(pattern)?.[0];
  if (!cell) throw new Error(`Нет ячейки ${ref} в бланке`);
  const style = cell.match(/ s="(\d+)"/)?.[1];
  return sheet.replace(pattern, `<c r="${ref}"${style ? ` s="${style}"` : ""}${type ? ` t="${type}"` : ""}>${valueXml}</c>`);
}

/**
 * Заполняет бланк: «Контрагент» и количества в колонке «ЗАКАЗ».
 * Позиции, которых в бланке нет, возвращаются в missing: бланк не дописываем, они идут в текст письма.
 * data: { counterparty, lines: [{ sku, qty }] }
 */
async function buildBlank(file, data) {
  const template = await loadTemplate(file);
  const zip = await JSZip.loadAsync(template.buffer);
  let sheet = await zip.file(SHEET).async("string");
  const missing = [];
  let total = 0;
  data.lines.forEach((line) => {
    const item = template.items.get(skuKey(line.sku));
    if (!item) return missing.push(line);
    sheet = setCell(sheet, `E${item.row}`, `<v>${line.qty}</v>`, "n");
    total += item.price * line.qty;
  });
  if (data.counterparty) { // название организации, «Контрагент» уже есть в бланке
    const filled = template.counterpartyXml.replace(/_{3,}/, xmlEscape(data.counterparty));
    sheet = setCell(sheet, template.counterpartyRef, `<is>${filled}</is>`, "inlineStr");
  }
  // Формулу не трогаем, обновляем только её сохранённый результат — он виден и до пересчёта.
  sheet = sheet.replace(new RegExp(`(<c r="${template.sumRef}"[^>]*><f[^>]*>[^<]*</f>)<v>[^<]*</v>`), `$1<v>${total}</v>`);
  zip.file(SHEET, sheet, { createFolders: false });
  const workbook = (await zip.file("xl/workbook.xml").async("string")).replace(/<calcPr(?![^>]*fullCalcOnLoad)/, '<calcPr fullCalcOnLoad="1"');
  zip.file("xl/workbook.xml", workbook, { createFolders: false });
  const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  return { buffer, total, missing };
}

module.exports = { buildBlank, loadTemplate, skuKey };
