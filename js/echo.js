// Anti-boucle précis : reconnaît, dans les événements détectés, ceux qui ne sont que l'écho des écritures du widget lui-même,
// et limite le nombre d'exécutions rapprochées sur une même ligne (filet de sécurité si l'écho n'est pas reconnu).
// Logique pure, sans DOM ni Grist. `now` est injectable pour les tests.
(function (root) {
  'use strict';

  const ECHO_TTL = 15000;   // une écriture attendue qui n'est jamais revenue est oubliée après 15 s
  const LOOP_WINDOW = 10000;
  const LOOP_MAX = 5;       // exécutions maximum sur la même ligne dans la fenêtre

  function same(a, b) {
    if (JSON.stringify(a) === JSON.stringify(b)) return true;
    return a !== null && b !== null && a !== undefined && b !== undefined && typeof a !== 'object' && typeof b !== 'object' && String(a) === String(b);
  }

  function create(now = Date.now) {
    let pending = [];
    let nextId = 1;
    const runs = new Map();

    const purge = () => { pending = pending.filter((p) => now() - p.at < ECHO_TTL); };

    // À appeler avant d'envoyer les écritures : l'écho peut arriver avant la réponse de Grist.
    function expect(effects) {
      purge();
      const id = nextId++;
      for (const effect of effects) pending.push({ id, at: now(), type: effect.type, rowId: effect.rowId, values: Object.assign({}, effect.values) });
      return id;
    }

    // L'écriture a échoué : rien ne reviendra.
    function cancel(id) { pending = pending.filter((p) => p.id !== id); }

    // Retire des événements ce qui s'explique par nos écritures. Une modification qui mêle notre valeur et celle d'une personne
    // est gardée, réduite aux colonnes qui ne viennent pas de nous.
    function filter(events) {
      purge();
      const out = [];
      for (const event of events) {
        if (event.type === 'update') {
          const changed = Object.assign({}, event.changed);
          for (const p of pending) {
            if (p.type !== 'UpdateRecord' || p.rowId !== event.rowId) continue;
            for (const key of Object.keys(p.values)) {
              if (key in changed && same(changed[key].to, p.values[key])) {
                delete changed[key];
                delete p.values[key];
              }
            }
          }
          pending = pending.filter((p) => p.type !== 'UpdateRecord' || Object.keys(p.values).length > 0);
          if (Object.keys(changed).length) out.push(Object.assign({}, event, { changed }));
        } else if (event.type === 'create') {
          const index = pending.findIndex((p) => p.type === 'AddRecord' && Object.keys(p.values).every((key) => same(event.record[key], p.values[key])));
          if (index >= 0) pending.splice(index, 1);
          else out.push(event);
        } else {
          out.push(event);
        }
      }
      return out;
    }

    // false quand la même ligne a déjà déclenché LOOP_MAX exécutions dans la fenêtre : on s'arrête plutôt que de boucler.
    function allowRun(rowId) {
      const t = now();
      const recent = (runs.get(rowId) || []).filter((time) => t - time < LOOP_WINDOW);
      const allowed = recent.length < LOOP_MAX;
      if (allowed) recent.push(t);
      runs.set(rowId, recent);
      return allowed;
    }

    return { expect, cancel, filter, allowRun };
  }

  const api = { create, same, LOOP_MAX, LOOP_WINDOW, ECHO_TTL };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Echo = api;
})(typeof window !== 'undefined' ? window : globalThis);
