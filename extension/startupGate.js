// Start-up guard for the saved research in this extension. Runs before the panel touches the database.
//   1. Looks at the existing database WITHOUT upgrading it (lib/upgrade.js opens it with no version number).
//   2. If a newer version of Chronium made it, refuses to continue and says so: nothing is changed, nothing is lost.
//   3. If this version would upgrade it, offers a backup file first and only upgrades after the person chooses.
//   4. If the database cannot be opened, says so in words and changes nothing.
// A brand-new install has nothing to protect and passes straight through.
import { pendingUpgrade, buildRawBackup, backupFileName } from './lib/upgrade.js';
import { openDb } from './lib/db.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function mount(html) {
  let host = document.getElementById('startupGate');
  if (!host) { host = document.createElement('div'); host.id = 'startupGate'; document.body.prepend(host); }
  host.innerHTML = html;
  return host;
}
function trapFocus(root) {
  root.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const f = [...root.querySelectorAll('button:not([disabled]), [tabindex]:not([tabindex="-1"])')];
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

function stopWith(title, paragraphs) {
  const host = mount(`<div class="ug-backdrop"></div><div class="ug-box" role="alertdialog" aria-modal="true" aria-labelledby="ug-title" aria-describedby="ug-desc">
    <h2 id="ug-title" tabindex="-1">${esc(title)}</h2><div id="ug-desc">${paragraphs.map((p) => `<p>${esc(p)}</p>`).join('')}</div></div>`);
  trapFocus(host.querySelector('.ug-box'));
  host.querySelector('#ug-title').focus();
}

function askAboutUpgrade(info) {
  return new Promise((resolve) => {
    const n = info.counts.investigations || 0; const r = info.counts.records || 0;
    const host = mount(`<div class="ug-backdrop"></div><div class="ug-box" role="alertdialog" aria-modal="true" aria-labelledby="ug-title" aria-describedby="ug-desc">
      <h2 id="ug-title" tabindex="-1">Chronium is about to update how it stores your research</h2>
      <div id="ug-desc"><p>This browser holds ${n} case${n === 1 ? '' : 's'} and ${r} saved source${r === 1 ? '' : 's'}. Your research stays on this computer and is not sent anywhere.</p>
      <p><strong>The update cannot be undone by going back to an older version.</strong> Please save a backup file first and keep it. You can restore it later.</p></div>
      <p id="ug-status" role="status" aria-live="polite"></p>
      <p class="ug-actions"><button type="button" id="ug-backup" class="primary">Download a backup</button> <button type="button" id="ug-go" disabled>Update now</button> <button type="button" id="ug-nobackup">Update without a backup</button></p>
      <p class="hint">Update now becomes available after the backup has been saved.</p></div>`);
    const $ = (s) => host.querySelector(s); const status = $('#ug-status');
    trapFocus($('.ug-box')); $('#ug-title').focus();
    $('#ug-backup').addEventListener('click', async () => {
      status.textContent = 'Making the backup...';
      try {
        const backup = await buildRawBackup();
        if (!backup) throw new Error('nothing to back up');
        download(JSON.stringify(backup), backupFileName(backup));
        status.textContent = `Backup saved as ${backupFileName(backup)}. Check your Downloads folder. You can now update.`;
        $('#ug-go').disabled = false; $('#ug-go').focus();
      } catch (e) {
        status.setAttribute('role', 'alert');
        status.textContent = `The backup could not be made: ${e && e.message ? e.message : 'unknown problem'}. Nothing has been changed. You can try again.`;
      }
    });
    $('#ug-go').addEventListener('click', () => { host.remove(); resolve(); });
    $('#ug-nobackup').addEventListener('click', () => {
      if (window.confirm('Update without a backup? Older versions of Chronium will not be able to open your cases afterwards.')) { host.remove(); resolve(); } else $('#ug-nobackup').focus();
    });
  });
}

/** Resolves true when the panel may start, false when it must not (a message is already on screen). */
export async function startupGate() {
  let info = null;
  try { info = await pendingUpgrade(); } catch { /* cannot even look: let the open below report it */ }
  if (info && info.fromVersion > info.toVersion) {
    stopWith('These saved cases were made by a newer version of Chronium', [
      'This copy of the extension is older than the one that saved your research, so it cannot open it safely. Nothing has been changed or lost.',
      'Close this panel and install the newer version of the extension (or the copy you used before), then open it again.'
    ]);
    return false;
  }
  if (info && info.pending && info.hasData) await askAboutUpgrade(info);
  let blocked = false;
  const onBlocked = () => { blocked = true; };
  addEventListener('chronium-db-blocked', onBlocked);
  try {
    await Promise.race([openDb(), new Promise((_, rej) => setTimeout(() => rej(new Error(blocked ? 'blocked' : 'timeout')), 15_000))]);
    return true;
  } catch (e) {
    stopWith('Chronium could not open your saved research', [
      blocked || (e && e.message === 'blocked') ? 'Another Chronium panel or window is still open with an older version. Close it and try again.' : `The browser reported: ${e && e.message ? e.message : 'a storage error'}.`,
      'Your saved research has not been changed by this failed attempt. Close this panel and open it again.'
    ]);
    return false;
  } finally { removeEventListener('chronium-db-blocked', onBlocked); }
}
