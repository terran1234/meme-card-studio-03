"use strict";

// 작업 상태: 화면 그리기의 유일한 근거. 파일 저장·템플릿도 이 객체를 기준으로 한다.
const state = {
  image: null,       // 디코딩된 이미지 (ImageBitmap)
  imageName: "",
  text: "안녕하세요",
  x: 50,             // 가로 위치 (%)
  y: 50,             // 세로 위치 (%)
  size: 96,          // 글자 크기 (캔버스 px)
  color: "#ffffff",
  ratio: "1:1",      // 화면비 키 (RATIOS 참고)
};

// 내보내기 픽셀 크기. 미리보기 캔버스도 같은 크기를 쓰므로 화면과 파일의 좌표 기준이 하나다.
const RATIOS = {
  "1:1": { w: 1080, h: 1080, file: "1x1" },
  "4:5": { w: 1080, h: 1350, file: "4x5" },
  "9:16": { w: 1080, h: 1920, file: "9x16" },
};
const TEXT_MAX_WIDTH = 0.9;  // 자동 줄바꿈 기준: 캔버스 폭의 90%
const TEXT_MAX_HEIGHT = 0.96; // 글자 덩어리 높이 한도: 캔버스 높이의 96%
const MIN_FONT_SIZE = 12;
const TEXT_LIMIT = 200;

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_PIXELS = 50 * 1000 * 1000;
const FONT_FAMILY = '"Malgun Gothic", "Apple SD Gothic Neo", "Noto Sans KR", sans-serif';

const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");
const $ = (id) => document.getElementById(id);

// ---------- 그리기 ----------
// 미리보기와 (이후) 내려받기가 같은 함수를 쓰도록 캔버스를 인자로 받는다.
function render(targetCanvas, s) {
  const c = targetCanvas.getContext("2d");
  const w = targetCanvas.width;
  const h = targetCanvas.height;

  // 흰 바탕을 먼저 깔아서, 투명 PNG가 JPEG로 저장될 때 검정으로 바뀌지 않게 하고
  // 화면과 파일의 투명 영역이 같은 모습이 되게 한다.
  c.fillStyle = "#ffffff";
  c.fillRect(0, 0, w, h);

  if (s.image) {
    drawCover(c, s.image, w, h);
  } else {
    drawPlaceholder(c, w, h);
  }

  drawText(c, s, w, h);
}

// 이미지가 없을 때의 배경. 문구가 얹혀도 읽히도록 어두운 그라데이션을 쓴다.
function drawPlaceholder(c, w, h) {
  const g = c.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, "#3b2f8f");
  g.addColorStop(1, "#c2417a");
  c.fillStyle = g;
  c.fillRect(0, 0, w, h);

  c.fillStyle = "rgba(255,255,255,0.10)";
  c.beginPath();
  c.arc(w * 0.2, h * 0.22, w * 0.22, 0, Math.PI * 2);
  c.fill();
  c.beginPath();
  c.arc(w * 0.85, h * 0.8, w * 0.28, 0, Math.PI * 2);
  c.fill();

  c.fillStyle = "rgba(255,255,255,0.75)";
  c.font = `600 ${Math.round(w * 0.028)}px ${FONT_FAMILY}`;
  c.textAlign = "center";
  c.textBaseline = "middle";
  c.fillText("오른쪽에서 이미지를 불러오세요", w / 2, h * 0.94);
}

function drawCover(c, img, w, h) {
  const scale = Math.max(w / img.width, h / img.height);
  const dw = img.width * scale;
  const dh = img.height * scale;
  c.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
}

// 수동 줄바꿈(\n)을 지키면서, 폭을 넘으면 공백 → 없으면 글자 단위로 줄을 나눈다.
function wrapLines(c, text, maxWidth) {
  const out = [];
  for (const para of text.split("\n")) {
    if (para === "") {
      out.push("");
      continue;
    }
    let cur = "";
    for (const ch of Array.from(para)) {
      if (cur !== "" && c.measureText(cur + ch).width > maxWidth) {
        const sp = cur.lastIndexOf(" ");
        if (sp > 0 && ch !== " ") {
          out.push(cur.slice(0, sp));
          cur = cur.slice(sp + 1) + ch;
        } else {
          out.push(cur);
          cur = ch === " " ? "" : ch;
        }
      } else {
        cur += ch;
      }
    }
    out.push(cur);
  }
  return out;
}

// 문구의 줄 나눔과 배치를 계산한다. 그리기(drawText)와 검사(tests/extreme.html)가 같은 결과를 쓴다.
function layoutText(c, s, w, h) {
  if (s.text.trim() === "") return null;

  // 글자 덩어리(모든 줄)의 높이가 캔버스 높이의 96%를 넘으면 글자 크기를 줄여 전부 보이게 한다.
  // 위치(x, y)는 사용자가 정한 대로 두므로, 가장자리 쪽에 놓은 문구가 잘리는 것까지 막지는 않는다.
  let size = s.size;
  let lines, lineHeight;
  for (;;) {
    c.font = `700 ${size}px ${FONT_FAMILY}`;
    lines = wrapLines(c, s.text, w * TEXT_MAX_WIDTH);
    lineHeight = size * 1.25;
    const blockHeight = (lines.length - 1) * lineHeight + size * 1.2;
    if (blockHeight <= h * TEXT_MAX_HEIGHT || size <= MIN_FONT_SIZE) break;
    size = Math.max(MIN_FONT_SIZE, Math.floor(size * 0.94));
  }
  const cx = (s.x / 100) * w;
  const cy = (s.y / 100) * h;
  const top = cy - ((lines.length - 1) * lineHeight) / 2;
  return { lines, size, lineHeight, cx, cy, top, shrunk: size < s.size };
}

function drawText(c, s, w, h) {
  const L = layoutText(c, s, w, h);
  if (!L) return;
  const { lines, size, lineHeight, cx, top } = L;

  c.font = `700 ${size}px ${FONT_FAMILY}`;
  c.textAlign = "center";
  c.textBaseline = "middle";
  c.lineJoin = "round";
  c.lineWidth = Math.max(2, size * 0.12);
  c.strokeStyle = contrastOutline(s.color);
  c.fillStyle = s.color;

  lines.forEach((line, i) => {
    const y = top + i * lineHeight;
    c.strokeText(line, cx, y);
    c.fillText(line, cx, y);
  });
}

// 글자색이 밝으면 어두운 외곽선, 어두우면 밝은 외곽선을 써서 어떤 배경에서도 읽히게 한다.
function contrastOutline(hex) {
  const n = parseInt(hex.slice(1), 16);
  const lum = 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
  return lum > 140 ? "rgba(0,0,0,0.85)" : "rgba(255,255,255,0.9)";
}

function redraw() {
  render(canvas, state);
  updateTextNotes();
}

// 글자가 넘쳐서 자동으로 줄었을 때와 입력 글자 수를 알려서, 결과가 조용히 달라지지 않게 한다.
function updateTextNotes() {
  const L = layoutText(ctx, state, canvas.width, canvas.height);
  const note = $("fit-note");
  if (L && L.shrunk) {
    note.textContent = `글자가 화면에 넘쳐서 ${state.size}px → ${Math.round(L.size)}px로 자동으로 줄였어요.`;
    note.hidden = false;
  } else {
    note.hidden = true;
  }
  const len = Array.from(state.text).length;
  $("text-count").textContent = `${len}/${TEXT_LIMIT}`;
  $("text-count").classList.toggle("full", len >= TEXT_LIMIT);
}

// 화면비를 바꾸면 캔버스 픽셀 크기부터 바꾼다 (크기를 바꾸면 캔버스가 비워지므로 바로 다시 그린다).
function applyRatio() {
  const r = RATIOS[state.ratio];
  canvas.width = r.w;
  canvas.height = r.h;
  $("canvas-meta").textContent = `${state.ratio} · ${r.w} × ${r.h}`;
  redraw();
}

// ---------- 내려받기 ----------
// 미리보기와 같은 render()·같은 크기로 그린 별도 캔버스를 파일로 만든다.
// 글꼴이 준비되기 전에 그리면 글자 위치가 달라질 수 있어 준비를 기다린 뒤 그린다.
async function exportBlob(format) {
  if (document.fonts && document.fonts.ready) await document.fonts.ready;
  const r = RATIOS[state.ratio];
  const out = document.createElement("canvas");
  out.width = r.w;
  out.height = r.h;
  render(out, state);
  const mime = format === "jpeg" ? "image/jpeg" : "image/png";
  const blob = await new Promise((resolve) => out.toBlob(resolve, mime, 0.92));
  if (!blob) throw new Error("이미지 파일을 만들지 못했습니다.");
  return blob;
}

async function download(format) {
  try {
    const blob = await exportBlob(format);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `card-${RATIOS[state.ratio].file}.${format === "jpeg" ? "jpg" : "png"}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    showMessage("ok", `${state.ratio} ${format.toUpperCase()} 파일을 내려받았습니다.`);
  } catch (e) {
    showMessage("error", "내려받기에 실패했습니다. 잠시 후 다시 시도해 주세요.");
  }
}

// 가장자리와 줄바꿈이 잘 보이는 검사 문구
const TEST_TEXT = "왼쪽 끝 ◀ 검사 문구 ▶ 오른쪽 끝\n둘째 줄은 수동 줄바꿈입니다\n이 문장은 아주 길어서 캔버스 폭에 맞춰 자동으로 줄이 바뀌어야 합니다 ABCDEFGHIJKLMNOPQRSTUVWXYZ";

// ---------- 메시지 ----------
function showMessage(kind, text) {
  const box = $("message");
  box.className = kind;
  box.textContent = text; // textContent: 파일 이름 등이 HTML로 해석되지 않도록
  box.hidden = false;
}

function clearMessage() {
  $("message").hidden = true;
}

// ---------- 파일 검사 ----------
// 확장자·MIME은 믿지 않고 파일 첫 바이트(시그니처)로 종류를 판별한다.
async function detectType(file) {
  const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const isPng =
    head.length >= 8 &&
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => head[i] === b);
  const isJpeg = head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
  if (isPng) return "png";
  if (isJpeg) return "jpeg";
  return null;
}

// 성공하면 { bitmap, type }, 실패하면 { error: "사유" }. 어떤 경우에도 state는 건드리지 않는다.
async function loadImageFile(file) {
  if (file.size === 0) return { error: "빈 파일입니다. 내용이 있는 PNG 또는 JPEG 파일을 선택해 주세요." };
  if (file.size > MAX_FILE_BYTES) {
    return { error: `파일이 너무 큽니다 (${(file.size / 1048576).toFixed(1)}MB). 10MB 이하 파일을 선택해 주세요.` };
  }

  const type = await detectType(file);
  if (!type) {
    return { error: "지원하지 않는 파일 형식입니다. PNG 또는 JPEG 이미지만 불러올 수 있습니다." };
  }

  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch (e) {
    return { error: "이미지를 읽을 수 없습니다. 파일이 손상되었을 수 있습니다." };
  }

  if (bitmap.width * bitmap.height > MAX_PIXELS) {
    bitmap.close();
    return { error: "이미지 해상도가 너무 큽니다. 5천만 화소 이하 이미지를 선택해 주세요." };
  }
  return { bitmap, type };
}

async function onFileChosen(event) {
  const input = event.target;
  const file = input.files && input.files[0];
  if (!file) return;
  await handleFile(file);
  input.value = ""; // 같은 파일을 다시 선택해도 change가 발생하도록
}

async function handleFile(file) {
  const result = await loadImageFile(file);

  if (result.error) {
    showMessage("error", `「${file.name}」을(를) 불러오지 못했습니다. ${result.error}`);
    return; // 기존 이미지·문구는 그대로 유지
  }

  if (state.image) state.image.close();
  state.image = result.bitmap;
  state.imageName = file.name;
  $("file-info").textContent = `${file.name} · ${result.type.toUpperCase()} · ${result.bitmap.width}×${result.bitmap.height}`;
  showMessage("ok", "이미지를 불러왔습니다.");
  redraw();
}

// ---------- 입력 연결 ----------
function bindDropzone() {
  const zone = $("dropzone");
  const on = (names, fn) => names.forEach((n) => zone.addEventListener(n, fn));
  on(["dragenter", "dragover"], (e) => {
    e.preventDefault();
    zone.classList.add("dragover");
  });
  on(["dragleave", "dragend"], () => zone.classList.remove("dragover"));
  zone.addEventListener("drop", (e) => {
    e.preventDefault();
    zone.classList.remove("dragover");
    const files = e.dataTransfer && e.dataTransfer.files;
    if (files && files.length > 0) handleFile(files[0]);
  });
  // 영역 밖에 놓았을 때 브라우저가 파일을 열어 버리지 않도록 막는다.
  window.addEventListener("dragover", (e) => e.preventDefault());
  window.addEventListener("drop", (e) => e.preventDefault());
}

function syncColorUI() {
  $("color").value = state.color;
  $("color-out").textContent = state.color.toUpperCase();
  document.querySelectorAll(".swatch").forEach((b) => {
    b.setAttribute("aria-pressed", String(b.dataset.color.toLowerCase() === state.color.toLowerCase()));
  });
}

const SLIDERS = [
  ["x", "x-out", "%"],
  ["y", "y-out", "%"],
  ["size", "size-out", "px"],
];

// state의 값을 슬라이더 모양(값 표시·채움 길이)에 반영한다.
function syncSliderUI(key) {
  const [, outId, unit] = SLIDERS.find((s) => s[0] === key);
  const el = $(key);
  el.value = state[key];
  $(outId).textContent = `${state[key]}${unit}`;
  const pct = ((el.value - el.min) / (el.max - el.min)) * 100;
  el.style.setProperty("--p", `${pct}%`);
}

// state를 기준으로 화면의 모든 컨트롤을 다시 맞추고 그린다. (템플릿 불러오기가 사용)
function syncUIFromState() {
  $("text").value = state.text;
  SLIDERS.forEach(([key]) => syncSliderUI(key));
  syncColorUI();
  document.querySelectorAll('input[name="ratio"]').forEach((r) => {
    r.checked = r.value === state.ratio;
  });
  applyRatio();
}

function bindInputs() {
  $("file").addEventListener("change", onFileChosen);
  bindDropzone();

  $("text").addEventListener("input", (e) => {
    state.text = e.target.value;
    redraw();
  });

  for (const [key] of SLIDERS) {
    $(key).addEventListener("input", () => {
      state[key] = Number($(key).value);
      syncSliderUI(key);
      redraw();
    });
    state[key] = Number($(key).value);
    syncSliderUI(key);
  }

  $("color").addEventListener("input", (e) => {
    state.color = e.target.value;
    syncColorUI();
    redraw();
  });
  document.querySelectorAll(".swatch").forEach((b) => {
    b.addEventListener("click", () => {
      state.color = b.dataset.color;
      syncColorUI();
      redraw();
    });
  });
  syncColorUI();

  document.querySelectorAll('input[name="ratio"]').forEach((r) => {
    r.addEventListener("change", () => {
      if (r.checked) {
        state.ratio = r.value;
        applyRatio();
      }
    });
  });

  $("dl-png").addEventListener("click", () => download("png"));
  $("dl-jpeg").addEventListener("click", () => download("jpeg"));

  $("fill-test").addEventListener("click", () => {
    state.text = TEST_TEXT;
    $("text").value = TEST_TEXT;
    state.size = 64;
    $("size").value = 64;
    $("size").dispatchEvent(new Event("input"));
  });
}

function init() {
  bindInputs();
  applyRatio();
  // 웹폰트가 아닌 시스템 폰트지만, 폰트 준비가 늦는 환경을 위해 한 번 더 그린다.
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(redraw);
}

// 검사 페이지(tests/extreme.html)가 같은 코드를 그대로 검사할 수 있도록 내부 함수를 내보낸다.
window.studio = {
  state, RATIOS, TEXT_MAX_WIDTH, TEXT_LIMIT, canvas,
  render, layoutText, wrapLines, applyRatio, redraw, exportBlob, handleFile,
  syncUIFromState, showMessage,
};

init();
