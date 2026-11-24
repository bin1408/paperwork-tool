import {
  amountInVietnameseWords,
  classifyInvoiceText,
  correctInvoiceDescription,
  extractOcrDescription,
  extractPaymentRequestInvoice,
  mergeOcrDescription,
  normalizeTotal,
  scoreInvoiceDescription,
} from "./payment-request-parser.mjs?v=20261123.17";

const PDFJS_VERSION = "4.10.38";
const PDFJS_BASE = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build`;
const TESSERACT_VERSION = "5.1.1";
const TESSERACT_BASE = `https://cdn.jsdelivr.net/npm/tesseract.js@${TESSERACT_VERSION}`;
const TESSERACT_CORE_BASE = `https://cdn.jsdelivr.net/npm/tesseract.js-core@${TESSERACT_VERSION}`;
const TEMPLATE_DOCX_URL = "./templates/payment-request.docx?v=20261119.11";
const PLACEHOLDERS = {
  FULL_NAME: "fullName",
  POSITION: "position",
  REQUESTER: "requester",
  INVOICE_DATE: "invoiceDate",
  INVOICE_SERIAL: "invoiceSerial",
  INVOICE_NUMBER: "invoiceNumber",
  DESCRIPTION: "description",
  TOTAL: "total",
  AMOUNT_WORDS: "amountWords",
};
const INPUT_IDS = {
  fullName: "requester",
  position: "position",
  requester: "requester",
  invoiceDate: "invoice-date",
  invoiceSerial: "invoice-serial",
  invoiceNumber: "invoice-number",
  description: "description",
  total: "total",
};

const fileInput = document.querySelector("#invoice-file");
const fileName = document.querySelector("#file-name");
const status = document.querySelector("#status");
const previewMessage = document.querySelector("#preview-message");
const previewStage = document.querySelector("#preview-stage");
const preview = document.querySelector("#document-preview");
const downloadButton = document.querySelector("#download-docx");
const amountWordsOutput = document.querySelector("#amount-words");
const invoiceItemsContainer = document.querySelector("#invoice-items");
const addInvoiceItemButton = document.querySelector("#add-invoice-item");
const inputs = Object.fromEntries(
  Object.values(PLACEHOLDERS)
    .filter((name) => name !== "amountWords")
    .map((name) => [name, document.getElementById(INPUT_IDS[name])]),
);

let templateDocxBytes;
let latestDocument;
let renderVersion = 0;
let updateTimer;
let latestItems = [];

fileInput.addEventListener("change", handleFile);
downloadButton.addEventListener("click", downloadDocument);
addInvoiceItemButton.addEventListener("click", () => {
  latestItems.push({ stt: String(latestItems.length + 1), description: "", amount: "" });
  renderInvoiceItems(latestItems);
  schedulePreview();
});
invoiceItemsContainer.addEventListener("input", handleInvoiceItemInput);
invoiceItemsContainer.addEventListener("click", handleInvoiceItemClick);
new Set(Object.values(inputs)).forEach((input) => {
  input.addEventListener("input", schedulePreview);
});
inputs.total.addEventListener("input", () => {
  if (latestItems.length !== 1 || latestItems[0].amount) return;
  let normalized;
  try { normalized = normalizeTotal(inputs.total.value); } catch { return; }
  latestItems[0].amount = normalized;
  const amountInput = invoiceItemsContainer.querySelector('[data-field="amount"]');
  if (amountInput) amountInput.value = formatItemAmount(normalized);
});

initialize();
renderInvoiceItems([{ stt: "1", description: "", amount: "" }]);
window.addEventListener("resize", fitDocumentPreview);

async function initialize() {
  try {
    if (!window.JSZip) {
      throw new Error("Không tải được thư viện xử lý file Word. Hãy tải lại trang hoặc kiểm tra kết nối mạng.");
    }
    if (!window.docx?.renderAsync) {
      throw new Error("Không tải được thư viện xem trước file Word. Hãy tải lại trang hoặc kiểm tra kết nối mạng.");
    }
    const response = await fetch(TEMPLATE_DOCX_URL);
    if (!response.ok) {
      throw new Error(`Không tải được mẫu Word (${response.status}).`);
    }
    templateDocxBytes = await response.arrayBuffer();
    previewMessage.textContent = "Mẫu giấy đề nghị đang hiển thị. Nhập thông tin để xem trước nội dung đã điền.";
    schedulePreview();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setPreviewMessage(message, "error");
  }
}

async function handleFile() {
  const file = fileInput.files?.[0];
  if (!file) return;

  if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
    setStatus("Vui lòng chọn một tệp PDF.", "error");
    fileInput.value = "";
    return;
  }

  fileName.textContent = `${file.name} · ${(file.size / 1024 / 1024).toFixed(2)} MB`;
  for (const name of ["invoiceDate", "invoiceSerial", "invoiceNumber", "description", "total"]) {
    inputs[name].value = "";
  }
  latestItems = [];
  renderInvoiceItems([{ stt: "1", description: "", amount: "" }]);
  let pdf;
  try {
    setStatus("Đang đọc hóa đơn trong trình duyệt…", "success");
    pdf = await openPdf(file);
    const { text, descriptionRegions, tableItems } = await extractPdfContent(pdf);
    const invoiceClass = classifyInvoiceText(text);
    let values = extractPaymentRequestInvoice(text);
    values.items = filterInvoiceItems(values.items);
    if (containsInvoiceTableHeaders(values.description)) values.description = "";
    if (values.items.length) values.description = values.items.map((item) => item.description).join("; ");
    if (scorePositionedItems(tableItems) > scorePositionedItems(values.items ?? [])) {
      values.items = tableItems;
      values.description = tableItems.map((item) => item.description).join("; ");
    }
    latestItems = values.items ?? [];
    const hadTextValues = Object.values(values).some(Boolean);
    applyExtractedValues(values);
    let extractionMethod = "PDF";
    let descriptionOcrApplied = false;
    let descriptionOcrChecked = false;

    if (
      Object.values(values).some((value) => !value) ||
      invoiceClass.confidence < 0.5 ||
      scoreInvoiceDescription(values.description) < 45
    ) {
      setStatus(
        "Một số trường chưa rõ hoặc kết quả cần được kiểm tra. Đang thử nhận diện lại bằng OCR…",
        "success",
      );
      const ocrResult = await recognizePdf(pdf);
      const ocrValues = extractPaymentRequestInvoice(ocrResult.text);
      ocrValues.items = filterInvoiceItems(ocrValues.items);
      if (containsInvoiceTableHeaders(ocrValues.description)) ocrValues.description = "";
      if (ocrValues.items.length) ocrValues.description = ocrValues.items.map((item) => item.description).join("; ");
      const ocrPositionedItems = filterInvoiceItems(ocrResult.tableItems);
      const ocrItems = scorePositionedItems(ocrPositionedItems) > scorePositionedItems(ocrValues.items)
        ? ocrPositionedItems
        : ocrValues.items;
      if (scorePositionedItems(ocrItems) > scorePositionedItems(latestItems)) {
        latestItems = ocrItems;
        ocrValues.items = ocrItems;
        ocrValues.description = ocrItems.map((item) => item.description).join("; ");
      }
      values = Object.fromEntries(Object.keys(values).map((key) => [
        key,
        key === "description"
          ? selectBestDescription(values.description, ocrValues.description)
          : values[key] || ocrValues[key],
      ]));
      applyExtractedValues(values);
      extractionMethod = hadTextValues ? "PDF và OCR" : "OCR";
    }

    if (!values.description && latestItems.length) {
      values.description = latestItems.map((item) => item.description).filter(Boolean).join("; ");
      inputs.description.value = values.description;
    }
    let ocrWarning = "";
    if (values.description && descriptionRegions.length) {
      try {
        const ocrDescription = await recognizeInvoiceDescription(
          pdf,
          descriptionRegions,
        );
        if (ocrDescription) {
          if (
            ocrDescription.confidence < 80 ||
            containsInvoiceTableHeaders(ocrDescription.text)
          ) {
            descriptionOcrChecked = true;
          } else {
            descriptionOcrChecked = true;
            const mergedDescription = mergeOcrDescription(
              values.description,
              ocrDescription.text,
              ocrDescription.confidence,
            );
            const correctedDescription = selectBestDescription(
              values.description,
              mergedDescription,
              ocrDescription.text,
            );
            descriptionOcrApplied = correctedDescription !== values.description;
            values.description = correctedDescription;
            inputs.description.value = correctedDescription;
            if (descriptionOcrApplied) extractionMethod += " và OCR nội dung";
          }
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        ocrWarning = ` Không thể kiểm tra chính tả nội dung bằng OCR: ${message}`;
      }
    }

    if (latestItems.length === 1 && values.description) {
      latestItems[0].description = values.description;
    }
    renderInvoiceItems(latestItems.length
      ? latestItems
      : [{ stt: "1", description: values.description, amount: values.total }]);

    const missing = Object.entries({
      "ngày hóa đơn": values.invoiceDate,
      "ký hiệu hóa đơn": values.invoiceSerial,
      "số hóa đơn": values.invoiceNumber,
      "nội dung thanh toán": values.description,
      "số tiền thanh toán": values.total,
    })
      .filter(([, value]) => !value)
      .map(([label]) => label);
    if (missing.length) {
      setStatus(
        `Đã đọc ${extractionMethod}, nhưng chưa nhận diện được: ${missing.join(", ")}. Hãy kiểm tra hóa đơn và nhập các ô còn thiếu.${ocrWarning}`,
        "error",
      );
    } else {
      const descriptionWarning =
        scoreInvoiceDescription(values.description) < 45
          ? " Nội dung hàng hóa, dịch vụ có độ tin cậy thấp; hãy kiểm tra và sửa trước khi tải."
          : "";
      const descriptionStatus = descriptionOcrChecked
        ? descriptionOcrApplied
          ? ""
          : " OCR đã đối chiếu nhưng giữ nguyên nội dung PDF."
        : "";
      setStatus(
        `Đã trích xuất bằng ${extractionMethod}${latestItems.length ? `, gồm ${latestItems.length} dòng hàng hóa/dịch vụ` : ""}.${descriptionStatus}${descriptionWarning} Hãy đối chiếu thông tin với hóa đơn.${ocrWarning}`,
        ocrWarning || descriptionWarning ? "error" : "success",
      );
    }
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : typeof error === "string"
          ? error
          : error && typeof error === "object" && "message" in error
            ? String(error.message)
            : String(error);
    setStatus(
      `Không đọc được hóa đơn: ${message}. Bạn vẫn có thể nhập hoặc sửa thông tin thủ công.`,
      "error",
    );
  } finally {
    await pdf?.destroy();
    schedulePreview();
  }
}

function selectBestDescription(...candidates) {
  return candidates
    .filter((candidate) => candidate && !containsInvoiceTableHeaders(candidate))
    .reduce((best, candidate) => {
      return scoreInvoiceDescription(candidate) > scoreInvoiceDescription(best)
        ? candidate
        : best;
    }, "");
}

function applyExtractedValues(values) {
  for (const name of ["invoiceDate", "invoiceSerial", "invoiceNumber", "description"]) {
    if (values[name]) inputs[name].value = values[name];
  }
  if (values.total) {
    inputs.total.value = new Intl.NumberFormat("vi-VN").format(BigInt(values.total));
  }
}

function renderInvoiceItems(items) {
  let singleLineTotal = "";
  if (items.length === 1 && inputs.total.value) {
    try { singleLineTotal = normalizeTotal(inputs.total.value); } catch { /* keep extracted item amount */ }
  }
  latestItems = items.length
    ? items.map((item, index) => ({
        stt: item.stt || String(index + 1),
        description: correctInvoiceDescription(item.description ?? ""),
        amount: items.length === 1 && singleLineTotal
          ? singleLineTotal
          : item.amount || "",
      }))
    : [{ stt: "1", description: "", amount: "" }];

  const rows = latestItems.map((item, index) => {
    const row = document.createElement("div");
    row.className = "invoice-item";
    row.dataset.index = String(index);

    const descriptionLabel = document.createElement("label");
    descriptionLabel.textContent = `Nội dung thanh toán · STT ${item.stt}`;
    const description = document.createElement("textarea");
    description.rows = 2;
    description.value = item.description;
    description.dataset.field = "description";
    description.setAttribute("aria-label", `Nội dung thanh toán dòng ${item.stt}`);
    descriptionLabel.append(description);

    const amountLabel = document.createElement("label");
    amountLabel.textContent = "Thành tiền (VNĐ)";
    const amount = document.createElement("input");
    amount.type = "text";
    amount.inputMode = "numeric";
    amount.value = formatItemAmount(item.amount);
    amount.dataset.field = "amount";
    amount.setAttribute("aria-label", `Thành tiền dòng ${item.stt}`);
    amountLabel.append(amount);

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "remove-invoice-item";
    remove.textContent = "Xóa";
    remove.dataset.removeIndex = String(index);
    remove.disabled = latestItems.length === 1;
    row.append(descriptionLabel, amountLabel, remove);
    return row;
  });
  invoiceItemsContainer.replaceChildren(...rows);
  inputs.description.value = latestItems
    .map((item) => item.description.trim())
    .filter(Boolean)
    .join("; ");
}

function formatItemAmount(value) {
  if (!value) return "";
  try {
    return new Intl.NumberFormat("vi-VN").format(BigInt(normalizeTotal(value)));
  } catch {
    return value;
  }
}

function handleInvoiceItemInput(event) {
  const target = event.target;
  const row = target.closest(".invoice-item");
  if (!row || !target.dataset.field) return;
  const item = latestItems[Number(row.dataset.index)];
  if (!item) return;
  item[target.dataset.field] = target.value;
  if (target.dataset.field === "description") {
    inputs.description.value = latestItems
      .map((entry) => entry.description.trim())
      .filter(Boolean)
      .join("; ");
  }
  schedulePreview();
}

function handleInvoiceItemClick(event) {
  const button = event.target.closest("[data-remove-index]");
  if (!button) return;
  latestItems.splice(Number(button.dataset.removeIndex), 1);
  renderInvoiceItems(latestItems);
  schedulePreview();
}

async function openPdf(file) {
  const { getDocument, GlobalWorkerOptions } = await import(
    `${PDFJS_BASE}/pdf.min.mjs`
  );
  GlobalWorkerOptions.workerSrc = `${PDFJS_BASE}/pdf.worker.min.mjs`;
  const bytes = new Uint8Array(await file.arrayBuffer());
  return getDocument({ data: bytes }).promise;
}

async function extractPdfContent(pdf) {
  const pages = [];
  const descriptionRegions = [];
  const tableItemSets = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const rows = new Map();
    const positionedItems = [];
    const layoutItems = [];
    for (const item of content.items) {
      if (!("str" in item) || !item.str.trim()) continue;
      const x = item.transform[4];
      const y = item.transform[5];
      positionedItems.push({ x, y, width: item.width, text: item.str });
      layoutItems.push({
        x,
        y: page.view[3] - y,
        width: item.width,
        height: item.height,
        text: item.str,
      });
      const rowY = Math.round(y / 3) * 3;
      const row = rows.get(rowY) ?? [];
      row.push({ x, text: item.str });
      rows.set(rowY, row);
    }
    const region = findDescriptionRegion(page, positionedItems);
    if (region) descriptionRegions.push({ pageNumber, ...region });
    const tableItems = extractPositionedInvoiceItems(layoutItems, page.view[2]);
    if (tableItems.length) tableItemSets.push(tableItems);
    const orderedRows = [...rows.entries()].sort((a, b) => b[0] - a[0]);
    pages.push(
      orderedRows
        .map(([, row]) =>
          row
            .sort((a, b) => a.x - b.x)
            .map((item) => item.text)
            .join(" "),
        )
        .join("\n"),
    );
  }
  return {
    text: pages.join("\n"),
    descriptionRegions,
    tableItems: tableItemSets.sort((a, b) => scorePositionedItems(b) - scorePositionedItems(a))[0] ?? [],
  };
}

function extractPositionedInvoiceItems(positionedItems, pageWidth) {
  if (!positionedItems.length) return [];
  const items = positionedItems
    .filter((item) => item.text?.trim())
    .map((item) => ({
      ...item,
      y: item.y ?? item.top,
      width: item.width ?? 0,
      height: item.height ?? Math.max(4, (item.bottom ?? 0) - (item.top ?? 0)),
    }))
    .sort((a, b) => a.y - b.y || a.x - b.x);
  const lines = [];
  for (const item of items) {
    const tolerance = Math.max(3, item.height * 0.45);
    let line = lines.at(-1);
    if (!line || Math.abs(line.y - item.y) > Math.max(tolerance, line.height * 0.45)) {
      line = { y: item.y, height: item.height, items: [] };
      lines.push(line);
    }
    line.items.push(item);
    line.y = line.items.reduce((sum, part) => sum + part.y, 0) / line.items.length;
    line.height = Math.max(line.height, item.height);
  }
  for (const line of lines) {
    line.items.sort((a, b) => a.x - b.x);
    line.text = line.items.map((item) => item.text.trim()).join(" ").replace(/\s+/g, " ");
  }
  const descriptionHeaderIndex = lines.findIndex((line) =>
    /(?:tên\s*hàng\s*h[oó]a|description|goods\s*(?:and|&)\s*services)/i.test(line.text),
  );
  if (descriptionHeaderIndex < 0) return extractHeaderlessPositionedItems(lines, pageWidth);
  const descriptionHeader = lines[descriptionHeaderIndex].items.find((item) =>
    /^(?:tên|description|goods)/i.test(item.text.trim()),
  ) ?? lines[descriptionHeaderIndex].items[0];
  const foundSummaryIndex = lines.findIndex((line, index) =>
    index > descriptionHeaderIndex && /(?:cộng\s*tiền\s*hàng|subtotal|total\s*amount)/i.test(line.text),
  );
  const summaryIndex = foundSummaryIndex < 0 ? lines.length : foundSummaryIndex;

  const tableLines = lines.slice(descriptionHeaderIndex, summaryIndex);
  const numberLines = tableLines.filter((line) =>
    line.y > lines[descriptionHeaderIndex].y &&
    line.items.some((item) => item.x < descriptionHeader.x - 2 && /^\d{1,3}[.)]?$/.test(item.text.trim())) &&
    !/\d\s*=\s*\d|(?:\(\s*\d+\s*\)\s*){2,}/.test(line.text),
  );
  if (!numberLines.length) return [];
  const firstDataY = Math.min(...numberLines.map((line) => line.y));
  const headerLines = tableLines.filter((line) => line.y < firstDataY);
  const headerText = headerLines.map((line) => line.text).join(" ");
  const fontHeight = Math.max(4, descriptionHeader.height || 6);
  const sttHeader = headerLines.flatMap((line) => line.items)
    .find((item) => /^(?:stt|no\.?)(?:\s|$)/i.test(item.text.trim()));
  const descriptionEndX = headerLines
    .flatMap((line) => line.items)
    .filter((item) => item.x > descriptionHeader.x &&
      /^(?:đơn\s*vị\s*tính|đơn|đvt|dvt|unit|uom)$/i.test(item.text.trim()))
    .map((item) => item.x)
    .sort((a, b) => a - b)[0] ?? pageWidth;
  const descriptionStartX = tableLines
    .filter((line) => line.y >= firstDataY)
    .flatMap((line) => line.items)
    .filter((item) => item.x < descriptionEndX &&
      (!sttHeader || item.x > sttHeader.x + sttHeader.width * 0.5) &&
      /[\p{L}]/u.test(item.text))
    .map((item) => item.x)
    .sort((a, b) => a - b)[0] ?? (sttHeader ? sttHeader.x + sttHeader.width : descriptionHeader.x - fontHeight * 2);

  const amountHeaderCandidates = [];
  for (const line of headerLines) {
    for (let index = 0; index < line.items.length; index += 1) {
      const item = line.items[index];
      const value = item.text.trim();
      const next = line.items[index + 1];
      if (/^thành\s*tiền\b/i.test(value) ||
        (/^thành$/i.test(value) && next && /^tiền$/i.test(next.text.trim()))) {
        amountHeaderCandidates.push(item);
      } else if (/^amount\b/i.test(value) &&
        !/vat\s*amount/i.test(line.text) &&
        !line.items.some((part) => /^(?:vat|thuế)$/i.test(part.text.trim()))) {
        amountHeaderCandidates.push(item);
      }
    }
  }
  const amountHeaders = amountHeaderCandidates
    .sort((a, b) => a.x - b.x)
    .filter((item, index, all) =>
      index === 0 ||
        Math.abs(
          (item.x + item.width / 2) -
          (all[index - 1].x + all[index - 1].width / 2),
        ) > fontHeight * 1.5,
    );
  const includeVat = /(?:thành\s*tiền\s*có\s*thuế|amount\s*including\s*vat|including\s*vat)/i.test(headerText);
  const selectedAmountHeader = amountHeaders.length
    ? includeVat ? amountHeaders.at(-1) : amountHeaders[0]
    : undefined;
  const amountHeaderCenters = amountHeaders.map((item) => item.x + item.width / 2);
  const amountCenter = selectedAmountHeader
    ? selectedAmountHeader.x + selectedAmountHeader.width / 2
    : undefined;
  const otherHeaderCenters = headerLines.flatMap((line) => line.items)
    .filter((item) => item !== selectedAmountHeader &&
      /(?:đơn\s*giá|unit\s*price|thuế\s*suất|vat\s*rate|tiền\s*thuế|vat\s*amount)/i.test(item.text))
    .map((item) => item.x + item.width / 2);
  const leftNeighbor = amountCenter === undefined ? undefined : [...otherHeaderCenters, ...amountHeaderCenters]
    .filter((center) => center < amountCenter)
    .sort((a, b) => b - a)[0];
  const rightNeighbor = amountCenter === undefined ? undefined : [...otherHeaderCenters, ...amountHeaderCenters]
    .filter((center) => center > amountCenter)
    .sort((a, b) => a - b)[0];
  const amountLeft = amountCenter === undefined
    ? -Infinity
    : leftNeighbor === undefined ? amountCenter - fontHeight * 2 : (leftNeighbor + amountCenter) / 2;
  const amountRight = amountCenter === undefined
    ? pageWidth
    : rightNeighbor === undefined ? pageWidth : (rightNeighbor + amountCenter) / 2;

  const anchors = numberLines.flatMap((line) => line.items
    .filter((item) => item.x < descriptionHeader.x - 2 && /^\d{1,3}[.)]?$/.test(item.text.trim()))
    .map((item) => ({ stt: item.text.replace(/[.)]$/, ""), y: line.y }))
  ).sort((a, b) => a.y - b.y);
  const uniqueAnchors = anchors.filter((anchor, index) =>
    index === 0 || anchor.stt !== anchors[index - 1].stt || Math.abs(anchor.y - anchors[index - 1].y) > fontHeight,
  );
  if (!uniqueAnchors.length) return [];

  return uniqueAnchors.map((anchor, index) => {
    const previous = uniqueAnchors[index - 1];
    const next = uniqueAnchors[index + 1];
    const lastHeaderY = headerLines.length
      ? Math.max(...headerLines.map((line) => line.y))
      : lines[descriptionHeaderIndex].y;
    const top = previous ? (previous.y + anchor.y) / 2 : lastHeaderY + fontHeight * 0.5;
    const bottom = next
      ? (anchor.y + next.y) / 2
      : foundSummaryIndex >= 0
        ? lines[foundSummaryIndex].y
        : anchor.y + fontHeight * 3;
    const rowLines = lines.filter((line) => line.y >= top && line.y < bottom);
    const description = rowLines.map((line) => line.items
      .filter((item) => item.x >= descriptionStartX - 2 && item.x < descriptionEndX - 2)
      .map((item) => item.text.trim())
      .filter((text) => /[\p{L}]/u.test(text))
      .join(" "))
      .filter(Boolean)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    const amountCandidates = rowLines.flatMap((line) => line.items)
      .filter((item) => item.x + item.width / 2 >= amountLeft && item.x + item.width / 2 < amountRight)
      .filter((item) => /^\d[\d., ]*$/.test(item.text.trim()))
      .sort((a, b) => b.x - a.x);
    let amount = "";
    for (const candidate of amountCandidates) {
      try {
        amount = normalizeTotal(candidate.text.replace(/\s+/g, " ").trim());
        break;
      } catch { /* ignore non-amount OCR tokens */ }
    }
    return { stt: anchor.stt, description: correctInvoiceDescription(description), amount };
  }).filter((item) => item.description && !containsInvoiceTableHeaders(item.description));
}

function extractHeaderlessPositionedItems(lines, pageWidth) {
  const summaryIndex = lines.findIndex((line) =>
    /(?:cộng\s*tiền\s*hàng|subtotal|total\s*amount)/i.test(line.text),
  );
  if (summaryIndex < 0) return [];
  const tableHeaderIndex = lines.findIndex((line, index) =>
    index < summaryIndex && /(?:stt|ntt|no\.?)/i.test(line.text),
  );
  const candidates = lines.slice(tableHeaderIndex < 0 ? 0 : tableHeaderIndex + 1, summaryIndex)
    .filter((line) => !isInvoiceTableFormula(line.text))
    .flatMap((line) => line.items
      .filter((item) => item.x < pageWidth * 0.18 && /^\d{1,2}[.)]?$/.test(item.text.trim()))
      .map((item) => ({ stt: item.text.replace(/[.)]$/, ""), y: line.y, line })));

  let anchors = [];
  for (const start of candidates.filter((item) => item.stt === "1")) {
    const run = [start];
    let expected = 2;
    for (const candidate of candidates) {
      if (candidate.y <= run.at(-1).y || candidate.stt !== String(expected)) continue;
      run.push(candidate);
      expected += 1;
    }
    if (run.length > anchors.length) anchors = run;
  }
  if (!anchors.length) return [];

  const fontHeight = Math.max(8, anchors[0].line.height);
  const bodyLines = lines.filter((line) =>
    line.y >= anchors[0].y - fontHeight * 2 && line.y < lines[summaryIndex].y,
  );
  const unitItems = bodyLines.flatMap((line) => line.items)
    .filter((item) => item.x > anchors[0].line.items[0].x + 10 &&
      /^(?:lọ|viên|ống|chai|hộp|gói|cái|tuýp|vỉ|bộ|chiếc|dịch\s*vụ|service)$/i.test(item.text.trim()));
  const unitClusters = [];
  for (const item of unitItems.sort((a, b) => a.x - b.x)) {
    const cluster = unitClusters.find((entry) => Math.abs(entry.x - item.x) < Math.max(18, item.height * 1.5));
    if (cluster) {
      cluster.x = (cluster.x * cluster.count + item.x) / (cluster.count + 1);
      cluster.count += 1;
    } else {
      unitClusters.push({ x: item.x, count: 1 });
    }
  }
  const unitX = unitClusters.sort((a, b) => b.count - a.count || b.x - a.x)[0]?.x ?? pageWidth * 0.72;
  const descriptionStartX = bodyLines.flatMap((line) => line.items)
    .filter((item) => item.x > anchors[0].line.items[0].x + 8 && item.x < unitX && /[\p{L}]/u.test(item.text))
    .map((item) => item.x)
    .sort((a, b) => a - b)[0] ?? anchors[0].line.items[0].x + 12;

  return anchors.map((anchor, index) => {
    const previous = anchors[index - 1];
    const next = anchors[index + 1];
    const top = previous ? (previous.y + anchor.y) / 2 : anchor.y - fontHeight * 2;
    const bottom = next ? (anchor.y + next.y) / 2 : lines[summaryIndex].y;
    const rowLines = bodyLines.filter((line) => line.y >= top && line.y < bottom);
    const description = rowLines.map((line) => line.items
      .filter((item) => item.x >= descriptionStartX - 3 && item.x < unitX - 5)
      .map((item) => item.text.trim())
      .filter((text) => /[\p{L}\d]/u.test(text) && text.length > 1)
      .join(" "))
      .filter(Boolean)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    const amounts = rowLines.flatMap((line) => line.items)
      .filter((item) => item.x >= unitX && item.x < pageWidth * 0.93 && /^\d[\d., ]*$/.test(item.text.trim()))
      .sort((a, b) => b.x - a.x);
    let amount = "";
    for (const item of amounts) {
      try { amount = normalizeTotal(item.text.trim()); break; } catch { /* skip non-integer numeric cells */ }
    }
    return { stt: anchor.stt, description: correctInvoiceDescription(description), amount };
  }).filter((item) => item.description && !containsInvoiceTableHeaders(item.description));
}

function filterInvoiceItems(items = []) {
  return items.filter((item) =>
    item.description?.trim() && !containsInvoiceTableHeaders(item.description),
  ).map((item) => ({
    ...item,
    description: correctInvoiceDescription(item.description),
  }));
}

function scorePositionedItems(items) {
  const validItems = filterInvoiceItems(items);
  return validItems.length * 100 + validItems.reduce((score, item) =>
    score + (item.description ? 10 : 0) + (item.amount ? 2 : 0), 0);
}

function findDescriptionRegion(page, items) {
  const header = items.find((item) =>
    /(?:tên\s*hàng\s*hóa|tên\s*hàng\s*hoá|item\s*description|description)/i.test(
      item.text,
    ),
  );
  if (!header) return undefined;

  const subtotal = items
    .filter(
      (item) =>
        item.y < header.y - 20 &&
        /(?:cộng\s*tiền\s*hàng|subtotal|total\s*amount)/i.test(item.text),
    )
    .sort((first, second) => second.y - first.y)[0];
  if (!subtotal) return undefined;

  const pageLeft = page.view[0];
  const pageRight = page.view[2];
  const pageTop = page.view[3];
  const headerRow = items.filter((item) => Math.abs(item.y - header.y) < 32);
  const sttHeader = headerRow.find((item) => /^(?:stt|s\s*t\s*t|no\.?|№)$/i.test(item.text.trim()));
  const nextColumn = headerRow
    .filter((item) => {
      if (item.x <= header.x) return false;
      const label = item.text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
      return /^(?:dvt|donvi|donvitinh|unit|uom|soluong|quantity|dongia|unitprice|price|thanhtien|amount|thuesuat|vatrate|ponvitinh)$/.test(label);
    })
    .sort((first, second) => first.x - second.x)[0];
  // The description is the second table column. Start after STT and stop
  // before the next column, so a wide crop cannot ingest neighboring headers.
  const regionLeft = Math.max(
    pageLeft,
    sttHeader ? sttHeader.x + (sttHeader.width || 0) + 3 : header.x,
  );
  const regionRight = Math.min(
    pageRight,
    nextColumn ? nextColumn.x - 4 : Math.max(regionLeft + 80, header.x + 260),
  );
  const bodyRows = items.filter(
    (item) =>
      item.x >= regionLeft &&
      item.x < regionRight &&
      item.y < header.y - 15 &&
      item.y > subtotal.y + 10,
  );
  if (!bodyRows.length || regionRight <= regionLeft) return undefined;

  const descriptionRows = bodyRows.filter(
    (item) =>
      /[\p{L}]/u.test(item.text) &&
      !isInvoiceTableHeading(item.text) &&
      !isInvoiceTableFormula(item.text),
  );
  if (!descriptionRows.length) return undefined;

  const firstPoint = page.getViewport({ scale: 1 }).convertToViewportPoint(
    regionLeft,
    Math.max(...descriptionRows.map((item) => item.y)) + 5,
  );
  const lastPoint = page.getViewport({ scale: 1 }).convertToViewportPoint(
    regionRight,
    Math.max(subtotal.y + 5, Math.min(...bodyRows.map((item) => item.y)) - 5),
  );
  return {
    pdfHeight: pageTop - page.view[1],
    left: Math.floor(firstPoint[0]),
    top: Math.floor(firstPoint[1]),
    width: Math.ceil(lastPoint[0] - firstPoint[0]),
    height: Math.ceil(lastPoint[1] - firstPoint[1]),
  };
}

function isInvoiceTableHeading(value) {
  return /^(?:tên\s*hàng|description|item|đơn\s*vị|unit|uom|số\s*lượng|quantity|đơn\s*giá|price|thành\s*tiền|amount|thuế\s*suất|vat\s*rate|no\.?|stt)\b/i.test(
    value.trim(),
  );
}

function isInvoiceTableFormula(value) {
  return /\d/.test(value) &&
    /[=x×+]/i.test(value) &&
    /^[\d\s()[\]{}=+x×-]+$/i.test(value.trim());
}

async function recognizePdf(pdf) {
  setStatus("Đang tải thư viện OCR và dữ liệu tiếng Việt…", "success");
  const { createWorker } = await import(`${TESSERACT_BASE}/+esm`);
  let currentPage = 0;
  const worker = await createWorker("vie+eng", 1, {
    workerPath: `${TESSERACT_BASE}/dist/worker.min.js`,
    corePath: TESSERACT_CORE_BASE,
    langPath: "https://tessdata.projectnaptha.com/4.0.0",
    logger: ({ status: label, progress }) => {
      if (progress === undefined) return;
      setStatus(
        `OCR trang ${currentPage}/${pdf.numPages} · ${label}: ${Math.round(progress * 100)}%`,
        "success",
      );
    },
  });

  try {
    const text = [];
    const tableItems = [];
    for (currentPage = 1; currentPage <= pdf.numPages; currentPage += 1) {
      setStatus(`Đang OCR trang ${currentPage}/${pdf.numPages}…`, "success");
      const page = await pdf.getPage(currentPage);
      const pageWidth = page.view[2] - page.view[0];
      const pageHeight = page.view[3] - page.view[1];
      const scale = Math.min(4, 3000 / pageWidth, 4200 / pageHeight);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      try {
        await page.render({
          canvasContext: canvas.getContext("2d"),
          viewport,
        }).promise;
        const firstPass = await worker.recognize(canvas);
        let recognizedText = firstPass.data.text;
        let recognizedItems = extractPositionedInvoiceItems(
          positionedOcrWords(firstPass.data.words),
          canvas.width,
        );
        const firstValues = extractPaymentRequestInvoice(recognizedText);
        const hasItemTable = classifyInvoiceText(recognizedText).tableSignals >= 3 ||
          /(?:stt|tên\s*hàng|goods\s*(?:and|&)\s*services|description)/i.test(recognizedText);
        if (!firstValues.invoiceDate || !firstValues.invoiceNumber || !firstValues.total || (hasItemTable && firstValues.items.length < 2)) {
          setStatus(`Đang quét lại bảng hàng hóa trang ${currentPage}/${pdf.numPages}…`, "success");
          await worker.setParameters({ tessedit_pageseg_mode: "6" });
          const tablePass = await worker.recognize(canvas);
          await worker.setParameters({ tessedit_pageseg_mode: "3" });
          const tableValues = extractPaymentRequestInvoice(tablePass.data.text);
          const tableItems = extractPositionedInvoiceItems(
            positionedOcrWords(tablePass.data.words),
            canvas.width,
          );
          const firstScore = scoreInvoiceOcrResult(firstValues) + scorePositionedItems(recognizedItems) / 100;
          const tableScore = scoreInvoiceOcrResult(tableValues) + scorePositionedItems(tableItems) / 100;
          if (tableScore > firstScore) {
            recognizedText = tablePass.data.text;
            recognizedItems = tableItems;
          }
        }
        text.push(recognizedText);
        tableItems.push(...recognizedItems);
      } finally {
        canvas.width = 0;
        canvas.height = 0;
      }
    }
    return {
      text: text.join("\n"),
      tableItems: tableItems.length ? tableItems : [],
    };
  } finally {
    await worker.terminate();
  }
}

function positionedOcrWords(words = []) {
  return words
    .filter((word) => word.text?.trim() && word.bbox && (word.confidence === undefined || word.confidence >= 25))
    .map((word) => ({
      x: word.bbox.x0,
      y: (word.bbox.y0 + word.bbox.y1) / 2,
      width: word.bbox.x1 - word.bbox.x0,
      height: word.bbox.y1 - word.bbox.y0,
      text: word.text,
    }));
}

function scoreInvoiceOcrResult(values) {
  return Number(Boolean(values.invoiceDate)) * 10 +
    Number(Boolean(values.invoiceNumber)) * 10 +
    Number(Boolean(values.total)) * 10 +
    Math.min(values.items.length, 20) * 8 +
    Math.min(scoreInvoiceDescription(values.description), 100) / 20;
}

async function recognizeInvoiceDescription(pdf, regions) {
  const worker = await createOcrWorker();
  try {
    for (const region of regions) {
      setStatus("Đang kiểm tra nội dung hàng hóa, dịch vụ bằng OCR…", "success");
      const page = await pdf.getPage(region.pageNumber);
      const scale = Math.min(4, 2800 / page.view[2], 4200 / region.pdfHeight);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      try {
        await page.render({
          canvasContext: canvas.getContext("2d"),
          viewport,
        }).promise;
        const rectangle = {
          left: Math.round(region.left * scale),
          top: Math.round(region.top * scale),
          width: Math.round(region.width * scale),
          height: Math.round(region.height * scale),
        };
        let best;
        for (const pageSegmentationMode of ["6", "11"]) {
          await worker.setParameters({ tessedit_pageseg_mode: pageSegmentationMode });
          const { data } = await worker.recognize(canvas, { rectangle });
          const description = correctInvoiceDescription(
            extractPaymentRequestInvoice(data.text).description || extractOcrDescription(data.text),
          );
          if (!description || containsInvoiceTableHeaders(description)) continue;
          const score = scoreInvoiceDescription(description) * 2 + data.confidence;
          if (!best || score > best.score) {
            best = { text: description, confidence: data.confidence, score };
          }
        }
        await worker.setParameters({ tessedit_pageseg_mode: "3" });
        if (best) return { text: best.text, confidence: best.confidence };
      } finally {
        canvas.width = 0;
        canvas.height = 0;
      }
    }
    return undefined;
  } finally {
    await worker.terminate();
  }
}

function containsInvoiceTableHeaders(value) {
  const normalized = value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[đĐ]/g, "d")
    .toLocaleLowerCase("vi-VN");
  const headerTerms = [
    /\bstt\b|\bno\.?\b/,
    /so\s*luong|quantity/,
    /don\s*gia|unit\s*price/,
    /don\s*vi\s*tinh|ponvi\s*tinh|uom/,
    /chua\s*co\s*thue|vat\s*rate|vat\s*amount|thue\s*gtgt/,
    /thanh\s*tien|amount\s*including/,
  ];
  const matches = headerTerms.filter((pattern) => pattern.test(normalized)).length;
  return matches >= 2 || /ponvitinh|ponvi\s*tinh/.test(normalized);
}

async function createOcrWorker() {
  const { createWorker } = await import(`${TESSERACT_BASE}/+esm`);
  return createWorker("vie+eng", 1, {
    workerPath: `${TESSERACT_BASE}/dist/worker.min.js`,
    corePath: TESSERACT_CORE_BASE,
    langPath: "https://tessdata.projectnaptha.com/4.0.0",
    logger: ({ status: label, progress }) => {
      if (progress === undefined) return;
      setStatus(`OCR: ${label} ${Math.round(progress * 100)}%`, "success");
    },
  });
}

function schedulePreview() {
  window.clearTimeout(updateTimer);
  updateTimer = window.setTimeout(updatePreview, 300);
}

async function updatePreview() {
  const version = ++renderVersion;
  downloadButton.disabled = true;
  latestDocument = undefined;

  const values = readValues();
  const validation = validateValues(values);
  updateAmountWords(values.total);
  if (!templateDocxBytes) return;

  const amountWords = amountWordsOutput.value;
  values.amountWords = amountWords && amountWords !== "—" ? amountWords : "";
  previewMessage.textContent = "Đang cập nhật bản xem trước…";
  previewMessage.dataset.kind = "success";
  previewStage.hidden = false;

  try {
    const blob = await buildDocument(values);
    if (version !== renderVersion) return;

    preview.replaceChildren();
    await window.docx.renderAsync(blob, preview, null, {
      inWrapper: true,
      breakPages: true,
    });
    if (version !== renderVersion) return;
    fitDocumentPreview();
    latestDocument = validation ? undefined : blob;
    downloadButton.disabled = Boolean(validation);
    if (validation) {
      previewMessage.textContent = "Bản xem trước đã cập nhật. Điền đủ thông tin để tải file Word.";
      delete previewMessage.dataset.kind;
    } else {
      previewMessage.textContent = "Thông tin đã sẵn sàng. File tải xuống sẽ dùng trực tiếp mẫu Word mới.";
      delete previewMessage.dataset.kind;
    }
  } catch (error) {
    previewStage.hidden = false;
    const message = error instanceof Error ? error.message : "Lỗi không xác định.";
    setPreviewMessage(`Không tạo được bản xem trước: ${message}`, "error");
  }
}

function fitDocumentPreview() {
  const wrapper = preview.querySelector(".docx-wrapper");
  if (!wrapper) return;
  const availableWidth = Math.max(1, previewStage.clientWidth - 40);
  const availableHeight = Math.max(1, previewStage.clientHeight - 40);
  const pages = [...wrapper.querySelectorAll(".docx")];
  for (const page of pages) {
    if (!page.innerText.trim() && !page.querySelector("img, svg, canvas")) page.remove();
  }
  const visiblePages = [...wrapper.querySelectorAll(".docx")];
  if (!visiblePages.length) return;
  const pageWidth = Math.max(...visiblePages.map((page) => page.offsetWidth));
  const pageHeight = Math.max(...visiblePages.map((page) => page.offsetHeight));
  const scale = Math.min(1, availableWidth / pageWidth, availableHeight / pageHeight);
  wrapper.style.alignItems = "flex-start";
  for (const page of visiblePages) {
    page.style.transformOrigin = "top left";
    page.style.transform = `scale(${scale})`;
    page.style.marginLeft = `${Math.max(0, (availableWidth - page.offsetWidth * scale) / 2)}px`;
    page.style.marginRight = "0";
    page.style.marginBottom = `${page.offsetHeight * (scale - 1)}px`;
  }
}

function readValues() {
  return Object.fromEntries(
    Object.values(PLACEHOLDERS)
      .filter((name) => name !== "amountWords")
      .map((name) => [name, inputs[name].value.trim()]),
  );
}

function validateValues(values) {
  const requiredNames = [
    ["position", "Chức vụ"],
    ["requester", "Người đề nghị"],
    ["invoiceDate", "Ngày hóa đơn"],
    ["invoiceNumber", "Số hóa đơn"],
    ["description", "Nội dung thanh toán"],
    ["total", "Số tiền thanh toán"],
  ];
  const missing = requiredNames
    .filter(([name]) => !values[name])
    .map(([, label]) => label);
  if (missing.length) {
    return `Cần điền: ${missing.join(", ")}.`;
  }
  if (!isValidInvoiceDate(values.invoiceDate)) {
    return "Ngày hóa đơn cần đúng định dạng dd/mm/yyyy và là ngày hợp lệ.";
  }
  try {
    values.total = normalizeTotal(values.total);
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    return `Số tiền thanh toán chưa hợp lệ: ${error.message}`;
  }
  const enteredItems = latestItems.filter((item) => item.description.trim());
  for (const [index, item] of enteredItems.entries()) {
    if (enteredItems.length > 1 && !item.amount.trim()) {
      return `Cần nhập thành tiền cho hàng hóa/dịch vụ dòng ${item.stt || index + 1}.`;
    }
    if (item.amount.trim()) {
      try { normalizeTotal(item.amount); } catch {
        return `Thành tiền của hàng hóa/dịch vụ dòng ${item.stt || index + 1} chưa hợp lệ.`;
      }
    }
  }
  return "";
}

function isValidInvoiceDate(value) {
  const match = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return false;
  const [, dayText, monthText, yearText] = match;
  const day = Number(dayText);
  const month = Number(monthText);
  const year = Number(yearText);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function updateAmountWords(total) {
  if (!total) {
    amountWordsOutput.value = "—";
    return;
  }
  try {
    amountWordsOutput.value = amountInVietnameseWords(normalizeTotal(total));
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    amountWordsOutput.value = "";
  }
}

function formatPreviewTotal(value) {
  if (!value) return "";
  try {
    return new Intl.NumberFormat("vi-VN").format(BigInt(normalizeTotal(value)));
  } catch {
    return value;
  }
}

async function buildDocument(values) {
  const zip = await window.JSZip.loadAsync(templateDocxBytes);
  const xmlFile = zip.file("word/document.xml");
  if (!xmlFile) throw new Error("Mẫu Word không có nội dung document.xml.");
  const xml = new DOMParser().parseFromString(await xmlFile.async("text"), "application/xml");
  if (xml.querySelector("parsererror")) throw new Error("Không đọc được nội dung mẫu Word.");
  const ns = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const paragraphs = [...xml.getElementsByTagNameNS(ns, "p")];
  const paragraphText = (p) => [...p.getElementsByTagNameNS(ns, "t")].map((node) => node.textContent).join("");
  const replaceParagraph = (p, text) => {
    for (const child of [...p.childNodes]) if (child.localName !== "pPr") p.removeChild(child);
    const run = xml.createElementNS(ns, "w:r");
    const rPr = xml.createElementNS(ns, "w:rPr");
    const fonts = xml.createElementNS(ns, "w:rFonts");
    for (const attr of ["ascii", "hAnsi", "eastAsia", "cs"]) fonts.setAttributeNS(ns, `w:${attr}`, "Times New Roman");
    rPr.append(fonts);
    const size = xml.createElementNS(ns, "w:sz"); size.setAttributeNS(ns, "w:val", "24"); rPr.append(size);
    const sizeCs = xml.createElementNS(ns, "w:szCs"); sizeCs.setAttributeNS(ns, "w:val", "24"); rPr.append(sizeCs);
    run.append(rPr);
    const t = xml.createElementNS(ns, "w:t"); t.setAttributeNS("http://www.w3.org/XML/1998/namespace", "xml:space", "preserve"); t.textContent = text; run.append(t); p.append(run);
  };
  for (const p of paragraphs) {
    const text = paragraphText(p);
    if (/^Họ và tên người đề nghị:/.test(text)) replaceParagraph(p, `Họ và tên người đề nghị: ${values.requester}     Chức vụ: ${values.position}`);
    else if (/^Nay đề nghị thanh toán số tiền:/.test(text)) {
      const total = formatPreviewTotal(values.total);
      replaceParagraph(p, `Nay đề nghị thanh toán số tiền: ${total}${total ? " VNĐ" : ""}`);
    }
    else if (/^Bằng chữ:/.test(text)) replaceParagraph(p, `Bằng chữ: ${values.amountWords || ""}`);
  }
  const approvalName = paragraphs.find((p) => paragraphText(p).includes("Lương Quế Trân"));
  const approvalTabRun = approvalName && [...approvalName.children].find(
    (child) => child.localName === "r" && child.getElementsByTagNameNS(ns, "tab").length,
  );
  const approvalProperties = approvalName?.getElementsByTagNameNS(ns, "pPr")[0];
  if (approvalName && approvalTabRun && approvalProperties) {
    let tabStops = approvalProperties.getElementsByTagNameNS(ns, "tabs")[0];
    if (!tabStops) {
      tabStops = xml.createElementNS(ns, "w:tabs");
      approvalProperties.append(tabStops);
    }
    const requesterCenterStop = xml.createElementNS(ns, "w:tab");
    requesterCenterStop.setAttributeNS(ns, "w:val", "center");
    requesterCenterStop.setAttributeNS(ns, "w:pos", "1700");
    tabStops.insertBefore(requesterCenterStop, tabStops.firstChild);

    let preceding = approvalProperties.nextSibling;
    while (preceding && preceding !== approvalTabRun) {
      const next = preceding.nextSibling;
      approvalName.removeChild(preceding);
      preceding = next;
    }
    const makeRun = (text, isTab = false) => {
      const run = xml.createElementNS(ns, "w:r");
      const properties = xml.createElementNS(ns, "w:rPr");
      const fonts = xml.createElementNS(ns, "w:rFonts");
      for (const attr of ["ascii", "hAnsi", "eastAsia", "cs"]) fonts.setAttributeNS(ns, `w:${attr}`, "Times New Roman");
      properties.append(fonts);
      const size = xml.createElementNS(ns, "w:sz"); size.setAttributeNS(ns, "w:val", "24"); properties.append(size);
      const sizeCs = xml.createElementNS(ns, "w:szCs"); sizeCs.setAttributeNS(ns, "w:val", "24"); properties.append(sizeCs);
      run.append(properties);
      if (isTab) run.append(xml.createElementNS(ns, "w:tab"));
      else {
        const value = xml.createElementNS(ns, "w:t");
        value.setAttributeNS("http://www.w3.org/XML/1998/namespace", "xml:space", "preserve");
        value.textContent = text;
        run.append(value);
      }
      return run;
    };
    approvalName.insertBefore(makeRun("", true), approvalTabRun);
    approvalName.insertBefore(makeRun(values.requester), approvalTabRun);
  }
  const tables = [...xml.getElementsByTagNameNS(ns, "tbl")];
  const paymentTable = tables.find((table) => [...table.getElementsByTagNameNS(ns, "tr")][0]?.textContent.includes("STT"));
  if (!paymentTable) throw new Error("Không tìm thấy bảng thanh toán trong mẫu Word.");
  const rows = [...paymentTable.children].filter((node) => node.localName === "tr");
  const itemTemplate = rows[1];
  const totalRow = rows.find((row) => row.textContent.includes("Tổng Cộng"));
  if (!itemTemplate || !totalRow) throw new Error("Bảng mẫu Word thiếu dòng hàng hóa hoặc dòng Tổng Cộng.");
  for (const row of rows.slice(1).filter((row) => row !== itemTemplate && row !== totalRow && !row.textContent.includes("Hạch toán"))) row.remove();
  const items = (latestItems.length ? latestItems : [{ stt: "1", description: values.description, amount: values.total }])
    .filter((item) => item.description.trim());
  const template = itemTemplate.cloneNode(true);
  const insertBefore = totalRow;
  for (const [index, item] of items.entries()) {
    const row = index === 0 ? itemTemplate : template.cloneNode(true);
    if (index > 0) {
      const word2010 = "http://schemas.microsoft.com/office/word/2010/wordml";
      for (const paragraph of row.getElementsByTagNameNS(ns, "p")) {
        paragraph.removeAttributeNS(word2010, "paraId");
        paragraph.removeAttributeNS(word2010, "textId");
      }
    }
    const cells = [...row.children].filter((node) => node.localName === "tc");
    const itemAmount = items.length === 1
      ? values.total || item.amount
      : item.amount;
    const cellValues = [item.stt || String(index + 1), values.invoiceDate, values.invoiceNumber, item.description, itemAmount ? formatItemAmount(itemAmount) : ""];
    cells.forEach((cell, cellIndex) => {
      const p = cell.getElementsByTagNameNS(ns, "p")[0];
      if (p) replaceParagraph(p, cellValues[cellIndex]);
      for (const extra of [...cell.getElementsByTagNameNS(ns, "p")].slice(1)) replaceParagraph(extra, "");
    });
    if (index > 0) paymentTable.insertBefore(row, insertBefore);
  }
  const totalCells = [...totalRow.children].filter((node) => node.localName === "tc");
  const totalCell = totalCells.at(-1);
  if (totalCell) replaceParagraph(totalCell.getElementsByTagNameNS(ns, "p")[0], formatPreviewTotal(values.total));
  zip.file("word/document.xml", new XMLSerializer().serializeToString(xml));
  return zip.generateAsync({ type: "blob", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
}

function downloadDocument() {
  if (!latestDocument) return;
  const invoiceNumber = inputs.invoiceNumber.value
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "_");
  const link = document.createElement("a");
  link.href = URL.createObjectURL(latestDocument);
  link.download = `Giay_de_nghi_thanh_toan_${invoiceNumber || "hoa-don"}.docx`;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

function setStatus(message, kind) {
  status.textContent = message;
  status.dataset.kind = kind;
  status.hidden = false;
}

function setPreviewMessage(message, kind) {
  previewMessage.textContent = message;
  if (kind) previewMessage.dataset.kind = kind;
  else delete previewMessage.dataset.kind;
}
