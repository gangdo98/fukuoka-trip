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

    // 환율 기준 한 줄 — 쇼핑/항공·숙소 탭에 같은 문구로 표시
    const fx = m.fx;
    if (fx) {
      const head = [fx.label, fx.rate, fx.source].filter(Boolean).join(' · ');
      ['#fxNoteShop', '#fxNoteBooking'].forEach((sel) => {
        const el = $(sel);
        if (!el) return;
        el.innerHTML = `<b>${esc(head)}</b>${fx.note ? `<span>${esc(fx.note)}</span>` : ''}`;
      });
    }
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

  function renderBaggage(target) {
    const b = trip.baggage;
    const el = $(target);
    if (!b || !el) return;
    el.innerHTML = `
      <div class="baggage__head">
        <h3>${esc(b.title)}</h3>
        ${b.lead ? `<p>${esc(b.lead)}</p>` : ''}
      </div>
      <ol class="baggage__list">
        ${b.items.map((i) => `
          <li>
            <span class="baggage__no">${esc(i.no)}</span>
            <div>
              <h4>${esc(i.title)}</h4>
              <p>${esc(i.body)}</p>
            </div>
          </li>`).join('')}
      </ol>`;
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
    renderBaggage('#shopBaggage');
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

    if (s.payment && $('#payment')) {
      if (s.payment.title && $('#paymentTitle')) $('#paymentTitle').textContent = s.payment.title;
      if ($('#paymentLead')) $('#paymentLead').textContent = s.payment.lead || '';
      $('#payment').innerHTML = s.payment.items.map((p) => `
        <article class="paycard">
          <h3>${esc(p.title)}</h3>
          <ul>${(p.points || []).map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
        </article>`).join('');
    }

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
      const depRow = input.closest('.dep__row');
      if (depRow) depRow.classList.toggle('is-done', input.checked);
      updateProgress();
      updateDepProgress();
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

  /* ---------------- departure (출국가방) ---------------- */
  const DEP_TAG_COLORS = { '필수': '#C8402F', '기내': '#3A4E7A', '위탁': '#9A6B2F', '현지': '#2F6D5B', '예약': '#B48A3C' };

  function renderDeparture() {
    const d = trip.departure;
    if (!d || !$('#depGroups')) return;
    if (d.headline) $('#depHeadline').textContent = d.headline;
    $('#depIntro').textContent = d.intro || '';
    $('#depFacts').innerHTML = (d.facts || []).map((f) => `
      <div class="depfact">
        <span class="depfact__label">${esc(f.label)}</span>
        <strong class="depfact__value">${esc(f.value)}</strong>
      </div>`).join('');

    renderBaggage('#depBaggage');

    $('#depGroups').innerHTML = d.groups.map((g) => {
      const items = g.items.map((it, i) => {
        const id = `dep:${g.id}:${i}`;
        const done = !!checks[id];
        const color = DEP_TAG_COLORS[it.tag] || '#7A6E62';
        return `
          <li>
            <label class="dep__row ${done ? 'is-done' : ''}">
              <input class="dep__check" type="checkbox" data-check="${esc(id)}" ${done ? 'checked' : ''}>
              <span class="dep__body">
                <span class="dep__label"><span class="dep__text">${esc(it.label)}</span>${it.tag ? `<em class="dep__tag" style="--c:${color}">${esc(it.tag)}</em>` : ''}</span>
                ${it.note ? `<span class="dep__note">${esc(it.note)}</span>` : ''}
              </span>
            </label>
          </li>`;
      }).join('');
      return `
        <article class="depgroup" id="dep-${esc(g.id)}">
          <header class="depgroup__head">
            <span class="depgroup__icon" aria-hidden="true">${esc(g.icon || '🧳')}</span>
            <div class="depgroup__title">
              <h3>${esc(g.name)}</h3>
              ${g.sub ? `<p>${esc(g.sub)}</p>` : ''}
            </div>
            <span class="depgroup__count" data-dep-count="${esc(g.id)}">0/${g.items.length}</span>
          </header>
          <div class="progress progress--thin" aria-hidden="true"><span data-dep-bar="${esc(g.id)}"></span></div>
          <ul class="dep__list">${items}</ul>
        </article>`;
    }).join('');

    if (d.notesTitle) $('#depNotesTitle').textContent = d.notesTitle;
    if ($('#depNotesLead')) $('#depNotesLead').textContent = d.notesLead || '';
    $('#depNotes').innerHTML = (d.notes || []).map((n) => `<li>${esc(n)}</li>`).join('');

    updateDepProgress();
  }

  function updateDepProgress() {
    const boxes = $$('#depGroups [data-check]');
    if (!boxes.length || !$('#depProgress')) return;
    const done = boxes.filter((b) => b.checked).length;
    const total = boxes.length;
    $('#depProgress').textContent = `${done} / ${total}`;
    $('#depBar').style.width = `${(done / total) * 100}%`;
    trip.departure.groups.forEach((g) => {
      const gb = boxes.filter((b) => b.dataset.check.startsWith(`dep:${g.id}:`));
      const gd = gb.filter((b) => b.checked).length;
      const count = $(`[data-dep-count="${g.id}"]`);
      const bar = $(`[data-dep-bar="${g.id}"]`);
      if (count) count.textContent = `${gd}/${gb.length}`;
      if (bar) bar.style.width = `${gb.length ? (gd / gb.length) * 100 : 0}%`;
      const card = $(`#dep-${g.id}`);
      if (card) card.classList.toggle('is-complete', gb.length > 0 && gd === gb.length);
    });
  }

  /* ---------------- booking ---------------- */
  function renderBooking() {
    const b = trip.booking;

    $('#flights').innerHTML = trip.flights.map((f) => `
      <article class="flight">
        <span class="flight__air">${esc(f.airline)}${f.flightNo ? ` ${esc(f.flightNo)}` : ''}</span>
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
        ${f.seats ? `<p class="flight__seat"><span>좌석</span>${esc(f.seats)}</p>` : ''}
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
        ${h.reservation ? `<div class="hotel-card__res">
          <p class="hotel-card__reshead">✓ ${esc(h.reservation.status)}</p>
          <div class="hotel-card__row"><b>예약번호</b><span>${esc(h.reservation.id)}</span></div>
          <div class="hotel-card__row"><b>투숙객</b><span>${esc(h.reservation.guest)}</span></div>
          <div class="hotel-card__row"><b>객실</b><span>${esc(h.reservation.room)}</span></div>
          ${h.reservation.extras ? `<div class="hotel-card__row"><b>포함</b><span>${esc(h.reservation.extras)}</span></div>` : ''}
          <div class="hotel-card__row"><b>결제</b><span>${esc(h.reservation.paid)}</span></div>
          <div class="hotel-card__row"><b>취소</b><span>${esc(h.reservation.cancel)}</span></div>
        </div>` : ''}
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
            ${(r.links || []).length ? `<div class="reminder__links">
              ${r.links.map((l) => `<a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)} ↗</a>`).join('')}
            </div>` : ''}
          </div>
        </article>`;
    }).join('');

    $('#bookingNotes').innerHTML = b.notes.map((n) => `<li>${esc(n)}</li>`).join('');

    const rem = b.reminders[0];
    if (rem) {
      const d = daysUntil(rem.date);
      const md = `${Number(rem.date.slice(5, 7))}월 ${Number(rem.date.slice(8, 10))}일(${rem.weekday})`;
      $('#reminderLead').textContent = d > 0
        ? `가장 가까운 일정은 ${md} ${rem.time} — ${rem.title} (${d}일 남음)`
        : `${md} ${rem.time} — ${rem.title}`;
    }
  }

  /* ---------------- 수하물 무게 계산기 (도완 폰 ↔ 명주 폰) ---------------- */
  const WC_KEY = 'fukuoka-luggage-v1';
  const WC_FB_CONFIG = {
    apiKey: 'AIzaSyCgZ6AYYIxzbEe135USUhTX_pB684zita8',
    authDomain: 'tosil-story.firebaseapp.com',
    databaseURL: 'https://tosil-story-default-rtdb.firebaseio.com',
    projectId: 'tosil-story',
    storageBucket: 'tosil-story.firebasestorage.app',
    messagingSenderId: '407302916302',
    appId: '1:407302916302:web:f62c3acaea531fae18689f'
  };
  // tosil-story의 체크 상태(tosil_story/state/checks)와 섞이지 않도록 여행 전용 경로에 씁니다.
  const WC_PATH = 'tosil_story/trip/fukuoka/luggage';
  const wc = {
    data: null, ref: null, wired: false, syncTried: false, seen: 0,
    pushTimer: null, delTimer: null, pendingRender: false,
    syncState: { state: 'off', text: '이 기기에만 저장' }
  };

  const wcConfig = () => (trip && trip.shopping ? trip.shopping.weightCalc : null);

  const wcNum = (v) => {
    const n = Number(String(v == null ? '' : v).replace(',', '.'));
    return isFinite(n) && n >= 0 ? Math.round(n * 10) / 10 : null;
  };
  const kgText = (n) => {
    const r = Math.round((Number(n) || 0) * 10) / 10;
    return Number.isInteger(r) ? String(r) : r.toFixed(1);
  };

  function wcDefaults() {
    const cfg = wcConfig() || {};
    const build = (src, kind) => ({
      total: Number(src && src.total) || 0,
      items: ((src && src.items) || []).map((it, i) => ({
        id: it.id || `${kind}-${i + 1}`,
        name: it.name || '',
        kg: Number(it.kg) || 0,
        note: it.note || ''
      }))
    });
    return { rev: 0, cabin: build(cfg.cabin, 'cabin'), checked: build(cfg.checked, 'checked') };
  }

  function wcNormalize(raw) {
    const def = wcDefaults();
    if (!raw || typeof raw !== 'object') return def;
    const one = (src, fb, kind) => {
      const s = src && typeof src === 'object' ? src : {};
      const list = Array.isArray(s.items) ? s.items
        : (s.items && typeof s.items === 'object' ? Object.keys(s.items).map((k) => s.items[k]) : []);
      const total = Number(s.total);
      return {
        total: isFinite(total) && total >= 0 ? Math.round(total * 10) / 10 : fb.total,
        items: list.filter((it) => it && typeof it === 'object').map((it, i) => ({
          id: String(it.id || `${kind}-${Date.now()}-${i}`),
          name: String(it.name == null ? '' : it.name),
          kg: isFinite(Number(it.kg)) && Number(it.kg) >= 0 ? Math.round(Number(it.kg) * 10) / 10 : 0,
          note: String(it.note == null ? '' : it.note)
        }))
      };
    };
    return {
      rev: Number(raw.rev) || 0,
      cabin: one(raw.cabin, def.cabin, 'cabin'),
      checked: one(raw.checked, def.checked, 'checked')
    };
  }

  function wcLoad() {
    try {
      const raw = JSON.parse(localStorage.getItem(WC_KEY));
      return raw ? wcNormalize(raw) : wcDefaults();
    } catch (e) { return wcDefaults(); }
  }
  function wcStore() {
    try { localStorage.setItem(WC_KEY, JSON.stringify(wc.data)); } catch (e) { /* 사생활 모드 */ }
  }

  function wcRows(kind) {
    const items = wc.data[kind].items;
    if (!items.length) {
      return `<li class="wc__empty">${kind === 'cabin' ? '아직 기내 아이템이 없어요.' : '아직 아이템이 없어요.'} 아래에서 이름과 무게를 넣어 추가하세요.</li>`;
    }
    return items.map((it) => `
      <li class="wc__row" data-id="${esc(it.id)}">
        <div class="wc__rowmain">
          <input class="wc__name" type="text" value="${esc(it.name)}" maxlength="40" autocomplete="off"
                 data-wc-field="name" data-id="${esc(it.id)}" data-kind="${kind}" aria-label="아이템 이름">
          <span class="wc__kgwrap">
            <input class="wc__kg" type="number" inputmode="decimal" step="0.1" min="0" value="${kgText(it.kg)}"
                   data-wc-field="kg" data-id="${esc(it.id)}" data-kind="${kind}" aria-label="무게 kg"><em>kg</em>
          </span>
          <button class="wc__del" type="button" data-wc-del="${esc(it.id)}" data-kind="${kind}" aria-label="${esc(it.name)} 삭제">✕</button>
        </div>
        ${it.note ? `<p class="wc__note">${esc(it.note)}</p>` : ''}
      </li>`).join('');
  }

  function wcCard(kind, cfg) {
    const state = wc.data[kind];
    const icon = kind === 'cabin' ? '🎒' : '🧳';
    return `
      <article class="wc wc--${kind}">
        <header class="wc__head">
          <span class="wc__icon" aria-hidden="true">${icon}</span>
          <div class="wc__title">
            <h3>${esc(cfg.label || (kind === 'cabin' ? '기내 수하물' : '위탁 수하물'))}</h3>
            ${cfg.hint ? `<p>${esc(cfg.hint)}</p>` : ''}
          </div>
        </header>
        <div class="wc__stats">
          <label class="wc__allow">
            <span>${esc(cfg.totalLabel || '총 허용')}</span>
            <span class="wc__allowrow"><input type="number" inputmode="decimal" step="0.5" min="0"
              data-wc-total="${kind}" value="${kgText(state.total)}"><em>kg</em></span>
          </label>
          <div class="wc__stat"><span>사용</span><strong data-wc-used="${kind}">0kg</strong></div>
          <div class="wc__stat"><span>잔여</span><strong data-wc-left="${kind}">0kg</strong></div>
        </div>
        <div class="wc__meter" aria-hidden="true"><span data-wc-bar="${kind}"></span></div>
        <ul class="wc__list" data-wc-list="${kind}">${wcRows(kind)}</ul>
        <form class="wc__add" data-wc-add="${kind}">
          <input type="text" data-wc-new="name" placeholder="아이템 이름" maxlength="40" autocomplete="off" aria-label="추가할 아이템 이름">
          <div class="wc__addrow">
            <input type="number" inputmode="decimal" step="0.1" min="0" data-wc-new="kg" placeholder="무게" aria-label="추가할 아이템 무게 kg">
            <em>kg</em>
            <button type="submit">추가</button>
          </div>
        </form>
      </article>`;
  }

  function wcPaintSync() {
    const el = $('#wcSync');
    if (!el) return;
    el.dataset.state = wc.syncState.state;
    const t = $('.wc__synctext', el);
    if (t) t.textContent = wc.syncState.text;
  }

  function wcPaint() {
    ['cabin', 'checked'].forEach((kind) => {
      const state = wc.data[kind];
      const used = state.items.reduce((s, it) => s + (Number(it.kg) || 0), 0);
      const total = Number(state.total) || 0;
      const left = Math.round((total - used) * 10) / 10;
      const usedEl = $(`[data-wc-used="${kind}"]`);
      const leftEl = $(`[data-wc-left="${kind}"]`);
      const bar = $(`[data-wc-bar="${kind}"]`);
      if (usedEl) usedEl.textContent = `${kgText(used)}kg`;
      if (leftEl) {
        leftEl.textContent = left >= 0 ? `${kgText(left)}kg` : `초과 ${kgText(-left)}kg`;
        leftEl.classList.toggle('is-over', left < 0);
      }
      if (bar) {
        bar.style.width = `${total > 0 ? Math.min(100, (used / total) * 100) : 0}%`;
        bar.classList.toggle('is-over', left < 0);
      }
    });
  }

  function wcRender() {
    const host = $('#weightCalc');
    const cfg = wcConfig();
    if (!host) return;
    if (!cfg || !wc.data) { host.innerHTML = ''; return; }
    host.innerHTML = `
      <div class="wcalc__bar">
        <p class="wcalc__lead">${esc(cfg.lead || '')}</p>
        <span class="wcalc__sync" id="wcSync" data-state="off"><i aria-hidden="true"></i><span class="wc__synctext">이 기기에만 저장</span></span>
      </div>
      <div class="wcalc__grid">
        ${wcCard('cabin', cfg.cabin || {})}
        ${wcCard('checked', cfg.checked || {})}
      </div>
      ${(cfg.tips || []).length ? `<div class="wcalc__tips">
        <p class="wcalc__tipshead">💡 ${esc(cfg.tipsTitle || 'TIP')}</p>
        <ul>${cfg.tips.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
      </div>` : ''}`;
    wcPaint();
    wcPaintSync();
  }

  function wcPush() {
    if (!wc.ref) return;
    // 폰 시계 차이에 흔들리지 않도록 "본 적 있는 최신 번호 + 1"로 올립니다.
    wc.data.rev = Math.max(Number(wc.data.rev) || 0, Number(wc.seen) || 0) + 1;
    wcStore();
    try {
      wc.ref.set(wc.data).catch(() => {
        wc.syncState = { state: 'off', text: '동기화 안 됨 · 이 폰에만 저장' };
        wcPaintSync();
      });
    } catch (e) { /* 오프라인이면 localStorage에만 남아요 */ }
  }
  function wcPushSoon() {
    clearTimeout(wc.pushTimer);
    wc.pushTimer = setTimeout(wcPush, 700);
  }

  function wcApplyRemote(raw) {
    const next = wcNormalize(raw);
    if (!next.rev) return false;
    if (next.rev <= wc.data.rev) return false;
    wc.data = next;
    wcStore();
    const host = $('#weightCalc');
    if (host && host.contains(document.activeElement)) wc.pendingRender = true;
    else wcRender();
    return true;
  }

  function wcInitSync() {
    if (wc.syncTried) return;
    wc.syncTried = true;
    if (!window.firebase || typeof window.firebase.database !== 'function') {
      wc.syncState = { state: 'off', text: '이 기기에만 저장' };
      wcPaintSync();
      return;
    }
    try {
      const app = firebase.apps && firebase.apps.length ? firebase.app() : firebase.initializeApp(WC_FB_CONFIG);
      const db = firebase.database(app);
      wc.ref = db.ref(WC_PATH);

      db.ref('.info/connected').on('value', (snap) => {
        const on = snap.val() === true;
        wc.syncState = on
          ? { state: 'on', text: '부부 실시간 동기화 중' }
          : { state: 'off', text: '연결 대기 중 · 이 폰에 저장' };
        wcPaintSync();
      });

      wc.ref.on('value', (snap) => {
        const val = snap.val();
        if (!val || typeof val !== 'object' || val.rev == null) {
          wcPush();   // DB가 비어 있으면 이 폰 목록을 올려 둬요
          return;
        }
        wc.seen = Number(val.rev) || 0;
        if (wcApplyRemote(val)) return;
        if ((Number(wc.data.rev) || 0) > wc.seen) wcPush();  // 오프라인에 고친 내 목록이 더 최신
      }, () => {
        wc.syncState = { state: 'off', text: '동기화 안 됨 · 이 폰에만 저장' };
        wcPaintSync();
      });
    } catch (e) {
      wc.syncState = { state: 'off', text: '이 기기에만 저장' };
      wcPaintSync();
    }
  }

  function wcSetField(kind, id, field, value) {
    const state = wc.data[kind];
    if (!state) return;
    const item = state.items.find((it) => it.id === id);
    if (!item) return;
    if (field === 'name') item.name = value;
    else {
      const n = wcNum(value);
      if (n === null) return;
      item.kg = n;
    }
    wcPaint();
    wcStore();
    wcPushSoon();
  }

  function wireWeightCalc() {
    if (wc.wired) return;
    const host = $('#weightCalc');
    if (!host) return;
    wc.wired = true;

    host.addEventListener('input', (e) => {
      const field = e.target.closest('[data-wc-field]');
      if (field) {
        wcSetField(field.dataset.kind, field.dataset.id, field.dataset.wcField, field.value);
        return;
      }
      const total = e.target.closest('[data-wc-total]');
      if (total) {
        const n = wcNum(total.value);
        if (n === null) return;
        wc.data[total.dataset.wcTotal].total = n;
        wcPaint(); wcStore(); wcPushSoon();
      }
    });

    host.addEventListener('change', (e) => {
      const kg = e.target.closest('[data-wc-field="kg"]');
      if (kg && wcNum(kg.value) !== null) kg.value = kgText(wcNum(kg.value));
    });

    host.addEventListener('click', (e) => {
      const del = e.target.closest('[data-wc-del]');
      if (!del) return;
      e.preventDefault();
      if (del.dataset.armed !== '1') {
        $$('[data-wc-del]', host).forEach((b) => {
          if (b !== del) { delete b.dataset.armed; b.textContent = '✕'; b.classList.remove('is-armed'); }
        });
        del.dataset.armed = '1';
        del.textContent = '삭제?';
        del.classList.add('is-armed');
        clearTimeout(wc.delTimer);
        wc.delTimer = setTimeout(() => {
          if (del.isConnected) { delete del.dataset.armed; del.textContent = '✕'; del.classList.remove('is-armed'); }
        }, 5000);
        return;
      }
      const kind = del.dataset.kind;
      const id = del.dataset.wcDel;
      const item = wc.data[kind].items.find((it) => it.id === id);
      wc.data[kind].items = wc.data[kind].items.filter((it) => it.id !== id);
      wcStore();
      wcRender();
      wcPushSoon();
      toast(`${item && item.name ? item.name + ' ' : ''}삭제했어요`);
    });

    host.addEventListener('submit', (e) => {
      const form = e.target.closest('[data-wc-add]');
      if (!form) return;
      e.preventDefault();
      const kind = form.dataset.wcAdd;
      const nameEl = form.querySelector('[data-wc-new="name"]');
      const kgEl = form.querySelector('[data-wc-new="kg"]');
      const name = (nameEl.value || '').trim();
      const kg = wcNum(kgEl.value || '0');
      if (!name) { nameEl.focus(); toast('아이템 이름을 먼저 적어 주세요'); return; }
      if (kg === null) { kgEl.focus(); toast('무게는 숫자로 적어 주세요'); return; }
      wc.data[kind].items.push({
        id: `u-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
        name, kg, note: ''
      });
      wcStore();
      wcRender();
      wcPushSoon();
      toast(`${name} ${kgText(kg)}kg 추가했어요`);
    });

    host.addEventListener('focusout', () => {
      setTimeout(() => {
        if (wc.pendingRender && !host.contains(document.activeElement)) {
          wc.pendingRender = false;
          wcRender();
        }
      }, 0);
    });
  }

  function renderWeightCalc() {
    const host = $('#weightCalc');
    if (!host) return;
    if (!wc.data) wc.data = wcLoad();
    wcRender();
    wireWeightCalc();
    wcInitSync();
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
    if (['map', 'shopping', 'departure', 'booking'].includes(h)) showTab(h, false);
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
    renderWeightCalc();
    renderDeparture();
    renderBooking();
    wireTabs();
    if (location.hash === '#map') showTab('map', false);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
