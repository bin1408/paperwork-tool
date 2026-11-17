import { extractInvoice } from "./invoice-parser.mjs";

const PDFJS_VERSION = "4.10.38";
const PDFJS_BASE = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build`;
const TESSERACT_VERSION = "5.1.1";
const TESSERACT_BASE = `https://cdn.jsdelivr.net/npm/tesseract.js@${TESSERACT_VERSION}`;

const fileInput = document.querySelector("#invoice-file");
const fileName = document.querySelector("#file-name");
const status = document.querySelector("#status");
const details = document.querySelector("#details");

fileInput.addEventListener("change", handleFile);

document.querySelectorAll("[data-copy]").forEach((button) => {
  button.addEventListener("click", async () => {
    const input = document.getElementById(button.dataset.copy);
    try {
      await navigator.clipboard.writeText(input.value);
      setStatus(`Đã sao chép: ${input.value}`, "success");
    } catch (error) {
      setStatus(
        "Không thể sao chép tự động. Hãy chọn và sao chép giá trị trong ô.",
        "error",
      );
    }
  });
});

async function handleFile() {
  const file = fileInput.files?.[0];
  details.hidden = true;
  fileName.textContent = "";
  hideStatus();
  if (!file) return;

  if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
    setStatus("Vui lòng chọn một tệp PDF.", "error");
    fileInput.value = "";
    return;
  }

  fileName.textContent = `${file.name} · ${(file.size / 1024 / 1024).toFixed(2)} MB`;
  let pdf;
  try {
    setStatus("Đang đọc PDF trong trình duyệt của bạn…", "success");
    pdf = await openPdf(file);
    let text = await extractPdfText(pdf);

    try {
      const values = extractInvoice(text);
      showDetails(values);
      setStatus("Đã trích xuất xong. Hãy đối chiếu với hóa đơn.", "success");
      return;
    } catch (textError) {
      if (text.trim()) {
        setStatus("Không đọc đủ thông tin văn bản. Đang thử OCR cục bộ…", "success");
      } else {
        setStatus("PDF có thể là bản scan. Đang thử OCR cục bộ…", "success");
      }
    }

    text = await recognizeFirstPage(pdf);
    const values = extractInvoice(text);
    showDetails(values);
    setStatus(
      "Đã trích xuất bằng OCR. Vui lòng kiểm tra kỹ các ký tự dễ nhầm trước khi tra cứu.",
      "success",
    );
  } catch (error) {
    setStatus(
      `Không trích xuất được thông tin: ${error.message} Bạn có thể nhập thông tin bằng cách kiểm tra trực tiếp trên hóa đơn.`,
      "error",
    );
    showDetails({ taxCode: "", serial: "", invoiceNumber: "", total: "" });
  } finally {
    await pdf?.destroy();
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

async function extractPdfText(pdf) {
  const pages = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const rows = new Map();
    for (const item of content.items) {
      if (!("str" in item) || !item.str.trim()) continue;
      const y = Math.round(item.transform[5] / 3) * 3;
      const row = rows.get(y) ?? [];
      row.push({ x: item.transform[4], text: item.str });
      rows.set(y, row);
    }
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
  return pages.join("\n");
}

async function recognizeFirstPage(pdf) {
  setStatus("Đang tải thư viện OCR và dữ liệu tiếng Việt…", "success");
  const { createWorker } = await import(`${TESSERACT_BASE}/+esm`);
  const worker = await createWorker("vie+eng", 1, {
    workerPath: `${TESSERACT_BASE}/dist/worker.min.js`,
    corePath: `${TESSERACT_BASE}/core`,
    langPath: "https://tessdata.projectnaptha.com/4.0.0",
    logger: ({ status: label, progress }) => {
      if (progress === undefined) return;
      setStatus(`${label}: ${Math.round(progress * 100)}%`, "success");
    },
  });

  try {
    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    await page.render({
      canvasContext: canvas.getContext("2d"),
      viewport,
    }).promise;
    const result = await worker.recognize(canvas);
    canvas.width = 0;
    canvas.height = 0;
    return result.data.text;
  } finally {
    await worker.terminate();
  }
}

function showDetails(values) {
  document.querySelector("#tax-code").value = values.taxCode;
  document.querySelector("#serial").value = values.serial;
  document.querySelector("#invoice-number").value = values.invoiceNumber;
  document.querySelector("#total").value = values.total;
  details.hidden = false;
  details.scrollIntoView({ behavior: "smooth", block: "start" });
}

function setStatus(message, kind) {
  status.textContent = message;
  status.dataset.kind = kind;
  status.hidden = false;
}

function hideStatus() {
  status.hidden = true;
  status.textContent = "";
  delete status.dataset.kind;
}
