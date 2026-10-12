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

  // options.menu : pas de bouton, le panneau s'ouvre par open() à l'endroit de l'hôte (menu d'ajout du canevas) ; onClose est appelé à la fermeture.
  function attach(select, options) {
    const settings = options || {};
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

    let shown = [];
    let activeIndex = 0;

    function selectedOption() {
      return select.options[select.selectedIndex];
    }

    function refresh() {
      const option = selectedOption();
      label.textContent = option ? option.textContent : '';
      label.classList.toggle('is-empty', !option || option.value === '');
      search.placeholder = root.I18n.t('list.search');
      search.setAttribute('aria-label', root.I18n.t('list.search'));
      button.disabled = select.disabled;
    }

    function render() {
      list.replaceChildren();
      shown = Array.from(select.options).filter((option) => matches(search.value, option.textContent));
      activeIndex = Math.max(0, shown.findIndex((option) => option === selectedOption()));
      if (!shown.length) {
        const none = document.createElement('li');
        none.className = 'ss-none';
        none.textContent = root.I18n.t('list.noResult');
        list.append(none);
        return;
      }
      shown.forEach((option, index) => {
        const item = document.createElement('li');
        item.setAttribute('role', 'option');
        item.setAttribute('aria-selected', String(option === selectedOption()));
        item.classList.toggle('is-empty-option', option.value === '');
        item.classList.toggle('is-active', index === activeIndex);
        item.textContent = option.textContent;
        item.addEventListener('mousedown', (event) => { event.preventDefault(); choose(option); });
        list.append(item);
      });
    }

    function moveActive(delta) {
      if (!shown.length) return;
      activeIndex = (activeIndex + delta + shown.length) % shown.length;
      Array.from(list.children).forEach((item, index) => item.classList.toggle('is-active', index === activeIndex));
      list.children[activeIndex].scrollIntoView({ block: 'nearest' });
    }

    function open() {
      if (select.disabled) return;
      search.value = '';
      render();
      panel.hidden = false;
      panel.classList.remove('up');
      const room = window.innerHeight - button.getBoundingClientRect().bottom;
      panel.classList.toggle('up', room < panel.offsetHeight + 8);
      button.setAttribute('aria-expanded', 'true');
      search.focus();
    }

    function close(returnFocus) {
      if (panel.hidden) return;
      panel.hidden = true;
      button.setAttribute('aria-expanded', 'false');
      if (returnFocus && !settings.menu) button.focus();
      if (settings.onClose) settings.onClose();
    }

    function choose(option) {
      select.value = option.value;
      refresh();
      close(true);
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }

    button.addEventListener('click', () => (panel.hidden ? open() : close(false)));
    button.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); open(); }
    });
    search.addEventListener('input', render);
    search.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowDown') { event.preventDefault(); moveActive(1); }
      else if (event.key === 'ArrowUp') { event.preventDefault(); moveActive(-1); }
      else if (event.key === 'Enter') { event.preventDefault(); if (shown[activeIndex]) choose(shown[activeIndex]); }
      else if (event.key === 'Escape') { event.preventDefault(); close(true); } // ferme le panneau seul, pas la fenêtre
      else if (event.key === 'Tab') close(false);
    });
    document.addEventListener('mousedown', (event) => { if (!host.contains(event.target)) close(false); });

    const instance = { refresh, open };
    instances.push(instance);
    refresh();
    return instance;
  }

  document.addEventListener('langchange', () => instances.forEach((instance) => instance.refresh()));
  root.SearchSelect = { attach, searchKey, searchWords, matches };
})(typeof window !== 'undefined' ? window : globalThis);
