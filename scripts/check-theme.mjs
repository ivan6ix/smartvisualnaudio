/* global console, process */
// Local CSS cascade regression check; does not sign in or access backend data.
// Run: node scripts/check-theme.mjs [path-to-chrome-or-edge]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL, URL } from 'node:url';

const browser = process.argv[2] || [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/chromium', '/usr/bin/google-chrome',
].find(file => fs.existsSync(file));
if (!browser) throw new Error('Pass the path to a Chromium browser as the first argument.');
const tempRoot = fs.realpathSync(os.tmpdir());
const work = fs.mkdtempSync(path.join(tempRoot, 'smart-theme-'));
function removeTemporaryProfile() {
  const resolved = fs.realpathSync(work);
  if (path.dirname(resolved) !== tempRoot || !path.basename(resolved).startsWith('smart-theme-')) throw new Error('Unexpected temporary path.');
  fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
const css = fs.readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8').replace(/@tailwind [^;]+;/g, '');
const roles = ['admin-dashboard-page', 'admin-section-page', 'professor-shell', 'student-shell', 'cluster-role-shell'];
const selectors = ['.card', 'h2', '.message-menu-empty', '.btn', '.btn-light', '.badge-blue', '.badge-success', 'input', 'th', 'td', '.modal', '.avatar-crop-modal', '.avatar-crop-modal p'];
const fixture = roles.map(role => `<main class="${role}" data-role="${role}"><section class="card"><h2>Heading</h2><p class="message-menu-empty">Secondary</p><button class="btn">Save</button><button class="btn btn-light">Cancel</button><div class="student-course-panel"><span class="badge badge-blue">12</span><span class="badge badge-success">Approved</span></div><div class="search-box"><input placeholder="Search"></div><table><thead><tr><th>Name</th></tr></thead><tbody><tr><td>Example</td></tr></tbody></table><section class="modal" role="dialog"><h2>Modal</h2><div class="card">Nested</div><input placeholder="Name"></section><section class="avatar-crop-modal"><h2>Crop</h2><p>Position photo</p></section></section></main>`).join('');
const script = `const results=[];for(const theme of ['light','dark']){document.documentElement.dataset.theme=theme;document.documentElement.dataset.appearance=theme;for(const main of document.querySelectorAll('main'))for(const selector of ${JSON.stringify(selectors)}){const s=getComputedStyle(main.querySelector(selector));results.push({theme,role:main.dataset.role,selector,color:s.color,bg:s.backgroundColor,border:s.borderColor});}}document.querySelector('#results').textContent=JSON.stringify(results);`;
try {
  const file = path.join(work, 'fixture.html');
  fs.writeFileSync(file, `<!doctype html><html><head><style>${css}</style></head><body>${fixture}<pre id="results"></pre><script>${script}</script></body></html>`);
  const result = spawnSync(browser, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', `--user-data-dir=${path.join(work, 'profile')}`, '--dump-dom', pathToFileURL(file).href], { encoding: 'utf8', timeout: 60000, windowsHide: true, maxBuffer: 5e6 });
  const json = result.stdout?.match(/<pre id="results">([\s\S]*?)<\/pre>/)?.[1];
  if (!json) throw new Error(result.error?.message || 'Browser did not return computed styles.');
  const results = JSON.parse(json.replaceAll('&quot;', '"').replaceAll('&amp;', '&'));
  const failures = results.filter(r => {
    const light = r.theme === 'light';
    const text = light ? 'rgb(30, 41, 59)' : 'rgb(230, 237, 247)';
    const muted = light ? 'rgb(100, 116, 139)' : 'rgb(148, 163, 184)';
    const surface = light ? 'rgb(255, 255, 255)' : 'rgb(22, 34, 56)';
    if (['.card', '.modal', '.avatar-crop-modal', '.btn-light'].includes(r.selector)) return r.bg !== surface || r.color !== text;
    if (['.message-menu-empty', '.avatar-crop-modal p'].includes(r.selector)) return r.color !== muted;
    if (r.selector === '.badge-success') return r.color !== (light ? 'rgb(22, 163, 74)' : 'rgb(34, 197, 94)');
    if (r.selector === '.btn') return r.color !== (light ? 'rgb(255, 255, 255)' : 'rgb(11, 18, 32)');
    if (r.selector === 'th') return r.color !== text || r.bg !== (light ? 'rgb(244, 247, 251)' : 'rgb(17, 27, 46)');
    if (r.selector === '.badge-blue') return r.color !== text || r.bg !== (light ? 'rgb(207, 250, 254)' : 'rgb(22, 78, 99)');
    return r.color !== text;
  });
  if (failures.length) throw new Error(JSON.stringify(failures, null, 2));
  console.log(`Passed ${results.length} computed-style assertions across ${roles.length} role shells in both themes.`);
} finally {
  // The freshly created browser profile is confined to the OS temporary directory.
  removeTemporaryProfile();
}
