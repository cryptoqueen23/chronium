// Start-up gate. Runs before the application and before anything opens the case database at the new version.
// If this browser holds cases from an older version of Chronium, ask first: the update is one-way (older versions of
// the site cannot open the updated storage), so a backup file is offered before it happens. Looking at the old
// database never upgrades it. Nothing is changed until the person chooses.
import { pendingUpgrade, buildRawBackup, backupFileName } from './upgrade.js';
import { openDb } from './db.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function mountPanel(html) {
  let host = document.getElementById('upgradeGate');
  if (!host) { host = document.createElement('div'); host.id = 'upgradeGate'; document.body.prepend(host); }
  host.innerHTML = html;
  return host;
}
function trapFocus(root) {
  root.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const f = [...root.querySelectorAll('button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])')];
    if (!f.length) return;
    const first = f[0]; const last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
}
function download(text, name) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function askAboutUpgrade(info) {
  return new Promise((resolve) => {
    const n = info.counts.investigations || 0; const r = info.counts.records || 0;
    const host = mountPanel(`
      <div class="ug-backdrop"></div>
      <div class="ug-box" role="alertdialog" aria-modal="true" aria-labelledby="ug-title" aria-describedby="ug-desc">
        <h1 id="ug-title" tabindex="-1">Chronium is about to update how it stores your work</h1>
        <p id="ug-desc">This browser holds ${n} investigation${n === 1 ? '' : 's'} and ${r} saved source${r === 1 ? '' : 's'}. The update changes how they are stored on this device. Your work stays on this device and is not sent anywhere.</p>
        <p><strong>It cannot be undone by going back to an older version of Chronium:</strong> after the update, older versions cannot open your cases. We recommend saving a backup file first, and keeping it. You can restore it later.</p>
        <p id="ug-status" role="status" aria-live="polite"></p>
        <p class="ug-actions"><button type="button" id="ug-backup" class="ug-primary">Download a backup</button> <button type="button" id="ug-go" disabled>Update now</button> <button type="button" id="ug-nobackup">Update without a backup</button></p>
        <p class="ug-hint">Update now becomes available after the backup has been saved.</p>
      </div>`);
    const $ = (s) => host.querySelector(s); const status = $('#ug-status');
    host.querySelectorAll('button').forEach((b) => b.addEventListener('keydown', () => {}));
    trapFocus($('.ug-box'));
    $('#ug-title').focus();
    $('#ug-backup').addEventListener('click', async () => {
      status.textContent = 'Making the backup…';
      try {
        const backup = await buildRawBackup();
        if (!backup) throw new Error('nothing to back up');
        download(JSON.stringify(backup), backupFileName(backup));
        status.textContent = `Backup saved as ${backupFileName(backup)} (${Object.entries(backup.counts).filter(([, c]) => c).map(([k, c]) => `${c} ${k}`).join(', ')}). Check your downloads folder. You can now update.`;
        $('#ug-go').disabled = false; $('#ug-go').focus();
      } catch (e) {
        status.setAttribute('role', 'alert');
        status.textContent = `The backup could not be made: ${e && e.message ? e.message : 'unknown problem'}. Nothing has been changed. You can try again, or update without a backup.`;
      }
    });
    $('#ug-go').addEventListener('click', () => { host.remove(); resolve('updated-with-backup'); });
    $('#ug-nobackup').addEventListener('click', () => {
      const ok = window.confirm('Update without a backup? After the update, older versions of Chronium will not be able to open your cases.');
      if (ok) { host.remove(); resolve('updated-without-backup'); } else $('#ug-nobackup').focus();
    });
  });
}

function showStorageProblem(message) {
  const host = mountPanel(`
    <div class="ug-backdrop"></div>
    <div class="ug-box" role="alertdialog" aria-modal="true" aria-labelledby="ug-title" aria-describedby="ug-desc">
      <h1 id="ug-title" tabindex="-1">Chronium could not finish updating its storage</h1>
      <p id="ug-desc">${esc(message)}</p>
      <p>Your cases have not been changed by this failed attempt. Close other Chronium tabs and windows, then try again. If you made a backup file, you can restore it from the Investigations page after the update completes.</p>
      <p class="ug-actions"><button type="button" id="ug-retry" class="ug-primary">Try again</button></p>
    </div>`);
  trapFocus(host.querySelector('.ug-box'));
  host.querySelector('#ug-title').focus();
  host.querySelector('#ug-retry').addEventListener('click', () => location.reload());
}

(async function boot() {
  let proceed = true;
  try {
    const info = await pendingUpgrade();
    if (info.pending && info.hasData) await askAboutUpgrade(info);
  } catch { /* if the old database cannot even be inspected, let the application try and report */ }
  let blocked = false;
  addEventListener('chronium-db-blocked', () => { blocked = true; });
  try {
    await Promise.race([openDb(), new Promise((_, rej) => setTimeout(() => rej(new Error(blocked ? 'blocked' : 'timeout')), 15_000))]);
  } catch (e) {
    proceed = false;
    showStorageProblem(blocked || (e && e.message === 'blocked') ? 'Another Chronium tab or window is still open with an older version, which stops the update.' : `The browser reported: ${e && e.message ? e.message : 'a storage error'}.`);
  }
  if (proceed) await import('./app.js');
})();
