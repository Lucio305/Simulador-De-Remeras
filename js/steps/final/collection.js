// Colección de remeras terminadas guardada en localStorage (la escribe el paso final,
// la muestra la bienvenida). Cada entrada lleva una miniatura JPEG chiquita.

const KEY = 'taller:coleccion';
export const MAX_COLLECTION = 12;

export function loadCollection() {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(list) ? list.filter((e) => e && typeof e === 'object' && e.id != null) : [];
  } catch (e) {
    return [];
  }
}

function store(list) {
  let l = list.slice(0, MAX_COLLECTION);
  // Si no entra en el cupo del navegador, se van descartando las más viejas.
  while (l.length) {
    try {
      localStorage.setItem(KEY, JSON.stringify(l));
      return true;
    } catch (e) {
      l = l.slice(0, -1);
    }
  }
  try {
    localStorage.removeItem(KEY);
  } catch (e) {
    /* sin storage */
  }
  return false;
}

// Agrega o reemplaza (mismo id) una remera al principio de la colección.
export function upsertShirt(entry) {
  const list = loadCollection().filter((e) => e.id !== entry.id);
  list.unshift(entry);
  return store(list);
}

export function updateShirtEntry(id, patch) {
  const list = loadCollection();
  const e = list.find((x) => x.id === id);
  if (!e) return false;
  Object.assign(e, patch);
  return store(list);
}

export function removeShirt(id) {
  return store(loadCollection().filter((e) => e.id !== id));
}

export function formatDate(ts) {
  try {
    return new Date(ts).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  } catch (e) {
    return '';
  }
}

// Modal con la ficha de una remera de la colección. Devuelve la promesa del modal.
// "Quitar" pide confirmación (no se puede deshacer).
export function showCollectionItem(ui, h, item, { onRemove } = {}) {
  const rows = [
    ['Nota', `${Math.round(item.score ?? 0)}/100${item.tier ? ' · ' + item.tier : ''}`],
    ['Tela', [item.colorHex ? h('span', { class: 'col-dot', style: { background: item.colorHex } }) : null, `${item.fabric || '—'}${item.colorName ? ' · ' + item.colorName : ''}`]],
    ['Estampa', item.technique || 'Sin estampa'],
    ['Molde', item.pattern || '—'],
  ];
  if (item.client) rows.push(['Pedido de', `${item.clientAvatar || ''} ${item.client}`]);
  if (item.wash) rows.push(['Lavado', item.wash]);
  const date = formatDate(item.date);
  const brand = item.brand || 'Mi Taller';
  const body = h(
    'div',
    { class: 'col-modal' },
    h('figure', { class: 'col-modal-photo' }, item.thumb ? h('img', { src: item.thumb, alt: 'Remera terminada' }) : h('div', { class: 'col-modal-empty' }, '👕'), h('figcaption', {}, date ? `Terminada el ${date}` : 'Remera terminada')),
    ui.propTable(rows),
  );
  const actions = [];
  if (onRemove) actions.push({ id: 'remove', label: 'Quitar de la colección', kind: 'ghost' });
  actions.push({ id: 'ok', label: 'Cerrar', kind: 'primary' });
  return ui.modal({ title: `👕 ${brand}`, body, actions }).then(async (id) => {
    if (id !== 'remove' || !onRemove) return id;
    const sure = await ui.modal({
      title: '¿Quitar esta remera?',
      body: h('p', { class: 'col-confirm' }, `Se borra de tu colección la remera de ${brand}${date ? ` del ${date}` : ''} (nota ${Math.round(item.score ?? 0)}). No se puede deshacer.`),
      actions: [
        { id: 'cancel', label: 'Cancelar', kind: 'secondary' },
        { id: 'yes', label: 'Sí, quitarla', kind: 'danger' },
      ],
    });
    if (sure === 'yes') {
      onRemove(item);
      ui.toast('Remera quitada de tu colección.', 'info', 2200);
      return 'remove';
    }
    return 'cancel';
  });
}
