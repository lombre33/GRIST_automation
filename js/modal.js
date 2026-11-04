// Base commune des fenêtres : voile, cadre à trois zones (titre fixe, contenu qui défile, boutons fixes), trois largeurs.
// Le clavier est tenu pour la fenêtre du dessus : le focus entre à l'ouverture et revient à l'ouvreur, Tab tourne dans la fenêtre,
// Échap la ferme (sauf si un composant, comme la liste avec recherche, l'a déjà pris). Un clic sur le voile ne ferme rien.
(function (root) {
  'use strict';
  const FOCUSABLE = 'a[href], button, input:not([type="hidden"]), [tabindex]';
  const stack = [];

  function focusables(box) {
    return Array.from(box.querySelectorAll(FOCUSABLE)).filter((el) => !el.disabled && el.tabIndex >= 0 && el.getClientRects().length > 0);
  }

  function onKeydown(event) {
    const top = stack[stack.length - 1];
    if (!top || event.defaultPrevented) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      top.close();
    } else if (event.key === 'Tab') {
      const items = focusables(top.box);
      if (!items.length) { event.preventDefault(); top.box.focus(); return; }
      const first = items[0];
      const last = items[items.length - 1];
      const outside = !top.box.contains(document.activeElement);
      if (outside || (event.shiftKey && document.activeElement === first) || (!event.shiftKey && document.activeElement === last)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      }
    }
  }

  // width : 'narrow' (400 px, questions), 'form' (480 px, formulaires), 'media' (620 px, fenêtre à captures, comme celle des nouveautés de la charte) ou 'large' (960 px plafonnés au panneau).
  // body : nœud DOM ; buttons : [{ label, primary, onClick }] — « Fermer » est ajouté si la liste est vide ; actions : nœuds posés à la place des boutons, pour une fenêtre
  // qui tient elle-même les siens (la prise en main : ses points, « Précédent », « Suivant »).
  function create({ title, width = 'narrow', body, buttons = [], actions = null, onClose }) {
    const opener = document.activeElement;
    const overlay = document.createElement('div');
    overlay.className = 'modal';
    const box = document.createElement('div');
    box.className = 'modal-box' + ({ form: ' w-form', media: ' w-media', large: ' w-large' }[width] || '');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.tabIndex = -1;

    const heading = document.createElement('h2');
    heading.className = 'modal-title';
    heading.id = 'modal-title-' + (stack.length + 1);
    heading.textContent = title;
    box.setAttribute('aria-labelledby', heading.id);

    const content = document.createElement('div');
    content.className = 'modal-body';
    content.append(body);

    const footer = document.createElement('div');
    footer.className = 'modal-footer';
    const win = { box, close };
    const list = actions ? [] : buttons.length ? buttons : [{ label: root.I18n.t('modal.close') }];
    if (actions) footer.append(...actions);
    for (const spec of list) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = spec.label;
      if (spec.primary) button.className = 'primary';
      button.addEventListener('click', () => { if (spec.onClick) spec.onClick(); close(); });
      footer.append(button);
    }

    box.append(heading, content, footer);
    overlay.append(box);
    document.body.append(overlay);
    stack.push(win);
    if (stack.length === 1) document.addEventListener('keydown', onKeydown);
    (box.querySelector('button.primary') || focusables(box)[0] || box).focus();

    function close() {
      const index = stack.indexOf(win);
      if (index === -1) return;
      stack.splice(index, 1);
      if (!stack.length) document.removeEventListener('keydown', onKeydown);
      overlay.remove();
      if (onClose) onClose();
      if (opener && opener.isConnected && typeof opener.focus === 'function') opener.focus();
    }
    return { close, box, footer };
  }

  // Question à deux boutons (Annuler, puis l'action) : rend une promesse qui vaut true pour l'action, false pour Annuler ou Échap.
  // Le focus est sur l'action, sauf pour une question destructrice (danger) où il est sur Annuler.
  function confirm({ title, message, confirmLabel, cancelLabel, danger }) {
    return new Promise((resolve) => {
      const body = document.createElement('p');
      body.textContent = message;
      const buttons = [
        { label: cancelLabel, onClick: () => resolve(false) },
        { label: confirmLabel, primary: !danger, onClick: () => resolve(true) },
      ];
      create({ title, body, buttons, onClose: () => resolve(false) });
    });
  }

  // Une fenêtre est-elle ouverte ? (la prise en main ne s'ouvre jamais d'elle-même par-dessus une autre)
  const isOpen = () => stack.length > 0;

  root.Modal = { create, confirm, isOpen };
})(window);
