#!/usr/bin/env node
/**
 * YouTube 링크 → oEmbed로 제목·채널명 수집 → 설명 자동 생성 → videos.json 맨 앞에 추가(또는 --update)
 *
 * 사용:
 *   npm run add-video -- "https://youtu.be/VIDEO_ID"
 *   npm run add-video -- "URL" --date=2024-07-01
 *   npm run add-video -- "URL" --update
 *
 * 이미 있는 videoId: 기본은 종료(안내). --update 로 title/description·date 덮어쓰기.
 * 설명: 제목·키워드로 짧은 한 줄(제목/날짜 문장 복붙 금지). .env에 ANTHROPIC_API_KEY 있으면 같은 규칙으로 생성(--no-llm 가능).
 *
 * oEmbed 제목이 `2024.06.30~… 태국…` 형태일 때: **첫 날짜**는 `date`(→ `<time datetime>`)로,
 * `title`·`displayTitle`에는 **날짜·기간을 뺀 본문만** 저장.
 */
import { readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const VIDEOS_PATH = join(ROOT, "videos.json");

const OEMBED = "https://www.youtube.com/oembed";

function loadDotEnv() {
  try {
    const p = join(ROOT, ".env");
    const raw = readFileSync(p, "utf8");
    for (const line of raw.split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const i = t.indexOf("=");
      if (i === -1) continue;
      const k = t.slice(0, i).trim();
      let v = t.slice(i + 1).trim();
      if (
        (v.startsWith('"') && v.endsWith('"')) ||
        (v.startsWith("'") && v.endsWith("'"))
      ) {
        v = v.slice(1, -1);
      }
      if (process.env[k] === undefined) process.env[k] = v;
    }
  } catch {
    // no .env
  }
}
loadDotEnv();

/** @param {string} input */
function extractVideoId(input) {
  const s = String(input).trim();
  if (!s) return null;
  const mShort = s.match(/(?:youtu\.be\/|shorts\/)([a-zA-Z0-9_-]{6,})/i);
  if (mShort) return mShort[1];
  const mWatch = s.match(/[?&]v=([a-zA-Z0-9_-]{6,})/i);
  if (mWatch) return mWatch[1];
  const mEmbed = s.match(/youtube\.com\/embed\/([a-zA-Z0-9_-]{6,})/i);
  if (mEmbed) return mEmbed[1];
  if (/^[a-zA-Z0-9_-]{6,}$/.test(s)) return s;
  return null;
}

/** @param {string} videoId @returns {Promise<{ title: string, author_name: string }>} */
async function fetchOembed(videoId) {
  const pageUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(
    videoId
  )}`;
  const u = new URL(OEMBED);
  u.searchParams.set("url", pageUrl);
  u.searchParams.set("format", "json");
  const r = await fetch(u);
  if (!r.ok) {
    const t = await r.text();
    throw new Error(
      `oEmbed 실패 (${r.status}): ${t.slice(0, 200)}. 비공개·삭제·연령제한이면 가져올 수 없을 수 있어요.`
    );
  }
  return r.json();
}

/** 제목 앞(또는 휴리스틱용) 날짜/기간 제거 */
function stripDatePrefix(s) {
  return String(s)
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
}

/**
 * oEmbed로 받은 전체 제목 → 표시/저장용 제목(날짜 제거) + 첫 날짜(ISO, date 필드).
 * @param {string} raw
 * @returns {{ cleanTitle: string, firstDateIso: string | null, raw: string }}
 */
function splitOembedTitle(raw) {
  const s = (raw || "").trim();
  if (!s) return { cleanTitle: "", firstDateIso: null, raw: s };

  let firstDateIso = null;
  const atStart = s.match(
    /^(\d{4})[.\-\/](\d{1,2})[.\-\/](\d{1,2})/
  );
  if (atStart) {
    firstDateIso = `${atStart[1]}-${atStart[2].padStart(2, "0")}-${atStart[3].padStart(2, "0")}`;
  } else {
    const any = s.match(
      /(\d{4})[.\-\/](\d{1,2})[.\-\/](\d{1,2})/
    );
    if (any) {
      firstDateIso = `${any[1]}-${any[2].padStart(2, "0")}-${any[3].padStart(2, "0")}`;
    }
  }

  const clean = stripDatePrefix(s);
  return {
    cleanTitle: clean || s,
    firstDateIso,
    raw: s,
  };
}

const MAX_BLURB = 90;

/**
 * 제목 키워드만으로 짧은 한 줄(날짜·전체 제목 복붙 없음)
 * @param {string} title
 * @param {string} [authorName]
 */
function heuristicDescription(title, authorName = "") {
  const s = (title || "").trim();
  const t = stripDatePrefix(s) || s;
  const low = t.toLowerCase();

  const pick = (line) => {
    const o = line.replace(/\s+/g, " ").trim();
    return o.length > MAX_BLURB ? o.slice(0, MAX_BLURB - 1) + "…" : o;
  };

  if (/신혼|허니문|honeymoon|웨딩|결혼여행|혼인|리마인드|혼수/i.test(s)) {
    const bits = [];
    if (/태국|방콕|치앙|푸켓|코사무이|파타야|푸파|다낭|발리|괌|하와이|오키나와|제주|부산|서울|강릉|속초|홍콩|싱가|대만|일본|도쿄|오사카|다카|교토|뉴욕|파리|스위스|스페인|이탈리아|유럽|미국|캐나다|호주|뉴질|베트남|캄보디아|필리핀|몰디브/i.test(
      t
    )) {
      if (/태국/.test(t)) bits.push("태국");
      if (/코사무이|사무이/.test(t)) bits.push("코사무이");
      if (/방콕/.test(t)) bits.push("방콕");
      if (/푸켓/.test(t)) bits.push("푸켓");
      if (/제주/.test(t)) bits.push("제주");
      if (/부산/.test(t)) bits.push("부산");
      const place =
        bits.length > 0
          ? [...new Set(bits)].join("·")
          : t.split(/\s+/).slice(0, 2).join(" ");
      return pick(`${place}, 행복한 신혼여행, 잊지 못할 영상.`);
    }
    return pick("둘만의 자리, 달콤한 신혼·기억이 담긴 짧은 기록.");
  }
  if (
    /해외|여행|투어|VLOG|vlog|브이로그|일주일|박\s*\d|티켓|항공|호텔|체크인|캐리/i.test(
      low
    ) ||
    /해외|여행|투어|VLOG|vlog|브이로그|나들이|드라이브/i.test(t)
  ) {
    return pick("여행·나들이 풍경, 그날의 기분만 가볍게 담은 영상.");
  }
  if (
    /생일|돌|백일|가족모임|명절|추석|설날|할머니|할아버지|엄빠|엄마|아빠|크리스마스|졸업|입학|웨딩|결혼식|돌잔치|돌잔|회갑|환갑|칠순|팔순|개업|이사/i.test(
      t
    )
  ) {
    return pick("가족·경사 어느 날, 웃는 얼굴이 남는 짧은 기록.");
  }
  if (
    /아기|아이|응강|초등|학교|강아지|반려|일상|주말|캠핑|바베큐|요리|먹방|쿠킹|개린이/i.test(
      t
    )
  ) {
    return pick("집·밖 일상, 소소한 순간을 모은 영상.");
  }
  if (authorName && /가족|home|vlog|일상|맘|대디|빠|mom|dad/i.test(authorName)) {
    return pick("가족 기록, 나중에 다시 훑어보기 좋은 한 편.");
  }
  return pick("가족이 함께 보는 아카이브, 그날의 요지만 담은 설명.");
}

/** oEmbed/LLM이 긴 문장·개행을 줄 때 */
function normalizeDescription(text, _title) {
  let s = String(text || "")
    .replace(/\r?\n/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[「」"]/g, "")
    .trim();
  if (s.length > MAX_BLURB) s = s.slice(0, MAX_BLURB - 1) + "…";
  return s;
}

/**
 * @param {string} title
 * @param {string} authorName
 */
async function describeWithClaude(title, authorName) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  const model =
    process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514";
  const body = {
    model,
    max_tokens: 120,
    messages: [
      {
        role: "user",
        content: `가족용 영상 사이트의 '짧은 설명' 한 줄(한국어)만 써라.

필수 규칙:
- 한 문장, 공백 포함 **80자 이하** (초과 시 잘라도 됨).
- **YouTube 제목을 그대로 복사하지 말 것.** 날짜(2024.06.30, 6/30~7/6 등)도 **설명에 넣지 말 것.**
- 제목에 나온 **장소·행사(신혼·생일·여행 등) 키워드만** 끌어와 유추해, "태국·코사무이, 행복한 신혼여행, 잊지 못할 기록"처럼 **짧고 담백**하게. 없는 사실(인명·사건)은 지어내지 말 것.
- 따옴표「」, 인용, 목록, 이모지 없이 본문만.
- 아래 "표시용 제목"은 **날짜가 이미 떼어진 문자열**이다. 날짜는 쓰지 말 것.

표시용 제목(날짜 제거됨): ${title}
채널명(참고): ${authorName || "(없음)"}`,
      },
    ],
  };
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const err = await r.text();
    console.warn("Claude API 실패, 휴리스틱으로 대체:", err.slice(0, 300));
    return null;
  }
  const j = await r.json();
  const text = j?.content?.[0]?.text?.trim();
  return text || null;
}

/** @param {string} title */
function guessDateFromTitle(title) {
  const m = title.match(
    /(\d{4})[.\-\/](\d{1,2})[.\-\/](\d{1,2})/
  );
  if (m) {
    const y = m[1];
    const mo = m[2].padStart(2, "0");
    const d = m[3].padStart(2, "0");
    return `${y}-${mo}-${d}`;
  }
  return null;
}

function localTodayIso() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseArgs(argv) {
  const urlArg = argv.find(
    (a) => a.startsWith("http") || extractVideoId(a)
  );
  const flags = {
    update: argv.includes("--update") || argv.includes("-u"),
    noLlm: argv.includes("--no-llm"),
    date: null,
  };
  for (const a of argv) {
    if (a.startsWith("--date=")) flags.date = a.slice(7);
  }
  return { urlArg, flags, raw: argv };
}

async function main() {
  const argv = process.argv.slice(2);
  if (!argv.length || argv.includes("-h") || argv.includes("--help")) {
    console.log(`
YouTube → videos.json

  npm run add-video -- "<유튜브 URL 또는 videoId>"

옵션:
  --date=YYYY-MM-DD   기록일(<time>용). 생략 시 oEmbed 제목 **맨 앞** 날짜 → … → 오늘
  --update / -u       같은 videoId가 이미 있으면 덮어쓰기(제목·날짜·설명)
  --no-llm              .env에 ANTHROPIC_API_KEY가 있어도 휴리스틱만 사용
  --help

선택: 프로젝트 루트에 .env
  ANTHROPIC_API_KEY=...   (있으면 설명 1~2문장을 Claude로 생성, 없으면 키워드 기반)
  ANTHROPIC_MODEL=...     (기본: claude-sonnet-4-20250514)
`);
    process.exit(argv.length ? 0 : 1);
  }

  const { urlArg, flags } = parseArgs(argv);
  const idStr = urlArg && extractVideoId(urlArg) ? urlArg : argv[0];
  const videoId = extractVideoId(idStr || "");
  if (!videoId) {
    console.error("유효한 YouTube 링크나 videoId를 주세요.");
    process.exit(1);
  }

  const meta = await fetchOembed(videoId);
  const oembedRaw = (meta.title || "").trim();
  const { cleanTitle, firstDateIso, raw: rawTitle } = splitOembedTitle(
    oembedRaw || ""
  );
  const title = cleanTitle || oembedRaw || "(제목 없음)";
  const author = (meta.author_name || "").trim();

  let description;
  if (!flags.noLlm && process.env.ANTHROPIC_API_KEY) {
    const ai = await describeWithClaude(title, author);
    description = normalizeDescription(
      ai || heuristicDescription(title, author),
      title
    );
  } else {
    description = normalizeDescription(
      heuristicDescription(title, author),
      title
    );
  }

  const date =
    flags.date ||
    firstDateIso ||
    guessDateFromTitle(oembedRaw || rawTitle) ||
    localTodayIso();

  const newEntry = {
    id: `yt-${videoId}`,
    videoId,
    title,
    displayTitle: title,
    description,
    date,
    note: author ? `채널: ${author}` : "",
  };

  const raw = readFileSync(VIDEOS_PATH, "utf8");
  const data = JSON.parse(raw);
  if (!Array.isArray(data.videos)) {
    throw new Error("videos.json: videos 배열이 없습니다.");
  }

  const idx = data.videos.findIndex((v) => v.videoId === videoId);
  if (idx >= 0) {
    if (!flags.update) {
      console.error(
        `이미 목록에 있는 videoId 입니다: ${videoId}\n` +
          `덮어쓰려면: npm run add-video -- "${urlArg || videoId}" --update`
      );
      process.exit(1);
    }
    const old = data.videos[idx];
    newEntry.id = old.id;
    if (old.note && !newEntry.note) newEntry.note = old.note;
    data.videos[idx] = newEntry;
    console.log(`업데이트: ${title} (기록일: ${date})`);
  } else {
    data.videos.unshift(newEntry);
    console.log(`추가: ${title} (기록일: ${date})`);
  }

  writeFileSync(VIDEOS_PATH, JSON.stringify(data, null, 2) + "\n", "utf8");
  console.log(`→ ${VIDEOS_PATH}`);
  if (oembedRaw && oembedRaw !== title) {
    const hint =
      oembedRaw.length > 60 ? oembedRaw.slice(0, 60) + "…" : oembedRaw;
    console.log(`  oEmbed 원문(참고): ${hint}`);
  }
  console.log(`  date → <time datetime>: ${date}`);
  console.log(
    `  desc: ${description.slice(0, 72)}${description.length > 72 ? "…" : ""}`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
