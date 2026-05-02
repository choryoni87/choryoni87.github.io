const $ = (sel, root = document) => root.querySelector(sel);

const SITE_AUTH_KEY = "familySiteAuthV1";
// 오직 0-9 네 자리(앞자리 0 포함)
const SITE_AUTH_PIN = "0629";

/** 전각→반각 뒤 ASCII 숫자만 남김(0123456789) */
function gatePinDigitsOnly(raw) {
  let s = String(raw ?? "").normalize("NFC");
  s = s.replace(/[\uFF10-\uFF19]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) - 0xff10 + 0x30)
  );
  return s.replace(/\D/g, "");
}

function gatePinMatches(entered) {
  const d = gatePinDigitsOnly(entered);
  return d.length === 4 && d === SITE_AUTH_PIN;
}

const state = {
  videos: [],
  /** null=전체, 숫자=해당 연도(videos[].date의 연) */
  activeYear: null,
  /** true일 때 `videos[].category === "결혼식"`인 항목만(연도 필터와 배타) */
  weddingOnly: false,
  /** 제목·설명·메모 검색어 */
  query: "",
  /** 페이지네이션 — 1-base 현재 페이지 */
  page: 1,
  /** 한 페이지에 표시할 영상 수(전체·연도·웨딩 모두 동일) */
  pageSize: 6,
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
  const pager = $("[data-pager]");

  const filtered = applyFilters(videos).sort(byDateDesc);
  const total = filtered.length;
  const pageSize = state.pageSize;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  // 필터/검색 결과가 줄어 현재 페이지가 범위를 벗어나면 보정
  if (state.page > pageCount) state.page = pageCount;
  if (state.page < 1) state.page = 1;

  const start = (state.page - 1) * pageSize;
  const pageItems = filtered.slice(start, start + pageSize);

  list.replaceChildren();
  if (total === 0) {
    empty.hidden = false;
  } else {
    empty.hidden = true;
    pageItems.forEach((v) => list.appendChild(buildRow(v)));
  }

  const inScope = state.weddingOnly
    ? videos.filter((v) => isWeddingCategory(v))
    : videos.filter((v) => !isWeddingListOnly(v));
  const totalInScope = inScope.length;
  const hasFilter = state.activeYear != null || state.weddingOnly || normalizeSearch(state.query);
  const headBase = hasFilter
    ? `${total} / ${totalInScope} 편 표시`
    : `총 ${totalInScope} 편 (최신순)`;
  count.textContent =
    pageCount > 1 ? `${headBase} · ${state.page}/${pageCount} 페이지` : headBase;

  renderPager(pager, pageCount);

  if (total === 0) {
    if (normalizeSearch(state.query)) {
      empty.textContent =
        "찾는 영상이 없어요. 다른 단어로 한 번 더 시도해 보세요.";
    } else if (state.weddingOnly) {
      empty.textContent =
        '웨딩으로 분류한 영상이 아직 없어요. videos.json에 "category": "결혼식"을 넣어 주세요.';
    } else {
      empty.textContent = "표시할 영상이 없어요.";
    }
  }
}

/**
 * 페이지 버튼 렌더 — ‹ 1 2 … 5 ›
 * @param {HTMLElement | null} pager
 * @param {number} pageCount
 */
function renderPager(pager, pageCount) {
  if (!pager) return;
  pager.replaceChildren();
  if (pageCount <= 1) {
    pager.hidden = true;
    return;
  }
  pager.hidden = false;

  const goto = (page) => {
    if (page < 1 || page > pageCount || page === state.page) return;
    state.page = page;
    renderAll(state.videos);
    // 페이지 이동 후 목록 상단으로 부드럽게 스크롤
    const list = $('[data-list="all"]');
    if (list) {
      const top = list.getBoundingClientRect().top + window.scrollY - 24;
      window.scrollTo({ top, behavior: "smooth" });
    }
  };

  const mkBtn = (label, page, opts = {}) => {
    const b = document.createElement("button");
    b.className = "pager__btn";
    if (opts.current) b.classList.add("pager__btn--current");
    if (opts.nav) b.classList.add("pager__btn--nav");
    b.type = "button";
    b.textContent = label;
    if (opts.current) b.setAttribute("aria-current", "page");
    if (opts.disabled) b.disabled = true;
    if (opts.ariaLabel) b.setAttribute("aria-label", opts.ariaLabel);
    b.addEventListener("click", () => goto(page));
    return b;
  };

  const mkEllipsis = () => {
    const span = document.createElement("span");
    span.className = "pager__ellipsis";
    span.setAttribute("aria-hidden", "true");
    span.textContent = "…";
    return span;
  };

  // 페이지가 7개 이하면 모두, 그보다 많으면 1 … (현재±1) … 마지막
  const numbers = [];
  if (pageCount <= 7) {
    for (let i = 1; i <= pageCount; i++) numbers.push(i);
  } else {
    const set = new Set([1, pageCount, state.page, state.page - 1, state.page + 1]);
    const arr = [...set].filter((n) => n >= 1 && n <= pageCount).sort((a, b) => a - b);
    arr.forEach((n, i) => {
      if (i > 0 && n - arr[i - 1] > 1) numbers.push("…");
      numbers.push(n);
    });
  }

  pager.appendChild(
    mkBtn("‹", state.page - 1, {
      nav: true,
      disabled: state.page === 1,
      ariaLabel: "이전 페이지",
    })
  );
  numbers.forEach((n) => {
    if (n === "…") pager.appendChild(mkEllipsis());
    else
      pager.appendChild(
        mkBtn(String(n), n, {
          current: state.page === n,
          ariaLabel: `${n} 페이지`,
        })
      );
  });
  pager.appendChild(
    mkBtn("›", state.page + 1, {
      nav: true,
      disabled: state.page === pageCount,
      ariaLabel: "다음 페이지",
    })
  );
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
  const year = state.activeYear;
  const q = normalizeSearch(state.query);
  return videos.filter((v) => {
    if (!state.weddingOnly && isWeddingListOnly(v)) return false;
    if (state.weddingOnly) {
      if (!isWeddingCategory(v)) return false;
    } else if (year != null) {
      const y = yearFromDate(v.date);
      if (y !== year) return false;
    }
    if (q && !searchHaystack(v).includes(q)) return false;
    return true;
  });
}

function normalizeSearch(value) {
  return String(value || "")
    .normalize("NFC")
    .trim()
    .toLocaleLowerCase("ko-KR");
}

function searchHaystack(video) {
  return normalizeSearch(
    [
      video.title,
      video.displayTitle,
      video.description,
      video.note,
    ]
      .filter(Boolean)
      .join(" ")
  );
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
    state.page = 1;
    renderYearFilters(state.videos);
    renderAll(state.videos);
  });
  return b;
}

function initSearch() {
  const input = $("[data-search]");
  if (!input) return;
  input.addEventListener("input", () => {
    state.query = input.value;
    state.page = 1;
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
  const gate = document.getElementById("site-gate");
  const form = document.getElementById("gate-form");
  const input = document.getElementById("gate-pin");
  const button = form?.querySelector("button[type='submit']") ?? null;
  const err = gate?.querySelector("[data-gate-error]") ?? null;
  const panel = gate?.querySelector(".site-gate__panel") ?? null;

  if (!gate || !form || !input) {
    load();
    return;
  }

  let unlocked = false;
  try {
    if (sessionStorage.getItem(SITE_AUTH_KEY) === "1") unlocked = true;
  } catch {
    // 사파리 사설 모드 등은 무시(잠금만 안 풀린 상태로 동작)
  }

  if (unlocked) {
    gate.classList.add("site-gate--hidden");
    gate.setAttribute("aria-hidden", "true");
    gate.style.display = "none";
    document.body.classList.remove("auth-locked");
    load();
    return;
  }

  document.body.classList.add("auth-locked");

  const ok = () => {
    try {
      sessionStorage.setItem(SITE_AUTH_KEY, "1");
    } catch {
      // 사파리 사설 모드 등
    }
    gate.classList.add("site-gate--hidden");
    gate.setAttribute("aria-hidden", "true");
    // 외부/인라인 CSS의 우선순위 차이로 숨김 클래스가 무시되는 경우를 대비한 보강
    gate.style.display = "none";
    document.body.classList.remove("auth-locked");
    if (err) {
      err.hidden = true;
      err.textContent = "";
    }
    load();
  };

  const playDenyFeedback = () => {
    if (panel) {
      panel.classList.remove("site-gate__panel--deny");
      requestAnimationFrame(() => {
        void panel.offsetWidth;
        panel.classList.add("site-gate__panel--deny");
        const done = () => {
          panel.classList.remove("site-gate__panel--deny");
        };
        panel.addEventListener("animationend", done, { once: true });
      });
    }
    input.classList.remove("site-gate__input--error");
    void input.offsetWidth;
    requestAnimationFrame(() => {
      input.classList.add("site-gate__input--error");
    });
  };

  const fail = () => {
    const raw = String(input.value ?? "");
    const digits = gatePinDigitsOnly(raw);
    if (err) {
      err.hidden = false;
      // 디버그가 필요한 동안에는 raw 길이 + 숫자 길이를 함께 보여줌
      const debug =
        location.search.includes("debug") ||
        location.hash.includes("debug");
      err.textContent = debug
        ? `틀려요. (raw ${raw.length}자, 숫자 ${digits.length}자, 첫코드 ${raw
            .charCodeAt(0)
            .toString(16)})`
        : `암호가 맞지 않아요. (감지된 숫자 ${digits.length}자리)`;
    }
    playDenyFeedback();
    try {
      input.select();
    } catch {
      // ignore
    }
  };

  const tryUnlock = () => {
    if (gatePinMatches(input.value)) ok();
    else fail();
  };

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    e.stopPropagation();
    tryUnlock();
  });

  /* 버튼 클릭/탭: form submit이 막혀도 직접 잡음 */
  if (button) {
    button.addEventListener("click", (e) => {
      e.preventDefault();
      tryUnlock();
    });
  }

  /* 엔터: 일부 브라우저가 input에서 submit을 생략 → 직접 확인 */
  input.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== "NumpadEnter") return;
    e.preventDefault();
    tryUnlock();
  });

  /* iOS 일부 버전에서 input.value 갱신이 한 틱 늦는 경우가 있어 마이크로태스크 뒤에 검사 */
  input.addEventListener("input", () => {
    setTimeout(() => {
      const d = gatePinDigitsOnly(input.value);
      if (d.length >= 4) tryUnlock();
    }, 0);
  });

  requestAnimationFrame(() => {
    try {
      input.focus({ preventScroll: true });
    } catch {
      input.focus();
    }
  });
}

initSearch();
initSiteGate();
