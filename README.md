# 후쿠오카 3박 4일 · 2027.01.07–10

도완 & 아내의 겨울 후쿠오카 여행 페이지.
**https://gangdo98.github.io/fukuoka-trip/**

## 무엇이 들어 있나

- **일정표** — Day 1~4 타임라인. 장소별 영업시간·금연/예약 여부·호텔(일 팔라조) 기준 거리·메모, 장소별 Google 지도 링크, 일자별 경로 링크
- **지도** — Leaflet + OpenStreetMap(CARTO) 타일. API 키 없이 동작하고, 호텔과 일자별 장소를 색 핀·동선으로 표시. 일자 필터와 핀 팝업의 Google 지도 링크
- **쇼핑·포장** — 백화점 / 아카짱혼포 / 온라인 면세점 분리 구매, 카시트+베이스T, 참고 가격, 카고패스, 합포장·진에어 수하물·임산부 Priority 팁. 체크 상태는 브라우저(localStorage)에 저장
- **항공·숙소** — 진에어 왕복, 호텔 일 팔라조 3연박, 12/2(화) 10:00 예약 알림(한큐 유모차·트립트랩 / 나가마사 타베로그)

## 일정을 바꾸는 법

데이터와 화면이 분리되어 있습니다. **`data/trip.json`만 고치고 push하면** 사이트에 바로 반영됩니다.

```
data/trip.json
  meta      제목·날짜·마지막 업데이트
  hotel     숙소 정보(좌표 포함)
  flights   항공편
  days[]    일자별 일정
    └ items[]  time, title, place, kind, lat, lng, maps, hours,
               smoking, reservation, distance, memo, optional
  shopping  쇼핑 카드·주의사항·포장 팁·체크리스트
            baby 카테고리(그룹별 품목·가격·구매처), weights(실측 무게),
            luggage(포장 배치), links(참고 링크)
  booking   예약 알림·메모
```

- `kind`: `food` `meal` `shop` `sight` `move` `stay` `pack` 중 하나
- `taxFree`: 일정 항목이나 매장 카드에 넣으면 면세 위치·순서·주의가 초록 박스로 표시됩니다(객체 또는 배열).
- `lat`/`lng`가 있으면 지도 핀과 경로가 자동 생성됩니다.
- `maps`를 비우면 `place` 이름으로 Google 지도 검색 링크를 만듭니다.
- `optional: true`는 "여유 시" 항목(점선 핀).
- 바꾼 날 `meta.updated`도 같이 고쳐 주세요.

```bash
git add -A && git commit -m "일정 수정: ..." && git push
```

## 파일 구조

```
index.html      화면 뼈대, OG/Twitter 메타태그
styles.css      모바일 우선 스타일
app.js          trip.json을 읽어 렌더링, Leaflet 지도
data/trip.json  모든 여행 데이터
assets/         OG 이미지
```

## 배포

GitHub Pages — `main` 브랜치 `/` 루트. push 후 1~2분 내 반영됩니다.
