// Shared accessibility primitives for the nav drawer, modals, and menus:
// focus trapping, Escape-to-close, backdrop click, and focus return to the
// element that opened the overlay. No dependencies, no framework.

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusablesIn(container) {
  return [...container.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null);
}

function trapFocus(container) {
  function onKeydown(e) {
    if (e.key !== 'Tab') return;
    const focusables = focusablesIn(container);
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
  container.addEventListener('keydown', onKeydown);
  return () => container.removeEventListener('keydown', onKeydown);
}

// Opens a modal-style overlay: traps focus inside `panelEl`, closes on
// Escape or a click on `overlayEl` itself (the backdrop), and returns focus
// to whatever had focus before opening. Returns a `close()` function.
export function openOverlay(overlayEl, panelEl, { onClose, initialFocusEl } = {}) {
  const opener = document.activeElement;
  overlayEl.classList.remove('hidden');
  document.body.classList.add('overlay-open');
  const releaseTrap = trapFocus(panelEl);

  const target = initialFocusEl || focusablesIn(panelEl)[0] || panelEl;
  requestAnimationFrame(() => target.focus());

  let closed = false;
  function onKeydown(e) {
    if (e.key === 'Escape') close();
  }
  function onBackdropClick(e) {
    if (e.target === overlayEl) close();
  }
  document.addEventListener('keydown', onKeydown);
  overlayEl.addEventListener('click', onBackdropClick);

  function close() {
    if (closed) return;
    closed = true;
    overlayEl.classList.add('hidden');
    document.body.classList.remove('overlay-open');
    releaseTrap();
    document.removeEventListener('keydown', onKeydown);
    overlayEl.removeEventListener('click', onBackdropClick);
    if (opener && typeof opener.focus === 'function') opener.focus();
    onClose?.();
  }
  return close;
}

// Opens a lightweight popup menu (e.g. an investigation's ••• menu): no
// focus trap, but closes on Escape, outside click, or item selection, and
// returns focus to the trigger button.
export function openMenu(menuEl, triggerEl, { onClose } = {}) {
  menuEl.classList.remove('hidden');
  triggerEl.setAttribute('aria-expanded', 'true');
  const first = menuEl.querySelector('[role="menuitem"]');
  first?.focus();

  function onDocClick(e) {
    if (!menuEl.contains(e.target) && e.target !== triggerEl) close();
  }
  function onKeydown(e) {
    if (e.key === 'Escape') { close(); triggerEl.focus(); }
  }
  document.addEventListener('click', onDocClick, true);
  document.addEventListener('keydown', onKeydown);

  function close() {
    menuEl.classList.add('hidden');
    triggerEl.setAttribute('aria-expanded', 'false');
    document.removeEventListener('click', onDocClick, true);
    document.removeEventListener('keydown', onKeydown);
    onClose?.();
  }
  return close;
}

// Promise-based confirmation dialog built on openOverlay. Reuses one
// dialog element in the DOM (see #confirmDialog in index.html) so callers
// don't need to build markup per confirmation.
export function confirmDialog({ title, message, confirmLabel = 'Confirm', danger = false }) {
  const overlay = document.querySelector('#confirmDialog');
  const panel = overlay.querySelector('.dialog-panel');
  overlay.querySelector('#confirmDialogTitle').textContent = title;
  overlay.querySelector('#confirmDialogMessage').textContent = message;
  const confirmBtn = overlay.querySelector('#confirmDialogConfirm');
  const cancelBtn = overlay.querySelector('#confirmDialogCancel');
  confirmBtn.textContent = confirmLabel;
  confirmBtn.classList.toggle('btn-danger', danger);

  return new Promise((resolve) => {
    let close;
    function finish(result) {
      close();
      confirmBtn.removeEventListener('click', onConfirm);
      cancelBtn.removeEventListener('click', onCancel);
      resolve(result);
    }
    function onConfirm() { finish(true); }
    function onCancel() { finish(false); }
    confirmBtn.addEventListener('click', onConfirm);
    cancelBtn.addEventListener('click', onCancel);
    close = openOverlay(overlay, panel, { initialFocusEl: cancelBtn, onClose: () => resolve(false) });
  });
}
