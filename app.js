/* 후쿠오카 3박 4일 — data/trip.json 하나만 고치면 페이지가 바뀝니다. */
(() => {
  'use strict';

  const DATA_URL = 'data/trip.json';
  const STORE_KEY = 'fukuoka-trip-checks-v1';
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  const KIND_LABEL = {
    food: '식사', meal: '식사', shop: '쇼핑', sight: '산책',
    move: '이동', stay: '숙소', pack: '포장'
  };
  const STORE_COLORS = { dept: '#C8402F', akachan: '#2F6D5B', online: '#3A4E7A', laraport: '#9A6B2F', mixed: '#4A423A' };

  let trip = null;
  let map = null;
  let mapBuilt = false;
  let activeFilter = 'all';
  const dayLayers = new Map();   // dayId -> {markers, line, bounds}
  const checks = loadChecks();

  /* ---------------- utils ---------------- */
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  const mapsLink = (text) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(text)}`;

  function loadChecks() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; }
    catch (e) { return {}; }
  }
  function saveChecks() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(checks)); } catch (e) { /* 사생활 모드 */ }
  }

  function toast(msg) {
    const el = $('#toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('is-on');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove('is-on'), 2200);
  }

  function kstDateParts(d) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(d);
    const get = (t) => Number(parts.find((p) => p.type === t).value);
    return Date.UTC(get('year'), get('month') - 1, get('day'));
  }

  function daysUntil(targetIso) {
    const now = kstDateParts(new Date());
    const t = new Date(targetIso + 'T00:00:00+09:00');
    const target = kstDateParts(t);
    return Math.round((target - now) / 86400000);
  }

  /* ---------------- hero / meta ---------------- */
  function renderMeta() {
    const m = trip.meta;
    $('#heroKicker').textContent = m.kicker;
    $('#heroTitle').innerHTML = esc(m.title.split(' ')[0]) + ' <em>' + esc(m.title.split(' ').slice(1).join(' ')) + '</em>';
    $('#heroSub').textContent = m.subtitle;
    $('#heroDates').textContent = m.datesFull;
    $('#heroTravelers').textContent = m.travelers;
    $('#heroBase').textContent = m.base;
    $('#intro').textContent = m.intro;
    $('#updated').textContent = m.updated;
    $('#footerDates').textContent = m.datesShort.replace(/ – /g, ' – ');
    $('#shareBtn').addEventListener('click', sharePage);

    const d = daysUntil('2027-01-07');
    $('#dday').textContent = d > 0 ? `D-${d}` : d === 0 ? 'D-DAY' : `D+${-d}`;
  }

  async function sharePage() {
    const url = location.href.split('#')[0];
    const payload = {
      title: '후쿠오카 3박 4일 · 2027.01.07–10',
      text: '도완 & 아내의 겨울 후쿠오카 일정',
      url
    };
    if (navigator.share) {
      try { await navigator.share(payload); return; }
      catch (err) { if (err && err.name === 'AbortError') return; }
    }
    try {
      await navigator.clipboard.writeText(url);
      toast('링크를 복사했어요. 카톡에 붙여 넣으면 됩니다.');
    } catch (err) {
      toast(url);
    }
  }

  /* ---------------- itinerary ---------------- */
  function routeUrl(day) {
    const collect = (includeOptional) => {
      const pts = [];
      day.items.forEach((it) => {
        if (typeof it.lat !== 'number' || typeof it.lng !== 'number') return;
        if (!includeOptional && it.optional) return;
        const last = pts[pts.length - 1];
        if (last && last.lat === it.lat && last.lng === it.lng) return;
        pts.push(it);
      });
      return pts;
    };
    let pts = collect(false);
    if (pts.length < 2) pts = collect(true);
    if (pts.length < 2) return null;
    // 마지막 날을 뺀 나머지는 호텔로 돌아오는 경로로 마무리
    if (day.id !== 'day4' && trip && trip.hotel) {
      const last = pts[pts.length - 1];
      if (last.lat !== trip.hotel.lat || last.lng !== trip.hotel.lng) {
        pts = pts.concat([{ lat: trip.hotel.lat, lng: trip.hotel.lng }]);
      }
    }
    const origin = pts[0];
    const dest = pts[pts.length - 1];
    const coord = (p) => `${p.lat},${p.lng}`;
    const mid = pts.slice(1, -1)
      .filter((p) => coord(p) !== coord(origin) && coord(p) !== coord(dest))
      .slice(0, 9);
    let url = `https://www.google.com/maps/dir/?api=1&origin=${coord(origin)}&destination=${coord(dest)}`;
    if (mid.length) url += `&waypoints=${mid.map(coord).join('%7C')}`;
    url += `&travelmode=${day.travelmode || 'walking'}`;
    return url;
  }

  /* 면세(텍스리펀) 안내 — 일정 카드와 매장 카드에서 같은 모양으로 씁니다. */
  function taxFreeBlocks(tf) {
    if (!tf) return '';
    const list = Array.isArray(tf) ? tf : [tf];
    return list.map((t) => {
      const steps = (t.steps || []).map((s) => `<li>${esc(s)}</li>`).join('');
      const notes = (t.notes || []).map((n) => `<li>${esc(n)}</li>`).join('');
      return `
        <div class="taxfree">
          <div class="taxfree__head">
            <span class="taxfree__badge">TAX FREE</span>
            ${t.place ? `<span class="taxfree__place">${esc(t.place)}</span>` : ''}
          </div>
          ${t.where ? `<p class="taxfree__where">${esc(t.where)}</p>` : ''}
          ${steps ? `<ol class="taxfree__steps">${steps}</ol>` : ''}
          ${notes ? `<ul class="taxfree__notes">${notes}</ul>` : ''}
        </div>`;
    }).join('');
  }

  function metaChips(it) {
    const chips = [];
    if (it.hours) chips.push(`<li><span aria-hidden="true">⏰</span>${esc(it.hours)}</li>`);
    if (it.distance) {
      const icon = /차량|택시/.test(it.distance) && !/도보/.test(it.distance) ? '🚕' : '🚶';
      chips.push(`<li><span aria-hidden="true">${icon}</span>${esc(it.distance)}</li>`);
    }
    if (it.smoking) chips.push(`<li class="prohibit"><span aria-hidden="true">🚭</span>${esc(it.smoking)}</li>`);
    if (it.reservation) chips.push(`<li><span aria-hidden="true">📅</span>${esc(it.reservation)}</li>`);
    return chips.length ? `<ul class="meta">${chips.join('')}</ul>` : '';
  }

  function renderItinerary() {
    const host = $('#days');
    host.innerHTML = trip.days.map((day) => {
      const stops = [];
      day.items.forEach((it) => {
        const link = it.maps || (it.place ? mapsLink(`${it.place}, Fukuoka`) : null);
        stops.push(`
          <li class="stop" data-optional="${it.optional ? 'true' : 'false'}" style="--day:${day.color}">
            <div class="stop__rail"><span class="stop__dot" aria-hidden="true"></span></div>
            <div class="stop__body">
              <div class="stop__time">${esc(it.time || '')}</div>
              <div class="stop__card">
                <div class="stop__head">
                  <h3 class="stop__title">${esc(it.title)}</h3>
                  <span class="stop__kind">${esc(KIND_LABEL[it.kind] || '일정')}</span>
                </div>
                ${it.place ? `<p class="stop__place"><svg width="11" height="11" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2a7 7 0 0 0-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 0 0-7-7Zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5Z"/></svg>${esc(it.place)}</p>` : ''}
                ${metaChips(it)}
                ${taxFreeBlocks(it.taxFree)}
                ${it.memo ? `<p class="stop__memo">${esc(it.memo)}</p>` : ''}
                ${link ? `<div class="stop__actions"><a class="btn" href="${esc(link)}" target="_blank" rel="noopener" style="--day:${day.color}">Google 지도 열기 ↗</a></div>` : ''}
              </div>
            </div>
          </li>`);
      });

      const route = routeUrl(day);
      return `
        <article class="day" id="${esc(day.id)}" style="--day:${day.color}">
          <header class="day__head">
            <span class="day__badge">DAY ${day.dayNo}</span>
            <div>
              <p class="day__date">${esc(day.dateShort)} (${esc(day.weekday)})</p>
              <h2 class="day__title">${esc(day.title)}</h2>
              <p class="day__sub">${esc(day.subtitle)}</p>
            </div>
          </header>
          ${route ? `<a class="route-btn" href="${esc(route)}" target="_blank" rel="noopener" style="--day:${day.color}">
              <span aria-hidden="true">🗺️</span> ${day.dayNo}일차 경로 한 번에 열기 <span>Google 지도</span>
            </a>` : ''}
          <ol class="timeline">${stops.join('')}</ol>
        </article>`;
    }).join('');
  }

  /* ---------------- map ---------------- */
  function buildMapLayers() {
    const allBounds = L.latLngBounds([]);
    trip.days.forEach((day) => {
      const pts = [];
      const seen = new Set();
      const markers = [];
      let num = 0;
      day.items.forEach((it) => {
        if (typeof it.lat !== 'number' || typeof it.lng !== 'number') return;
        pts.push([it.lat, it.lng]);
        const key = `${it.lat},${it.lng}`;
        if (seen.has(key)) return;
        seen.add(key);
        // 호텔 좌표는 지도에서 별도 ★ 핀으로 표시하므로 중복 핀을 만들지 않음
        if (it.lat === trip.hotel.lat && it.lng === trip.hotel.lng) return;
        num += 1;
        const icon = L.divIcon({
          className: '',
          html: `<div class="pin${it.optional ? ' pin--opt' : ''}" style="--pin:${day.color}">${num}</div>`,
          iconSize: [28, 28], iconAnchor: [14, 14], popupAnchor: [0, -14]
        });
        const m = L.marker([it.lat, it.lng], { icon, title: it.title, alt: it.title });
        const link = it.maps || (it.place ? mapsLink(`${it.place}, Fukuoka`) : mapsLink(it.title));
        m.bindPopup(`
          <div class="pop" style="--pin:${day.color}">
            <span class="pop__day">DAY ${day.dayNo} · ${esc(it.time || '')}</span>
            <strong class="pop__title">${esc(it.title)}</strong>
            ${it.hours ? `<p class="pop__meta">${esc(it.hours)}</p>` : ''}
            ${it.distance ? `<p class="pop__meta">${esc(it.distance)}</p>` : ''}
            <a class="pop__link" href="${esc(link)}" target="_blank" rel="noopener">Google 지도에서 열기 ↗</a>
          </div>`);
        markers.push(m);
      });

      if (pts.length) {
        const line = L.polyline(pts, {
          color: day.color, weight: 3, opacity: 0.72,
          lineJoin: 'round', dashArray: day.dayNo === 4 ? '6 6' : null
        });
        const bounds = L.latLngBounds(pts);
        allBounds.extend(bounds);
        dayLayers.set(day.id, { markers, line, bounds });
      }
    });

    // 호텔은 따로 강조
    const h = trip.hotel;
    const hotelIcon = L.divIcon({
      className: '', html: '<div class="pin pin--hotel">★</div>',
      iconSize: [34, 34], iconAnchor: [17, 17], popupAnchor: [0, -16]
    });
    const hotelMarker = L.marker([h.lat, h.lng], { icon: hotelIcon, title: h.name, zIndexOffset: 500 })
      .bindPopup(`
        <div class="pop" style="--pin:#241F1B">
          <span class="pop__day">우리 숙소 · 3연박</span>
          <strong class="pop__title">${esc(h.name)}</strong>
          <p class="pop__meta">체크인 ${esc(h.checkIn)} · 체크아웃 ${esc(h.checkOut)}</p>
          <p class="pop__meta">${esc(h.addressKr)}</p>
          <a class="pop__link" href="${esc(h.mapsUrl)}" target="_blank" rel="noopener">Google 지도에서 열기 ↗</a>
        </div>`);
    dayLayers.set('hotel', { markers: [hotelMarker], line: null, bounds: L.latLngBounds([[h.lat, h.lng]]) });
    allBounds.extend([h.lat, h.lng]);
    dayLayers.set('all', { markers: [], line: null, bounds: allBounds });
  }

  function initMap() {
    if (map) return;
    const el = $('#map');
    if (!el) return;
    if (typeof L === 'undefined') {
      el.innerHTML = '<p style="padding:30px;text-align:center;color:#7A6E62;font-size:13px">지도를 불러오지 못했어요. 인터넷 연결을 확인해 주세요.</p>';
      return;
    }
    map = L.map(el, { scrollWheelZoom: true, zoomSnap: 0.5 }).setView([33.588, 130.405], 13);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors'
    }).addTo(map);
    buildMapLayers();
    applyFilter(activeFilter);
    setTimeout(() => map.invalidateSize(), 160);
  }

  function applyFilter(filter) {
    if (!map) return;
    activeFilter = filter;
    dayLayers.forEach((layer, key) => {
      if (key === 'all') return;
      const show = filter === 'all' ? true : (key === filter || key === 'hotel');
      layer.markers.forEach((m) => {
        if (show) m.addTo(map); else if (map.hasLayer(m)) map.removeLayer(m);
      });
      if (layer.line) {
        if (show) layer.line.addTo(map); else if (map.hasLayer(layer.line)) map.removeLayer(layer.line);
      }
    });
    const target = filter === 'all'
      ? dayLayers.get('all')
      : combineBounds([filter, 'hotel']);
    if (target && target.bounds && target.bounds.isValid()) {
      map.fitBounds(target.bounds.pad(0.16), { maxZoom: filter === 'all' ? 14 : 15 });
    }
  }

  function combineBounds(keys) {
    const b = L.latLngBounds([]);
    keys.forEach((k) => {
      const l = dayLayers.get(k);
      if (l && l.bounds && l.bounds.isValid()) b.extend(l.bounds);
    });
    return { bounds: b };
  }

  function renderMapFilters() {
    const host = $('#mapFilters');
    const legend = $('#mapLegend');
    host.innerHTML = `<button class="fchip is-active" type="button" data-filter="all">전체</button>` +
      trip.days.map((d) => `<button class="fchip" type="button" data-filter="${esc(d.id)}" data-day style="--day:${d.color}">Day ${d.dayNo}</button>`).join('');
    host.addEventListener('click', (e) => {
      const btn = e.target.closest('.fchip');
      if (!btn) return;
      $$('.fchip', host).forEach((b) => b.classList.toggle('is-active', b === btn));
      applyFilter(btn.dataset.filter);
    });
    legend.innerHTML = `<span><i style="background:#241F1B"></i>호텔 일 팔라조</span>` +
      trip.days.map((d) => `<span><i style="background:${d.color}"></i>Day ${d.dayNo} · ${esc(d.dateShort)}</span>`).join('');
  }

  /* ---------------- shopping ---------------- */
  function renderBaby() {
    const b = trip.shopping.baby;
    if (!b) return;
    $('#babyTitle').textContent = b.title;
    $('#babyIntro').textContent = b.intro || '';
    $('#babyGroups').innerHTML = b.groups.map((g) => {
      const items = g.items.map((it) => {
        const color = STORE_COLORS[it.shop] || '#4A423A';
        return `
          <li class="baby__item">
            <div class="baby__row">
              <span class="baby__name">${esc(it.name)}</span>
              ${it.place ? `<span class="baby__shop" style="--c:${color}">${esc(it.place)}</span>` : ''}
            </div>
            ${it.price ? `<p class="baby__price">${esc(it.price)}</p>` : ''}
            ${it.note ? `<p class="baby__note">${esc(it.note)}</p>` : ''}
          </li>`;
      }).join('');
      return `
        <article class="babygroup">
          <header class="babygroup__head">
            <span class="babygroup__icon" aria-hidden="true">${esc(g.icon || '🍼')}</span>
            <div class="babygroup__title">
              <h3>${esc(g.name)}</h3>
              ${g.sub ? `<p>${esc(g.sub)}</p>` : ''}
            </div>
            <span class="babygroup__count">${g.items.length}</span>
          </header>
          <ul class="baby__list">${items}</ul>
        </article>`;
    }).join('');
  }

  function renderLoadPlan() {
    const w = trip.shopping.weights;
    const l = trip.shopping.luggage;
    if (w && $('#weightCard')) {
      $('#weightCard').innerHTML = `
        <div class="weight-card__head">
          <h3>${esc(w.title)}</h3>
          ${w.lead ? `<p>${esc(w.lead)}</p>` : ''}
        </div>
        <ul class="weight-list">
          ${w.items.map((i) => `
            <li>
              <span class="weight-list__name">${esc(i.name)}${i.memo ? `<em>${esc(i.memo)}</em>` : ''}</span>
              <span class="weight-list__kg">${esc(i.kg)}</span>
            </li>`).join('')}
        </ul>
        ${w.note ? `<p class="weight-card__note">${esc(w.note)}</p>` : ''}`;
    }
    if (l && $('#luggage')) {
      $('#luggage').innerHTML = l.items.map((i) => `
        <article class="lug">
          <header class="lug__head">
            <span class="lug__tag">${esc(i.tag)}</span>
            ${i.kg ? `<span class="lug__kg">${esc(i.kg)}</span>` : ''}
            <h3>${esc(i.title)}</h3>
          </header>
          <ul class="lug__list">${i.body.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>
        </article>`).join('');
    }
  }

  function renderShoppingLinks() {
    const s = trip.shopping;
    if (!s.links || !$('#refLinks')) return;
    if (s.linksTitle) $('#linksTitle').textContent = s.linksTitle;
    $('#refLinks').innerHTML = s.links.map((l) => `
      <a class="reflink" href="${esc(l.url)}" target="_blank" rel="noopener">
        <span class="reflink__icon" aria-hidden="true">🔗</span>
        <span class="reflink__body">
          <span class="reflink__title">${esc(l.title)}</span>
          ${l.desc ? `<span class="reflink__desc">${esc(l.desc)}</span>` : ''}
        </span>
        <span class="reflink__go" aria-hidden="true">↗</span>
      </a>`).join('');
  }

  function renderShopping() {
    const s = trip.shopping;
    $('#shopHeadline').textContent = s.headline;
    $('#shopIntro').textContent = s.intro;

    renderBaby();
    renderLoadPlan();
    renderShoppingLinks();

    $('#shoppingStores').innerHTML = s.stores.map((store) => {
      const color = STORE_COLORS[store.id] || '#C8402F';
      const items = store.items.map((item, i) => {
        const id = `shop:${store.id}:${i}`;
        const done = !!checks[id];
        return `
          <label class="buy__row ${done ? 'is-done' : ''}" style="--accent:${color}">
            <input class="buy__check" type="checkbox" data-check="${esc(id)}" ${done ? 'checked' : ''}>
            <span class="buy__name">${esc(item.name)}${item.note ? `<span class="buy__note">${esc(item.note)}</span>` : ''}</span>
            ${item.price ? `<span class="buy__price">${esc(item.price)}</span>` : '<span></span>'}
          </label>`;
      }).join('');
      return `
        <article class="store" style="--accent:${color}">
          <span class="store__tag">${esc(store.tag)}</span>
          <h3>${esc(store.name)}</h3>
          <p class="store__place">${esc(store.place)}</p>
          ${taxFreeBlocks(store.taxFree)}
          <div class="buy">${items}</div>
          <p class="store__why"><b>왜 여기서?</b> ${esc(store.why)}</p>
          <ul class="cautions">${store.cautions.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>
        </article>`;
    }).join('');

    $('#shopRules').innerHTML = s.rules.map((r, i) => `
      <article class="rule">
        <p class="rule__num">0${i + 1}</p>
        <h3>${esc(r.title)}</h3>
        <p>${esc(r.body)}</p>
      </article>`).join('');

    $('#packing').innerHTML = s.packing.map((p) => `
      <article class="pack">
        <span class="pack__icon" aria-hidden="true">${esc(p.icon)}</span>
        <div><h3>${esc(p.title)}</h3><p>${esc(p.body)}</p></div>
      </article>`).join('');

    $('#checklistTitle').textContent = s.checklistTitle;
    $('#packList').innerHTML = s.checklist.map((label, i) => {
      const id = `pack:${i}`;
      const done = !!checks[id];
      return `<li><label><input type="checkbox" data-check="${esc(id)}" ${done ? 'checked' : ''}><span>${esc(label)}</span></label></li>`;
    }).join('');

    document.addEventListener('change', (e) => {
      const input = e.target.closest('[data-check]');
      if (!input) return;
      const id = input.dataset.check;
      if (input.checked) checks[id] = true; else delete checks[id];
      saveChecks();
      if (input.classList.contains('buy__check')) {
        input.closest('.buy__row').classList.toggle('is-done', input.checked);
      }
      updateProgress();
    });
    updateProgress();
  }

  function updateProgress() {
    const boxes = $$('#packList [data-check]');
    if (!boxes.length) return;
    const done = boxes.filter((b) => b.checked).length;
    $('#packProgress').textContent = `${done} / ${boxes.length}`;
    $('#packBar').style.width = `${(done / boxes.length) * 100}%`;
  }

  /* ---------------- booking ---------------- */
  function renderBooking() {
    const b = trip.booking;

    $('#flights').innerHTML = trip.flights.map((f) => `
      <article class="flight">
        <span class="flight__air">${esc(f.airline)}</span>
        <p class="flight__dir">${esc(f.dir)}</p>
        <p class="flight__date">${esc(f.date)}</p>
        <div class="flight__route">
          <div class="flight__pt">
            <p class="flight__code">${esc(f.fromCode)}</p>
            <p class="flight__time">${esc(f.depart)} ${esc(f.fromName)}</p>
          </div>
          <div class="flight__line" aria-hidden="true"></div>
          <div class="flight__pt" style="text-align:right">
            <p class="flight__code">${esc(f.toCode)}</p>
            <p class="flight__time">${esc(f.arrive)} ${esc(f.toName)}</p>
          </div>
        </div>
        <p class="flight__memo">${esc(f.memo)}</p>
      </article>`).join('');

    const h = trip.hotel;
    $('#hotelCard').innerHTML = `
      <div class="hotel-card__top">
        <p class="hotel-card__label">STAY · 3 NIGHTS</p>
        <h3>${esc(h.name)}</h3>
        <p class="hotel-card__en">${esc(h.nameEn)}</p>
        <p class="hotel-card__stay">${esc(h.stay)}</p>
      </div>
      <div class="hotel-card__body">
        <div class="hotel-card__row"><b>체크인</b><span>${esc(h.checkIn)} · 체크아웃 ${esc(h.checkOut)}</span></div>
        <div class="hotel-card__row"><b>주소</b><span>${esc(h.addressKr)}</span></div>
        <div class="hotel-card__perks">${h.perks.map((p) => `<span>${esc(p)}</span>`).join('')}</div>
        <div class="hotel-card__row"><b>메모</b><span>${esc(h.memo)}</span></div>
        <a class="hotel-card__link" href="${esc(h.mapsUrl)}" target="_blank" rel="noopener">Google 지도에서 보기 ↗</a>
      </div>`;

    $('#reminders').innerHTML = b.reminders.map((r) => {
      const d = daysUntil(r.date);
      const badge = d > 0 ? `D-${d}` : d === 0 ? '오늘' : `D+${-d}`;
      const month = Number(r.date.slice(5, 7));
      const day = Number(r.date.slice(8, 10));
      return `
        <article class="reminder">
          <div class="reminder__date">
            <p class="reminder__d">${month}/${day}</p>
            <p class="reminder__t">${esc(r.weekday)} ${esc(r.time)}</p>
          </div>
          <div>
            <span class="reminder__badge">${badge} · 예약</span>
            <h3>${esc(r.title)}</h3>
            <p>${esc(r.detail)}</p>
            <div class="reminder__links">
              ${r.links.map((l) => `<a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)} ↗</a>`).join('')}
            </div>
          </div>
        </article>`;
    }).join('');

    $('#bookingNotes').innerHTML = b.notes.map((n) => `<li>${esc(n)}</li>`).join('');

    const rem = b.reminders[0];
    if (rem) {
      const d = daysUntil(rem.date);
      $('#reminderLead').textContent = d > 0
        ? `${rem.date.slice(5, 7)}월 ${Number(rem.date.slice(8, 10))}일(${rem.weekday}) ${rem.time}, 두 가지를 한 번에 예약합니다. (${d}일 남음)`
        : `${rem.date.slice(5, 7)}월 ${Number(rem.date.slice(8, 10))}일(${rem.weekday}) ${rem.time} 예약 건입니다.`;
    }
  }

  /* ---------------- tabs ---------------- */
  function showTab(name, push = true) {
    const panel = $(`#panel-${name}`);
    if (!panel) return;
    $$('.tab').forEach((t) => {
      const on = t.dataset.tab === name;
      t.classList.toggle('is-active', on);
      t.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    $$('.panel').forEach((p) => {
      const on = p.id === `panel-${name}`;
      p.classList.toggle('is-active', on);
      p.hidden = !on;
    });
    if (name === 'map') {
      initMap();
      if (map) setTimeout(() => map.invalidateSize(), 180);
    }
    const tabsH = $('.tabs').getBoundingClientRect().height || 62;
    const top = panel.getBoundingClientRect().top + window.scrollY - tabsH - 4;
    window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    if (push) history.replaceState(null, '', name === 'itinerary' ? location.pathname + location.search : `#${name}`);
  }

  function wireTabs() {
    $$('.tab').forEach((t) => t.addEventListener('click', () => showTab(t.dataset.tab)));
    const h = (location.hash || '').replace('#', '');
    if (['map', 'shopping', 'booking'].includes(h)) showTab(h, false);
  }

  /* ---------------- boot ---------------- */
  async function boot() {
    try {
      const res = await fetch(DATA_URL, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      trip = await res.json();
    } catch (err) {
      $('#days').innerHTML = `<p class="loading">일정 데이터를 불러오지 못했어요. (${esc(err.message)})<br>잠시 후 새로고침해 주세요.</p>`;
      return;
    }
    renderMeta();
    renderItinerary();
    renderMapFilters();
    renderShopping();
    renderBooking();
    wireTabs();
    if (location.hash === '#map') showTab('map', false);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
