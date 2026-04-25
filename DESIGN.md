# DESIGN.md — 우리 가족 영상

## Color strategy

**Restrained.** 따뜻한 뉴트럴(웜 그레이·크림) + 단일 액센트(테라코타/벽돌). 액센트는 화면의 ≤10%, “재생/자세히” 같은 주요 동작과 “선택된 필터”에만.

순흑/순백은 쓰지 않는다. 모든 뉴트럴은 동일한 웜(주황 계열) 휴 쪽으로 살짝 틴트. OKLCH 채도는 매우 낮게.

### Tokens (OKLCH)

```
--bg         oklch(0.972 0.012 75);   /* 종이 같은 크림 */
--bg-soft    oklch(0.945 0.018 72);   /* 필터·호버 틴트 */
--bg-elev    oklch(0.985 0.008 78);   /* 살짝 떠 있는 면 */
--text-ink, --text-body, --text-lead, --text-dim, --text-caption, --text-date, --text-blurb, --text-eyebrow, --text-chevron  /* 문맥별(엠버·테라코타·황올리브 틴트) */
--fg / --fg-muted / --fg-subtle      /* --text-body 등 별칭(호환) */
--border     oklch(0.880 0.014 70);   /* 얇은 구분선 */
--border-strong oklch(0.800 0.018 68);
--accent     oklch(0.585 0.140 38);   /* 테라코타 */
--accent-press oklch(0.515 0.150 35);
--accent-fg  oklch(0.985 0.012 80);   /* 액센트 위 텍스트(틴트 화이트) */
--ring       oklch(0.65 0.13 38 / 0.35);
```

## Typography

- **Body & Display**: **Paperlogy(페이퍼로지)** (한·영, OFL) — woff2는 jsDelivr `fonts-archive/Paperlogy` 400/500/600/700. 본문 16px, 줄높이 1.6, 한 줄 폭 65~75ch. 굵기로 제목(600~700)과 본문(400~500)을 나눔. 제목·본문 스케일 비 ≥1.25.
- **글씨색**: 모두 `styles.css`의 `--text-*` 토큰으로 역할 구분(제목 **ink**, 부제 **lead**, 힌트 **caption**, 날짜 **date**, 본문 메모 **blurb** 등). 링크·선택 UI는 **accent** 유지. 영상 항목에 태그 필드·표시는 없음.
- 숫자는 `font-variant-numeric: tabular-nums`.

스케일(rem):
- display: 2.25
- h1: 1.75
- h2: 1.25
- body: 1.0
- caption: 0.825

## Layout

- 최대 폭: 본문 컨테이너 720px (목록은 850px까지). 모든 것을 컨테이너에 가두지 않음.
- **리듬**: 섹션 간 여백을 같지 않게(`5rem` / `3rem` / `4rem`).
- **목록 한 줄**: 가로 그리드 `144px 1fr`(데스크탑), 카드 그림자 X. 미세한 `border-radius: 8px` (썸네일은 6px).
- 모바일(≤640px): 한 열 스택, 썸네일 비율 `16/9` 풀폭.

## Components

- **버튼 Primary**: 액센트 채움, `--accent-fg` 텍스트, hover에 `--accent-press`. 그림자/그라디언트 X.
- **버튼 Ghost**: 배경 투명, 본문색, hover에 `--bg-soft`.
- **연도 필터**: 캡슐(`.filter-pill`), 평소엔 `--bg-soft` + 얇은 보더. 선택되면 액센트 1px 보더 + 옅은 `--accent` 틴트(액센트 채움은 아님). 날짜(`date`)에서 연도만 뽑아 표시.
- **검색**: 큰 입력 1개. placeholder `“제목이나 짧은 메모로 찾기”`. `title`·`displayTitle`·`description`·`note`만 검색.
- **재생**: 인라인 펼침. 행 아래에 `iframe` 16/9. 모달 X.

## Motion

- 호버 / 펼침 / 포커스만 적용. 200~280ms `cubic-bezier(0.22, 1, 0.36, 1)` (ease-out-quart).
- 절대 금지: 레이아웃 속성 애니메이션, 바운스/일래스틱, 그라데이션 텍스트.

## Anti-bans (지키기)

- 사이드 스트라이프 컬러 보더 X.
- 그라데이션 텍스트 X.
- 글래스모피즘 기본 X.
- 모달 X (인라인 우선).
- “큰 숫자 + 그라데이션” SaaS 클리셰 X.
- 똑같은 카드 16장 그리드 X.
