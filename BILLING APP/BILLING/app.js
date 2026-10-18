/* Latesto Drycleaners - Dry Cleaning Management System
   Data is stored in the browser's localStorage and synced to the cloud by sync.js. */
(function () {
  'use strict';

  const KEY = 'freshpress_v1';
  const STATUSES = ['received', 'processing', 'ready', 'delivered', 'cancelled'];
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  /* ---------- Utilities ---------- */
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const todayStr = () => toDateInput(new Date());
  function toDateInput(d) {
    const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
    return z.toISOString().slice(0, 10);
  }
  const addDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return toDateInput(d); };
  const money = (n) => (state.settings.currency || '₹') + (Number(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtDate = (s) => { if (!s) return '—'; const d = new Date(s); return isNaN(d) ? s : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }); };
  const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove('show'), 2200);
  }

  /* ---------- State ---------- */
  function defaults() {
    return {
      settings: { name: 'Latesto Drycleaners', address: '', phone: '', email: '', currency: '₹', defaultDays: 3, countryCode: '91',
        reminderTemplate: 'Hello {name}, your clothes are ready for pickup 🧺\nOrder #{order} · {count} item(s)\n{balance_line}Thank you,\n{shop}' },
      customers: [],
      services: [
        { id: uid(), name: 'Shirt', price: 80 },
        { id: uid(), name: 'Blouse', price: 80 },
        { id: uid(), name: 'Trousers', price: 100 },
        { id: uid(), name: 'Skirt', price: 100 },
        { id: uid(), name: 'Suit (2 piece)', price: 350 },
        { id: uid(), name: 'Saree', price: 250 },
        { id: uid(), name: 'Dress', price: 200 },
        { id: uid(), name: 'Jacket', price: 300 },
        { id: uid(), name: 'Coat', price: 300 },
        { id: uid(), name: 'Blanket', price: 450 },
        { id: uid(), name: 'Quilt', price: 450 },
        { id: uid(), name: 'Curtain (per panel)', price: 180 }
      ],
      inventory: [
        { id: uid(), name: 'Dry-cleaning solvent', unit: 'litres', qty: 40, reorder: 15 },
        { id: uid(), name: 'Garment bags', unit: 'pcs', qty: 200, reorder: 50 },
        { id: uid(), name: 'Hangers', unit: 'pcs', qty: 300, reorder: 100 },
        { id: uid(), name: 'Stain remover', unit: 'bottles', qty: 8, reorder: 4 },
        { id: uid(), name: 'Tags / labels', unit: 'pcs', qty: 500, reorder: 150 }
      ],
      orders: [],
      nextOrderNo: 1001,
      splitDone: true
    };
  }

  let state = load();
  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const s = JSON.parse(raw);
        const d = defaults();
        const st = Object.assign(d, s, { settings: Object.assign(d.settings, s.settings || {}) });
        delete st.settings.taxRate;
        if (st.settings.name === 'FreshPress Dry Cleaners') st.settings.name = 'Latesto Drycleaners';
        if (!s.splitDone) {
          // older data: split "Shirt / Blouse" style services into separate ones
          st.services = (st.services || []).flatMap((svc) => /\s\/\s/.test(svc.name)
            ? svc.name.split(/\s*\/\s*/).filter(Boolean).map((n) => ({ id: uid(), name: n.trim(), price: svc.price }))
            : [svc]);
          st.splitDone = true;
        }
        return st;
      }
    } catch (e) { console.warn('Could not load saved data', e); }
    return defaults();
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); }
    catch (e) { toast('Could not save: storage is full or blocked'); }
    // cloud sync (sync.js): uploads whatever changed since the last save
    if (window.LatestoSync) { try { window.LatestoSync.onSave(); } catch (e) { console.warn('Sync error', e); } }
  }

  /* ---------- Domain helpers ---------- */
  const customerById = (id) => state.customers.find((c) => c.id === id);
  const serviceById = (id) => state.services.find((s) => s.id === id);
  const orderById = (id) => state.orders.find((o) => o.id === id);

  function orderTotals(o) {
    const subtotal = round2(o.items.reduce((s, i) => s + i.qty * i.price, 0));
    const discount = Math.min(round2(o.discount || 0), subtotal);
    const total = round2(subtotal - discount);
    const paid = round2((o.payments || []).reduce((s, p) => s + p.amount, 0));
    const balance = round2(total - paid);
    return { subtotal, discount, total, paid, balance };
  }
  function payStatus(o) {
    const t = orderTotals(o);
    if (t.paid <= 0) return 'unpaid';
    return t.balance <= 0.005 ? 'paid' : 'partial';
  }
  const itemCount = (o) => o.items.reduce((s, i) => s + i.qty, 0);
  const isOverdue = (o) => o.dueDate && o.dueDate < todayStr() && (o.status === 'received' || o.status === 'processing' || o.status === 'ready');

  /* ---------- Modal ---------- */
  function openModal(html, wide) {
    closeModal();
    const root = $('#modal-root');
    root.innerHTML = `<div class="modal-back"><div class="modal ${wide ? 'wide' : ''}">${html}</div></div>`;
    $('.modal-back', root).addEventListener('mousedown', (e) => { if (e.target.classList.contains('modal-back')) closeModal(); });
    const first = $('input,select,textarea', root);
    if (first) first.focus();
    return $('.modal', root);
  }
  let pendingRender = false;
  function closeModal() {
    $('#modal-root').innerHTML = '';
    if (pendingRender) { pendingRender = false; applyBrand(); render(); }
  }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

  function confirmBox(msg, onYes) {
    const m = openModal(`<h2>Please confirm</h2><p>${esc(msg)}</p>
      <div class="modal-actions"><button class="btn" data-no>Cancel</button><button class="btn danger" data-yes>Confirm</button></div>`);
    $('[data-no]', m).onclick = closeModal;
    $('[data-yes]', m).onclick = () => { closeModal(); onYes(); };
  }

  /* ---------- Table helper ---------- */
  function table(cols, rows, empty) {
    if (!rows.length) return `<div class="empty">${esc(empty || 'Nothing to show yet.')}</div>`;
    return `<table><thead><tr>${cols.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table>`;
  }
  function barList(data, fmt) {
    if (!data.length) return '<div class="empty">No data for this period.</div>';
    const max = Math.max(...data.map((d) => d.value), 1);
    return data.map((d) => `<div class="bar-row"><div class="name" title="${esc(d.label)}">${esc(d.label)}</div>
      <div class="bar"><i style="width:${Math.max(2, d.value / max * 100)}%"></i></div><div class="num">${esc(fmt ? fmt(d.value) : d.value)}</div></div>`).join('');
  }

  /* ---------- Branding (name comes from Settings) ---------- */
  function applyBrand() {
    const name = (state.settings.name || 'Latesto Drycleaners').trim();
    const i = name.indexOf(' ');
    const first = i > 0 ? name.slice(0, i) : name; const rest = i > 0 ? name.slice(i + 1) : '';
    $('.brand').innerHTML = `<b>${esc(first.toUpperCase())}</b>${rest ? `<span>${esc(rest.toUpperCase())}</span>` : ''}`;
    document.title = name;
  }

  /* ---------- Navigation ---------- */
  let currentView = 'dashboard';
  const titles = { dashboard: 'Dashboard', orders: 'Orders', reminders: 'Pickup Reminders', customers: 'Customers', services: 'Services & Pricing', inventory: 'Inventory', reports: 'Reports', settings: 'Settings' };
  function show(view) {
    currentView = view;
    $$('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + view));
    $$('.nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
    $('#view-title').textContent = titles[view];
    render();
  }
  function updateBadge() {
    const n = state.orders.filter((o) => o.status === 'ready').length;
    const b = $('[data-view="reminders"]');
    if (b) b.innerHTML = 'Reminders' + (n ? ` <span class="nav-badge">${n}</span>` : '');
  }
  function render() {
    updateBadge();
    ({ dashboard: renderDashboard, orders: renderOrders, reminders: renderReminders, customers: renderCustomers, services: renderServices, inventory: renderInventory, reports: renderReports, settings: renderSettings })[currentView]();
  }

  /* ---------- Dashboard ---------- */
  function renderDashboard() {
    const active = state.orders.filter((o) => ['received', 'processing', 'ready'].includes(o.status));
    const today = todayStr();
    const todayRevenue = state.orders.flatMap((o) => o.payments || []).filter((p) => p.date === today).reduce((s, p) => s + p.amount, 0);
    const outstanding = state.orders.filter((o) => o.status !== 'cancelled').reduce((s, o) => s + Math.max(0, orderTotals(o).balance), 0);
    const lowStock = state.inventory.filter((i) => i.qty <= i.reorder).length;
    $('#stat-cards').innerHTML = [
      ['Active orders', active.length],
      ['Ready for pickup', state.orders.filter((o) => o.status === 'ready').length],
      ["Today's collections", money(todayRevenue)],
      ['Outstanding balance', money(outstanding)],
      ['Customers', state.customers.length],
      ['Low stock items', lowStock]
    ].map(([l, v]) => `<div class="card"><div class="label">${l}</div><div class="value">${esc(v)}</div></div>`).join('');

    $('#status-chart').innerHTML = barList(STATUSES.map((s) => ({ label: cap(s), value: state.orders.filter((o) => o.status === s).length })));

    const due = state.orders.filter((o) => ['received', 'processing', 'ready'].includes(o.status))
      .sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || '')).slice(0, 6);
    $('#due-list').innerHTML = table(['Order', 'Customer', 'Due', 'Status'], due.map((o) => {
      const c = customerById(o.customerId);
      return `<tr><td><a href="#" data-open="${o.id}">#${o.number}</a></td><td>${esc(c ? c.name : 'Unknown')}</td>
        <td>${fmtDate(o.dueDate)} ${isOverdue(o) ? '<span class="badge cancelled">overdue</span>' : ''}</td>
        <td><span class="badge ${o.status}">${cap(o.status)}</span></td></tr>`;
    }), 'No pending orders.');

    const recent = [...state.orders].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 6);
    $('#recent-orders').innerHTML = orderRows(recent, true);
  }

  /* ---------- Orders ---------- */
  function orderRows(list, compact) {
    return table(compact ? ['Order', 'Customer', 'Items', 'Total', 'Status'] : ['Order', 'Customer', 'Date', 'Due', 'Items', 'Total', 'Balance', 'Status', 'Payment', ''],
      list.map((o) => {
        const c = customerById(o.customerId); const t = orderTotals(o); const ps = payStatus(o);
        if (compact) {
          return `<tr><td><a href="#" data-open="${o.id}">#${o.number}</a></td><td>${esc(c ? c.name : 'Unknown')}</td><td>${itemCount(o)}</td><td>${money(t.total)}</td><td><span class="badge ${o.status}">${cap(o.status)}</span></td></tr>`;
        }
        return `<tr><td><a href="#" data-open="${o.id}">#${o.number}</a></td><td>${esc(c ? c.name : 'Unknown')}${c && c.address ? `<div class="muted" style="font-size:12px">${esc(c.address)}</div>` : ''}</td>
          <td>${fmtDate(o.createdAt)}</td><td>${fmtDate(o.dueDate)}${isOverdue(o) ? ' <span class="badge cancelled">overdue</span>' : ''}</td>
          <td>${itemCount(o)}</td><td>${money(t.total)}</td><td>${money(t.balance)}</td>
          <td><span class="badge ${o.status}">${cap(o.status)}</span></td><td><span class="badge ${ps}">${cap(ps)}</span></td>
          <td class="actions"><button class="btn sm" data-open="${o.id}">View</button><button class="btn sm" data-invoice="${o.id}">Invoice</button></td></tr>`;
      }), 'No orders found.');
  }

  let searchTerm = '';
  function renderOrders() {
    const sf = $('#order-status-filter');
    if (!sf.options.length) sf.innerHTML = '<option value="">All statuses</option>' + STATUSES.map((s) => `<option value="${s}">${cap(s)}</option>`).join('');
    const status = sf.value, pay = $('#order-pay-filter').value, q = searchTerm.toLowerCase();
    const list = state.orders.filter((o) => {
      if (status && o.status !== status) return false;
      if (pay && payStatus(o) !== pay) return false;
      if (q) {
        const c = customerById(o.customerId);
        const hay = ['#' + o.number, String(o.number), c ? c.name : '', c ? c.phone : '', c ? c.address : '', o.notes || '', ...o.items.map((i) => i.name)].join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    }).sort((a, b) => b.number - a.number);
    $('#orders-table').innerHTML = orderRows(list);
  }

  function orderForm(existing) {
    if (!state.customers.length) {
      toast('Add a customer first');
      show('customers');
      return customerForm();
    }
    if (!state.services.length) { toast('Add a service first'); return show('services'); }
    const o = existing ? JSON.parse(JSON.stringify(existing)) : {
      id: uid(), customerId: '', items: [], discount: 0, status: 'received', payments: [],
      createdAt: new Date().toISOString(), dueDate: addDays(state.settings.defaultDays), notes: ''
    };
    const m = openModal('', true);

    // every service is a row with an on/off toggle; items from deleted services stay editable too
    const rowDefs = () => {
      const rows = state.services.map((s) => ({ id: s.id, name: s.name, price: s.price }));
      o.items.forEach((i) => { if (!rows.some((r) => r.id === i.serviceId)) rows.push({ id: i.serviceId, name: i.name, price: i.price }); });
      return rows;
    };

    function draw() {
      const t = orderTotals(o);
      const rows = rowDefs();
      m.innerHTML = `<h2>${existing ? 'Edit order #' + o.number : 'New order'}</h2>
        <div class="form-grid">
          <div class="field"><label>Customer</label><select id="of-cust">${state.customers.map((c) => `<option value="${c.id}" ${c.id === o.customerId ? 'selected' : ''}>${esc(c.name)}${c.phone ? ' · ' + esc(c.phone) : ''}${c.address ? ' · ' + esc(c.address) : ''}</option>`).join('')}</select></div>
          <div class="field"><label>Due date</label><input type="date" id="of-due" value="${esc(o.dueDate)}"></div>
        </div>
        <h3 style="margin:16px 0 6px;font-size:14px">Select garments (switch ON to add)</h3>
        <table class="line-items"><thead><tr><th style="width:60px">On/Off</th><th>Garment</th><th style="width:80px">Qty</th><th style="width:100px">Price</th><th style="width:100px">Amount</th></tr></thead><tbody>
        ${rows.map((r) => {
          const it = o.items.find((i) => i.serviceId === r.id); const on = !!it;
          return `<tr class="${on ? '' : 'off'}">
            <td><label class="switch"><input type="checkbox" data-tg="${esc(r.id)}" ${on ? 'checked' : ''}><span class="slider"></span></label></td>
            <td>${esc(r.name)}</td>
            <td><input type="number" min="1" step="1" value="${on ? it.qty : 1}" data-q="${esc(r.id)}" ${on ? '' : 'disabled'}></td>
            <td><input type="number" min="0" step="0.01" value="${on ? it.price : r.price}" data-p="${esc(r.id)}" ${on ? '' : 'disabled'}></td>
            <td>${on ? money(it.qty * it.price) : '—'}</td></tr>`;
        }).join('')}
        </tbody></table>
        <div class="form-grid" style="margin-top:14px">
          <div class="field"><label>Discount (${esc(state.settings.currency)})</label><input type="number" min="0" step="0.01" id="of-disc" value="${o.discount}"></div>
          <div class="field full"><label>Notes (stains, special care, tag numbers)</label><textarea id="of-notes" rows="2">${esc(o.notes)}</textarea></div>
        </div>
        <div class="totals">
          <div><span>Items selected</span><span>${o.items.reduce((s, i) => s + i.qty, 0)}</span></div>
          <div><span>Subtotal</span><span>${money(t.subtotal)}</span></div>
          <div><span>Discount</span><span>- ${money(t.discount)}</span></div>
          <div class="grand"><span>Total</span><span>${money(t.total)}</span></div>
        </div>
        ${existing ? '' : `<div class="form-grid" style="margin-top:12px"><div class="field"><label>Advance payment (optional)</label><input type="number" min="0" step="0.01" id="of-adv" value="${o._adv || ''}"></div>
          <div class="field"><label>Method</label><select id="of-method"><option>Cash</option><option>UPI</option><option>Card</option></select></div></div>`}
        <div class="modal-actions"><button class="btn" id="of-cancel">Cancel</button><button class="btn primary" id="of-save">${existing ? 'Save changes' : 'Create order'}</button></div>`;

      $('#of-cust').value = o.customerId || state.customers[0].id;
      o.customerId = $('#of-cust').value;
      $('#of-cust').onchange = (e) => { o.customerId = e.target.value; };
      $('#of-due').onchange = (e) => { o.dueDate = e.target.value; };
      $('#of-notes').oninput = (e) => { o.notes = e.target.value; };
      $('#of-cancel').onclick = closeModal;
      $$('[data-tg]', m).forEach((el) => el.onchange = () => {
        capture();
        const id = el.dataset.tg;
        if (el.checked) {
          const r = rowDefs().find((x) => x.id === id);
          if (r && !o.items.some((i) => i.serviceId === id)) o.items.push({ serviceId: id, name: r.name, qty: 1, price: r.price });
        } else {
          o.items = o.items.filter((i) => i.serviceId !== id);
        }
        draw();
      });
      $$('[data-q],[data-p]', m).forEach((el) => el.onchange = () => { capture(); draw(); });
      $('#of-disc').onchange = () => { capture(); draw(); };
      $('#of-save').onclick = () => {
        capture();
        if (!o.customerId) return toast('Select a customer');
        if (!o.items.length) return toast('Switch ON at least one garment');
        if (o.items.some((i) => !(i.qty >= 1))) return toast('Quantity must be at least 1');
        if (!o.dueDate) return toast('Choose a due date');
        if (!existing) {
          o.number = state.nextOrderNo++;
          const adv = round2($('#of-adv') ? $('#of-adv').value : 0);
          delete o._adv;
          if (adv > 0) o.payments.push({ id: uid(), amount: Math.min(adv, orderTotals(o).total), date: todayStr(), method: $('#of-method').value });
          state.orders.push(o);
        } else {
          Object.assign(orderById(o.id), o);
        }
        save(); closeModal(); toast('Order saved'); render();
      };
    }
    function capture() {
      $$('[data-q]', m).forEach((el) => { const it = o.items.find((i) => i.serviceId === el.dataset.q); if (it) it.qty = Math.max(0, parseInt(el.value, 10) || 0); });
      $$('[data-p]', m).forEach((el) => { const it = o.items.find((i) => i.serviceId === el.dataset.p); if (it) it.price = Math.max(0, parseFloat(el.value) || 0); });
      if ($('#of-disc')) o.discount = Math.max(0, parseFloat($('#of-disc').value) || 0);
      if ($('#of-adv')) o._adv = $('#of-adv').value;
    }
    draw();
  }

  function orderDetail(id) {
    const o = orderById(id); if (!o) return;
    const c = customerById(o.customerId) || { name: 'Unknown' };
    const t = orderTotals(o); const ps = payStatus(o);
    const m = openModal(`<h2>Order #${o.number} <span class="badge ${o.status}">${cap(o.status)}</span> <span class="badge ${ps}">${cap(ps)}</span></h2>
      <p class="muted">${esc(c.name)}${c.phone ? ' · ' + esc(c.phone) : ''} — placed ${fmtDate(o.createdAt)}, due ${fmtDate(o.dueDate)}</p>
      ${table(['Service', 'Qty', 'Price', 'Amount'], o.items.map((i) => `<tr><td>${esc(i.name)}</td><td>${i.qty}</td><td>${money(i.price)}</td><td>${money(i.qty * i.price)}</td></tr>`))}
      <div class="totals">
        <div><span>Subtotal</span><span>${money(t.subtotal)}</span></div>
        <div><span>Discount</span><span>- ${money(t.discount)}</span></div>
        <div class="grand"><span>Total</span><span>${money(t.total)}</span></div>
        <div><span>Paid</span><span>${money(t.paid)}</span></div>
        <div><span><b>Balance</b></span><span><b>${money(t.balance)}</b></span></div>
      </div>
      ${o.notes ? `<p><b>Notes:</b> ${esc(o.notes)}</p>` : ''}
      ${o.payments.length ? `<h3 style="font-size:14px">Payments</h3>${table(['Date', 'Method', 'Amount'], o.payments.map((p) => `<tr><td>${fmtDate(p.date)}</td><td>${esc(p.method)}</td><td>${money(p.amount)}</td></tr>`))}` : ''}
      <div class="field" style="margin-top:12px"><label>Update status</label>
        <select id="od-status">${STATUSES.map((s) => `<option value="${s}" ${s === o.status ? 'selected' : ''}>${cap(s)}</option>`).join('')}</select></div>
      <div class="modal-actions">
        <button class="btn danger" data-del>Delete</button>
        <button class="btn" data-edit>Edit</button>
        <button class="btn" data-pay ${t.balance <= 0.005 ? 'disabled' : ''}>Record payment</button>
        ${o.status === 'ready' ? `<button class="btn wa" data-wa="${o.id}">WhatsApp reminder</button>` : ''}
        <button class="btn" data-inv>Invoice</button>
        <button class="btn primary" data-close>Close</button>
      </div>`, true);
    $('#od-status', m).onchange = (e) => {
      const prev = o.status; o.status = e.target.value;
      const nowReady = o.status === 'ready' && prev !== 'ready';
      if (nowReady) o.readyAt = new Date().toISOString();
      save(); toast('Status updated'); render();
      if (nowReady) return reminderPrompt(id);
      orderDetail(id);
    };
    $('[data-close]', m).onclick = closeModal;
    $('[data-edit]', m).onclick = () => orderForm(o);
    $('[data-inv]', m).onclick = () => invoice(id);
    $('[data-pay]', m).onclick = () => paymentForm(id);
    $('[data-del]', m).onclick = () => confirmBox(`Delete order #${o.number}? This cannot be undone.`, () => {
      state.orders = state.orders.filter((x) => x.id !== id); save(); toast('Order deleted'); render();
    });
  }

  function paymentForm(id) {
    const o = orderById(id); const t = orderTotals(o);
    const m = openModal(`<h2>Record payment — #${o.number}</h2><p class="muted">Balance due: ${money(t.balance)}</p>
      <div class="form-grid">
        <div class="field"><label>Amount</label><input type="number" id="pf-amt" min="0.01" step="0.01" value="${t.balance}"></div>
        <div class="field"><label>Method</label><select id="pf-method"><option>Cash</option><option>UPI</option><option>Card</option><option>Bank transfer</option></select></div>
        <div class="field"><label>Date</label><input type="date" id="pf-date" value="${todayStr()}"></div>
      </div>
      <div class="modal-actions"><button class="btn" data-no>Cancel</button><button class="btn primary" data-ok>Save payment</button></div>`);
    $('[data-no]', m).onclick = () => orderDetail(id);
    $('[data-ok]', m).onclick = () => {
      const amt = round2($('#pf-amt').value);
      if (!(amt > 0)) return toast('Enter a valid amount');
      if (amt > t.balance + 0.005) return toast('Amount exceeds the balance due');
      o.payments.push({ id: uid(), amount: amt, method: $('#pf-method').value, date: $('#pf-date').value || todayStr() });
      save(); toast('Payment recorded'); orderDetail(id); render();
    };
  }

  function invoice(id) {
    const o = orderById(id); if (!o) return;
    const c = customerById(o.customerId) || { name: 'Unknown' }; const t = orderTotals(o); const s = state.settings;
    const m = openModal(`<div class="invoice">
      <h2>${esc(s.name)}</h2>
      <div class="muted">${esc(s.address)}${s.phone ? '<br>Phone: ' + esc(s.phone) : ''}${s.email ? '<br>' + esc(s.email) : ''}</div>
      <div class="meta">
        <div><b>Bill to</b><br>${esc(c.name)}${c.phone ? '<br>' + esc(c.phone) : ''}${c.address ? '<br>' + esc(c.address) : ''}</div>
        <div style="text-align:right"><b>Invoice #${o.number}</b><br>Date: ${fmtDate(o.createdAt)}<br>Due: ${fmtDate(o.dueDate)}<br>Status: ${cap(payStatus(o))}</div>
      </div>
      ${table(['Description', 'Qty', 'Rate', 'Amount'], o.items.map((i) => `<tr><td>${esc(i.name)}</td><td>${i.qty}</td><td>${money(i.price)}</td><td>${money(i.qty * i.price)}</td></tr>`))}
      <div class="totals">
        <div><span>Subtotal</span><span>${money(t.subtotal)}</span></div>
        ${t.discount ? `<div><span>Discount</span><span>- ${money(t.discount)}</span></div>` : ''}
        <div class="grand"><span>Total</span><span>${money(t.total)}</span></div>
        <div><span>Paid</span><span>${money(t.paid)}</span></div>
        <div><span><b>Balance due</b></span><span><b>${money(t.balance)}</b></span></div>
      </div>
      ${o.notes ? `<p class="muted">Notes: ${esc(o.notes)}</p>` : ''}
      <p class="muted" style="text-align:center;margin-top:24px">Thank you for your business!</p>
    </div>
    <div class="modal-actions"><button class="btn" data-close>Close</button><button class="btn primary" data-print>Print</button></div>`, true);
    $('[data-close]', m).onclick = closeModal;
    $('[data-print]', m).onclick = () => window.print();
  }

  /* ---------- WhatsApp pickup reminders ---------- */
  function waNumber(phone) {
    const raw = String(phone || '').trim();
    let d = raw.replace(/\D/g, '');
    if (!d) return '';
    if (raw.startsWith('+')) return d;
    d = d.replace(/^00/, '');
    if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
    if (d.length === 10) return String(state.settings.countryCode || '91').replace(/\D/g, '') + d;
    return d;
  }
  function reminderText(o) {
    const c = customerById(o.customerId) || {}; const t = orderTotals(o); const sh = state.settings;
    const vars = {
      name: c.name || 'Customer', order: o.number, count: itemCount(o),
      items: o.items.map((i) => `${i.name} x${i.qty}`).join(', '),
      total: money(t.total), balance: money(Math.max(0, t.balance)),
      balance_line: t.balance > 0.005 ? `Amount to pay: ${money(t.balance)}\n` : '',
      due: fmtDate(o.dueDate), shop: sh.name
    };
    return String(sh.reminderTemplate || defaults().settings.reminderTemplate).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
  }
  function sendReminder(id) {
    const o = orderById(id); if (!o) return false;
    const c = customerById(o.customerId) || {};
    const num = waNumber(c.phone);
    if (num.length < 8 || num.length > 15) { toast('Add a valid phone number for this customer first'); return false; }
    const url = 'https://wa.me/' + num + '?text=' + encodeURIComponent(reminderText(o));
    o.reminders = o.reminders || []; o.reminders.push({ date: new Date().toISOString() });
    save();
    window.open(url, '_blank', 'noopener');
    render();
    return true;
  }
  function reminderPrompt(id) {
    const o = orderById(id); const c = customerById(o.customerId) || {};
    const num = waNumber(c.phone);
    if (num.length < 8 || num.length > 15) { toast('Marked ready. Add a phone number to send a WhatsApp reminder.'); return orderDetail(id); }
    const m = openModal(`<h2>Order #${o.number} is ready ✔</h2>
      <p>Send a pickup reminder to <b>${esc(c.name)}</b> (${esc(c.phone)}) on WhatsApp?</p>
      <div class="panel" style="background:#f6f8ff;white-space:pre-wrap;font-size:13px">${esc(reminderText(o))}</div>
      <div class="modal-actions"><button class="btn" data-no>Not now</button><button class="btn wa" data-send>Send on WhatsApp</button></div>`);
    $('[data-no]', m).onclick = closeModal;
    $('[data-send]', m).onclick = () => { if (sendReminder(id)) closeModal(); };
  }
  function renderReminders() {
    const q = searchTerm.toLowerCase();
    const list = state.orders.filter((o) => o.status === 'ready').filter((o) => {
      if (!q) return true;
      const c = customerById(o.customerId) || {};
      return [String(o.number), c.name, c.phone, c.address].join(' ').toLowerCase().includes(q);
    }).sort((a, b) => (a.readyAt || a.createdAt).localeCompare(b.readyAt || b.createdAt));
    $('#reminders-table').innerHTML = table(['Order', 'Customer', 'Phone', 'Items', 'Balance', 'Waiting', 'Reminders sent', ''], list.map((o) => {
      const c = customerById(o.customerId) || {}; const t = orderTotals(o); const rs = o.reminders || [];
      const days = Math.max(0, Math.floor((new Date(todayStr()) - new Date(toDateInput(new Date(o.readyAt || o.createdAt)))) / 86400000));
      return `<tr><td><a href="#" data-open="${o.id}">#${o.number}</a></td>
        <td>${esc(c.name || 'Unknown')}${c.address ? `<div class="muted" style="font-size:12px">${esc(c.address)}</div>` : ''}</td>
        <td>${esc(c.phone || '—')}</td><td>${itemCount(o)}</td><td>${money(Math.max(0, t.balance))}</td>
        <td>${days === 0 ? 'Today' : `<span class="badge ${days >= 3 ? 'cancelled' : 'processing'}">${days} day${days > 1 ? 's' : ''}</span>`}</td>
        <td>${rs.length ? `${rs.length} · last ${fmtDate(rs[rs.length - 1].date)}` : '<span class="muted">none yet</span>'}</td>
        <td class="actions"><button class="btn sm wa" data-wa="${o.id}">${rs.length ? 'Remind again' : 'WhatsApp'}</button><button class="btn sm" data-deliver="${o.id}">Mark delivered</button></td></tr>`;
    }), 'No orders are waiting for pickup. When you mark an order READY it appears here.');
  }

  /* ---------- Customers ---------- */
  function renderCustomers() {
    const q = searchTerm.toLowerCase();
    const list = state.customers.filter((c) => !q || [c.name, c.phone, c.email, c.address].join(' ').toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name));
    $('#customers-table').innerHTML = table(['Name', 'Phone', 'Address', 'Orders', 'Paid', 'Balance', ''], list.map((c) => {
      const os = state.orders.filter((o) => o.customerId === c.id && o.status !== 'cancelled');
      const spent = os.reduce((s, o) => s + orderTotals(o).paid, 0);
      const bal = os.reduce((s, o) => s + Math.max(0, orderTotals(o).balance), 0);
      return `<tr><td><b>${esc(c.name)}</b></td><td>${esc(c.phone)}</td><td>${esc(c.address)}</td><td>${os.length}</td><td>${money(spent)}</td><td>${money(bal)}</td>
        <td class="actions">${os.length ? `<button class="btn sm" data-last-invoice="${c.id}">Invoice</button>` : ''}<button class="btn sm" data-cust-orders="${c.id}">History</button><button class="btn sm" data-new-order-for="${c.id}">New order</button>
        <button class="btn sm" data-edit-cust="${c.id}">Edit</button><button class="btn sm danger" data-del-cust="${c.id}">Delete</button></td></tr>`;
    }), 'No customers yet. Add your first one.');
  }
  function customerForm(id) {
    const c = id ? customerById(id) : { name: '', phone: '', email: '', address: '', notes: '' };
    const m = openModal(`<h2>${id ? 'Edit' : 'Add'} customer</h2><div class="form-grid">
      <div class="field"><label>Name *</label><input id="cf-name" value="${esc(c.name)}"></div>
      <div class="field"><label>Phone</label><input id="cf-phone" value="${esc(c.phone)}"></div>
      <div class="field"><label>Email</label><input id="cf-email" type="email" value="${esc(c.email)}"></div>
      <div class="field"><label>Address</label><input id="cf-addr" value="${esc(c.address)}"></div>
      <div class="field full"><label>Preferences / notes</label><textarea id="cf-notes" rows="2">${esc(c.notes)}</textarea></div></div>
      <div class="modal-actions"><button class="btn" data-no>Cancel</button><button class="btn primary" data-ok>Save</button></div>`);
    $('[data-no]', m).onclick = closeModal;
    $('[data-ok]', m).onclick = () => {
      const name = $('#cf-name').value.trim();
      if (!name) return toast('Name is required');
      const phone = $('#cf-phone').value.trim();
      if (phone && state.customers.some((x) => x.phone === phone && x.id !== id)) return toast('Another customer already has this phone number');
      const data = { name, phone, email: $('#cf-email').value.trim(), address: $('#cf-addr').value.trim(), notes: $('#cf-notes').value.trim() };
      if (id) Object.assign(c, data); else state.customers.push(Object.assign({ id: uid(), createdAt: new Date().toISOString() }, data));
      save(); closeModal(); toast('Customer saved'); render();
    };
  }
  function customerHistory(id) {
    const c = customerById(id);
    const os = state.orders.filter((o) => o.customerId === id).sort((a, b) => b.number - a.number);
    const m = openModal(`<h2>${esc(c.name)} — order history</h2>${orderRows(os, true)}${c.notes ? `<p class="muted">Notes: ${esc(c.notes)}</p>` : ''}
      <div class="modal-actions"><button class="btn primary" data-close>Close</button></div>`, true);
    $('[data-close]', m).onclick = closeModal;
  }

  /* ---------- Services ---------- */
  function renderServices() {
    $('#services-table').innerHTML = table(['Service', 'Price', 'Times ordered', ''], state.services.map((s) => {
      const n = state.orders.reduce((a, o) => a + o.items.filter((i) => i.serviceId === s.id).reduce((x, i) => x + i.qty, 0), 0);
      return `<tr><td>${esc(s.name)}</td><td>${money(s.price)}</td><td>${n}</td>
        <td class="actions"><button class="btn sm" data-edit-svc="${s.id}">Edit</button><button class="btn sm danger" data-del-svc="${s.id}">Delete</button></td></tr>`;
    }), 'No services defined.');
  }
  function serviceForm(id) {
    const s = id ? serviceById(id) : { name: '', price: '' };
    const m = openModal(`<h2>${id ? 'Edit' : 'Add'} service</h2><div class="form-grid">
      <div class="field"><label>Name *</label><input id="sf-name" value="${esc(s.name)}"></div>
      <div class="field"><label>Price *</label><input id="sf-price" type="number" min="0" step="0.01" value="${esc(s.price)}"></div></div>
      <p class="muted">Changing a price does not affect existing orders.</p>
      <div class="modal-actions"><button class="btn" data-no>Cancel</button><button class="btn primary" data-ok>Save</button></div>`);
    $('[data-no]', m).onclick = closeModal;
    $('[data-ok]', m).onclick = () => {
      const name = $('#sf-name').value.trim(); const price = parseFloat($('#sf-price').value);
      if (!name) return toast('Name is required');
      if (!(price >= 0)) return toast('Enter a valid price');
      if (id) { s.name = name; s.price = price; } else state.services.push({ id: uid(), name, price });
      save(); closeModal(); toast('Service saved'); render();
    };
  }

  /* ---------- Inventory ---------- */
  function renderInventory() {
    $('#inventory-table').innerHTML = table(['Item', 'In stock', 'Unit', 'Reorder level', 'Status', ''], state.inventory.map((i) => `<tr>
      <td>${esc(i.name)}</td><td><b>${i.qty}</b></td><td>${esc(i.unit)}</td><td>${i.reorder}</td>
      <td>${i.qty <= i.reorder ? '<span class="badge low">Low stock</span>' : '<span class="badge paid">OK</span>'}</td>
      <td class="actions"><button class="btn sm" data-stock="${i.id}" data-dir="1">+ Add</button><button class="btn sm" data-stock="${i.id}" data-dir="-1">− Use</button>
      <button class="btn sm" data-edit-item="${i.id}">Edit</button><button class="btn sm danger" data-del-item="${i.id}">Delete</button></td></tr>`), 'No inventory items.');
  }
  function itemForm(id) {
    const i = id ? state.inventory.find((x) => x.id === id) : { name: '', unit: 'pcs', qty: 0, reorder: 0 };
    const m = openModal(`<h2>${id ? 'Edit' : 'Add'} inventory item</h2><div class="form-grid">
      <div class="field"><label>Name *</label><input id="if-name" value="${esc(i.name)}"></div>
      <div class="field"><label>Unit</label><input id="if-unit" value="${esc(i.unit)}"></div>
      <div class="field"><label>Quantity</label><input id="if-qty" type="number" min="0" step="any" value="${i.qty}"></div>
      <div class="field"><label>Reorder level</label><input id="if-re" type="number" min="0" step="any" value="${i.reorder}"></div></div>
      <div class="modal-actions"><button class="btn" data-no>Cancel</button><button class="btn primary" data-ok>Save</button></div>`);
    $('[data-no]', m).onclick = closeModal;
    $('[data-ok]', m).onclick = () => {
      const name = $('#if-name').value.trim();
      if (!name) return toast('Name is required');
      const data = { name, unit: $('#if-unit').value.trim() || 'pcs', qty: Math.max(0, parseFloat($('#if-qty').value) || 0), reorder: Math.max(0, parseFloat($('#if-re').value) || 0) };
      if (id) Object.assign(i, data); else state.inventory.push(Object.assign({ id: uid() }, data));
      save(); closeModal(); toast('Item saved'); render();
    };
  }
  function stockAdjust(id, dir) {
    const i = state.inventory.find((x) => x.id === id);
    const m = openModal(`<h2>${dir > 0 ? 'Add stock' : 'Use stock'} — ${esc(i.name)}</h2><p class="muted">Currently ${i.qty} ${esc(i.unit)}</p>
      <div class="field"><label>Quantity</label><input id="sa-qty" type="number" min="0" step="any" value="1"></div>
      <div class="modal-actions"><button class="btn" data-no>Cancel</button><button class="btn primary" data-ok>Apply</button></div>`);
    $('[data-no]', m).onclick = closeModal;
    $('[data-ok]', m).onclick = () => {
      const q = parseFloat($('#sa-qty').value);
      if (!(q > 0)) return toast('Enter a quantity above zero');
      if (dir < 0 && q > i.qty) return toast('Not enough stock');
      i.qty = round2(i.qty + dir * q); save(); closeModal(); render();
      if (i.qty <= i.reorder) toast(i.name + ' is low on stock');
    };
  }

  /* ---------- Reports ---------- */
  function reportRange() {
    const f = $('#rep-from'), t = $('#rep-to');
    if (!f.value) f.value = addDays(-29);
    if (!t.value) t.value = todayStr();
    return [f.value, t.value];
  }
  function renderReports() {
    const [from, to] = reportRange();
    const inRange = (d) => d >= from && d <= to;
    const orders = state.orders.filter((o) => o.status !== 'cancelled' && inRange(o.createdAt.slice(0, 10)));
    const payments = state.orders.flatMap((o) => o.payments.map((p) => Object.assign({ order: o }, p))).filter((p) => inRange(p.date));
    const collected = payments.reduce((s, p) => s + p.amount, 0);
    const billed = orders.reduce((s, o) => s + orderTotals(o).total, 0);
    const outstanding = orders.reduce((s, o) => s + Math.max(0, orderTotals(o).balance), 0);
    $('#report-cards').innerHTML = [
      ['Orders', orders.length], ['Items cleaned', orders.reduce((s, o) => s + itemCount(o), 0)], ['Billed', money(billed)],
      ['Collected', money(collected)], ['Outstanding', money(outstanding)],
      ['Avg order value', money(orders.length ? billed / orders.length : 0)]
    ].map(([l, v]) => `<div class="card"><div class="label">${l}</div><div class="value">${esc(v)}</div></div>`).join('');

    const byDay = {};
    payments.forEach((p) => { byDay[p.date] = (byDay[p.date] || 0) + p.amount; });
    $('#rev-chart').innerHTML = barList(Object.keys(byDay).sort().slice(-14).map((d) => ({ label: fmtDate(d), value: round2(byDay[d]) })), money);

    const svc = {};
    orders.forEach((o) => o.items.forEach((i) => { svc[i.name] = (svc[i.name] || 0) + i.qty * i.price; }));
    $('#top-services').innerHTML = barList(Object.entries(svc).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([label, value]) => ({ label, value: round2(value) })), money);

    const cust = {};
    orders.forEach((o) => { cust[o.customerId] = cust[o.customerId] || { n: 0, v: 0 }; cust[o.customerId].n++; cust[o.customerId].v += orderTotals(o).total; });
    const rows = Object.entries(cust).sort((a, b) => b[1].v - a[1].v).slice(0, 10).map(([id, d]) => {
      const c = customerById(id);
      return `<tr><td>${esc(c ? c.name : 'Unknown')}</td><td>${d.n}</td><td>${money(d.v)}</td></tr>`;
    });
    $('#top-customers').innerHTML = table(['Customer', 'Orders', 'Billed'], rows, 'No data for this period.');
  }
  function exportCsv() {
    const [from, to] = reportRange();
    const cell = (v) => { v = String(v == null ? '' : v); if (/^[=+\-@]/.test(v)) v = "'" + v; return '"' + v.replace(/"/g, '""') + '"'; };
    const head = ['Order', 'Date', 'Due', 'Customer', 'Phone', 'Items', 'Subtotal', 'Discount', 'Total', 'Paid', 'Balance', 'Status', 'Payment'];
    const rows = state.orders.filter((o) => o.createdAt.slice(0, 10) >= from && o.createdAt.slice(0, 10) <= to).map((o) => {
      const c = customerById(o.customerId) || {}; const t = orderTotals(o);
      return [o.number, o.createdAt.slice(0, 10), o.dueDate, c.name, c.phone, itemCount(o), t.subtotal, t.discount, t.total, t.paid, t.balance, o.status, payStatus(o)];
    });
    download(`orders_${from}_to_${to}.csv`, [head, ...rows].map((r) => r.map(cell).join(',')).join('\n'), 'text/csv');
  }
  function download(name, text, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  /* ---------- Excel export (no external libraries; works offline) ---------- */
  const CRC_TABLE = (() => { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(bytes) { let c = 0xFFFFFFFF; for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }

  function zipStore(files) { // files: [{name, data(string)}] -> Uint8Array (uncompressed zip)
    const enc = new TextEncoder(); const parts = []; const central = []; let offset = 0;
    const u16 = (n) => [n & 255, (n >>> 8) & 255]; const u32 = (n) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
    files.forEach((f) => {
      const name = enc.encode(f.name); const data = enc.encode(f.data); const crc = crc32(data);
      const local = Uint8Array.from([...u32(0x04034b50), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0)]);
      parts.push(local, name, data);
      central.push(Uint8Array.from([...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset)]), name);
      offset += local.length + name.length + data.length;
    });
    const cdSize = central.reduce((a, b) => a + b.length, 0);
    const end = Uint8Array.from([...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length), ...u32(cdSize), ...u32(offset), ...u16(0)]);
    const all = [...parts, ...central, end]; const out = new Uint8Array(all.reduce((a, b) => a + b.length, 0)); let pos = 0;
    all.forEach((b) => { out.set(b, pos); pos += b.length; });
    return out;
  }

  const xmlEsc = (v) => String(v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
  function colName(i) { let n = ''; i++; while (i > 0) { const r = (i - 1) % 26; n = String.fromCharCode(65 + r) + n; i = Math.floor((i - 1) / 26); } return n; }

  function sheetXml(headers, rows, widths) {
    const cell = (v, r, c, style) => {
      const ref = colName(c) + r;
      if (typeof v === 'number' && isFinite(v)) return `<c r="${ref}" s="2"><v>${v}</v></c>`;
      if (v == null || v === '') return `<c r="${ref}"${style ? ` s="${style}"` : ''}/>`;
      return `<c r="${ref}"${style ? ` s="${style}"` : ''} t="inlineStr"><is><t xml:space="preserve">${xmlEsc(v)}</t></is></c>`;
    };
    const head = `<row r="1">${headers.map((h, c) => cell(h, 1, c, 1)).join('')}</row>`;
    const body = rows.map((row, i) => `<row r="${i + 2}">${row.map((v, c) => cell(v, i + 2, c)).join('')}</row>`).join('');
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
      `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
      `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` +
      `<sheetData>${head}${body}</sheetData></worksheet>`;
  }

  function exportExcel() {
    const custRows = [...state.customers].sort((a, b) => a.name.localeCompare(b.name)).map((c) => {
      const os = state.orders.filter((o) => o.customerId === c.id && o.status !== 'cancelled');
      const billed = round2(os.reduce((s, o) => s + orderTotals(o).total, 0));
      const paid = round2(os.reduce((s, o) => s + orderTotals(o).paid, 0));
      return [c.name, c.phone, c.email, c.address, c.notes, os.length, billed, paid, round2(billed - paid)];
    });
    const orderRowsX = [...state.orders].sort((a, b) => a.number - b.number).map((o) => {
      const c = customerById(o.customerId) || {}; const t = orderTotals(o);
      return [o.number, o.createdAt.slice(0, 10), o.dueDate, c.name || 'Unknown', c.phone, c.address,
        o.items.map((i) => `${i.name} x${i.qty}`).join(', '), itemCount(o), t.subtotal, t.discount, t.total, t.paid, t.balance,
        cap(o.status), cap(payStatus(o)), o.notes];
    });
    const sheets = [
      { name: 'Customers', xml: sheetXml(['Name', 'Phone', 'Email', 'Address', 'Notes', 'Orders', 'Total Billed', 'Paid', 'Balance'], custRows, [24, 16, 26, 36, 30, 9, 14, 14, 14]) },
      { name: 'Orders', xml: sheetXml(['Order No', 'Order Date', 'Due Date', 'Customer', 'Phone', 'Address', 'Items', 'Total Qty', 'Subtotal', 'Discount', 'Total', 'Paid', 'Balance', 'Status', 'Payment', 'Notes'], orderRowsX, [10, 12, 12, 22, 16, 34, 44, 10, 13, 12, 13, 13, 13, 12, 12, 30]) }
    ];
    const ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
    const files = [
      { name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>` },
      { name: '_rels/.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
      { name: 'xl/workbook.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="${ns}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((sh, i) => `<sheet name="${sh.name}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>` },
      { name: 'xl/_rels/workbook.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
      { name: 'xl/styles.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="${ns}"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1F6FEB"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>` }
    ].concat(sheets.map((sh, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sh.xml })));
    download(`Latesto_Data_${todayStr()}.xlsx`, zipStore(files), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    toast(`Excel downloaded: ${state.customers.length} customers, ${state.orders.length} orders`);
  }

  /* ---------- Settings ---------- */
  function renderSettings() {
    const s = state.settings;
    $('#settings-form').innerHTML = `
      <div class="field"><label>Business name</label><input name="name" value="${esc(s.name)}"></div>
      <div class="field"><label>Phone</label><input name="phone" value="${esc(s.phone)}"></div>
      <div class="field"><label>Email</label><input name="email" value="${esc(s.email)}"></div>
      <div class="field"><label>Address</label><input name="address" value="${esc(s.address)}"></div>
      <div class="field"><label>Currency symbol</label><input name="currency" value="${esc(s.currency)}" maxlength="4"></div>
      <div class="field"><label>Default turnaround (days)</label><input name="defaultDays" type="number" min="0" step="1" value="${s.defaultDays}"></div>
      <div class="field"><label>WhatsApp country code (for 10-digit numbers)</label><input name="countryCode" value="${esc(s.countryCode)}" maxlength="4" inputmode="numeric"></div>
      <div class="field full"><label>Pickup reminder message (WhatsApp)</label><textarea name="reminderTemplate" rows="5">${esc(s.reminderTemplate)}</textarea>
        <div class="muted" style="font-size:12px;margin-top:4px">You can use: {name} {order} {count} {items} {total} {balance} {balance_line} {due} {shop}</div></div>
      <div class="field full"><button class="btn primary" type="submit">Save settings</button></div>`;
  }

  /* ---------- Events ---------- */
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-view],[data-open],[data-invoice],[data-cust-orders],[data-last-invoice],[data-wa],[data-deliver],[data-new-order-for],[data-edit-cust],[data-del-cust],[data-edit-svc],[data-del-svc],[data-stock],[data-edit-item],[data-del-item]');
    if (!t) return;
    const d = t.dataset;
    if (d.view) return show(d.view);
    if (t.tagName === 'A') e.preventDefault();
    if (d.open) return orderDetail(d.open);
    if (d.invoice) return invoice(d.invoice);
    if (d.wa) return void sendReminder(d.wa);
    if (d.deliver) { const o = orderById(d.deliver); if (o) { o.status = 'delivered'; save(); render(); toast('Marked delivered'); } return; }
    if (d.custOrders) return customerHistory(d.custOrders);
    if (d.lastInvoice) {
      const latest = state.orders.filter((o) => o.customerId === d.lastInvoice).sort((a, b) => b.number - a.number)[0];
      return latest ? invoice(latest.id) : toast('No orders for this customer');
    }
    if (d.newOrderFor) { orderForm(); const sel = $('#of-cust'); if (sel) { sel.value = d.newOrderFor; sel.dispatchEvent(new Event('change')); } return; }
    if (d.editCust) return customerForm(d.editCust);
    if (d.delCust) {
      const c = customerById(d.delCust);
      if (state.orders.some((o) => o.customerId === c.id)) return toast('Cannot delete: this customer has orders');
      return confirmBox(`Delete customer ${c.name}?`, () => { state.customers = state.customers.filter((x) => x.id !== c.id); save(); render(); toast('Customer deleted'); });
    }
    if (d.editSvc) return serviceForm(d.editSvc);
    if (d.delSvc) return confirmBox('Delete this service? Existing orders keep their saved names and prices.', () => { state.services = state.services.filter((x) => x.id !== d.delSvc); save(); render(); });
    if (d.stock) return stockAdjust(d.stock, +d.dir);
    if (d.editItem) return itemForm(d.editItem);
    if (d.delItem) return confirmBox('Delete this inventory item?', () => { state.inventory = state.inventory.filter((x) => x.id !== d.delItem); save(); render(); });
  });

  $('#new-order-btn').onclick = () => orderForm();
  $('#new-customer-btn').onclick = () => customerForm();
  $('#new-service-btn').onclick = () => serviceForm();
  $('#new-item-btn').onclick = () => itemForm();
  $('#order-status-filter').onchange = renderOrders;
  $('#order-pay-filter').onchange = renderOrders;
  $('#rep-from').onchange = $('#rep-to').onchange = renderReports;
  $('#export-csv-btn').onclick = exportCsv;
  $$('.export-excel').forEach((b) => { b.onclick = exportExcel; });

  $('#global-search').addEventListener('input', (e) => {
    searchTerm = e.target.value.trim();
    if (searchTerm && !['orders', 'customers', 'reminders'].includes(currentView)) show('orders'); else render();
  });

  $('#settings-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = new FormData(e.target); const s = state.settings;
    ['name', 'phone', 'email', 'address', 'currency'].forEach((k) => { s[k] = String(f.get(k) || '').trim(); });
    s.name = s.name || 'Latesto Drycleaners'; s.currency = s.currency || '₹';
    s.defaultDays = Math.max(0, parseInt(f.get('defaultDays'), 10) || 0);
    s.countryCode = String(f.get('countryCode') || '').replace(/\D/g, '') || '91';
    s.reminderTemplate = String(f.get('reminderTemplate') || '').trim() || defaults().settings.reminderTemplate;
    save(); applyBrand(); toast('Settings saved');
  });

  $('#backup-btn').onclick = () => download(`latesto_backup_${todayStr()}.json`, JSON.stringify(state, null, 2), 'application/json');
  $('#restore-input').onchange = (e) => {
    const file = e.target.files[0]; if (!file) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        const s = JSON.parse(r.result);
        if (!Array.isArray(s.orders) || !Array.isArray(s.customers) || !Array.isArray(s.services)) throw new Error('bad format');
        confirmBox('Replace all current data with this backup?', () => { localStorage.setItem(KEY, JSON.stringify(s)); state = load(); save(); applyBrand(); show('dashboard'); toast('Backup restored'); });
      } catch (err) { toast('That file is not a valid backup'); }
    };
    r.readAsText(file); e.target.value = '';
  };
  $('#reset-btn').onclick = () => confirmBox('Erase ALL orders, customers and settings on EVERY device (phone, laptop, desktop)? Download a backup first if unsure.', () => { state = defaults(); save(); applyBrand(); show('dashboard'); toast('All data reset'); });

  /* ---------- App install / offline support ---------- */
  let installPrompt = null;
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installPrompt = e; $('#install-btn').hidden = false; });
  window.addEventListener('appinstalled', () => { installPrompt = null; $('#install-btn').hidden = true; toast('Latesto installed'); });
  $('#install-btn').onclick = async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    try { await installPrompt.userChoice; } catch (e) { /* ignore */ }
    installPrompt = null; $('#install-btn').hidden = true;
  };
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    navigator.serviceWorker.register('sw.js').catch((e) => console.warn('Offline mode unavailable', e));
  }
  // ask the browser not to clear this app's data when storage is low
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

  /* ---------- Hooks for cloud sync (sync.js) ---------- */
  window.LatestoApp = {
    getState: () => state,
    // called after cloud data was merged into the state: save on this device only, then redraw
    refresh() {
      try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
      if ($('#modal-root').innerHTML.trim()) { pendingRender = true; return; }
      applyBrand(); render();
    }
  };

  /* ---------- Init ---------- */
  save();
  applyBrand();
  show('dashboard');
})();
