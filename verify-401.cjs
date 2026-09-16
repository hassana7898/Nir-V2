// Extracts the SHIPPED 401/clearLocalAuth helpers from source and exercises them with stubs.
const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

const root = __dirname;
const auth = fs.readFileSync(path.join(root, 'services', 'authService.ts'), 'utf8');
const ds = fs.readFileSync(path.join(root, 'services', 'dataService.ts'), 'utf8');

const grab = (src, startMarker, endMarker) => {
  const s = src.indexOf(startMarker);
  if (s < 0) throw new Error('start not found: ' + startMarker);
  const e = src.indexOf(endMarker, s);
  if (e < 0) throw new Error('end not found: ' + endMarker);
  return src.slice(s, e + endMarker.length);
};

const sessionKeyLine = auth.match(/const SESSION_KEY = '[^']*';/)[0];
const clearFn = grab(auth, 'export const clearLocalAuth = (): void => {', '};');
const evLine = ds.match(/const UNAUTHORIZED_EVENT = '[^']*';/)[0];
const notifyFn = grab(ds, 'export const notifyUnauthorized = (): void => {', '};');
const onFn = grab(ds, 'export const onUnauthorized = (handler: () => void): (() => void) => {', 'removeEventListener(UNAUTHORIZED_EVENT, handler);');
const onFnFull = onFn + '\n};';

const combined = [sessionKeyLine, clearFn, evLine, notifyFn, onFnFull, 'module.exports.__x = { clearLocalAuth, notifyUnauthorized, onUnauthorized, UNAUTHORIZED_EVENT };'].join('\n');
const js = esbuild.transformSync(combined, { loader: 'ts', format: 'cjs' }).code;

// --- stubs ---
const store = {};
const sessionStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; },
};
const lsStore = { nir_token: 'tok-123' };
const localStorage = {
  getItem: (k) => (k in lsStore ? lsStore[k] : null),
  setItem: (k, v) => { lsStore[k] = String(v); },
  removeItem: (k) => { delete lsStore[k]; },
};
const listeners = {};
const window = {
  localStorage,
  sessionStorage,
  addEventListener: (t, fn) => { (listeners[t] = listeners[t] || []).push(fn); },
  removeEventListener: (t, fn) => { listeners[t] = (listeners[t] || []).filter((f) => f !== fn); },
  dispatchEvent: (ev) => { (listeners[ev.type] || []).forEach((f) => f(ev)); return true; },
};
global.window = window;
global.sessionStorage = sessionStorage;
global.localStorage = localStorage;

const mod = { exports: {} };
new Function('module', 'exports', 'window', 'sessionStorage', 'localStorage', js)(mod, mod.exports, window, sessionStorage, localStorage);
const { clearLocalAuth, notifyUnauthorized, onUnauthorized } = mod.exports.__x;

// seed an authenticated-looking session
sessionStorage.setItem('__seeded__', '1');
// discover the real session key value used by the shipped code
const realKey = sessionKeyLine.match(/'([^']*)'/)[1];
sessionStorage.setItem(realKey, 'true');
localStorage.setItem('nir_token', 'tok-xyz');

let fired = 0;
const off = onUnauthorized(() => { fired++; });

notifyUnauthorized();

const sessionCleared = sessionStorage.getItem(realKey) === null;
const tokenCleared = localStorage.getItem('nir_token') === null;
console.log(JSON.stringify({ event_fired: fired, session_flag_cleared: sessionCleared, bearer_token_cleared: tokenCleared }));

// unsubscribe works
off();
notifyUnauthorized();
const afterOff = fired;
console.log(JSON.stringify({ after_unsubscribe_fired: afterOff }));

const pass = fired >= 1 && sessionCleared && tokenCleared && afterOff === 1;
console.log('AUTH_401_HANDLING_OK =', pass);
process.exit(pass ? 0 : 1);
