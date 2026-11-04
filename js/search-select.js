// Liste avec recherche : remplace l'affichage d'un <select> natif, qui reste la source de vérité (masqué).
// Recherche par mots, dans n'importe quel ordre ; accents, casse et ponctuation ne comptent pas
// (« porteur 3 », « Porteur3 » et « 3 porteur » retrouvent Projets.Porteur_3, mais « Porteur_3 » tapé en entier ne retrouve pas Porteur_13).
(function (root) {
  'use strict';

  function searchKey(text) {
    return String(text).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  function searchWords(input) {
    return String(input).split(/\s+/).map(searchKey).filter(Boolean);
  }

  // Une saisie sans lettre ni chiffre ne filtre rien.
  function matches(input, optionText) {
    const key = searchKey(optionText);
    return searchWords(input).every((word) => key.includes(word));
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { searchKey, searchWords, matches };
    return;
  }

  const instances = [];

  // Les éléments d'une liste : l'hôte qui prend la place du <select> (et le garde, masqué), le bouton qui montre le choix, le panneau (recherche et options).
  function build(select, settings) {
    const host = document.createElement('div');
    host.className = 'ss-host';
    select.before(host);
    host.append(select);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'ss-button';
    button.setAttribute('aria-haspopup', 'listbox');
    button.setAttribute('aria-expanded', 'false');
    const label = document.createElement('span');
    label.className = 'ss-label';
    const chevron = document.createElement('span');
    chevron.className = 'icon icon-chevron';
    chevron.setAttribute('aria-hidden', 'true');
    button.append(label, chevron);
    button.hidden = Boolean(settings.menu);
    const panel = document.createElement('div');
    panel.className = 'ss-panel';
    panel.hidden = true;
    const search = document.createElement('input');
    search.type = 'text';
    search.setAttribute('autocomplete', 'off');
    search.setAttribute('aria-label', root.I18n.t('list.search'));
    const list = document.createElement('ul');
    list.className = 'ss-options';
    list.setAttribute('role', 'listbox');
    panel.append(search, list);
    host.append(button, panel);
    return { select, settings, host, button, label, panel, search, list, shown: [], activeIndex: 0 };
  }

  // ss : une liste construite par build ; shown : les options que la recherche laisse voir ; activeIndex : celle que les flèches désignent.
  const selectedOption = (ss) => ss.select.options[ss.select.selectedIndex];

  // Le bouton montre le choix du <select> et le suit quand il est grisé ; les textes suivent la langue.
  function refresh(ss) {
    const option = selectedOption(ss);
    ss.label.textContent = option ? option.textContent : '';
    ss.label.classList.toggle('is-empty', !option || option.value === '');
    ss.search.placeholder = root.I18n.t('list.search');
    ss.search.setAttribute('aria-label', root.I18n.t('list.search'));
    ss.button.disabled = ss.select.disabled;
  }

  function render(ss) {
    ss.list.replaceChildren();
    ss.shown = Array.from(ss.select.options).filter((option) => matches(ss.search.value, option.textContent));
    ss.activeIndex = Math.max(0, ss.shown.findIndex((option) => option === selectedOption(ss)));
    if (!ss.shown.length) {
      const none = document.createElement('li');
      none.className = 'ss-none';
      none.textContent = root.I18n.t('list.noResult');
      ss.list.append(none);
      return;
    }
    ss.shown.forEach((option, index) => {
      const item = document.createElement('li');
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', String(option === selectedOption(ss)));
      item.classList.toggle('is-empty-option', option.value === '');
      item.classList.toggle('is-active', index === ss.activeIndex);
      item.textContent = option.textContent;
      item.addEventListener('mousedown', (event) => { event.preventDefault(); choose(ss, option); });
      ss.list.append(item);
    });
  }

  function moveActive(ss, delta) {
    if (!ss.shown.length) return;
    ss.activeIndex = (ss.activeIndex + delta + ss.shown.length) % ss.shown.length;
    Array.from(ss.list.children).forEach((item, index) => item.classList.toggle('is-active', index === ss.activeIndex));
    ss.list.children[ss.activeIndex].scrollIntoView({ block: 'nearest' });
  }

  // Le panneau s'ouvre sous le bouton, ou au-dessus s'il manque de place en bas du cadre.
  function open(ss) {
    if (ss.select.disabled) return;
    ss.search.value = '';
    render(ss);
    ss.panel.hidden = false;
    ss.panel.classList.remove('up');
    const room = window.innerHeight - ss.button.getBoundingClientRect().bottom;
    ss.panel.classList.toggle('up', room < ss.panel.offsetHeight + 8);
    ss.button.setAttribute('aria-expanded', 'true');
    ss.search.focus();
  }

  function close(ss, returnFocus) {
    if (ss.panel.hidden) return;
    ss.panel.hidden = true;
    ss.button.setAttribute('aria-expanded', 'false');
    if (returnFocus && !ss.settings.menu) ss.button.focus();
    if (ss.settings.onClose) ss.settings.onClose();
  }

  // Le choix passe par le <select>, qui reste la source de vérité : son événement change prévient le canevas.
  function choose(ss, option) {
    ss.select.value = option.value;
    refresh(ss);
    close(ss, true);
    ss.select.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function onSearchKey(ss, event) {
    if (event.key === 'ArrowDown') { event.preventDefault(); moveActive(ss, 1); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); moveActive(ss, -1); }
    else if (event.key === 'Enter') { event.preventDefault(); if (ss.shown[ss.activeIndex]) choose(ss, ss.shown[ss.activeIndex]); }
    else if (event.key === 'Escape') { event.preventDefault(); close(ss, true); } // ferme le panneau seul, pas la fenêtre
    else if (event.key === 'Tab') close(ss, false);
  }

  // options.menu : pas de bouton, le panneau s'ouvre par open() à l'endroit de l'hôte (menu d'ajout du canevas) ; onClose est appelé à la fermeture.
  function attach(select, options) {
    const ss = build(select, options || {});
    ss.button.addEventListener('click', () => (ss.panel.hidden ? open(ss) : close(ss, false)));
    ss.button.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); open(ss); }
    });
    ss.search.addEventListener('input', () => render(ss));
    ss.search.addEventListener('keydown', (event) => onSearchKey(ss, event));
    document.addEventListener('mousedown', (event) => { if (!ss.host.contains(event.target)) close(ss, false); });
    const instance = { refresh: () => refresh(ss), open: () => open(ss), host: ss.host };
    instances.push(instance);
    refresh(ss);
    return instance;
  }

  // Changement de langue : les listes encore dans la page se remettent à jour ; celles des nœuds supprimés ou rechargés sont oubliées.
  document.addEventListener('langchange', () => {
    for (let i = instances.length - 1; i >= 0; i -= 1) {
      if (instances[i].host.isConnected) instances[i].refresh();
      else instances.splice(i, 1);
    }
  });
  root.SearchSelect = { attach, searchKey, searchWords, matches };
})(typeof window !== 'undefined' ? window : globalThis);
