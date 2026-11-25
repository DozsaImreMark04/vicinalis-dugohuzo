import * as pdfjsLib from "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs";

const els = {
  shell: document.querySelector(".app-shell"),
  sidebar: document.getElementById("sidebar"),
  sidebarBackdrop: document.getElementById("sidebar-backdrop"),
  btnSidebar: document.getElementById("btn-sidebar"),
  catalogCount: document.getElementById("catalog-count"),
  issueList: document.getElementById("issue-list"),
  issueSelect: document.getElementById("issue-select"),
  btnSpread: document.getElementById("btn-spread"),
  btnThumbs: document.getElementById("btn-thumbs"),
  btnZoomOut: document.getElementById("btn-zoom-out"),
  btnZoomReset: document.getElementById("btn-zoom-reset"),
  btnZoomIn: document.getElementById("btn-zoom-in"),
  btnDownload: document.getElementById("btn-download"),
  btnFullscreen: document.getElementById("btn-fullscreen"),
  btnTheme: document.getElementById("btn-theme"),
  loadingBar: document.getElementById("loading-bar"),
  loadingProgress: document.getElementById("loading-progress"),
  statusOverlay: document.getElementById("status-overlay"),
  statusText: document.getElementById("status-text"),
  viewport: document.getElementById("viewport"),
  bookStage: document.getElementById("book-stage"),
  slotLeft: document.getElementById("page-slot-left"),
  slotRight: document.getElementById("page-slot-right"),
  canvasLeft: document.getElementById("canvas-left"),
  canvasRight: document.getElementById("canvas-right"),
  labelLeft: document.getElementById("label-left"),
  labelRight: document.getElementById("label-right"),
  navPrevOverlay: document.getElementById("nav-prev-overlay"),
  navNextOverlay: document.getElementById("nav-next-overlay"),
  thumbStrip: document.getElementById("thumb-strip"),
  btnFirst: document.getElementById("btn-first"),
  btnPrev: document.getElementById("btn-prev"),
  btnNext: document.getElementById("btn-next"),
  btnLast: document.getElementById("btn-last"),
  pageForm: document.getElementById("page-form"),
  pageInput: document.getElementById("page-input"),
  pageTotal: document.getElementById("page-total"),
  pageSlider: document.getElementById("page-slider"),
  issueMeta: document.getElementById("issue-meta"),
};

const state = {
  catalog: [],
  currentIssue: null,
  pdfDoc: null,
  loadingTask: null,
  currentPage: 1,
  totalPages: 0,
  spreadMode: window.innerWidth >= 1050,
  zoom: 1.0, // multiplier relative to "fit to viewport"
  showThumbs: false,
  renderToken: 0,
  activeRenderTasks: [],
  thumbObserver: null,
  renderedThumbs: new Set(),
};

const STORAGE_KEY_STATE = "vd_reader_progress_v1";

/* ---------- Theme Toggle (per modern-web-guidance) ---------- */
const metaColorScheme = document.querySelector('meta[name="color-scheme"]');
const darkMQ = window.matchMedia("(prefers-color-scheme: dark)");

function getSystemScheme() {
  return darkMQ.matches ? "dark" : "light";
}

function getStoredScheme() {
  try {
    const v = localStorage.getItem("color-scheme");
    return v === "light" || v === "dark" ? v : null;
  } catch {
    return null;
  }
}

function applyScheme(value) {
  metaColorScheme.content = value ?? "light dark";
}

function toggleTheme() {
  const rendered = getStoredScheme() ?? getSystemScheme();
  const target = rendered === "dark" ? "light" : "dark";
  const sys = getSystemScheme();
  try {
    if (target === sys) {
      localStorage.removeItem("color-scheme");
      applyScheme(null);
    } else {
      localStorage.setItem("color-scheme", target);
      applyScheme(target);
    }
  } catch {
    applyScheme(target === sys ? null : target);
  }
}

window.addEventListener("storage", (e) => {
  if (e.key === "color-scheme") {
    applyScheme(getStoredScheme());
  }
});

/* ---------- Progress Persistence ---------- */
function readProgress() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY_STATE) || "{}");
  } catch {
    return {};
  }
}

function saveProgress(issueId, page) {
  try {
    const data = readProgress();
    data.lastIssue = issueId;
    data.pages = data.pages || {};
    data.pages[issueId] = page;
    localStorage.setItem(STORAGE_KEY_STATE, JSON.stringify(data));
  } catch {}
}

function updateHash(issueId, page) {
  const desired = `#${issueId}/${page}`;
  if (window.location.hash !== desired) {
    history.replaceState(null, "", desired);
  }
}

function parseHash() {
  const m = window.location.hash.match(/^#(\d{4})(?:\/(\d+))?$/);
  if (!m) return null;
  return { issueId: m[1], page: m[2] ? parseInt(m[2], 10) : null };
}

/* ---------- Sidebar ---------- */
function setSidebarOpen(open) {
  els.shell.classList.toggle("sidebar-collapsed", !open);
  els.btnSidebar.setAttribute("aria-expanded", String(open));
  const isMobile = window.innerWidth <= 900;
  els.sidebarBackdrop.hidden = !(open && isMobile);
}

/* ---------- Catalog Rendering ---------- */
function renderCatalog() {
  els.catalogCount.textContent = `${state.catalog.length} szám`;
  els.issueList.innerHTML = "";
  els.issueSelect.innerHTML = "";

  for (const item of state.catalog) {
    // Sidebar card
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "issue-card";
    btn.dataset.issueId = item.id;
    btn.setAttribute("role", "listitem");

    const img = document.createElement("img");
    img.className = "issue-thumb";
    img.loading = "lazy";
    img.alt = `${item.year} borító`;
    if (item.coverUrl) img.src = item.coverUrl;

    const info = document.createElement("div");
    info.className = "issue-info";
    info.innerHTML = `
      <span class="issue-year">${item.year}</span>
      <span class="issue-details">${item.pages} oldal · ${item.sizeMB} MB</span>
    `;

    btn.append(img, info);
    btn.addEventListener("click", () => {
      loadIssue(item.id);
      if (window.innerWidth <= 900) setSidebarOpen(false);
    });
    els.issueList.appendChild(btn);

    // Dropdown option
    const opt = document.createElement("option");
    opt.value = item.id;
    opt.textContent = `Vicinális Dugóhúzó — ${item.year} (${item.pages} o.)`;
    els.issueSelect.appendChild(opt);
  }
}

function highlightActiveIssue(issueId) {
  els.issueSelect.value = issueId;
  for (const card of els.issueList.querySelectorAll(".issue-card")) {
    const active = card.dataset.issueId === issueId;
    card.classList.toggle("active", active);
    if (active) {
      card.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }
}

/* ---------- Page Spread Math ---------- */
// In spread mode: page 1 is cover (solo), then (2,3), (4,5), ...
function getVisiblePages(page) {
  const total = state.totalPages;
  if (!state.spreadMode || total <= 1) {
    return [page];
  }
  if (page <= 1) {
    return [1];
  }
  const left = page % 2 === 0 ? page : page - 1;
  const right = left + 1;
  return right <= total ? [left, right] : [left];
}

function normalizePageForMode(page) {
  const clamped = Math.max(1, Math.min(state.totalPages, page));
  if (!state.spreadMode || clamped === 1) return clamped;
  return clamped % 2 === 0 ? clamped : clamped - 1;
}

/* ---------- PDF Loading & Rendering ---------- */
function cancelActiveRenders() {
  for (const task of state.activeRenderTasks) {
    try {
      task.cancel();
    } catch {}
  }
  state.activeRenderTasks = [];
}

async function loadIssue(issueId, requestedPage = null) {
  const issue = state.catalog.find((x) => x.id === issueId) || state.catalog[0];
  if (!issue) return;

  if (state.loadingTask) {
    try {
      await state.loadingTask.destroy();
    } catch {}
  }
  if (state.pdfDoc) {
    try {
      await state.pdfDoc.destroy();
    } catch {}
  }
  cancelActiveRenders();

  state.currentIssue = issue;
  state.pdfDoc = null;
  state.totalPages = issue.pages;
  highlightActiveIssue(issue.id);

  els.btnDownload.href = issue.pdfUrl;
  els.btnDownload.download = issue.filename;
  els.issueMeta.textContent = `${issue.year} · ${issue.pages} oldal · ${issue.sizeMB} MB`;
  document.title = `${issue.title} — Digitális Archívum`;

  els.statusText.textContent = `${issue.title} betöltése…`;
  els.statusOverlay.hidden = false;
  els.loadingBar.hidden = false;
  els.loadingProgress.style.width = "10%";

  try {
    const loadingTask = pdfjsLib.getDocument({
      url: issue.pdfUrl,
      disableAutoFetch: false,
      disableStream: false,
      cMapUrl: "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/cmaps/",
      cMapPacked: true,
    });
    state.loadingTask = loadingTask;

    loadingTask.onProgress = ({ loaded, total }) => {
      if (total > 0) {
        const pct = Math.min(100, Math.round((loaded / total) * 100));
        els.loadingProgress.style.width = `${pct}%`;
        els.statusText.textContent = `${issue.title} betöltése… ${pct}%`;
      }
    };

    const pdf = await loadingTask.promise;
    if (state.currentIssue?.id !== issue.id) return;

    state.pdfDoc = pdf;
    state.totalPages = pdf.numPages;

    const progress = readProgress();
    const startPage =
      requestedPage ??
      (progress.pages && progress.pages[issue.id]) ??
      1;

    els.pageTotal.textContent = String(state.totalPages);
    els.pageInput.max = String(state.totalPages);
    els.pageSlider.max = String(state.totalPages);

    els.statusOverlay.hidden = true;
    els.loadingBar.hidden = true;

    buildThumbnails();
    await goToPage(startPage, null);
  } catch (err) {
    if (err?.name === "RenderingCancelledException") return;
    console.error(err);
    els.statusText.textContent = `Nem sikerült betölteni a kiadványt (${issue.year}).`;
    els.loadingBar.hidden = true;
  }
}

async function renderPageToCanvas(pageNum, canvas, maxW, maxH) {
  const page = await state.pdfDoc.getPage(pageNum);
  const baseViewport = page.getViewport({ scale: 1 });

  const fitScale = Math.min(maxW / baseViewport.width, maxH / baseViewport.height);
  const cssScale = Math.max(0.2, fitScale * state.zoom);
  const dpr = Math.min(window.devicePixelRatio || 1, 2.25);

  const cssViewport = page.getViewport({ scale: cssScale });
  const renderViewport = page.getViewport({ scale: cssScale * dpr });

  canvas.width = Math.floor(renderViewport.width);
  canvas.height = Math.floor(renderViewport.height);
  canvas.style.width = `${Math.floor(cssViewport.width)}px`;
  canvas.style.height = `${Math.floor(cssViewport.height)}px`;

  const ctx = canvas.getContext("2d", { alpha: false });
  const renderTask = page.render({
    canvasContext: ctx,
    viewport: renderViewport,
  });
  state.activeRenderTasks.push(renderTask);
  await renderTask.promise;
}

function triggerFlipAnimation(direction) {
  els.bookStage.classList.remove("flip-next", "flip-prev");
  if (!direction) return;
  void els.bookStage.offsetWidth;
  els.bookStage.classList.add(direction === "next" ? "flip-next" : "flip-prev");
}

async function renderCurrentView(direction = null) {
  if (!state.pdfDoc) return;
  cancelActiveRenders();
  const token = ++state.renderToken;

  const pages = getVisiblePages(state.currentPage);
  const isSpread = pages.length === 2;
  els.bookStage.classList.toggle("spread-active", isSpread);

  const rect = els.viewport.getBoundingClientRect();
  const padX = window.innerWidth <= 900 ? 24 : 136;
  const padY = 36;
  const availW = Math.max(260, rect.width - padX);
  const availH = Math.max(280, rect.height - padY);
  const slotMaxW = isSpread ? (availW - 8) / 2 : availW;

  els.slotLeft.hidden = false;
  els.slotRight.hidden = !isSpread;
  els.labelLeft.textContent = `${pages[0]}. oldal`;
  if (isSpread) {
    els.labelRight.textContent = `${pages[1]}. oldal`;
  }

  updateNavControls(pages);
  if (direction) triggerFlipAnimation(direction);

  try {
    const jobs = [renderPageToCanvas(pages[0], els.canvasLeft, slotMaxW, availH)];
    if (isSpread) {
      jobs.push(renderPageToCanvas(pages[1], els.canvasRight, slotMaxW, availH));
    }
    await Promise.all(jobs);
    if (token !== state.renderToken) return;
  } catch (err) {
    if (err?.name !== "RenderingCancelledException") {
      console.error(err);
    }
  }
}

function updateNavControls(visiblePages) {
  const firstVisible = visiblePages[0];
  const lastVisible = visiblePages[visiblePages.length - 1];

  els.pageInput.value = String(firstVisible);
  els.pageSlider.value = String(firstVisible);
  els.btnZoomReset.textContent = `${Math.round(state.zoom * 100)}%`;

  const atStart = firstVisible <= 1;
  const atEnd = lastVisible >= state.totalPages;

  els.btnFirst.disabled = atStart;
  els.btnPrev.disabled = atStart;
  els.navPrevOverlay.disabled = atStart;
  els.btnNext.disabled = atEnd;
  els.btnLast.disabled = atEnd;
  els.navNextOverlay.disabled = atEnd;

  els.btnSpread.setAttribute("aria-pressed", String(state.spreadMode));

  // Highlight active thumbnails
  if (state.showThumbs) {
    for (const item of els.thumbStrip.querySelectorAll(".thumb-item")) {
      const p = Number(item.dataset.page);
      const active = visiblePages.includes(p);
      item.classList.toggle("active", active);
      if (active && p === firstVisible) {
        item.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
      }
    }
  }
}

async function goToPage(page, direction = null) {
  if (!state.pdfDoc) return;
  const target = normalizePageForMode(page);
  state.currentPage = target;
  saveProgress(state.currentIssue.id, target);
  updateHash(state.currentIssue.id, target);
  els.viewport.scrollTo({ top: 0, left: 0 });
  await renderCurrentView(direction);
}

function nextPage() {
  if (!state.pdfDoc) return;
  const visible = getVisiblePages(state.currentPage);
  const next = visible[visible.length - 1] + 1;
  if (next <= state.totalPages) {
    goToPage(next, "next");
  }
}

function prevPage() {
  if (!state.pdfDoc) return;
  const visible = getVisiblePages(state.currentPage);
  const prev = visible[0] - 1;
  if (prev >= 1) {
    goToPage(prev, "prev");
  }
}

/* ---------- Thumbnail Strip (Lazy Rendered) ---------- */
function buildThumbnails() {
  if (state.thumbObserver) {
    state.thumbObserver.disconnect();
  }
  state.renderedThumbs.clear();
  els.thumbStrip.innerHTML = "";
  if (!state.pdfDoc) return;

  const frag = document.createDocumentFragment();
  for (let p = 1; p <= state.totalPages; p++) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "thumb-item";
    btn.dataset.page = String(p);
    btn.innerHTML = `<canvas width="56" height="82"></canvas><span>${p}</span>`;
    btn.addEventListener("click", () => goToPage(p));
    frag.appendChild(btn);
  }
  els.thumbStrip.appendChild(frag);

  if (state.showThumbs) {
    observeThumbnails();
  }
}

function observeThumbnails() {
  if (!state.pdfDoc) return;
  if (state.thumbObserver) state.thumbObserver.disconnect();

  state.thumbObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const btn = entry.target;
        const pageNum = Number(btn.dataset.page);
        if (state.renderedThumbs.has(pageNum)) continue;
        state.renderedThumbs.add(pageNum);
        renderThumb(pageNum, btn.querySelector("canvas"));
      }
    },
    { root: els.thumbStrip, rootMargin: "200px" }
  );

  for (const item of els.thumbStrip.querySelectorAll(".thumb-item")) {
    state.thumbObserver.observe(item);
  }
}

async function renderThumb(pageNum, canvas) {
  if (!state.pdfDoc || !canvas) return;
  try {
    const page = await state.pdfDoc.getPage(pageNum);
    const base = page.getViewport({ scale: 1 });
    const scale = 140 / base.height;
    const vp = page.getViewport({ scale });
    canvas.width = Math.floor(vp.width);
    canvas.height = Math.floor(vp.height);
    const ctx = canvas.getContext("2d", { alpha: false });
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
  } catch {}
}

/* ---------- Events ---------- */
els.btnTheme.addEventListener("click", toggleTheme);

els.btnSidebar.addEventListener("click", () => {
  const isCollapsed = els.shell.classList.contains("sidebar-collapsed");
  setSidebarOpen(isCollapsed);
  setTimeout(() => renderCurrentView(), 220);
});

els.sidebarBackdrop.addEventListener("click", () => setSidebarOpen(false));

els.issueSelect.addEventListener("change", (e) => {
  loadIssue(e.target.value);
});

els.btnSpread.addEventListener("click", () => {
  state.spreadMode = !state.spreadMode;
  goToPage(state.currentPage);
});

els.btnThumbs.addEventListener("click", () => {
  state.showThumbs = !state.showThumbs;
  els.thumbStrip.hidden = !state.showThumbs;
  els.btnThumbs.setAttribute("aria-pressed", String(state.showThumbs));
  if (state.showThumbs) {
    observeThumbnails();
    updateNavControls(getVisiblePages(state.currentPage));
  }
  renderCurrentView();
});

els.btnZoomIn.addEventListener("click", () => {
  state.zoom = Math.min(3.0, Math.round((state.zoom + 0.2) * 10) / 10);
  renderCurrentView();
});

els.btnZoomOut.addEventListener("click", () => {
  state.zoom = Math.max(0.5, Math.round((state.zoom - 0.2) * 10) / 10);
  renderCurrentView();
});

els.btnZoomReset.addEventListener("click", () => {
  state.zoom = 1.0;
  renderCurrentView();
});

els.btnFullscreen.addEventListener("click", () => {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen?.().catch(() => {});
  } else {
    document.exitFullscreen?.().catch(() => {});
  }
});

els.btnFirst.addEventListener("click", () => goToPage(1, "prev"));
els.btnPrev.addEventListener("click", prevPage);
els.navPrevOverlay.addEventListener("click", prevPage);
els.btnNext.addEventListener("click", nextPage);
els.navNextOverlay.addEventListener("click", nextPage);
els.btnLast.addEventListener("click", () => goToPage(state.totalPages, "next"));

els.pageForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const num = parseInt(els.pageInput.value, 10);
  if (!Number.isNaN(num)) {
    goToPage(num);
  }
});

els.pageSlider.addEventListener("input", () => {
  els.pageInput.value = els.pageSlider.value;
});

els.pageSlider.addEventListener("change", () => {
  const num = parseInt(els.pageSlider.value, 10);
  if (!Number.isNaN(num)) {
    goToPage(num);
  }
});

// Keyboard shortcuts
window.addEventListener("keydown", (e) => {
  if (e.target.matches("input, select, textarea")) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;

  switch (e.key) {
    case "ArrowRight":
    case "PageDown":
    case " ":
      e.preventDefault();
      nextPage();
      break;
    case "ArrowLeft":
    case "PageUp":
      e.preventDefault();
      prevPage();
      break;
    case "Home":
      e.preventDefault();
      goToPage(1, "prev");
      break;
    case "End":
      e.preventDefault();
      goToPage(state.totalPages, "next");
      break;
    case "+":
    case "=":
      e.preventDefault();
      els.btnZoomIn.click();
      break;
    case "-":
      e.preventDefault();
      els.btnZoomOut.click();
      break;
    case "0":
      e.preventDefault();
      els.btnZoomReset.click();
      break;
    case "b":
    case "B":
      e.preventDefault();
      els.btnSpread.click();
      break;
    case "t":
    case "T":
      e.preventDefault();
      els.btnThumbs.click();
      break;
    case "f":
    case "F":
      e.preventDefault();
      els.btnFullscreen.click();
      break;
    case "m":
    case "M":
      e.preventDefault();
      els.btnSidebar.click();
      break;
  }
});

// Touch swipe to flip pages (when not zoomed in)
let touchStartX = 0;
let touchStartY = 0;
els.viewport.addEventListener(
  "touchstart",
  (e) => {
    if (e.touches.length !== 1) return;
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
  },
  { passive: true }
);

els.viewport.addEventListener(
  "touchend",
  (e) => {
    if (state.zoom > 1.05 || e.changedTouches.length !== 1) return;
    const dx = e.changedTouches[0].clientX - touchStartX;
    const dy = e.changedTouches[0].clientY - touchStartY;
    if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.4) {
      if (dx < 0) nextPage();
      else prevPage();
    }
  },
  { passive: true }
);

// Re-render cleanly on resize
let resizeTimer;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => renderCurrentView(), 160);
});

window.addEventListener("hashchange", () => {
  const parsed = parseHash();
  if (!parsed) return;
  if (parsed.issueId !== state.currentIssue?.id) {
    loadIssue(parsed.issueId, parsed.page);
  } else if (parsed.page && parsed.page !== state.currentPage) {
    goToPage(parsed.page);
  }
});

/* ---------- Boot ---------- */
async function init() {
  if (window.innerWidth <= 900) {
    setSidebarOpen(false);
  }
  try {
    const res = await fetch("catalog.json");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    state.catalog = await res.json();
    renderCatalog();

    const fromHash = parseHash();
    const progress = readProgress();
    const initialIssue =
      fromHash?.issueId ||
      progress.lastIssue ||
      state.catalog[0]?.id;

    await loadIssue(initialIssue, fromHash?.page ?? null);
  } catch (err) {
    console.error(err);
    els.statusOverlay.hidden = false;
    els.statusText.textContent = "Nem sikerült betölteni a kiadványok listáját.";
  }
}

init();
