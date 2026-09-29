"use strict";

// 템플릿 관리: 만들기·불러오기·수정·삭제, localStorage 저장.
// 원칙: 모든 대상은 고유 id로만 찾는다(배열 위치 사용 금지). 화면은 항상 저장된 데이터에서 다시 그린다.
(function () {
  const { state, RATIOS, TEXT_LIMIT, syncUIFromState, showMessage } = window.studio;

  const STORE_KEY = "studio.templates.v1";
  const MAX_TEMPLATES = 30;
  const NAME_MAX = 30;
  const $ = (id) => document.getElementById(id);

  let templates = [];       // 화면을 그리는 근거. 항상 저장소에서 읽은 값으로 갱신한다.
  let editingId = null;     // 수정 중인 템플릿 id
  let pendingDeleteId = null; // 삭제 확인 대기 중인 템플릿 id
  let storageOk = true;     // false면 이 브라우저에서 저장 불가 → 메모리에서만 유지

  // ---------- 데이터 ----------
  function newId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return "t-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }

  const clamp = (v, min, max, fallback) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
  };

  // 저장소나 가져온 파일에서 온 값은 믿지 않고 한 항목씩 걸러서 안전한 모양으로 만든다.
  // 쓸 수 없는 항목은 null. (카드 5의 JSON 가져오기도 이 함수를 쓴다.)
  function sanitizeTemplate(raw) {
    if (!raw || typeof raw !== "object") return null;
    const id = typeof raw.id === "string" && /^[\w-]{1,64}$/.test(raw.id) ? raw.id : null;
    const name = typeof raw.name === "string" ? Array.from(raw.name.trim()).slice(0, NAME_MAX).join("") : "";
    if (!id || !name) return null;
    const ratio = typeof raw.ratio === "string" && Object.prototype.hasOwnProperty.call(RATIOS, raw.ratio) ? raw.ratio : "1:1";
    return {
      id,
      name,
      text: typeof raw.text === "string" ? Array.from(raw.text).slice(0, TEXT_LIMIT).join("") : "",
      x: clamp(raw.x, 0, 100, 50),
      y: clamp(raw.y, 0, 100, 50),
      size: clamp(raw.size, 16, 300, 96),
      color: typeof raw.color === "string" && /^#[0-9a-f]{6}$/i.test(raw.color) ? raw.color.toLowerCase() : "#ffffff",
      ratio,
      createdAt: Number.isFinite(raw.createdAt) ? raw.createdAt : 0,
      updatedAt: Number.isFinite(raw.updatedAt) ? raw.updatedAt : 0,
    };
  }

  function readStore() {
    let raw;
    try {
      raw = localStorage.getItem(STORE_KEY);
    } catch (e) {
      storageOk = false;
      return null;
    }
    if (!raw) return [];
    try {
      const data = JSON.parse(raw);
      const list = Array.isArray(data) ? data : data && Array.isArray(data.items) ? data.items : [];
      const seen = new Set();
      const out = [];
      for (const item of list) {
        const t = sanitizeTemplate(item);
        if (t && !seen.has(t.id)) {
          seen.add(t.id);
          out.push(t);
        }
      }
      return out;
    } catch (e) {
      // 깨진 데이터: 다음 저장이 덮어쓰기 전에 원본을 따로 보관해 둔다.
      try { localStorage.setItem(STORE_KEY + ".corrupt", raw); } catch (e2) { /* 보관 실패는 무시 */ }
      showMessage("error", "저장된 템플릿을 읽지 못해 빈 목록으로 시작합니다. 깨진 원본은 따로 보관해 두었어요.");
      return [];
    }
  }

  function writeStore(items) {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ version: 1, items }));
      return true;
    } catch (e) {
      return false;
    }
  }

  // 저장소를 다시 읽어 그 위에서 바꾸고, 저장한 뒤, 그 결과로 화면을 다시 그린다.
  // (다른 탭에서 바뀐 내용을 실수로 덮어쓰지 않도록 항상 최신 저장 내용에서 시작한다.)
  function mutate(change) {
    let base = storageOk ? readStore() : null;
    if (base === null) base = templates.map((t) => ({ ...t })); // 복사본 위에서 바꿔야, 실패해도 원본이 안 바뀐다
    const items = base;
    const result = change(items);
    if (result === false) return false;
    if (storageOk && !writeStore(items)) storageOk = false;
    templates = items;
    render();
    return true;
  }

  const snapshot = () => ({
    text: state.text, x: state.x, y: state.y, size: state.size, color: state.color, ratio: state.ratio,
  });

  const findById = (id) => templates.find((t) => t.id === id) || null;

  // ---------- 동작 ----------
  function nameFromInput() {
    const name = Array.from($("tpl-name").value.trim()).slice(0, NAME_MAX).join("");
    if (!name) {
      showMessage("error", "템플릿 이름을 입력해 주세요.");
      $("tpl-name").focus();
      return null;
    }
    return name;
  }

  function onSave() {
    const name = nameFromInput();
    if (name === null) return;
    const now = Date.now();

    if (editingId) {
      const id = editingId;
      let missing = false;
      mutate((items) => {
        const t = items.find((it) => it.id === id);
        if (!t) { missing = true; return false; }
        Object.assign(t, snapshot(), { name, updatedAt: now });
      });
      if (missing) {
        showMessage("error", "수정하려던 템플릿이 이미 삭제되어 저장하지 못했습니다.");
        stopEditing();
        render();
        return;
      }
      showMessage("ok", `「${name}」 템플릿을 수정했습니다.`);
      stopEditing();
      return;
    }

    let full = false;
    mutate((items) => {
      if (items.length >= MAX_TEMPLATES) { full = true; return false; }
      items.push({ id: newId(), name, ...snapshot(), createdAt: now, updatedAt: now });
    });
    if (full) {
      showMessage("error", `템플릿은 최대 ${MAX_TEMPLATES}개까지 저장할 수 있어요. 안 쓰는 템플릿을 삭제해 주세요.`);
      return;
    }
    $("tpl-name").value = "";
    showMessage("ok", `「${name}」 템플릿을 저장했습니다.`);
  }

  function applyTemplate(id, quiet) {
    const t = findById(id);
    if (!t) return null;
    Object.assign(state, { text: t.text, x: t.x, y: t.y, size: t.size, color: t.color, ratio: t.ratio });
    syncUIFromState(); // 이미지는 그대로 두고 문구·위치·크기·색·화면비만 바뀐다
    if (!quiet) showMessage("ok", `「${t.name}」 템플릿을 불러왔습니다.`);
    return t;
  }

  function startEditing(id) {
    const t = applyTemplate(id, true);
    if (!t) return;
    editingId = id;
    pendingDeleteId = null;
    $("tpl-name").value = t.name;
    showMessage("ok", `「${t.name}」을(를) 수정 중입니다. 설정을 바꾼 뒤 '수정 저장'을 눌러 주세요.`);
    renderEditingState();
    render();
  }

  function stopEditing() {
    editingId = null;
    $("tpl-name").value = "";
    renderEditingState();
    render();
  }

  function askDelete(id) {
    pendingDeleteId = id;
    render();
  }

  function confirmDelete(id) {
    const t = findById(id);
    const label = t ? t.name : "템플릿";
    let removed = false;
    mutate((items) => {
      const i = items.findIndex((it) => it.id === id); // 방금 저장소에서 읽은 목록에서 id로 찾는다
      if (i < 0) return false;
      items.splice(i, 1);
      removed = true;
    });
    pendingDeleteId = null;
    if (editingId === id) stopEditing();
    else render();
    showMessage(removed ? "ok" : "error", removed ? `「${label}」 템플릿을 삭제했습니다.` : "이미 삭제된 템플릿입니다.");
  }

  // ---------- JSON 내보내기 / 가져오기 ----------
  const EXPORT_FORMAT = "meme-card-studio-templates";
  const MAX_IMPORT_BYTES = 1024 * 1024; // 가져올 파일 크기 한도 1MB
  const REQUIRED_FIELDS = ["id", "name", "text", "x", "y", "size", "color", "ratio"];

  function exportData() {
    return {
      format: EXPORT_FORMAT,
      version: 1,
      exportedAt: new Date().toISOString(),
      templates: templates.map((t) => ({
        id: t.id, name: t.name, text: t.text, x: t.x, y: t.y, size: t.size, color: t.color, ratio: t.ratio,
        createdAt: t.createdAt, updatedAt: t.updatedAt,
      })),
    };
  }

  const isInt = (v, min, max) => typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;

  // 가져온 JSON을 저장하기 전에 처음부터 끝까지 검사한다. 저장소 읽기와 달리 "고쳐서 받아 주기"를 하지 않고,
  // 하나라도 문제가 있으면 전체를 거부한다. 성공하면 { ok: true, items }, 실패하면 { ok: false, kind, errors }.
  function validateImport(text) {
    if (typeof text !== "string" || text.length === 0) return { ok: false, kind: "empty", errors: ["파일이 비어 있습니다."] };
    if (text.length > MAX_IMPORT_BYTES) return { ok: false, kind: "size", errors: ["파일이 너무 큽니다 (1MB 이하만 가져올 수 있어요)."] };

    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      return { ok: false, kind: "syntax", errors: [`JSON 문법이 손상되었습니다 (${e.message}).`] };
    }

    const list = Array.isArray(data) ? data : data && typeof data === "object" ? data.templates : undefined;
    if (!Array.isArray(list)) return { ok: false, kind: "missing", errors: ["필수 항목 'templates'(템플릿 배열)가 없습니다."] };
    if (!Array.isArray(data) && data.version !== undefined && data.version !== 1) {
      return { ok: false, kind: "version", errors: [`지원하지 않는 버전입니다 (version: ${String(data.version).slice(0, 20)}).`] };
    }
    if (list.length === 0) return { ok: false, kind: "empty", errors: ["가져올 템플릿이 없습니다."] };
    if (list.length > MAX_TEMPLATES) return { ok: false, kind: "count", errors: [`템플릿이 ${list.length}개입니다. 한 번에 ${MAX_TEMPLATES}개까지만 가져올 수 있어요.`] };

    const errors = [];
    const ids = new Set();
    const items = [];
    list.forEach((raw, i) => {
      const label = `${i + 1}번째 템플릿`;
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        errors.push(`${label}: 올바른 객체가 아닙니다.`);
        return;
      }
      const missing = REQUIRED_FIELDS.filter((f) => raw[f] === undefined || raw[f] === null);
      if (missing.length) {
        errors.push(`${label}: 필수 항목이 빠졌습니다 (${missing.join(", ")}).`);
        return;
      }
      const bad = [];
      if (typeof raw.id !== "string" || !/^[\w-]{1,64}$/.test(raw.id)) bad.push("id");
      if (typeof raw.name !== "string" || raw.name.trim() === "" || Array.from(raw.name).length > NAME_MAX) bad.push("name");
      if (typeof raw.text !== "string" || Array.from(raw.text).length > TEXT_LIMIT) bad.push("text");
      if (!isInt(raw.x, 0, 100)) bad.push("x(0~100)");
      if (!isInt(raw.y, 0, 100)) bad.push("y(0~100)");
      if (!isInt(raw.size, 16, 300)) bad.push("size(16~300)");
      if (typeof raw.color !== "string" || !/^#[0-9a-f]{6}$/i.test(raw.color)) bad.push("color(#rrggbb)");
      if (typeof raw.ratio !== "string" || !Object.prototype.hasOwnProperty.call(RATIOS, raw.ratio)) bad.push("ratio(1:1/4:5/9:16)");
      if (bad.length) {
        errors.push(`${label}: 값이 올바르지 않습니다 (${bad.join(", ")}).`);
        return;
      }
      if (ids.has(raw.id)) {
        errors.push(`${label}: 같은 id가 파일 안에 두 번 나옵니다.`);
        return;
      }
      ids.add(raw.id);
      items.push(sanitizeTemplate(raw)); // 필요한 항목만 골라 담는다(그 밖의 항목은 버림)
    });

    if (errors.length) return { ok: false, kind: "invalid", errors };
    return { ok: true, items };
  }

  // 같은 id는 파일 내용으로 덮어쓰고, 새 id는 추가한다. 기존의 나머지 템플릿은 그대로 둔다.
  function importText(text) {
    const before = (storageOk ? readStore() : templates) || [];
    const result = validateImport(text);
    if (!result.ok) {
      const shown = result.errors.slice(0, 5).join(" ");
      const more = result.errors.length > 5 ? ` 외 ${result.errors.length - 5}건.` : "";
      showMessage("error", `가져오기에 실패했습니다. ${shown}${more} 기존 템플릿 ${before.length}개는 그대로입니다.`);
      return { ok: false, kind: result.kind, before: before.length, after: before.length, errors: result.errors };
    }

    let tooMany = false;
    const done = mutate((items) => {
      const byId = new Map(items.map((t) => [t.id, t]));
      for (const t of result.items) {
        const old = byId.get(t.id);
        if (old) Object.assign(old, t, { createdAt: old.createdAt, updatedAt: Date.now() });
        else items.push(t);
      }
      if (items.length > MAX_TEMPLATES) {
        tooMany = true;
        return false; // 저장하지 않음
      }
    });
    if (!done) {
      const msg = tooMany
        ? `가져오면 템플릿이 ${MAX_TEMPLATES}개를 넘어서 가져오지 않았습니다.`
        : "가져오지 못했습니다.";
      showMessage("error", `${msg} 기존 템플릿 ${before.length}개는 그대로입니다.`);
      return { ok: false, kind: "count", before: before.length, after: before.length, errors: [msg] };
    }
    const after = templates.length;
    showMessage("ok", `템플릿 ${result.items.length}개를 가져왔습니다. (가져오기 전 ${before.length}개 → 후 ${after}개)`);
    return { ok: true, before: before.length, after, imported: result.items.length };
  }

  function onExport() {
    if (templates.length === 0) {
      showMessage("error", "내보낼 템플릿이 없어요. 먼저 템플릿을 저장해 주세요.");
      return;
    }
    const blob = new Blob([JSON.stringify(exportData(), null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "meme-card-templates.json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    showMessage("ok", `템플릿 ${templates.length}개를 meme-card-templates.json으로 내보냈습니다.`);
  }

  async function onImportFile(e) {
    const input = e.target;
    const file = input.files && input.files[0];
    if (!file) return;
    input.value = "";
    if (file.size > MAX_IMPORT_BYTES) {
      showMessage("error", `가져오기에 실패했습니다. 파일이 너무 큽니다 (1MB 이하만 가져올 수 있어요). 기존 템플릿은 그대로입니다.`);
      return;
    }
    let text;
    try {
      text = await file.text();
    } catch (err) {
      showMessage("error", "파일을 읽지 못했습니다. 기존 템플릿은 그대로입니다.");
      return;
    }
    importText(text);
  }

  // ---------- 화면 ----------
  function renderEditingState() {
    const editing = editingId !== null;
    $("tpl-save").textContent = editing ? "수정 저장" : "새 템플릿으로 저장";
    $("tpl-cancel").hidden = !editing;
    const note = $("tpl-editing");
    const t = editing ? findById(editingId) : null;
    note.hidden = !t;
    note.textContent = t ? `「${t.name}」 수정 중` : "";
  }

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text; // 이름은 항상 글자로만 넣는다
    return e;
  }

  function actionButton(label, action, extraClass) {
    const b = el("button", "tpl-btn" + (extraClass ? " " + extraClass : ""), label);
    b.type = "button";
    b.dataset.action = action;
    return b;
  }

  function render() {
    const list = $("tpl-list");
    list.replaceChildren();

    for (const t of templates) {
      const li = el("li", "tpl-item");
      li.dataset.id = t.id;
      if (t.id === editingId) li.classList.add("editing");

      const dot = el("span", "tpl-dot");
      dot.style.setProperty("--c", t.color);
      dot.setAttribute("aria-hidden", "true");

      const info = el("div", "tpl-info");
      info.append(el("strong", "tpl-name", t.name), el("span", "tpl-meta", `${t.ratio} · ${t.size}px · ${t.color.toUpperCase()}`));

      const actions = el("div", "tpl-actions");
      if (t.id === pendingDeleteId) {
        actions.append(el("span", "tpl-ask", "삭제할까요?"), actionButton("삭제 확인", "delete-confirm", "danger"), actionButton("취소", "delete-cancel"));
      } else {
        actions.append(actionButton("불러오기", "apply", "primary"), actionButton("수정", "edit"), actionButton("삭제", "delete"));
      }

      li.append(dot, info, actions);
      list.appendChild(li);
    }

    $("tpl-empty").hidden = templates.length > 0;
    $("tpl-count").textContent = `${templates.length}/${MAX_TEMPLATES}`;
    $("tpl-storage-warn").hidden = storageOk;
    renderEditingState();
  }

  function onListClick(e) {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    const li = btn.closest("li[data-id]");
    if (!li) return;
    const id = li.dataset.id; // 위치가 아니라 저장된 id로 대상을 정한다
    switch (btn.dataset.action) {
      case "apply": applyTemplate(id); break;
      case "edit": startEditing(id); break;
      case "delete": askDelete(id); break;
      case "delete-cancel": pendingDeleteId = null; render(); break;
      case "delete-confirm": confirmDelete(id); break;
    }
  }

  // ---------- 시작 ----------
  function init() {
    const stored = readStore();
    templates = stored === null ? [] : stored;

    $("tpl-save").addEventListener("click", onSave);
    $("tpl-cancel").addEventListener("click", stopEditing);
    $("tpl-name").addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); onSave(); }
    });
    $("tpl-list").addEventListener("click", onListClick);
    $("tpl-export").addEventListener("click", onExport);
    $("tpl-import").addEventListener("change", onImportFile);

    // 다른 탭에서 템플릿이 바뀌면 이 탭도 저장된 내용으로 다시 그린다.
    window.addEventListener("storage", (e) => {
      if (e.key !== STORE_KEY && e.key !== null) return;
      const fresh = readStore();
      if (fresh === null) return;
      templates = fresh;
      if (editingId && !findById(editingId)) stopEditing();
      if (pendingDeleteId && !findById(pendingDeleteId)) pendingDeleteId = null;
      render();
    });

    render();
  }

  window.studioTemplates = {
    sanitizeTemplate, validateImport, importText, exportData, readStore, STORE_KEY, MAX_TEMPLATES,
    get list() { return templates; },
  };
  init();
})();
