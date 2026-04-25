const $ = (sel, root = document) => root.querySelector(sel);

const SITE_AUTH_KEY = "familySiteAuthV1";
const SITE_AUTH_PIN = "0629";

const state = {
  videos: [],
  query: "",
  /** null=전체, 숫자=해당 연도(videos[].date의 연) */
  activeYear: null,
  /** true일 때 `videos[].category === "결혼식"`인 항목만(연도 필터와 배타) */
  weddingOnly: false,
};

function fmtDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}.${m}.${day}`;
}

/** oEmbed에서 파싱한 기간(예: 2024.06.30 ~ 07.06). 없으면 `date`만 포맷 */
function fmtDateOrRangeForRow(video) {
  const custom = video.dateDisplay;
  if (custom && String(custom).trim()) return String(custom).trim();
  return fmtDate(video.date);
}

/** row__desc: JSON·자동생성 모두, 맨끝 마침표는 표시하지 않음 */
function stripTrailingDescriptionPeriodForUi(s) {
  return String(s || "")
    .trim()
    .replace(/[.．。]+$/u, "")
    .trim();
}

/**
 * 유튜브식 제목(앞에 2024.06.30~… 등)이 섞인 경우, 제목만 보이게(날짜는 `date`·`dateDisplay`).
 * @param {string} s
 */
function stripLeadingDateFromTitleForUi(s) {
  if (!s) return s;
  const t = String(s)
    .replace(/^\d{4}\d{2}\d{2}~\d{4}\d{2}\d{2}\s*/u, "")
    .replace(/^\d{4}\d{2}\d{2}~\d{2}\d{2}\s*/u, "")
    .replace(/^\d{4}년\s*\d{1,2}월\s*\d{1,2}일\s*/u, "")
    .replace(
      /^\d{4}[.\-\/]\d{1,2}[.\-\/]\d{1,2}\.(?=[^\d.]|$)/u,
      ""
    )
    .replace(
      /^\d{4}[.\-\/]\d{1,2}[.\-\/]\d{1,2}\s*~\s*[\d.~\/\-,\s]+/i,
      ""
    )
    .replace(
      /^\d{4}[.\-\/]\d{1,2}[.\-\/]\d{1,2}\s*[-–~]\s*\d{4}[.\-\/]\d{1,2}[.\-\/]\d{1,2}/i,
      ""
    )
    .replace(/^\d{4}[.\-\/]?\d{1,2}[.\-\/]?\d{1,2}\s*~\s*[\d.]+\s*/i, "")
    .replace(
      /^\d{4}\s*년\s*\d{1,2}\s*월[\s~\-–—]*\d{0,2}\s*일?\s*/i,
      ""
    )
    .replace(/^\d{4}[.\-\/]\d{1,2}[.\-\/]\d{1,2}\s+/, "")
    .trim();
  return t || s;
}

/** @param {string|undefined} iso */
function yearFromDate(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.getFullYear();
}

function thumbUrl(videoId) {
  return `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/hqdefault.jpg`;
}

function thumbFallback(videoId) {
  return `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/mqdefault.jpg`;
}

function embedUrl(videoId) {
  const params = new URLSearchParams({
    autoplay: "1",
    rel: "0",
    modestbranding: "1",
    playsinline: "1",
  });
  return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(
    videoId
  )}?${params.toString()}`;
}

function buildRow(video) {
  const tpl = $("#row-template");
  const li = tpl.content.firstElementChild.cloneNode(true);
  const btn = $(".row__main", li);
  const img = $(".row__thumb img", li);
  const title = $(".row__title", li);
  const date = $(".row__date", li);
  const desc = $(".row__desc", li);
  const player = $(".row__player", li);
  const playerInner = $(".row__player-inner", li);

  const display = stripLeadingDateFromTitleForUi(
    video.displayTitle || video.title || "(제목 없음)"
  );

  img.src = thumbUrl(video.videoId);
  img.alt = `${display} 썸네일`;
  img.addEventListener("error", () => {
    if (img.dataset.fallback !== "1") {
      img.dataset.fallback = "1";
      img.src = thumbFallback(video.videoId);
    }
  });

  const playBadge = document.createElement("span");
  playBadge.className = "row__play";
  playBadge.innerHTML =
    '<svg viewBox="0 0 24 24" width="14" height="14"><path d="M8 5v14l11-7L8 5z" fill="currentColor"/></svg>';
  $(".row__thumb", li).appendChild(playBadge);

  title.textContent = display;
  date.textContent = fmtDateOrRangeForRow(video);
  date.dateTime = video.date || "";
  desc.textContent = stripTrailingDescriptionPeriodForUi(
    video.description || ""
  );

  btn.addEventListener("click", () => {
    const expanded = btn.getAttribute("aria-expanded") === "true";
    if (expanded) {
      btn.setAttribute("aria-expanded", "false");
      player.hidden = true;
      playerInner.innerHTML = "";
    } else {
      btn.setAttribute("aria-expanded", "true");
      player.hidden = false;
      const iframe = document.createElement("iframe");
      iframe.src = embedUrl(video.videoId);
      iframe.title = display;
      iframe.allow =
        "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";
      iframe.referrerPolicy = "strict-origin-when-cross-origin";
      iframe.allowFullscreen = true;
      playerInner.replaceChildren(iframe);
      requestAnimationFrame(() => {
        const top = li.getBoundingClientRect().top + window.scrollY - 24;
        window.scrollTo({ top, behavior: "smooth" });
      });
    }
  });

  return li;
}

function renderAll(videos) {
  const list = $('[data-list="all"]');
  const empty = $("[data-empty]");
  const count = $("[data-count]");
  const filtered = applyFilters(videos);
  list.replaceChildren();
  if (filtered.length === 0) {
    empty.hidden = false;
  } else {
    empty.hidden = true;
    filtered.sort(byDateDesc).forEach((v) => list.appendChild(buildRow(v)));
  }
  const inScope = state.weddingOnly
    ? videos.filter((v) => isWeddingCategory(v))
    : videos.filter((v) => !isWeddingListOnly(v));
  const total = inScope.length;
  const hasFilter =
    state.query ||
    state.activeYear != null ||
    state.weddingOnly;
  count.textContent = hasFilter
    ? `${filtered.length} / ${total} 편 표시`
    : `총 ${total} 편 (최신순)`;

  if (filtered.length === 0) {
    if (state.weddingOnly && !state.query.trim()) {
      empty.textContent =
        '웨딩으로 분류한 영상이 아직 없어요. videos.json에 "category": "결혼식"을 넣어 주세요.';
    } else {
      empty.textContent =
        "찾는 영상이 없어요. 다른 단어로 한 번 더 시도해 보세요.";
    }
  }
}

/** @param {Record<string, unknown>} v */
function isWeddingCategory(v) {
  const c = v.category;
  return c === "결혼식" || c === "wedding";
}

/** `onlyWedding: true` — 결혼식 필터에서만 보임(전체·연도·검색의 일반 목록 제외) */
function isWeddingListOnly(v) {
  return v.onlyWedding === true;
}

function applyFilters(videos) {
  const q = state.query.trim().toLowerCase();
  const year = state.activeYear;
  return videos.filter((v) => {
    if (!state.weddingOnly && isWeddingListOnly(v)) return false;
    if (state.weddingOnly) {
      if (!isWeddingCategory(v)) return false;
    } else if (year != null) {
      const y = yearFromDate(v.date);
      if (y !== year) return false;
    }
    if (!q) return true;
    const hay = [
      v.displayTitle || "",
      v.title || "",
      v.dateDisplay || "",
      v.description || "",
      v.note || "",
    ]
      .join(" ")
      .toLowerCase();
    return hay.includes(q);
  });
}

function byDateDesc(a, b) {
  return new Date(b.date || 0) - new Date(a.date || 0);
}

function renderYearFilters(videos) {
  const wrap = $("[data-filters]");
  const years = new Set();
  videos.forEach((v) => {
    if (isWeddingListOnly(v)) return;
    const y = yearFromDate(v.date);
    if (y != null) years.add(y);
  });
  const sorted = Array.from(years).sort((a, b) => b - a);
  if (state.activeYear != null && !sorted.includes(state.activeYear)) {
    state.activeYear = null;
  }
  wrap.replaceChildren();

  const allPressed = state.activeYear == null && !state.weddingOnly;
  wrap.appendChild(filterPill("전체", allPressed, () => {
    state.activeYear = null;
    state.weddingOnly = false;
  }));

  sorted.forEach((y) => {
    const pressed = !state.weddingOnly && state.activeYear === y;
    wrap.appendChild(
      filterPill(String(y), pressed, () => {
        state.activeYear = y;
        state.weddingOnly = false;
      })
    );
  });

  wrap.appendChild(
    filterPill("웨딩", state.weddingOnly, () => {
      state.activeYear = null;
      state.weddingOnly = true;
    })
  );
}

/**
 * @param {string} label
 * @param {boolean} pressed
 * @param {() => void} onSelect
 */
function filterPill(label, pressed, onSelect) {
  const b = document.createElement("button");
  b.className = "filter-pill";
  b.type = "button";
  b.textContent = label;
  b.setAttribute("aria-pressed", pressed ? "true" : "false");
  if (label === "웨딩") b.setAttribute("data-filter", "wedding");
  b.addEventListener("click", () => {
    onSelect();
    renderYearFilters(state.videos);
    renderAll(state.videos);
  });
  return b;
}

function bindSearch() {
  const input = $("[data-search]");
  input.addEventListener("input", (e) => {
    state.query = e.target.value;
    renderAll(state.videos);
  });
}

function applySite(site) {
  if (!site) return;
  if (site.title) {
    document.title = site.title;
    $("[data-site-title]").textContent = site.title;
  }
  if (site.tagline) {
    $("[data-site-tagline]").textContent = site.tagline;
  }
}

async function load() {
  try {
    const res = await fetch("videos.json", { cache: "no-cache" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    applySite(data.site);
    state.videos = Array.isArray(data.videos) ? data.videos : [];
    renderYearFilters(state.videos);
    renderAll(state.videos);
    bindSearch();
  } catch (err) {
    console.error(err);
    const list = $('[data-list="all"]');
    list.replaceChildren();
    const empty = $("[data-empty]");
    empty.hidden = false;
    empty.textContent =
      "영상 목록을 불러오지 못했어요. videos.json을 확인해 주세요.";
  }
}

function initSiteGate() {
  if (sessionStorage.getItem(SITE_AUTH_KEY) === "1") {
    const gate = document.getElementById("site-gate");
    if (gate) {
      gate.classList.add("site-gate--hidden");
      gate.setAttribute("aria-hidden", "true");
    }
    document.body.classList.remove("auth-locked");
    load();
    return;
  }

  const gate = document.getElementById("site-gate");
  const form = document.querySelector("[data-gate-form]");
  const input = document.querySelector("[data-gate-input]");
  const err = document.querySelector("[data-gate-error]");

  if (!gate || !form || !input) {
    load();
    return;
  }

  document.body.classList.add("auth-locked");

  const ok = () => {
    sessionStorage.setItem(SITE_AUTH_KEY, "1");
    gate.classList.add("site-gate--hidden");
    gate.setAttribute("aria-hidden", "true");
    document.body.classList.remove("auth-locked");
    err.hidden = true;
    err.textContent = "";
    load();
  };

  const fail = () => {
    err.hidden = false;
    err.textContent = "암호가 맞지 않아요.";
    input.select();
  };

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const v = String(input.value || "").trim();
    if (v === SITE_AUTH_PIN) ok();
    else fail();
  });

  requestAnimationFrame(() => input.focus());
}

initSiteGate();
