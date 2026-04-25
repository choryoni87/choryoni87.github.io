const $ = (sel, root = document) => root.querySelector(sel);

const state = {
  videos: [],
  query: "",
  /** null=전체, 숫자=해당 연도(videos[].date의 연) */
  activeYear: null,
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

  const display = video.displayTitle || video.title || "(제목 없음)";

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
  date.textContent = fmtDate(video.date);
  date.dateTime = video.date || "";
  desc.textContent = video.description || "";

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
  const total = videos.length;
  count.textContent =
    state.query || state.activeYear != null
      ? `${filtered.length} / ${total} 편 표시`
      : `총 ${total} 편 (최신순)`;
}

function applyFilters(videos) {
  const q = state.query.trim().toLowerCase();
  const year = state.activeYear;
  return videos.filter((v) => {
    if (year != null) {
      const y = yearFromDate(v.date);
      if (y !== year) return false;
    }
    if (!q) return true;
    const hay = [v.displayTitle || "", v.title || "", v.description || "", v.note || ""]
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
    const y = yearFromDate(v.date);
    if (y != null) years.add(y);
  });
  const sorted = Array.from(years).sort((a, b) => b - a);
  if (state.activeYear != null && !sorted.includes(state.activeYear)) {
    state.activeYear = null;
  }
  wrap.replaceChildren();
  if (sorted.length === 0) return;

  wrap.appendChild(makeYearButton("전체", null, state.activeYear == null));
  sorted.forEach((y) => {
    wrap.appendChild(
      makeYearButton(String(y), y, state.activeYear === y)
    );
  });
}

function makeYearButton(label, value, pressed) {
  const b = document.createElement("button");
  b.className = "filter-pill";
  b.type = "button";
  b.textContent = label;
  b.setAttribute("aria-pressed", pressed ? "true" : "false");
  if (value != null) {
    b.setAttribute("data-year", String(value));
  }
  b.addEventListener("click", () => {
    state.activeYear = value;
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

load();
