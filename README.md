# 우리 가족 영상

가족이 유튜브에 올린 일부공개·비공개 영상을 한 군데에서 보기 위한 정적 사이트입니다. 영상 자체는 유튜브에 두고, 이 사이트는 **목록 + 임베드**만 합니다.

## 폴더 구조

```
.
├─ index.html        # 마크업
├─ styles.css        # 따뜻한 종이 톤(OKLCH) 스타일
├─ app.js            # videos.json 로드, 연도 필터·검색, 인라인 재생
├─ videos.json       # 영상 목록(여기만 고치면 됨)
├─ assets/
│  └─ hero.jpg       # 헤더 가족 사진(최적화본)
├─ PRODUCT.md        # 톤·사용자·원칙
├─ DESIGN.md         # 디자인 토큰·규칙
└─ README.md
```

## 영상 추가하는 방법

1. 유튜브에 영상 업로드 후 **공개 범위**를 정합니다(추천: **일부공개**).
2. 주소창에서 `videoId`를 가져옵니다.
   - 예) `https://www.youtube.com/watch?v=dQw4w9WgXcQ` → `dQw4w9WgXcQ`
3. `videos.json`의 `videos` 배열 **맨 위**에 한 항목을 추가합니다.

```json
{
  "id": "2026-09-29-family-dinner",
  "videoId": "여기에_유튜브_ID",
  "displayTitle": "사이트에 보일 짧은 제목",
  "description": "한두 줄 가족 메모.",
  "date": "2026-09-29",
  "note": ""
}
```

`displayTitle`을 비우면 `title`이 사용됩니다. 둘 다 없으면 `(제목 없음)`.

**연도 필터**는 각 항목의 `date`(ISO 날짜, 예: `2026-09-29`)에서 **연도만** 읽어 자동으로 버튼을 만듭니다. 상단의 `2026`, `2025` 같은 버튼으로 그 해 영상만 보여 줍니다. **태그는 사용하지 않습니다.**

> 자동화 옵션: 나중에 “링크만 적으면 빌드 시 oEmbed로 제목 자동 채움”을 붙일 수 있습니다(스크립트 추가). 가족이 직접 적는 짧은 메모는 항상 수동입니다.

## 로컬에서 미리 보기

이 사이트는 정적 파일이라 서버 하나만 띄우면 됩니다.

```bash
# 1) 파이썬
python3 -m http.server 5173

# 2) 또는 Node
npx --yes serve -p 5173 .
```

그다음 브라우저에서 [http://localhost:5173](http://localhost:5173).

> `file://`로 직접 열면 `fetch('videos.json')`이 막힙니다. 반드시 서버로 띄워 주세요.

## GitHub Pages 배포

1. 새 GitHub 레포지토리를 만들고 이 폴더를 push.
2. 레포지토리 **Settings → Pages**에서
   - Source: **Deploy from a branch**
   - Branch: `main` (또는 `gh-pages`), 폴더 `/ (root)`
3. 잠시 뒤 `https://<유저명>.github.io/<레포명>/`에서 사이트가 열립니다.

> 검색엔진 노출은 줄이고 싶어 `<meta name="robots" content="noindex">`를 넣어 두었습니다. 완전한 비공개는 아니므로, **공유 범위는 가족에게만**.

## 가족 사진 교체하기

원본 큰 사진은 깃에 올리지 않고, 다음과 같이 **줄여서** `assets/hero.jpg`로만 둡니다.

```bash
# 가로/세로 큰 쪽이 1200px가 되도록 축소(macOS 기본 sips 사용)
sips -s format jpeg -s formatOptions 80 -Z 1200 \
  ~/원본/사진.png --out assets/hero.jpg
```

권장 용량은 한 장당 수백 KB 이하. 헤더에서 얼굴이 잘리지 않도록 `styles.css`의 `.hero__photo img { object-position: 50% 30%; }` 값을 조절하세요.

## 디자인 메모

- 색 전략: **Restrained**(웜 뉴트럴 + 단일 액센트, 액센트 ≤10%).
- 톤: 차분한 가족 아카이브. SaaS·OTT 분위기·핑크 파스텔 회피.
- 타이포: **Paperlogy(페이퍼로지)** (본문·제목 공통, 굵기로 구분).
- 레이아웃: 카드 그리드 X, **가로행** 목록(썸네일+제목+한 줄). 모바일에선 한 열 스택.
- 재생: 모달이 아니라 **인라인 펼침**.

자세한 토큰·원칙은 [PRODUCT.md](PRODUCT.md), [DESIGN.md](DESIGN.md).
