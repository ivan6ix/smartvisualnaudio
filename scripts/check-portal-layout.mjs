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
const roles=['top-nav','cluster-topbar professor-topbar','cluster-topbar cluster-role-topbar','cluster-topbar student-topbar','cluster-topbar dean-topbar'];
const fixture=roles.map(role=>'<header class="'+role+'"><button class="brand"><strong>Smart Proctoring</strong><span>Cluster Professor Portal</span></button><div class="portal-navigation"><button class="portal-menu-toggle">Menu</button><nav class="portal-links">'+['Dashboard','Courses','Exams','Monitoring Center','Scores'].map(x=>'<a>'+x+'</a>').join('')+'</nav><button class="portal-theme-toggle">Light</button></div><div class="cluster-tools"><button>Msg</button><button>Bell</button><button>Me</button></div></header>').join('');
try {
 const file=path.join(work,'fixture.html');
 for(const width of [375,768,1024,1366,1920]) {
  const script="const results=[];for(const theme of ['light','dark']){document.documentElement.dataset.theme=theme;document.documentElement.dataset.appearance=theme;for(const h of document.querySelectorAll('header')){const n=h.querySelector('nav'),b=h.querySelector('.portal-menu-toggle');results.push({theme,role:h.className,bg:getComputedStyle(h).backgroundColor,overflow:h.scrollWidth>h.clientWidth,nav:getComputedStyle(n).display,menu:getComputedStyle(b).display});}}document.querySelector('#results').textContent=JSON.stringify(results);";
  fs.writeFileSync(file,'<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+css+'</style></head><body>'+fixture+'<pre id="results"></pre><script>'+script+'</script></body></html>');
  const result=spawnSync(browser,['--headless=new','--disable-gpu','--no-first-run','--window-size='+width+',900','--user-data-dir='+path.join(work,'profile'),'--dump-dom',pathToFileURL(file).href],{encoding:'utf8',timeout:60000,windowsHide:true,maxBuffer:5e6});
  const json=result.stdout?.match(/<pre id="results">([\s\S]*?)<\/pre>/)?.[1];
  if(!json) throw new Error('Browser returned no layout results');
  for(const r of JSON.parse(json.replaceAll('&quot;','"').replaceAll('&amp;','&'))) {
   if(r.overflow || r.bg!==(r.theme==='light'?'rgb(232, 238, 246)':'rgb(15, 26, 45)') || (width>1200 ? r.nav==='none' : r.menu==='none')) throw new Error(JSON.stringify({width,...r}));
  }
 }
 console.log('Passed 50 portal layout/theme cases at mobile, tablet, laptop and desktop widths.');
} finally {removeTemporaryProfile();}
