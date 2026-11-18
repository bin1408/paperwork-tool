import {
  amountInVietnameseWords,
  extractOcrDescription,
  extractPaymentRequestInvoice,
  mergeOcrDescription,
  normalizeTotal,
} from "./payment-request-parser.mjs";

const PDFJS_VERSION = "4.10.38";
const PDFJS_BASE = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build`;
const TESSERACT_VERSION = "5.1.1";
const TESSERACT_BASE = `https://cdn.jsdelivr.net/npm/tesseract.js@${TESSERACT_VERSION}`;
const TESSERACT_CORE_BASE = `https://cdn.jsdelivr.net/npm/tesseract.js-core@${TESSERACT_VERSION}`;
const TEMPLATE_PDF_URL = "./templates/payment-request.pdf";
const TEMPLATE_RENDER_SCALE = 3;
const FILLED_TEXT_FONT_SIZE = 12;
const DESCRIPTION_LINE_HEIGHT = 14;
const PLACEHOLDERS = {
  FULL_NAME: "fullName",
  POSITION: "position",
  REQUESTER: "requester",
  INVOICE_DATE: "invoiceDate",
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
const downloadButton = document.querySelector("#download-pdf");
const amountWordsOutput = document.querySelector("#amount-words");
const inputs = Object.fromEntries(
  Object.values(PLACEHOLDERS)
    .filter((name) => name !== "amountWords")
    .map((name) => [name, document.getElementById(INPUT_IDS[name])]),
);

let templatePdfBytes;
let latestDocument;
let templatePage;
let templatePageCanvas;
let templatePdf;
let renderVersion = 0;
let updateTimer;

fileInput.addEventListener("change", handleFile);
downloadButton.addEventListener("click", downloadDocument);
new Set(Object.values(inputs)).forEach((input) => {
  input.addEventListener("input", schedulePreview);
});

initialize();

async function initialize() {
  try {
    if (!window.jspdf?.jsPDF) {
      throw new Error("Không tải được thư viện tạo file PDF. Hãy tải lại trang hoặc kiểm tra kết nối mạng.");
    }
    const response = await fetch(TEMPLATE_PDF_URL);
    if (!response.ok) {
      throw new Error(`Không tải được mẫu PDF (${response.status}).`);
    }
    templatePdfBytes = await response.arrayBuffer();
    const { getDocument, GlobalWorkerOptions } = await import(
      `${PDFJS_BASE}/pdf.min.mjs`
    );
    GlobalWorkerOptions.workerSrc = `${PDFJS_BASE}/pdf.worker.min.mjs`;
    templatePdf = await getDocument({
      data: new Uint8Array(templatePdfBytes),
    }).promise;
    for (let pageNumber = 2; pageNumber <= templatePdf.numPages; pageNumber += 1) {
      const page = await templatePdf.getPage(pageNumber);
      const content = await page.getTextContent();
      if (content.items.some((item) => "str" in item && item.str.trim())) {
        throw new Error(
          "Mẫu PDF chỉ hỗ trợ một trang nội dung; các trang sau phải để trống.",
        );
      }
    }
    templatePage = await templatePdf.getPage(1);
    const viewport = templatePage.getViewport({ scale: TEMPLATE_RENDER_SCALE });
    templatePageCanvas = document.createElement("canvas");
    templatePageCanvas.width = Math.ceil(viewport.width);
    templatePageCanvas.height = Math.ceil(viewport.height);
    await templatePage.render({
      canvasContext: templatePageCanvas.getContext("2d"),
      viewport,
    }).promise;
    previewMessage.textContent =
      "Nhập thông tin người đề nghị và chọn hóa đơn để xem trước tài liệu.";
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
  for (const name of ["invoiceDate", "invoiceNumber", "description", "total"]) {
    inputs[name].value = "";
  }
  let pdf;
  try {
    setStatus("Đang đọc hóa đơn trong trình duyệt…", "success");
    pdf = await openPdf(file);
    const { text, descriptionRegions } = await extractPdfContent(pdf);
    let values = extractPaymentRequestInvoice(text);
    const hadTextValues = Object.values(values).some(Boolean);
    applyExtractedValues(values);
    let extractionMethod = "PDF";
    let descriptionOcrApplied = false;
    let descriptionOcrChecked = false;

    if (Object.values(values).some((value) => !value)) {
      setStatus(
        "Một số trường chưa nhận diện được. Đang thử OCR các trang hóa đơn còn thiếu thông tin…",
        "success",
      );
      const ocrText = await recognizePdf(pdf);
      const ocrValues = extractPaymentRequestInvoice(ocrText);
      values = Object.fromEntries(
        Object.keys(values).map((key) => [key, values[key] || ocrValues[key]]),
      );
      applyExtractedValues(values);
      extractionMethod = hadTextValues ? "PDF và OCR" : "OCR";
    }

    let ocrWarning = "";
    if (values.description && descriptionRegions.length) {
      try {
        const ocrDescription = await recognizeInvoiceDescription(
          pdf,
          descriptionRegions,
        );
        if (ocrDescription) {
          descriptionOcrChecked = true;
          const correctedDescription = mergeOcrDescription(
            values.description,
            ocrDescription.text,
            ocrDescription.confidence,
          );
          descriptionOcrApplied = correctedDescription !== values.description;
          values.description = correctedDescription;
          inputs.description.value = correctedDescription;
          if (descriptionOcrApplied) extractionMethod += " và OCR nội dung";
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        ocrWarning = ` Không thể kiểm tra chính tả nội dung bằng OCR: ${message}`;
      }
    }

    const missing = Object.entries({
      "ngày hóa đơn": values.invoiceDate,
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
      const descriptionStatus = descriptionOcrChecked
        ? descriptionOcrApplied
          ? ""
          : " OCR đã đối chiếu nhưng giữ nguyên nội dung PDF."
        : "";
      setStatus(
        `Đã trích xuất bằng ${extractionMethod}.${descriptionStatus} Hãy đối chiếu thông tin với hóa đơn.${ocrWarning}`,
        ocrWarning ? "error" : "success",
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

function applyExtractedValues(values) {
  for (const name of ["invoiceDate", "invoiceNumber", "description"]) {
    if (values[name]) inputs[name].value = values[name];
  }
  if (values.total) {
    inputs.total.value = new Intl.NumberFormat("vi-VN").format(BigInt(values.total));
  }
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
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const rows = new Map();
    const positionedItems = [];
    for (const item of content.items) {
      if (!("str" in item) || !item.str.trim()) continue;
      const x = item.transform[4];
      const y = item.transform[5];
      positionedItems.push({ x, y, text: item.str });
      const rowY = Math.round(y / 3) * 3;
      const row = rows.get(rowY) ?? [];
      row.push({ x, text: item.str });
      rows.set(rowY, row);
    }
    const region = findDescriptionRegion(page, positionedItems);
    if (region) descriptionRegions.push({ pageNumber, ...region });
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
  return { text: pages.join("\n"), descriptionRegions };
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
  const nextColumn = items
    .filter(
      (item) =>
        item.x > header.x &&
        Math.abs(item.y - header.y) < 8 &&
        /^(?:đvt|dvt|uom|số lượng|quantity|đơn giá|price|thành tiền|amount)$/i.test(
          item.text.trim(),
        ),
    )
    .sort((first, second) => first.x - second.x)[0];
  const columnRight = nextColumn?.x ?? Math.min(header.x + 220, pageRight);
  const regionLeft = Math.max(pageLeft, header.x - 110);
  const regionRight = Math.min(pageRight, columnRight - 10);
  const bodyRows = items.filter(
    (item) =>
      item.x >= regionLeft &&
      item.x < regionRight &&
      item.y < header.y - 15 &&
      item.y > subtotal.y + 10,
  );
  if (!bodyRows.length || regionRight <= regionLeft) return undefined;

  const firstPoint = page.getViewport({ scale: 1 }).convertToViewportPoint(
    regionLeft,
    header.y + 5,
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
    for (currentPage = 1; currentPage <= pdf.numPages; currentPage += 1) {
      setStatus(`Đang OCR trang ${currentPage}/${pdf.numPages}…`, "success");
      const page = await pdf.getPage(currentPage);
      const viewport = page.getViewport({ scale: 2 });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      try {
        await page.render({
          canvasContext: canvas.getContext("2d"),
          viewport,
        }).promise;
        const result = await worker.recognize(canvas);
        text.push(result.data.text);
      } finally {
        canvas.width = 0;
        canvas.height = 0;
      }
    }
    return text.join("\n");
  } finally {
    await worker.terminate();
  }
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
        const { data } = await worker.recognize(canvas, {
          rectangle: {
            left: Math.round(region.left * scale),
            top: Math.round(region.top * scale),
            width: Math.round(region.width * scale),
            height: Math.round(region.height * scale),
          },
        });
        const description =
          extractPaymentRequestInvoice(data.text).description ||
          extractOcrDescription(data.text);
        if (description) {
          return { text: description, confidence: data.confidence };
        }
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
  if (validation) {
    previewStage.hidden = true;
    setPreviewMessage(validation);
    updateAmountWords(values.total);
    return;
  }

  if (!templatePdfBytes || !templatePageCanvas) return;
  updateAmountWords(values.total);
  const amountWords = amountWordsOutput.value;
  if (!amountWords || amountWords === "—") {
    previewStage.hidden = true;
    setPreviewMessage("Không thể đọc số tiền bằng chữ. Hãy kiểm tra số tiền thanh toán.", "error");
    return;
  }
  values.amountWords = amountWords;

  try {
    previewMessage.textContent = "Đang cập nhật bản xem trước…";
    previewMessage.dataset.kind = "success";
    previewStage.hidden = false;
    const canvas = renderPaymentRequestPage(values);
    if (version !== renderVersion) return;
    const blob = buildDocument(canvas);
    if (version !== renderVersion) return;

    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", "Bản xem trước giấy đề nghị thanh toán theo mẫu PDF");
    preview.replaceChildren(canvas);
    latestDocument = blob;
    downloadButton.disabled = false;
    previewMessage.textContent = "Bản xem trước đã cập nhật theo thông tin hiện tại.";
    delete previewMessage.dataset.kind;
  } catch (error) {
    previewStage.hidden = true;
    const message = error instanceof Error ? error.message : "Lỗi không xác định.";
    setPreviewMessage(`Không tạo được bản xem trước: ${message}`, "error");
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

function renderPaymentRequestPage(values) {
  const [pageLeft, , pageRight, pageTop] = templatePage.view;
  const scale = templatePageCanvas.width / (pageRight - pageLeft);
  const canvas = document.createElement("canvas");
  canvas.width = templatePageCanvas.width;
  canvas.height = templatePageCanvas.height;
  const context = canvas.getContext("2d");
  const rowTop = 545;
  const descriptionX = 263;
  const descriptionWidth = 178;
  const rowBottom = 461;
  const rowHeight = rowTop - rowBottom;
  const totalRowBaseline = 447.36;
  const descriptionLayout = layoutDescription(
    context,
    values.description,
    descriptionWidth * scale,
    scale,
  );
  const rowExpansion = Math.max(
    0,
    descriptionLayout.lines.length * DESCRIPTION_LINE_HEIGHT + 8 - rowHeight,
  );
  const sourceY = (pageTop - rowBottom) * scale;
  const expansionPixels = Math.ceil(rowExpansion * scale);
  context.drawImage(templatePageCanvas, 0, 0);

  if (expansionPixels) {
    context.fillStyle = "#fff";
    context.fillRect(0, sourceY, canvas.width, canvas.height - sourceY);
    context.drawImage(
      templatePageCanvas,
      0,
      sourceY,
      canvas.width,
      canvas.height - sourceY - expansionPixels,
      0,
      sourceY + expansionPixels,
      canvas.width,
      canvas.height - sourceY - expansionPixels,
    );
    extendDescriptionTableRow(context, scale, pageTop, rowBottom, rowExpansion);
  }

  const y = (pdfY) => (pageTop - pdfY) * scale;
  const x = (pdfX) => (pdfX - pageLeft) * scale;
  const text = (value, pdfX, pdfY, alignment = "left") => {
    context.font = `${FILLED_TEXT_FONT_SIZE * scale}px "Times New Roman", serif`;
    context.fillStyle = "#000";
    context.textBaseline = "alphabetic";
    context.textAlign = alignment;
    context.fillText(value, x(pdfX), y(pdfY));
    context.textAlign = "left";
  };

  const expandedRowBottom = rowBottom - rowExpansion;
  const rowCenter = (rowTop + expandedRowBottom) / 2;
  const centeredTextBaseline = rowCenter - FILLED_TEXT_FONT_SIZE * 0.35;
  const descriptionBaseline =
    rowCenter +
    ((descriptionLayout.lines.length - 1) * DESCRIPTION_LINE_HEIGHT) / 2 -
    FILLED_TEXT_FONT_SIZE * 0.35;
  const formattedTotal = new Intl.NumberFormat("vi-VN").format(
    BigInt(values.total),
  );
  text(values.requester, 196, 671.3);
  text(values.position, 350, 671.3);
  text(`${formattedTotal} VNĐ`, 225, 631.44);
  text(values.invoiceDate, 149.5, centeredTextBaseline, "center");
  text(values.invoiceNumber, 224, centeredTextBaseline, "center");
  drawDescription(
    context,
    descriptionLayout,
    x(descriptionX),
    y(descriptionBaseline),
    descriptionWidth * scale,
    scale,
  );
  text(formattedTotal, 451, centeredTextBaseline);
  text(formattedTotal, 451, totalRowBaseline - rowExpansion);
  text(values.amountWords, 132, 400.8 - rowExpansion);
  text(values.requester, 123, 216.72 - rowExpansion);

  return canvas;
}

function layoutDescription(context, description, maxWidth, scale) {
  const fontSize = FILLED_TEXT_FONT_SIZE;
  context.font = `${fontSize * scale}px "Times New Roman", serif`;
  return { lines: wrapText(context, description, maxWidth), fontSize };
}

function drawDescription(context, layout, x, baseline, maxWidth, scale) {
  context.font = `${layout.fontSize * scale}px "Times New Roman", serif`;
  context.fillStyle = "#000";
  context.textBaseline = "alphabetic";
  const lineHeight = DESCRIPTION_LINE_HEIGHT * scale;
  layout.lines.forEach((line, index) => {
    context.fillText(line, x, baseline + index * lineHeight, maxWidth);
  });
}

function extendDescriptionTableRow(
  context,
  scale,
  pageTop,
  rowBottom,
  expansion,
) {
  const x = (pdfX) => (pdfX - templatePage.view[0]) * scale;
  const y = (pdfY) => (pageTop - pdfY) * scale;
  context.strokeStyle = "#222";
  context.lineWidth = 0.48 * scale;
  for (const boundary of [78, 109, 190, 258, 446, 550]) {
    context.beginPath();
    context.moveTo(x(boundary), y(rowBottom));
    context.lineTo(x(boundary), y(rowBottom - expansion));
    context.stroke();
  }
  context.beginPath();
  context.moveTo(x(78), y(rowBottom - expansion));
  context.lineTo(x(550), y(rowBottom - expansion));
  context.stroke();
}

function wrapText(context, text, maxWidth) {
  const words = text.split(/\s+/);
  const lines = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && context.measureText(candidate).width > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function buildDocument(canvas) {
  const { jsPDF } = window.jspdf;
  const width = templatePage.view[2];
  const height = templatePage.view[3];
  const pdf = new jsPDF({ unit: "pt", format: [width, height], compress: true });
  pdf.addImage(canvas.toDataURL("image/png"), "PNG", 0, 0, width, height);
  return pdf.output("blob");
}

function downloadDocument() {
  if (!latestDocument) return;
  const invoiceNumber = inputs.invoiceNumber.value
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "_");
  const link = document.createElement("a");
  link.href = URL.createObjectURL(latestDocument);
  link.download = `Giay_de_nghi_thanh_toan_${invoiceNumber || "hoa-don"}.pdf`;
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
