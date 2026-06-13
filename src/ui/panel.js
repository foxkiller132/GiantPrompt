// Draggable panels with the spec's "sticky-anchor" persistence.
//
// Every non-map element is draggable. When a panel is moved, its coordinates are
// written to localStorage; when it is closed and reopened it snaps back to that
// saved position, preserving the player's workflow. Open/close uses deliberate
// magical transitions (CSS) rather than immediate state changes.

const STORE_KEY = 'aa:panel-anchors';

function loadAnchors() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; }
  catch { return {}; }
}

function saveAnchor(id, x, y) {
  const all = loadAnchors();
  all[id] = { x, y };
  localStorage.setItem(STORE_KEY, JSON.stringify(all));
}

export class Panel {
  constructor(id, title, bodyEl) {
    this.id = id;
    this.el = document.createElement('section');
    this.el.className = 'aa-panel aa-frame';
    this.el.dataset.panel = id;
    this.el.innerHTML = `
      <div class="aa-panel-bar">
        <span class="aa-panel-title">${title}</span>
        <button class="aa-panel-close" aria-label="Close">✕</button>
      </div>
      <div class="aa-panel-body"></div>`;
    this.el.querySelector('.aa-panel-body').appendChild(bodyEl);
    this.el.querySelector('.aa-panel-close')
      .addEventListener('click', () => this.close());

    this._makeDraggable(this.el.querySelector('.aa-panel-bar'));
    document.body.appendChild(this.el);

    // Snap back to the saved anchor, or a sensible default.
    const anchor = loadAnchors()[id];
    this.move(anchor ? anchor.x : 120, anchor ? anchor.y : 120);
    this.close(true); // start hidden, no transition on first frame
  }

  move(x, y) {
    const maxX = window.innerWidth - this.el.offsetWidth - 8;
    const maxY = window.innerHeight - this.el.offsetHeight - 8;
    this.x = Math.max(8, Math.min(x, Math.max(8, maxX)));
    this.y = Math.max(64, Math.min(y, Math.max(64, maxY)));
    this.el.style.left = `${this.x}px`;
    this.el.style.top = `${this.y}px`;
  }

  open() {
    const anchor = loadAnchors()[this.id];
    if (anchor) this.move(anchor.x, anchor.y); // snap back on reopen
    this.el.classList.add('is-open');
  }

  close(instant = false) {
    if (instant) this.el.classList.add('is-instant');
    this.el.classList.remove('is-open');
    if (instant) requestAnimationFrame(() => this.el.classList.remove('is-instant'));
  }

  toggle() {
    this.el.classList.contains('is-open') ? this.close() : this.open();
  }

  _makeDraggable(handle) {
    let startX, startY, originX, originY, dragging = false;
    const onDown = (e) => {
      dragging = true;
      startX = e.clientX; startY = e.clientY;
      originX = this.x; originY = this.y;
      this.el.classList.add('is-dragging');
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    };
    const onMove = (e) => {
      if (!dragging) return;
      this.move(originX + (e.clientX - startX), originY + (e.clientY - startY));
    };
    const onUp = () => {
      dragging = false;
      this.el.classList.remove('is-dragging');
      saveAnchor(this.id, this.x, this.y); // remember coordinates
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    handle.addEventListener('pointerdown', onDown);
  }
}
