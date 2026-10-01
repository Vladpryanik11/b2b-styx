"""Переводит бланк заказа .xls (BIFF) в JSON-шаблон для server/blanks.js.

Запуск: python3 tools/extract-blank.py blanks/source/styx-aromaderm.xls blanks/styx-aromaderm.json
Нужен пакет xlrd (pip install xlrd). Сохраняются значения, шрифты, заливка,
выравнивание, рамки, формат чисел, высота строк и ширина колонок.
"""
import json
import sys

import xlrd

HALIGN = {0: None, 1: "left", 2: "center", 3: "right"}
BORDER = {0: None, 1: "thin", 2: "medium", 3: "dashed", 4: "dotted", 5: "thick", 6: "double"}


def rgb(book, index):
    colour = book.colour_map.get(index)
    return "%02X%02X%02X" % colour if colour else None


def cell_style(book, xf):
    font = book.font_list[xf.font_index]
    style = {"font": {"name": font.name, "size": font.height // 20}}
    if font.bold:
        style["font"]["bold"] = True
    if font.italic:
        style["font"]["italic"] = True
    colour = rgb(book, font.colour_index)
    if colour and colour != "000000":
        style["font"]["color"] = colour
    if xf.background.fill_pattern:
        fill = rgb(book, xf.background.pattern_colour_index)
        if fill:
            style["fill"] = fill
    align = HALIGN.get(xf.alignment.hor_align)
    if align:
        style["align"] = align
    b = xf.border
    borders = {side: BORDER.get(value) for side, value in
               (("top", b.top_line_style), ("bottom", b.bottom_line_style), ("left", b.left_line_style), ("right", b.right_line_style))}
    borders = {k: v for k, v in borders.items() if v}
    if borders:
        style["border"] = borders
    fmt = book.format_map[xf.format_key].format_str
    if fmt not in ("General", "@"):
        style["numFmt"] = fmt
    return style


def main(src, dst):
    book = xlrd.open_workbook(src, formatting_info=True)
    sheet = book.sheet_by_index(0)
    styles, style_ids, rows = [], {}, []
    for r in range(sheet.nrows):
        cells = []
        for c in range(sheet.ncols):
            value = sheet.cell_value(r, c)
            if isinstance(value, float) and value.is_integer():
                value = int(value)
            if isinstance(value, str):
                value = value.strip()
            key = json.dumps(cell_style(book, book.xf_list[sheet.cell_xf_index(r, c)]), sort_keys=True)
            if key not in style_ids:
                style_ids[key] = len(styles)
                styles.append(json.loads(key))
            cells.append([value, style_ids[key]])
        info = sheet.rowinfo_map.get(r)
        rows.append({"height": info.height / 20 if info else None, "cells": cells})
    widths = [round(sheet.colinfo_map[c].width / 256, 2) if c in sheet.colinfo_map else 8 for c in range(sheet.ncols)]
    template = {"sheet": sheet.name, "widths": widths, "styles": styles, "rows": rows}
    with open(dst, "w", encoding="utf-8") as out:
        json.dump(template, out, ensure_ascii=False, separators=(",", ":"))
        out.write("\n")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
