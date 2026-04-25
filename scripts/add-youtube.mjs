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
 * 설명: 제목·키워드·date/dateDisplay(당일/기간 느낌)로 짧은 한 줄. .env에 ANTHROPIC_API_KEY 있으면 생성(--no-llm 가능).
 * --refresh-all-descriptions: videos.json 전부 description 재생성(일괄: npm run refresh-descriptions).
 *
 * oEmbed 제목이 `2024.06.30~… 태국…` 형태일 때: **첫 날짜**는 `date`(→ `<time datetime>`)로,
 * `title`·`displayTitle`에는 **날짜·기간을 뺀 본문만** 저장.
 * 제목 **맨 앞**에 `2024.06.30~07.06` 같은 **기간**이 있으면 `dateDisplay`에 "2024.06.30 ~ 07.06" 식으로 넣고,
 * row 옆이 그 문자열로 표시됨(정렬·연도필터는 `date` 기준 = 시작일).
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
    .replace(/^\d{4}년\s*\d{1,2}월\s*\d{1,2}일\s*/u, "")
    .replace(
      /^\d{4}\d{2}\d{2}~\d{4}\d{2}\d{2}\s*/u,
      ""
    )
    .replace(
      /^\d{4}\d{2}\d{2}~\d{2}\d{2}\s*/u,
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
    .replace(/^\d{4}[.\-\/]\d{1,2}[.\-\/]\d{1,2}\s+/, "")
    .replace(
      /^\d{4}[.\-\/]\d{1,2}[.\-\/]\d{1,2}\.(?=[^\d.]|$)/u,
      ""
    )
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
  const koStart = s.match(
    /^(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/
  );
  if (koStart) {
    firstDateIso = `${koStart[1]}-${String(koStart[2]).padStart(2, "0")}-${String(
      koStart[3]
    ).padStart(2, "0")}`;
  } else {
    const compactFull = s.match(
      /^(\d{4})(\d{2})(\d{2})~(\d{4})(\d{2})(\d{2})/
    );
    if (compactFull) {
      firstDateIso = `${compactFull[1]}-${compactFull[2]}-${compactFull[3]}`;
    } else {
      const compactEnd = s.match(
        /^(\d{4})(\d{2})(\d{2})~(\d{2})(\d{2})/
      );
      if (compactEnd) {
        firstDateIso = `${compactEnd[1]}-${compactEnd[2]}-${compactEnd[3]}`;
      } else {
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
          } else {
            const anyKo = s.match(
              /(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/
            );
            if (anyKo) {
              firstDateIso = `${anyKo[1]}-${String(anyKo[2]).padStart(2, "0")}-${String(
                anyKo[3]
              ).padStart(2, "0")}`;
            }
          }
        }
      }
    }
  }

  const clean = stripDatePrefix(s);
  return {
    cleanTitle: clean || s,
    firstDateIso,
    raw: s,
  };
}

const pad2 = (n) => String(n).padStart(2, "0");
function ymdDots(y, mo, d) {
  return `${y}.${pad2(mo)}.${pad2(d)}`;
}

/**
 * oEmbed **원문** 제목 맨 앞의 날짜·기간 → 목록에 그대로 쓰는 표시용 문자열
 * @returns {string | null} 예: "2024.06.30 ~ 07.06", "2024.12.20 ~ 2025.01.02", "2024.09.15"
 */
function parseDateRangeDisplayFromRawTitle(raw) {
  const s = (raw || "").trim();
  if (!s) return null;

  const koOne = s.match(
    /^(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/
  );
  if (koOne) {
    return ymdDots(koOne[1], koOne[2], koOne[3]);
  }

  const cFull8 = s.match(
    /^(\d{4})(\d{2})(\d{2})~(\d{4})(\d{2})(\d{2})/
  );
  if (cFull8) {
    return `${ymdDots(cFull8[1], cFull8[2], cFull8[3])} ~ ${ymdDots(
      cFull8[4],
      cFull8[5],
      cFull8[6]
    )}`;
  }
  const cEnd4 = s.match(
    /^(\d{4})(\d{2})(\d{2})~(\d{2})(\d{2})/
  );
  if (cEnd4) {
    return `${ymdDots(cEnd4[1], cEnd4[2], cEnd4[3])} ~ ${pad2(cEnd4[4])}.${pad2(
      cEnd4[5]
    )}`;
  }

  const ymdFull = s.match(
    /^(\d{4})[.\-\/](\d{1,2})[.\-\/](\d{1,2})\s*~\s*(\d{4})[.\-\/](\d{1,2})[.\-\/](\d{1,2})/
  );
  if (ymdFull) {
    return `${ymdDots(ymdFull[1], ymdFull[2], ymdFull[3])} ~ ${ymdDots(ymdFull[4], ymdFull[5], ymdFull[6])}`;
  }
  const ymdShort = s.match(
    /^(\d{4})[.\-\/](\d{1,2})[.\-\/](\d{1,2})\s*~\s*(\d{1,2})[.\-\/](\d{1,2})/
  );
  if (ymdShort) {
    return `${ymdDots(ymdShort[1], ymdShort[2], ymdShort[3])} ~ ${pad2(ymdShort[4])}.${pad2(ymdShort[5])}`;
  }
  const one = s.match(/^(\d{4})[.\-\/](\d{1,2})[.\-\/](\d{1,2})/);
  if (one) {
    return ymdDots(one[1], one[2], one[3]);
  }
  return null;
}

const MAX_BLURB = 90;

/**
 * `date`·`dateDisplay`로 당일/이틀/며칠 느낌만(설명에 숫자 날짜는 안 씀)
 * @param {string|undefined} dateDisplay
 * @param {string} title
 */
function inferScheduleHint(dateDisplay, title) {
  const t = title || "";
  if (/당일치기|당일|왕복/.test(t)) {
    return { isRange: false, hint: "당일 다녀온" };
  }
  const dd = (dateDisplay || "").replace(/\s/g, "");
  const hasRange = /~|～|∼/.test(dateDisplay || "");
  if (!hasRange) {
    return { isRange: false, hint: "그날" };
  }
  if (/유럽|태교|파리|이탈리아|스위스|해외|비행|터키|로마|밀라노|베니스/i.test(t)) {
    return { isRange: true, hint: "여러 밤에 걸친" };
  }
  if (dd.length <= 20 && /~\d{2}\.\d{2}$/.test(dd) && !/202[45]\.02/.test(dd)) {
    return { isRange: true, hint: "이틀에 걸친" };
  }
  return { isRange: true, hint: "며칠에 걸친" };
}

/**
 * 제목 + 기록일·목록날짜(기간)을 보고 짧은 한 줄 유추(날짜 숫자·전체제목 복붙 없음)
 * @param {string} title
 * @param {string} [authorName]
 * @param {{ date?: string, dateDisplay?: string }} [ctx]
 */
function heuristicDescription(title, authorName = "", ctx = {}) {
  const s = (title || "").trim();
  const t = stripDatePrefix(s) || s;
  const low = t.toLowerCase();
  const { date: _d, dateDisplay = "" } = ctx;
  const sched = inferScheduleHint(dateDisplay, t);

  const pick = (line) => {
    const o = line.replace(/\s+/g, " ").trim();
    return o.length > MAX_BLURB ? o.slice(0, MAX_BLURB - 1) + "…" : o;
  };

  if (/신혼|허니문|honeymoon|웨딩|결혼여행|혼인|리마인드|혼수/i.test(t)) {
    const bits = [];
    if (
      /태국|방콕|치앙|푸켓|코사무이|파타야|푸파|다낭|발리|괌|하와이|오키나와|제주|부산|서울|강릉|속초|홍콩|싱가|대만|일본|도쿄|오사카|다카|교토|뉴욕|파리|스위스|스페인|이탈리아|유럽|미국|캐나다|호주|뉴질|베트남|캄보디아|필리핀|몰디브/i.test(
        t
      )
    ) {
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
      const when = sched.isRange ? `${sched.hint} ` : "";
      return pick(
        `${place} 신혼 루트, ${when}휴·풍경만 담은 기억`
      );
    }
    return pick("둘만의 신혼, 달콤한 풍경만 담은 짧은 기록");
  }
  if (
    /돌잔치|돌\s*준비|첫돌/i.test(t) &&
    /사진|촬영|스파텔|호텔|잔디|야외|계룡|펜|드레스/i.test(t)
  ) {
    return pick(
      "돌잔치를 앞두고 호텔 잔디·야외에서 준비·촬영한 장면, 가족이 모인 그날의 기록"
    );
  }
  if (/호캉스|스테이|리조트/i.test(t) && /호텔|엔포드|청주/i.test(t)) {
    if (sched.isRange && /이틀|며칠/.test(sched.hint)) {
      return pick(
        "청주 엔포드에서 머무는 동안, 호캉스·실내 분위기만 가볍게 담은 기록"
      );
    }
    return pick("호텔에 머문 하루·밤, 여유로운 분위기만 담은 기록");
  }
  if (/유럽|태교|파리|이탈리아|로마|밀라노|베니스|스위스/i.test(t)) {
    if (sched.hint.includes("여러")) {
      return pick(
        "태교·유럽(파리~이탈리아) 루트, 며칠에 걸친 발자국·풍경만 담은 기록"
      );
    }
    return pick("태교·유럽 일정, 지나온 풍경만 담은 짧은 기록");
  }
  if (/옥천|펜션|풀빌라/i.test(t) && /여행|1박|2박|휴식|펜션/.test(t)) {
    if (sched.isRange) {
      return pick("옥천 펜션에서 머무는 이틀, 나들이·쉼이 겹쳐진 짧은 기록");
    }
    return pick("옥천 펜션에서의 여행, 그날의 분위기만 담은 기록");
  }
  if ((/부여|백제|부소|궁/.test(t) && /당일치기|나들이|하루/.test(t)) || /부여.*당일|당일.*부여/.test(t)) {
    return pick("부여로 당일 다녀온 하루, 유적·밖 풍경이 겹쳐진 짧은 기록");
  }
  if (
    /대전/.test(t) &&
    /(0시|축제|한밤|은행|미디어|밤의|문화|퍼레이드|야시장)/.test(t)
  ) {
    return pick("한밤 축제·밤거리, 그날 공기·불빛만 담은 기록");
  }
  if (/벚꽃|벚|개화|꽃놀이/i.test(t) && /죽동|서원|지역|동네/i.test(t)) {
    return pick("봄꽃·동네(카페) 나들이, 맑은 날의 기록");
  }
  if (/산책|걷기|도보|왕복|신세계|집에서/i.test(t)) {
    return pick("집에서 가까운 곳까지 왕복 산책, 맑은 날의 걸음 기록");
  }
  if (
    /물놀이|워터|물장|수영|풀장/i.test(t) &&
    /환경|체험|어린이|박물관|전시관|센터/i.test(t)
  ) {
    return pick("가족·센터(체험)에서의 물놀이, 그날의 짧은 기록");
  }
  if (
    /육아|센터|놀이|교육|지원|아빠|딸|아들|엄마|퍼실|놀이방/i.test(t)
  ) {
    if (/아빠|딸|아들|엄마|함께|같이/i.test(t) && /센터|지원|놀이/i.test(t)) {
      return pick(
        "센터에서 부모·아이가 함께한 짧은 일상, 그때의 분위기만 담은 기록"
      );
    }
    return pick("육아·가족 일상, 센터에서의 잠깐이 담긴 기록");
  }
  if (/필름톤|톤\s*테스트|테스트\s*촬영|시네|LUT|촬영\s*느낌/i.test(t)) {
    return pick("카메라 톤·촬영 느낌을 맞춰 본 일상, 그날의 빛·질감 기록");
  }
  if (
    /해외|여행|투어|VLOG|vlog|브이로그|박\s*\d|티켓|항공|체크인|캐리/i.test(
      low
    ) ||
    /해외|여행|투어|VLOG|vlog|브이로그|나들이|드라이브|캉스|여정/i.test(
      t
    )
  ) {
    const when = sched.hint;
    if (when === "당일 다녀온") {
      return pick("당일 나들이·이동, 그날의 풍경만 가볍게 담은 기록");
    }
    if (sched.isRange) {
      return pick(`${when} 이동·나들이, 풍경만 잠깐 겹친 짧은 기록`);
    }
    return pick("나들이·이동, 그날의 기분만 가볍게 담은 기록");
  }
  if (
    /생일|돌|백일|가족모임|명절|추석|설날|할머니|할아버지|엄빠|엄마|아빠|크리스마스|졸업|입학|웨딩|결혼식|돌잔|회갑|환갑|칠순|팔순|개업|이사|잔치/i.test(
      t
    )
  ) {
    return pick("가족·경사스러운 날, 짧은 순간이 겹쳐진 기록");
  }
  if (
    /아기|아이|응강|초등|학교|강아지|반려|일상|주말|캠핑|바베큐|요리|먹방|쿠킹|개린이/i.test(
      t
    )
  ) {
    return pick("집·밖 일상, 소소한 풍경만 잠깐 담은 기록");
  }
  if (
    /축제|0시|야시장|퍼레이드|불꽃|놀이마당|놀거리|지역행사|밤거리|야경|문화거리/i.test(
      t
    )
  ) {
    return pick("밤·거리 행사, 그날의 분위기만 가볍게 담은 기록");
  }
  if (authorName && /가족|home|vlog|일상|맘|대디|빠|mom|dad/i.test(authorName)) {
    return pick("가족 기록, 나중에 훑어 보기 좋은 잠깐의 풍경");
  }
  return pick("가족이 함께 보는 기록, 제목·그날의 요지만 떠올리는 짧은 설명");
}

/** 설명 끝 마침표(자동 생성 규칙: 마지막 . 금지) */
function stripTrailingDescriptionPeriod(s) {
  return String(s || "")
    .trim()
    .replace(/[.．。]+$/u, "")
    .trim();
}

/** oEmbed/LLM이 긴 문장·개행을 줄 때 */
function normalizeDescription(text, _title) {
  let s = String(text || "")
    .replace(/\r?\n/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[「」"]/g, "")
    .trim();
  if (s.length > MAX_BLURB) s = s.slice(0, MAX_BLURB - 1) + "…";
  return stripTrailingDescriptionPeriod(s);
}

/**
 * @param {string} title
 * @param {string} authorName
 */
async function describeWithClaude(title, authorName, ctx = {}) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  const model =
    process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514";
  const dd = ctx.dateDisplay || "";
  const di = ctx.date || "";
  const body = {
    model,
    max_tokens: 120,
    messages: [
      {
        role: "user",
        content: `가족용 영상 사이트의 '짧은 설명' 한 줄(한국어)만 써라.

필수 규칙:
- 한 문장, 공백 포함 **80자 이하** (초과 시 잘라도 됨).
- **제목을 복붙하지 말 것** — 키워드(장소·행사)만 보고 담긴 내용을 유추, 날짜 숫자는 쓰지 말 것. 아래 '목록날짜'에 **~**가 있으면 '며칠/밤이 넘는 일정'으로만 느낌 잡기. 없는 사실(인명·사건)은 지어내지 말 것.
- **문장/문구 맨끝에 마침표(.)나 전각 마침표(。)를 넣지 말 것**
- 따옴표「」, 이모지 없이 본문만.

표시용 제목(날짜 제거 본문): ${title}
채널명(참고): ${authorName || "(없음)"}
목록 날짜/기간(참고, 숫자 복붙 금지): ${dd || "없음"} | 시작일 ISO(참고): ${di || "없음"}`,
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
  const t = title || "";
  const km = t.match(
    /(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/
  );
  if (km) {
    return `${km[1]}-${String(km[2]).padStart(2, "0")}-${String(km[3]).padStart(
      2,
      "0"
    )}`;
  }
  const cf = t.match(/^(\d{4})(\d{2})(\d{2})~(\d{4})(\d{2})(\d{2})/);
  if (cf) {
    return `${cf[1]}-${cf[2]}-${cf[3]}`;
  }
  const ce = t.match(/^(\d{4})(\d{2})(\d{2})~(\d{2})(\d{2})/);
  if (ce) {
    return `${ce[1]}-${ce[2]}-${ce[3]}`;
  }
  const m = t.match(
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

/** @param {string|undefined} note */
function parseChannelFromNote(note) {
  const m = String(note || "").match(/채널:\s*(.+)/);
  return m ? m[1].trim() : "";
}

/**
 * videos.json의 모든 `description`을 제목·date·dateDisplay·휴리스틱(또는 Claude)로 다시 씀
 * @param {{ noLlm: boolean }} flags
 */
async function refreshAllDescriptions(flags) {
  const raw = readFileSync(VIDEOS_PATH, "utf8");
  const data = JSON.parse(raw);
  if (!Array.isArray(data.videos)) {
    throw new Error("videos.json: videos 배열이 없습니다.");
  }
  let n = 0;
  for (const v of data.videos) {
    const title =
      String(v.displayTitle || v.title || "").trim() || "(제목 없음)";
    const author = parseChannelFromNote(v.note);
    const date = (v.date && String(v.date)) || "";
    const dateDisplay = (v.dateDisplay && String(v.dateDisplay)) || "";
    const descCtx = { date, dateDisplay };
    let description;
    if (!flags.noLlm && process.env.ANTHROPIC_API_KEY) {
      const ai = await describeWithClaude(title, author, descCtx);
      description = normalizeDescription(
        ai || heuristicDescription(title, author, descCtx),
        title
      );
    } else {
      description = normalizeDescription(
        heuristicDescription(title, author, descCtx),
        title
      );
    }
    v.description = description;
    n += 1;
  }
  writeFileSync(VIDEOS_PATH, JSON.stringify(data, null, 2) + "\n", "utf8");
  console.log(`description ${n}개 갱신 → ${VIDEOS_PATH}`);
}

function parseArgs(argv) {
  const urlArg = argv.find(
    (a) => a.startsWith("http") || extractVideoId(a)
  );
  const flags = {
    update: argv.includes("--update") || argv.includes("-u"),
    noLlm: argv.includes("--no-llm"),
    refresh: argv.includes("--refresh-all-descriptions"),
    date: null,
    /** @type {string | null} 예: "결혼식" */
    category: null,
    /** true면 전체·연도 목록에 숨기고 '결혼식' 탭에만(기존 항목 --update 시 생략하면 유지) */
    onlyWedding: argv.includes("--only-wedding"),
  };
  for (const a of argv) {
    if (a.startsWith("--date=")) flags.date = a.slice(7);
    if (a.startsWith("--category=")) flags.category = a.slice(11).trim() || null;
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
  --no-llm            .env에 ANTHROPIC_API_KEY가 있어도 휴리스틱만 사용
  --refresh-all-descriptions   videos.json의 모든 description 재생성(제목·date·dateDisplay 반영)
  --category=결혼식            사이트 '결혼식' 필터에 표시(다른 값도 저장 가능, 생략 시 —update는 기존 유지)
  --only-wedding              전체·연도 목록에서 숨기고 결혼식 탭에만(onlyWedding: true, —update 시 생략 유지)
  --help

선택: 프로젝트 루트에 .env
  ANTHROPIC_API_KEY=...   (있으면 설명 1~2문장을 Claude로 생성, 없으면 키워드 기반)
  ANTHROPIC_MODEL=...     (기본: claude-sonnet-4-20250514)
`);
    process.exit(argv.length ? 0 : 1);
  }

  const { urlArg, flags } = parseArgs(argv);
  if (flags.refresh) {
    await refreshAllDescriptions(flags);
    return;
  }

  const idStr = urlArg && extractVideoId(urlArg) ? urlArg : argv[0];
  const videoId = extractVideoId(idStr || "");
  if (!videoId) {
    console.error("유효한 YouTube 링크나 videoId를 주세요.");
    process.exit(1);
  }

  const meta = await fetchOembed(videoId);
  const oembedRaw = (meta.title || "")
    .trim()
    .normalize("NFC");
  const { cleanTitle, firstDateIso, raw: rawTitle } = splitOembedTitle(
    oembedRaw || ""
  );
  const title = cleanTitle || oembedRaw || "(제목 없음)";
  const author = (meta.author_name || "").trim();

  const date =
    flags.date ||
    firstDateIso ||
    guessDateFromTitle(oembedRaw || rawTitle) ||
    localTodayIso();

  const dateDisplay = parseDateRangeDisplayFromRawTitle(oembedRaw) || "";
  const descCtx = { date, dateDisplay };

  let description;
  if (!flags.noLlm && process.env.ANTHROPIC_API_KEY) {
    const ai = await describeWithClaude(title, author, descCtx);
    description = normalizeDescription(
      ai || heuristicDescription(title, author, descCtx),
      title
    );
  } else {
    description = normalizeDescription(
      heuristicDescription(title, author, descCtx),
      title
    );
  }

  const newEntry = {
    id: `yt-${videoId}`,
    videoId,
    title,
    displayTitle: title,
    description,
    date,
    note: author ? `채널: ${author}` : "",
  };
  if (dateDisplay) {
    newEntry.dateDisplay = dateDisplay;
  }

  const raw = readFileSync(VIDEOS_PATH, "utf8");
  const data = JSON.parse(raw);
  if (!Array.isArray(data.videos)) {
    throw new Error("videos.json: videos 배열이 없습니다.");
  }

  const idx = data.videos.findIndex((v) => v.videoId === videoId);
  if (flags.category) {
    newEntry.category = flags.category;
  } else if (idx >= 0) {
    const prev = data.videos[idx];
    if (prev && prev.category) newEntry.category = prev.category;
  }
  if (flags.onlyWedding) {
    newEntry.onlyWedding = true;
  } else if (idx >= 0) {
    const prev = data.videos[idx];
    if (prev && Object.prototype.hasOwnProperty.call(prev, "onlyWedding")) {
      newEntry.onlyWedding = prev.onlyWedding;
    }
  }
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
  if (dateDisplay) {
    console.log(`  dateDisplay(목록): ${dateDisplay}`);
  }
  if (newEntry.category) {
    console.log(`  category: ${newEntry.category}`);
  }
  console.log(
    `  desc: ${description.slice(0, 72)}${description.length > 72 ? "…" : ""}`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
