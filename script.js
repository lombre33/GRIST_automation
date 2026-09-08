// Placeholder — logique de démonstration uniquement.
// L'intégration réelle avec la Grist Plugin API (grist.ready, grist.onRecords, docApi)
// sera ajoutée lors du développement du POC V0.5.

const toggleButton = document.getElementById('toggle-active');
const testButton = document.getElementById('test-workflow');
const logList = document.getElementById('log-list');

let isActive = false;

function addLog(message) {
  const li = document.createElement('li');
  const time = new Date().toLocaleTimeString();
  li.textContent = `[${time}] ${message}`;
  logList.prepend(li);
}

toggleButton.addEventListener('click', () => {
  isActive = !isActive;
  toggleButton.textContent = isActive ? 'Désactiver' : 'Activer';
  addLog(`Workflow ${isActive ? 'activé' : 'désactivé'} (placeholder, aucune exécution réelle).`);
});

testButton.addEventListener('click', () => {
  addLog('Simulation (dry-run) déclenchée — placeholder, aucun effet réel.');
});

// TODO: brancher grist.ready() et grist.onRecords() ici lors de l'implémentation réelle.
