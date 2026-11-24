export function normalizeTotal(value) {
  const compact = value.replace(/\s/g, "");
  if (/^\d+$/.test(compact)) return compact;
  if (/^\d{1,3}(?:[.,]\d{3})+$/.test(compact)) {
    return compact.replace(/[.,]/g, "");
  }
  throw new Error(
    "Tổng tiền phải là số nguyên, có thể có dấu phân tách hàng nghìn.",
  );
}

export function correctInvoiceDescription(value) {
  let text = String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
  if (!text) return "";

  text = text
    .replace(/^[“"'ˆ^~<>\s]*(?:[A-Z]\s+|<\s*)+(?=[A-Z]{3,}\b)/u, "")
    .replace(/^00?\d\s+(?=[A-Z])/u, "")
    .replace(/\bWizosone\b/gi, "Wizosone")
    .replace(/\bSAVI[e•]?TOUX\b/gi, "SAVI•TOUX")
    .replace(/\b[EF]\.?L\.?P\.?\s*(?=units\b)/gi, "F.I.P ")
    .replace(/\bViên\s+(?:TÊN|TEN)\s+sui\b/gi, "Viên sủi")
    .replace(/\bVi[eéê]t\b/gi, "Việt")
    .replace(/\bVi[eé]n\b/gi, "Viên")
    .replace(/\bDich(?=\s+v)/gi, "Dịch")
    .replace(/\bquang\s+cao\b/gi, "quảng cáo")
    .replace(/\bquảng\s+cao\b/gi, "quảng cáo")
    .replace(/\bx(?:i|ị)t\b/gi, "xịt")
    .replace(/\bLo\b(?=\s*(?:\(|,|Nam\b|$))/gi, "Lọ")
    .replace(/\bOng\b/gi, "Ống")
    .replace(/\bcô\s*phân\b/gi, "cổ phần")
    .replace(/\bdược\s*pham\b/gi, "dược phẩm")
    .replace(/\bdược\s*phâm\b/gi, "dược phẩm")
    .replace(/\(\s*,\s*Việt\s+Nam\s*\)/gi, "(Việt Nam)")
    .replace(/\(\s*,\s*Nam\s*\)/gi, "(Việt Nam)")
    .replace(/(?<!Việt )Nam\)/g, "Việt Nam)")
    .replace(/,\s*Lọ\s+Việt Nam\)/i, ", Lọ (Việt Nam)")
    .replace(/Phương Đông\s+Việt Nam\)/i, "Phương Đông, Việt Nam)")
    .replace(/dược phẩm\s+Viên\s+(?=SaVi\b)/gi, "dược phẩm ")
    .replace(/(ALLERGEX\b[^)]*dược phẩm\s*)Việt Nam\)/i, "$1OPV, Việt Nam)")
    .replace(/(ALLERGEX\b[^)]*dược phẩm\s*)Nam\)/i, "$1OPV, Việt Nam)")
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/,\s*/g, ", ")
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (/^dịch vụ\s+(?:(?:quảng cáo\s+)?google\s+)?ads$/i.test(text)) {
    return "Dịch vụ quảng cáo Google Ads";
  }
  if (/dịch vụ quảng cáo google/i.test(text) && !/\bgoogle\s+ads\b/i.test(text)) {
    text = `${text} Ads`;
  }
  return text;
}

export function mergeOcrDescription(
  nativeDescription,
  ocrDescription,
  confidence = 100,
) {
  if (confidence < 80) return nativeDescription;
  const nativeWords = tokenizeDescription(nativeDescription);
  const ocrWords = tokenizeDescription(ocrDescription);
  if (!nativeWords.length || !ocrWords.length) return nativeDescription;

  const nativeText = nativeWords.map(normalizeWord).join(" ");
  const ocrText = ocrWords.map(normalizeWord).join(" ");
  if (
    Math.abs(nativeText.length - ocrText.length) /
      Math.max(nativeText.length, ocrText.length) >
      0.05 ||
    characterSimilarity(nativeText, ocrText) < 0.75 ||
    (!nativeText.startsWith(ocrText.slice(0, 24)) &&
      !ocrText.startsWith(nativeText.slice(0, 24)))
  ) {
    return nativeDescription;
  }

  const rows = Array.from({ length: nativeWords.length + 1 }, () =>
    Array(ocrWords.length + 1),
  );
  rows[0][0] = { cost: 0, previous: null, operation: null };
  for (let i = 1; i <= nativeWords.length; i += 1) {
    rows[i][0] = { cost: i, previous: [i - 1, 0], operation: "delete" };
  }
  for (let j = 1; j <= ocrWords.length; j += 1) {
    rows[0][j] = { cost: j, previous: [0, j - 1], operation: "insert" };
  }

  for (let i = 1; i <= nativeWords.length; i += 1) {
    for (let j = 1; j <= ocrWords.length; j += 1) {
      const sameWord =
        normalizeWord(nativeWords[i - 1]) === normalizeWord(ocrWords[j - 1]);
      const choices = [
        {
          cost: rows[i - 1][j - 1].cost + (sameWord ? 0 : 1.2),
          previous: [i - 1, j - 1],
          operation: sameWord ? "match" : "replace",
        },
        { cost: rows[i - 1][j].cost + 1, previous: [i - 1, j], operation: "delete" },
        { cost: rows[i][j - 1].cost + 1, previous: [i, j - 1], operation: "insert" },
      ];
      rows[i][j] = choices.reduce((best, choice) =>
        choice.cost < best.cost ? choice : best,
      );
    }
  }

  const merged = [];
  let i = nativeWords.length;
  let j = ocrWords.length;
  while (i > 0 || j > 0) {
    const cell = rows[i][j];
    if (cell.operation === "match") {
      merged.push(nativeWords[i - 1]);
    } else if (cell.operation === "replace" || cell.operation === "insert") {
      merged.push(ocrWords[j - 1]);
    }
    [i, j] = cell.previous;
  }
  return merged.reverse().join(" ");
}

function tokenizeDescription(text) {
  return text.match(/[\p{L}\p{N}]+(?:[./-][\p{L}\p{N}]+)*[.,;:]?/gu) ?? [];
}

function normalizeWord(word) {
  return word
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[đĐ]/g, "d")
    .toLocaleLowerCase("vi-VN")
    .replace(/[.,;:]+$/g, "");
}

function characterSimilarity(first, second) {
  const previous = Array.from({ length: second.length + 1 }, (_, index) => index);
  for (let i = 1; i <= first.length; i += 1) {
    let diagonal = previous[0];
    previous[0] = i;
    for (let j = 1; j <= second.length; j += 1) {
      const above = previous[j];
      previous[j] = Math.min(
        previous[j] + 1,
        previous[j - 1] + 1,
        diagonal + (first[i - 1] === second[j - 1] ? 0 : 1),
      );
      diagonal = above;
    }
  }
  return 1 - previous[second.length] / Math.max(first.length, second.length);
}

const DATE_LABEL =
  /(?:ngày\s*(?:lập(?:\s*(?:hóa|hoá)\s*đơn)?|(?:hóa|hoá)\s*đơn)?|invoice\s*date|date)\s*[:：]?\s*(\d{1,2}\s*[./-]\s*\d{1,2}\s*[./-]\s*\d{4})/i;
const INVOICE_NUMBER_LABEL =
 /^\s*(?:số\s*(?:(?:\(\s*(?:invoice\s*)?(?:no\.?|number)\s*\)\s*[:：]?\s*)|(?:(?:hóa|hoá)\s*đơn\s*[:：]?\s*)|[:：]\s*|\s+(?=\d))|invoice\s*(?:no\.?|number|#)\s*[:：]?\s*)([A-Z0-9][A-Z0-9./-]*)/im;
const INVOICE_NUMBER_LABEL_ONLY =
  /^\s*(?:số\s*(?:\(\s*(?:invoice\s*)?(?:no\.?|number)\s*\)\s*[:：]?|[:：])|invoice\s*(?:no\.?|number|#))\s*$/i;
const DESCRIPTION_LABEL =
  /(?:nội\s*dung(?:\s*(?:(?:hóa|hoá)\s*đơn|thanh\s*toán|hàng\s*hóa))?|diễn\s*giải|mô\s*tả|tên\s*(?:hàng\s*(?:hóa|hoá)|dịch\s*vụ)\s*,?\s*(?:dịch\s*vụ)?|description|goods\s*(?:and|&)\s*services)\s*[:：]?\s*(.*)/i;
const TOTAL_LABEL =
  /(?:tổng\s*(?:cộng\s*)?(?:tiền\s*)?(?:thanh\s*toán|cần\s*thanh\s*toán)|cộng\s*tiền\s*thanh\s*toán|thành\s*tiền\s*thanh\s*toán|số\s*tiền\s*thanh\s*toán|grand\s*total|total\s*(?:payment|payable|amount|invoice)|amount\s*(?:payable|due)|net\s*payable)(?:\s*\([^)]*\))?\s*[:：]?\s*(.*)/i;

export function extractPaymentRequestInvoice(text) {
  const lines = text
    .replace(/\u00a0/g, " ")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const items = extractInvoiceItems(lines);
  const description = items.length
    ? items.map((item) => item.description).join("; ")
    : extractDescription(lines);
  return {
    invoiceDate: extractInvoiceDate(text, lines),
    invoiceSerial: extractInvoiceSerial(text),
    invoiceNumber: extractInvoiceNumber(lines),
    items,
    description: correctInvoiceDescription(description),
    total: extractTotal(lines),
  };
}

function extractInvoiceNumber(lines) {
  const flattened = lines.join(" ");
  const numberAfterNo = flattened.match(/(?:^|\s)số\s*\(\s*(?:invoice\s*)?no\.?\s*\)\s*[:：]?\s*(\d[\d ]{2,})/i)?.[1];
  if (numberAfterNo) return numberAfterNo.replace(/\s+/g, "");

  for (let index = 0; index < lines.length; index += 1) {
    const inline = lines[index].match(INVOICE_NUMBER_LABEL)?.[1];
    if (inline) return inline;
    if (!INVOICE_NUMBER_LABEL_ONLY.test(lines[index])) continue;
    for (const candidate of lines.slice(index + 1, index + 4)) {
      const value = candidate.match(/^\s*([A-Z0-9][A-Z0-9./-]*)\s*$/i)?.[1];
      if (value) return value;
      if (/^(?:ngày|date|ký hiệu|serial|mã|tax)/i.test(candidate)) break;
    }
  }
  const inlineFromFlattened = flattened.match(/(?:^|\s)(?:số\s*(?:[:：]|(?:hóa|hoá)\s*đơn\s*[:：]?)|invoice\s*(?:no\.?|number|#)\s*[:：]?)\s*([A-Z0-9][A-Z0-9./-]*)/i)?.[1];
  if (inlineFromFlattened) return inlineFromFlattened;
  return "";
}

const SERIAL_LABEL = /(?:ký\s*hiệu(?:\s*\([^)]*\))?|serial\s*(?:\(\s*(?:no\.?|number)\s*\)|no\.?|number)?|invoice\s*series)\s*[:：]?\s*([\p{L}\d][\p{L}\d./ -]*)/iu;

function extractInvoiceSerial(text) {
  // Invoice series are short identifiers. OCR often inserts spaces between
  // letters (for example, "1C26T GG"), so remove internal whitespace.
  return text.match(SERIAL_LABEL)?.[1]?.trim().replace(/\s+/g, "") ?? "";
}

export function extractInvoiceItems(linesOrText) {
  const lines = Array.isArray(linesOrText) ? linesOrText : String(linesOrText).split(/\r?\n/);
  const header = lines.findIndex((line) => /(?:tên\s*hàng\s*h[oó]a|description|goods\s*(?:and|&)\s*services)/i.test(line));
  if (header < 0) return [];
  const summaryIndex = lines.findIndex((line, index) => index > header && isInvoiceSummaryLine(line));
  const tableText = lines.slice(0, summaryIndex < 0 ? undefined : summaryIndex).join(" ");
  const amountIncludesVat = /(?:thành\s*tiền\s*(?:có|sau)\s*thuế(?:\s*gtgt)?|amount\s*(?:including|after)\s*(?:vat|tax)|including\s*(?:vat|tax)|after\s*tax)/i.test(tableText);
  const rows = [];
  let current;
  const finish = () => {
    if (current?.description.trim()) rows.push({ stt: current.stt, description: current.description.trim().replace(/\s+/g, " "), amount: current.amount || "" });
    current = undefined;
  };
  for (const raw of lines.slice(header + 1)) {
    let line = raw.trim();
    if (!line || isDescriptionTableHeader(line) || isTableColumnIndex(line)) continue;
    if (isInvoiceSummaryLine(line)) {
      if (current) break;
      continue;
    }
    const numbered = line.match(/^(?:no\.?\s*)?(\d{1,3})\s*[|.)-]?\s+(.+)$/i);
    const numberOnly = line.match(/^(\d{1,3})\s*[|.)-]?$/);
    if (numbered && /[\p{L}]/u.test(numbered[2])) {
      finish();
      current = { stt: numbered[1], description: "", amount: "" };
      line = numbered[2];
    } else if (numberOnly) {
      finish();
      current = { stt: numberOnly[1], description: "", amount: "" };
      continue;
    }
    if (!current) continue;
    const amounts = line.match(/(?:^|\s)(\d{1,3}(?:(?:[.,]\d{3})+|(?:\s\d{3})+))(?=\s|$)/g);
    const withoutAmounts = removeInvoiceColumns(line);
    const cleaned = cleanDescriptionLine(withoutAmounts);
    if (cleaned && /[\p{L}]/u.test(cleaned)) {
      if (current.description && /[^\s]-$/.test(current.description)) current.description += cleaned;
      else current.description += `${current.description ? " " : ""}${cleaned}`;
    } else if (/^\d{1,2}[./-]\d{1,2}[./-]\d{4}$/.test(line)) {
      current.description += `${current.description ? " " : ""}${line}`;
    }
    if (amounts?.length) {
      // In bilingual VAT invoices, prefer the last line amount when the
      // table explicitly contains an "including VAT" column. Otherwise the
      // second grouped amount is normally the line amount after unit price.
      const amountColumn = amountIncludesVat
        ? amounts.at(-1)
        : amounts.length >= 2
          ? amounts[1]
          : amounts[0];
      try { current.amount = normalizeTotal(amountColumn.trim()); } catch { /* keep reading wrapped row */ }
    }
  }
  finish();
  return rows;
}

export function classifyInvoiceText(text) {
  const normalized = text.normalize("NFKC");
  const values = extractPaymentRequestInvoice(normalized);
  const invoiceSignals = [
    /hóa\s*đơn|hoá\s*đơn|invoice/i.test(normalized),
    /mã\s*số\s*thuế|tax\s*code|mst/i.test(normalized),
    /ngày\s*\(?date|invoice\s*date/i.test(normalized),
    /tổng\s*(?:tiền|cộng)|total\s*(?:payment|amount|payable)|amount\s*(?:due|payable)/i.test(normalized),
  ].filter(Boolean).length;
  const tableSignals = [
    /tên\s*hàng\s*h[oó]a|description|goods\s*(?:and|&)\s*services/i.test(normalized),
    /đơn\s*vị\s*tính|\bunit\b|uom/i.test(normalized),
    /số\s*lượng|quantity/i.test(normalized),
    /đơn\s*giá|unit\s*price|\bprice\b/i.test(normalized),
    /thành\s*tiền|amount/i.test(normalized),
  ].filter(Boolean).length;
  const fieldCount = Object.values(values).filter(Boolean).length;
  const confidence = Math.min(
    1,
    invoiceSignals * 0.12 + tableSignals * 0.08 + fieldCount * 0.12,
  );
  return {
    layout:
      normalized.trim().length < 80
        ? "scanned"
        : tableSignals >= 3
          ? "tabular"
          : "text",
    confidence,
    invoiceSignals,
    tableSignals,
    fieldCount,
  };
}

export function scoreInvoiceDescription(value) {
  const text = value.replace(/\s+/g, " ").trim();
  if (!text) return 0;
  const words = tokenizeDescription(text);
  const letters = (text.match(/[\p{L}]/gu) ?? []).length;
  let score = Math.min(65, words.length * 4) + (letters / text.length) * 35;
  if (/vat\s*rate|quantity|unit\s*price|amount\s*including|thuế\s*suất|đơn\s*giá|thành\s*tiền/i.test(text)) score -= 30;
  if (/\(\s*\d+\s*\)\s*(?:\(\s*\d+\s*\)|=)/.test(text)) score -= 35;
  if ((text.match(/\b\d{1,3}(?:[.,]\d{3}){2,}\b/g) ?? []).length > 1) score -= 25;
  if (/^(?:no\.?|item|description|vat\s*rate)\b/i.test(text)) score -= 25;
  return Math.max(0, Math.min(100, Math.round(score)));
}

export function extractOcrDescription(text) {
  const lines = text
    .replace(/\u00a0/g, " ")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const itemIndex = lines.findIndex((line) => /^\d+\s*(?:[|.)-]\s*)?\S/.test(line));
  if (itemIndex < 0) return "";

  const description = [];
  for (const line of lines.slice(itemIndex)) {
    if (isInvoiceSummaryLine(line)) break;
    if (isTableHeader(line) || isTableColumnIndex(line)) continue;
    const startsItem = /^\d+\s*(?:[|.)-]\s*)?\S/.test(line);
    const withoutColumns = removeInvoiceColumns(line);
    const cleaned = (startsItem ? withoutColumns.replace(/^\d+\s*[|.)-]?\s+/, "") : withoutColumns)
      .replace(/\s+\d{1,3}(?:[.,]\d{3})+$/, "")
      .replace(/^[|:;,.]+\s*/, "")
      .replace(/\s*[|=]+\s*$/, "")
      .trim();
    if (cleaned) {
      appendDescriptionLine(description, cleaned, startsItem && description.length ? "; " : " ");
    }
  }
  return description.join(" ");
}

function appendDescriptionLine(description, line, separator = " ") {
  const previous = description.at(-1);
  if (previous && /[^\s]-$/.test(previous)) {
    description[description.length - 1] += line;
  } else if (previous) {
    description[description.length - 1] += `${separator}${line}`;
  } else {
    description.push(line);
  }
}

function extractInvoiceDate(text, lines) {
  const labeledVietnameseDate = text.match(
    /ngày(?:\s*\([^)]*\))?\s+(\d{1,2})\s+tháng(?:\s*\([^)]*\))?\s+(\d{1,2})\s+năm(?:\s*\([^)]*\))?\s+(\d{4})/i,
  );
  if (labeledVietnameseDate) {
    return normalizeDate(
      `${labeledVietnameseDate[1]}/${labeledVietnameseDate[2]}/${labeledVietnameseDate[3]}`,
    );
  }

  const labeledLine = lines.find((line) =>
    /^(?:ngày\s*(?:(?:lập(?:\s*(?:hóa|hoá)\s*đơn)?|(?:hóa|hoá)\s*đơn))?|invoice\s*date|date)\b/i.test(line),
  );
  const labeled = labeledLine?.match(DATE_LABEL)?.[1];
  if (labeled) return normalizeDate(labeled);

  const vietnameseDate = text.match(
    /ngày\s+(\d{1,2})\s+tháng\s+(\d{1,2})\s+năm\s+(\d{4})/i,
  );
  if (vietnameseDate) {
    return normalizeDate(
      `${vietnameseDate[1]}/${vietnameseDate[2]}/${vietnameseDate[3]}`,
    );
  }

  const dateLine = lines.find((line) => /^ngày\s*[:：]?\s*\d/i.test(line));
  const generalDate = dateLine?.match(/(\d{1,2}\s*[./-]\s*\d{1,2}\s*[./-]\s*\d{4})/);
  return generalDate ? normalizeDate(generalDate[1]) : "";
}

function normalizeDate(value) {
  const parts = value.split(/[./-]/).map((part) => Number(part.trim()));
  if (parts.length !== 3) return "";
  const [day, month, year] = parts;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return "";
  }
  return `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}/${year}`;
}

function extractDescription(lines) {
  const index = lines.findIndex((line) => DESCRIPTION_LABEL.test(line));
  if (index < 0) return "";
  const match = lines[index].match(DESCRIPTION_LABEL);
  const inlineDescription = match?.[1]?.trim();
  const isTableDescription =
    /(?:tên\s*hàng\s*h[oó]a|tên\s*dịch\s*vụ|diễn\s*giải|mô\s*tả|description|goods\s*(?:and|&)\s*services)/i.test(
      lines[index],
    );
  if (
    inlineDescription &&
    !isDescriptionTableHeader(inlineDescription) &&
    !isTableColumnIndex(inlineDescription)
  ) {
    return cleanDescriptionLine(inlineDescription);
  }

  const description = [];
  let itemStarted = !isTableDescription;
  let nextSeparator = " ";
  for (const line of lines.slice(index + 1)) {
    if (isDescriptionTableHeader(line) || isTableColumnIndex(line)) continue;
    if (isInvoiceSummaryLine(line)) break;
    if (/^(?:thuế suất|tiền thuế)/i.test(line)) {
      if (isTableDescription) continue;
      break;
    }
    if (/^\s*(?:dịch vụ|service)\s+\d+\s+\d{1,3}(?:[.,]\d{3}){2,}/i.test(line)) {
      continue;
    }

    if (/^\d+\s*[|.)-]?$/i.test(line)) {
      if (isTableDescription && description.length) nextSeparator = "; ";
      if (isTableDescription) itemStarted = true;
      continue;
    }
    if (/^\d{1,3}(?:[.,]\d{3})+(?:\s|$)/.test(line)) continue;
    const startsItem = /^(?:no\.?\s*)?\d+\s*[|.)-]?\s+\S/i.test(line);
    if (startsItem) {
      if (description.length > 0) nextSeparator = "; ";
      itemStarted = true;
    }
    if (!itemStarted) continue;
    const cleaned = cleanDescriptionLine(removeInvoiceColumns(line));
    if (cleaned) {
      appendDescriptionLine(description, cleaned, nextSeparator);
      nextSeparator = " ";
    }
  }
  return description.join(" ");
}

function isInvoiceSummaryLine(line) {
  return /^(?:tổng hợp|thành tiền trước thuế|tiền thuế|không chịu thuế|thuế suất|tổng tiền theo từng loại thuế suất|cộng tiền hàng|cộng tiền thanh toán|tổng cộng|tổng tiền thanh toán|đơn vị cung cấp giải pháp|số tiền viết bằng chữ|amount\s*\(in words\))/i.test(
    line,
  );
}

function removeInvoiceColumns(line) {
  const amount = String.raw`\d{1,3}(?:[., ]\d{3})+`;
  const quantity = String.raw`\d+(?:[.,]\d+)?`;
  const units = String.raw`(?:dịch\s*vụ|service|viên\s+sủi|viên|lọ|ống|chai|hộp|gói|cái|tuýp|vỉ|bộ|chiếc|răng|mg|ml|kg|g|l)`;
  const withoutTaxFlags = line.replace(/\s+(?:X\s*){1,3}$/i, "");
  const unitColumns = new RegExp(String.raw`\s+${units}\s+${quantity}\s+${amount}\s+${amount}(?:\s+.*)?$`, "i");
  if (unitColumns.test(withoutTaxFlags)) return withoutTaxFlags.replace(unitColumns, "");
  return line.replace(
    new RegExp(String.raw`\s+${quantity}\s+${amount}\s+${amount}(?:\s+.*)?$`, "i"),
    "",
  ).replace(/\s+(?:X\s*){1,3}$/i, "");
}

function cleanDescriptionLine(line) {
  return line
    .replace(/^no\.?\s+(?=[\p{L}])/iu, "")
    .replace(/^\d+\s*[|.)-]?\s+/, "")
    .replace(/\s+\d{1,3}(?:[.,]\d{3})+$/, "")
    .replace(/^[|:;,.]+\s*/, "")
    .replace(/\s*[|=]+\s*$/, "")
    .trim();
}

function isDescriptionTableHeader(line) {
  const normalized = line.trim().replace(/^[([]|[)\]]$/g, "").trim();
  return /^(?:(?:stt\s*)?no\.?|(?:stt\s*)?item|tên hàng hóa(?:,)? dịch vụ|tên hàng hoá(?:,)? dịch vụ|name of goods and services|description|đơn vị tính|đvt|dvt|unit|uom|số lượng|quantity|đơn giá|unit price|price|thành tiền|amount|thuế suất|vat rate|total amount|amount including vat)(?:\s+(?:item|đvt|dvt|unit|uom|số lượng|quantity|đơn giá|unit price|price|thành tiền|amount|gtgt|vat|rate))*$/i.test(
    normalized,
  ) || isTableHeader(normalized);
}

function isTableHeader(line) {
  return /(?:\bđvt\b|\bsố lượng\b|\bđơn giá\b|\bthành tiền\b|\buom\b|\bquantity\b|\bprice\b|\bamount\b)/i.test(
    line,
  );
}

function isTableColumnIndex(line) {
  return /^(?:\d+\s+){2,}\d+(?:\s*=\s*[\dx]+)?$/i.test(line) ||
    (/\d/.test(line) && /[=x×+]/i.test(line) && /^[\d\s()[\]{}=+x×-]+$/i.test(line)) ||
    /^(?:\(\s*\d+\s*\)\s*){2,}$/.test(line);
}

function extractTotal(lines) {
  const candidates = lines
    .map((line, index) => ({ line, index, match: line.match(TOTAL_LABEL) }))
    .filter(({ line, match }) =>
      match &&
      !/(?:by\s+type|before\s+vat|excluding\s+vat|subtotal|discount|not\s+taxable)/i.test(
        line,
      ),
    )
    .sort((first, second) => {
      const priority = (line) =>
        /grand\s*total|total\s*(?:payment|payable|invoice)|amount\s*(?:payable|due)|net\s*payable|tổng\s*(?:cộng\s*)?(?:tiền\s*)?(?:thanh\s*toán|cần\s*thanh\s*toán)/i.test(
          line,
        )
          ? 1
          : 0;
      return priority(second.line) - priority(first.line) || second.index - first.index;
    });

  for (const { line, index, match } of candidates) {
    const amountText = match[1]?.trim() || lines[index + 1] || "";
    const amount = amountText.match(/\d[\d\s.,]*/)?.[0];
    if (!amount) continue;
    try {
      return normalizeTotal(amount);
    } catch {
      continue;
    }
  }
  const subtotalLine = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => /^(?:tổng\s*cộng(?:\s*(?:(?:tiền\s*)?(?:hàng(?:\s*h[oó]a)?|thanh\s*toán)))?|cộng\s*tiền\s*hàng(?:\s*h[oó]a)?(?:\s*,?\s*dịch\s*vụ)?|tổng\s*tiền\s*hàng(?:\s*h[oó]a)?)(?:\s*\([^)]*\))?\s*[:：]?/i.test(line))
    .at(-1);
  if (subtotalLine) {
    const amountMatches = subtotalLine.line.match(/\d{1,3}(?:(?:[.,]\d{3})+|(?:\s\d{3})+)/g);
    const nextLineMatches = lines[subtotalLine.index + 1]?.match(/\d{1,3}(?:(?:[.,]\d{3})+|(?:\s\d{3})+)/g);
    const amountText = amountMatches?.at(-1) || nextLineMatches?.at(-1);
    if (amountText) {
      try { return normalizeTotal(amountText); } catch { /* no valid fallback amount */ }
    }
  }
  return "";
}

const ONES = [
  "không",
  "một",
  "hai",
  "ba",
  "bốn",
  "năm",
  "sáu",
  "bảy",
  "tám",
  "chín",
];
const SCALES = ["", "nghìn", "triệu", "tỷ", "nghìn tỷ", "triệu tỷ", "tỷ tỷ"];

function readGroup(value, forceHundreds = false) {
  const hundreds = Math.floor(value / 100);
  const tens = Math.floor((value % 100) / 10);
  const units = value % 10;
  const words = [];

  if (hundreds > 0) words.push(ONES[hundreds], "trăm");
  else if (forceHundreds) words.push("không", "trăm");

  if (tens > 1) {
    words.push(`${ONES[tens]} mươi`);
    if (units === 1) words.push("mốt");
    else if (units === 4) words.push("tư");
    else if (units === 5) words.push("lăm");
    else if (units > 0) words.push(ONES[units]);
  } else if (tens === 1) {
    words.push("mười");
    if (units === 5) words.push("lăm");
    else if (units > 0) words.push(ONES[units]);
  } else if (units > 0) {
    if (hundreds > 0 || forceHundreds) words.push("lẻ");
    words.push(ONES[units]);
  }
  return words.join(" ");
}

export function amountInVietnameseWords(value) {
  const digits = String(value);
  if (!/^\d+$/.test(digits) || digits.length > SCALES.length * 3) {
    throw new Error("Số tiền không hợp lệ hoặc vượt quá giới hạn đọc bằng chữ.");
  }

  const groups = [];
  for (let end = digits.length; end > 0; end -= 3) {
    groups.push(Number(digits.slice(Math.max(0, end - 3), end)));
  }
  while (groups.length > 1 && groups.at(-1) === 0) groups.pop();

  if (groups.length === 1 && groups[0] === 0) return "Không đồng";

  const words = [];
  let hasHigherGroup = false;
  for (let index = groups.length - 1; index >= 0; index -= 1) {
    const group = groups[index];
    if (group === 0) continue;

    const forceHundreds = hasHigherGroup && group < 100;
    words.push(readGroup(group, forceHundreds));
    if (SCALES[index]) words.push(SCALES[index]);
    hasHigherGroup = true;
  }
  const phrase = words.join(" ");
  return `${phrase.charAt(0).toLocaleUpperCase("vi-VN")}${phrase.slice(1)} đồng`;
}
