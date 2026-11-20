import "./style.css";
import { load, save, log, sizingRate, exportJson, parseImport, hasUnbackedChanges, newId, requestPersistence, type Vault, type Entry } from "./vault";
import { lockToNextWindow, tryUnlock, latestRound } from "./drand";
import { puzzleId, openPuzzle, type Puzzle, type Checkpoint } from "./puzzle";
import type { WorkerIn, WorkerOut } from "./puzzle.worker";
import { generatePassword } from "./crypto";
import { copySecret, clearClipboard } from "./clipboard";
import { fmtTime, fmtDuration, windowEnd, validateConfig } from "./schedule";
import { DEVICE_PREP, RECOVERY_EMAIL, RECOVERY_EMAIL_FINISH, RELOCK_STEPS, stepsFor, type Step } from "./checklists";

// ---------- state ----------
type Route =
  | { name: "home" }
  | { name: "setup" }
  | { name: "add" }
  | { name: "settings" }
  | { name: "lock"; id: string }
  | { name: "open"; id: string }
  | { name: "emergency"; id: string };

let vault: Vault = load();
let route: Route = { name: "home" };
let latest: number | null = null;
let netError: string | null = null;
let busy: string | null = null;
const revealed = new Map<string, string>(); // entry id -> current password (memory only)
const checked = new Set<string>(); // checklist ticks for the current screen
const solving = new Map<string, { worker: Worker; cp: Checkpoint | null; rate: number }>();

const MIN_EMERGENCY_HOURS = 48;
const EMERGENCY_PHRASE = "this is a real emergency";
const app = document.getElementById("app")!;

// ---------- helpers ----------
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const entry = (id: string) => vault.entries.find((e) => e.id === id)!;
const persist = () => save(vault);
const go = (r: Route) => {
  route = r;
  checked.clear();
  render();
  window.scrollTo(0, 0);
};

function toast(msg: string) {
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2200);
}

function runWorker(msg: WorkerIn): Promise<WorkerOut> {
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL("./puzzle.worker.ts", import.meta.url), { type: "module" });
    w.onmessage = (ev: MessageEvent<WorkerOut>) => {
      w.terminate();
      ev.data.type === "error" ? reject(new Error(ev.data.error)) : resolve(ev.data);
    };
    w.onerror = (e) => {
      w.terminate();
      reject(new Error(e.message));
    };
    w.postMessage(msg);
  });
}

const cpKey = (pz: Puzzle) => `pl.cp.${puzzleId(pz)}`;
const runKey = (pz: Puzzle) => `pl.run.${puzzleId(pz)}`;
function loadCp(pz: Puzzle): Checkpoint | null {
  try {
    return JSON.parse(localStorage.getItem(cpKey(pz)) ?? "null");
  } catch {
    return null;
  }
}

type Status = "setup" | "locked" | "open" | "emergency-running" | "emergency-done";
function status(e: Entry): Status {
  if (!e.puzzle) return "setup";
  const cp = solving.get(e.id)?.cp ?? loadCp(e.puzzle);
  if (cp && cp.done >= e.puzzle.t) return "emergency-done";
  if (e.kind === "scheduled" && e.tlock && latest !== null && latest >= e.tlock.round) return "open";
  if (cp) return "emergency-running";
  return "locked";
}

async function refreshNet() {
  try {
    latest = await latestRound();
    netError = null;
  } catch (err) {
    netError = err instanceof Error ? err.message : String(err);
  }
}

// ---------- actions ----------
async function measureRate(): Promise<number> {
  const out = await runWorker({ type: "calibrate" });
  if (out.type !== "rate") throw new Error("calibration failed");
  if (out.rate > vault.settings.maxRate) {
    vault.settings.maxRate = out.rate;
    vault.settings.maxRateDevice = deviceName();
    persist();
  }
  return out.rate;
}

function deviceName(): string {
  const ua = navigator.userAgent;
  if (/iPhone|iPad/.test(ua)) return "iPhone/iPad";
  if (/Windows/.test(ua)) return "Windows PC";
  if (/Mac/.test(ua)) return "Mac";
  if (/Android/.test(ua)) return "Android";
  return "this device";
}

/** Lock e.pending: tlock to the next window (scheduled) and a fresh emergency puzzle. */
async function lockPending(e: Entry) {
  if (!e.pending) return;
  const secret = e.pending.secret;
  busy = "Measuring this device's speed…";
  render();
  try {
    await measureRate();
    busy = "Building the emergency puzzle…";
    render();
    const out = await runWorker({ type: "create", secret, hours: vault.settings.emergencyHours, rate: sizingRate(vault.settings) });
    if (out.type !== "created") throw new Error("puzzle creation failed");
    let tlock = undefined;
    if (e.kind === "scheduled") {
      busy = "Time-locking to the next window via drand…";
      render();
      tlock = await lockToNextWindow(secret, vault.settings.window);
    }
    // Commit everything in one go only after it has all succeeded.
    if (e.puzzle) localStorage.removeItem(cpKey(e.puzzle));
    stopSolving(e.id);
    e.puzzle = out.puzzle;
    e.tlock = tlock;
    e.lockedAt = Date.now();
    log(e, e.pending.reason === "initial" ? "locked (initial)" : "re-locked with a new password");
    delete e.pending;
    revealed.delete(e.id);
    persist();
    busy = null;
    go({ name: "home" });
    toast(tlock ? `Locked until ${fmtTime(tlock.unlockAt)}` : "Locked (emergency path only)");
  } catch (err) {
    busy = null;
    render();
    alert(`Locking failed, nothing was changed: ${err instanceof Error ? err.message : err}\n\nYour new password is still pending, so try again.`);
  }
}

function startSolving(e: Entry) {
  if (!e.puzzle || solving.has(e.id)) return;
  const pz = e.puzzle;
  const w = new Worker(new URL("./puzzle.worker.ts", import.meta.url), { type: "module" });
  const s = { worker: w, cp: loadCp(pz), rate: 0 };
  solving.set(e.id, s);
  localStorage.setItem(runKey(pz), "1");
  w.onmessage = (ev: MessageEvent<WorkerOut>) => {
    const m = ev.data;
    if (m.type === "progress") {
      s.cp = m.cp;
      s.rate = m.rate;
      localStorage.setItem(cpKey(pz), JSON.stringify(m.cp));
      updateProgress(e.id);
    } else if (m.type === "solved") {
      localStorage.setItem(cpKey(pz), JSON.stringify(m.cp));
      revealed.set(e.id, m.secret);
      log(e, "emergency unlock completed");
      persist();
      stopSolving(e.id);
      render();
    } else if (m.type === "error") {
      alert(`Emergency solver error: ${m.error}`);
      stopSolving(e.id);
      render();
    }
  };
  w.postMessage({ type: "solve", puzzle: pz, cp: s.cp } satisfies WorkerIn);
}

/** Stop the solver. Progress (checkpoint) is kept; it just won't auto-resume on next launch. */
function stopSolving(id: string) {
  solving.get(id)?.worker.terminate();
  solving.delete(id);
  const pz = vault.entries.find((e) => e.id === id)?.puzzle;
  if (pz) localStorage.removeItem(runKey(pz));
}

async function revealFromPuzzle(e: Entry): Promise<string | null> {
  if (!e.puzzle) return null;
  const cp = loadCp(e.puzzle);
  if (!cp || cp.done < e.puzzle.t) return null;
  return openPuzzle(e.puzzle, cp);
}

async function ensureRevealed(e: Entry) {
  if (revealed.has(e.id)) return;
  if (latest === null) await refreshNet();
  let secret: string | null = null;
  if (e.tlock && latest !== null && latest >= e.tlock.round) {
    const r = await tryUnlock(e.tlock);
    if (r.ok) secret = r.secret;
    else if (r.reason === "error") netError = r.error;
  }
  secret ??= await revealFromPuzzle(e);
  if (secret !== null) {
    revealed.set(e.id, secret);
    if (!e.pending) {
      e.pending = { secret: generatePassword(), createdAt: Date.now(), reason: "relock" };
      log(e, "unlocked; new password generated");
      persist();
    }
  } else {
    toast(netError ? "Can't reach drand, check your connection" : "Still locked");
    route = { name: "home" };
  }
  render();
}

function download(name: string, text: string) {
  const blob = new Blob([text], { type: "application/json" });
  const file = new File([blob], name, { type: "application/json" });
  if (navigator.canShare?.({ files: [file] })) {
    navigator.share({ files: [file], title: "Password locker vault backup" }).then(markExported, () => {});
    return;
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
  markExported();
}

function markExported() {
  vault.exportedAt = Date.now() + 1500;
  persist();
  render();
}

// ---------- views ----------
function checklist(steps: Step[], prefix: string): string {
  return `<ol class="steps">${steps
    .map((s) => {
      const id = `${prefix}:${s.id}`;
      return `<li class="${checked.has(id) ? "done" : ""}"><label>
        <input type="checkbox" data-check="${esc(id)}" ${checked.has(id) ? "checked" : ""}>
        <span><span class="step-text">${esc(s.text)}</span><small>${esc(s.why)}</small></span>
      </label></li>`;
    })
    .join("")}</ol>`;
}
const allChecked = (steps: Step[], prefix: string) => steps.every((s) => checked.has(`${prefix}:${s.id}`));

function secretRow(label: string, action: string, id: string, length: number, revealable: string | null = null): string {
  return `<div class="secret">
    <div><div class="secret-label">${esc(label)}</div>
      <code class="secret-val" data-secret="${esc(id)}">${"•".repeat(Math.min(length, 28))}</code></div>
    <div class="secret-btns">
      ${revealable !== null ? `<button class="ghost" data-action="toggle-reveal" data-id="${esc(id)}">Show</button>` : ""}
      <button data-action="${action}" data-id="${esc(id)}">Copy</button>
    </div></div>`;
}

function header(): string {
  const backup = hasUnbackedChanges(vault)
    ? `<div class="banner warn">Vault changed since your last backup. <button class="link" data-action="export">Back up now</button></div>`
    : "";
  const net = netError ? `<div class="banner err">Can't reach drand (${esc(netError)}). Unlocking and locking need internet.</div>` : "";
  const nav = route.name === "home" ? "" : `<button class="ghost back" data-action="home">← Vault</button>`;
  return `<header><div class="brand">🔒 Locker</div>${nav}<button class="ghost" data-action="settings">Settings</button></header>${net}${backup}`;
}

function viewHome(): string {
  const entries = vault.entries;
  if (!entries.length) {
    return `<section class="card hero">
      <h1>Lock away X and Reddit</h1>
      <p>Your passwords are encrypted so they only open at <b>${esc(eatTime())} EAT</b> each day. Nobody can open them sooner, not this app and not you. A ${vault.settings.emergencyHours}h computation is the only other way in.</p>
      <button class="primary" data-action="setup">Start setup</button>
    </section>`;
  }
  const emailLocked = entries.some((e) => e.site === "email" && e.puzzle);
  const showEmailReminder = emailLocked && !localStorage.getItem("pl.emailFinish");
  return `
    ${!vault.settings.nativeRate ? `<div class="banner warn">Native PC speed not set, so emergency puzzles are undersized and a native solver could beat them about 25× faster. Run <code>python emergency.py calibrate</code> on your PC and enter the number in <button class="link" data-action="settings">Settings</button>, then re-lock.</div>` : ""}
    ${showEmailReminder ? `<section class="card"><h3>Recovery email</h3>${checklist(RECOVERY_EMAIL_FINISH, "emailfinish")}<button data-action="email-finish" ${allChecked(RECOVERY_EMAIL_FINISH, "emailfinish") ? "" : "disabled"}>Done</button></section>` : ""}
    <div class="list">${entries.map(entryCard).join("")}</div>
    <button class="primary wide" data-action="add">+ Add account</button>`;
}

function eatTime(): string {
  const w = vault.settings.window;
  const h = (w.hourUTC + 3) % 24;
  return `${String(h).padStart(2, "0")}:${String(w.minuteUTC).padStart(2, "0")}`;
}

function entryCard(e: Entry): string {
  const st = status(e);
  const icon = { x: "𝕏", reddit: "👽", email: "✉️", other: "🔑" }[e.site];
  let body = "";
  let btn = "";
  if (st === "setup") {
    body = `<span class="pill">Setup unfinished</span>`;
    btn = `<button class="primary" data-action="lock" data-id="${e.id}">Continue setup</button>`;
  } else if (st === "open") {
    const end = windowEnd(e.tlock!.unlockAt, vault.settings.window);
    const over = Date.now() > end;
    body = `<span class="pill ${over ? "red" : "green"}">${over ? "Re-lock overdue" : "Window open"}</span>
      ${over ? "" : `<span class="muted">ends in <b data-countdown="${end}"></b></span>`}`;
    btn = `<button class="primary" data-action="open" data-id="${e.id}">${e.pending?.reason === "relock" ? "Finish re-lock" : "Open"}</button>`;
  } else if (st === "emergency-done") {
    body = `<span class="pill red">Emergency-unlocked: re-lock</span>`;
    btn = `<button class="primary" data-action="emergency" data-id="${e.id}">Open</button>`;
  } else if (st === "emergency-running") {
    const s = solving.get(e.id);
    const cp = s?.cp ?? loadCp(e.puzzle!);
    body = `<span class="pill amber">Emergency ${pct(cp, e.puzzle!)}${s ? "" : " (paused)"}</span>`;
    btn = `<button data-action="emergency" data-id="${e.id}">View</button>`;
  } else {
    body =
      e.kind === "scheduled"
        ? `<span class="pill">Locked</span><span class="muted">opens in <b data-countdown="${e.tlock!.unlockAt}"></b></span>`
        : `<span class="pill">Emergency only</span>`;
    btn = `<button class="ghost" data-action="emergency" data-id="${e.id}">Emergency…</button>`;
  }
  return `<article class="card entry">
    <div class="entry-head"><span class="icon">${icon}</span>
      <div><div class="entry-title">${esc(e.label)}</div><div class="muted small">${esc(e.username)}</div></div></div>
    <div class="entry-status">${body}</div>
    <div class="entry-actions">${btn}</div>
  </article>`;
}

function pct(cp: Checkpoint | null, pz: Puzzle): string {
  return `${(((cp?.done ?? 0) / pz.t) * 100).toFixed(1)}%`;
}

function viewSetup(): string {
  const has = (site: string) => vault.entries.some((e) => e.site === site);
  return `<section class="card">
    <h2>1 · Prepare this device</h2>
    <p class="muted">Do this on BOTH the PC and the iPhone.</p>
    ${checklist(DEVICE_PREP, "prep")}
    ${nativeSpeedBlock()}
  </section>
  <section class="card">
    <h2>2 · Lock accounts, in this order</h2>
    <ol class="order">
      <li>${has("email") ? "✅" : ""} <b>Recovery email</b>: a new inbox only X and Reddit know about. Emergency-only.
        ${has("email") ? "" : `<button data-action="add-site" data-site="email">Add</button>`}</li>
      <li>${has("x") ? "✅" : ""} <b>X</b>, daily window. ${has("x") ? "" : `<button data-action="add-site" data-site="x">Add</button>`}</li>
      <li>${has("reddit") ? "✅" : ""} <b>Reddit</b>, daily window. ${has("reddit") ? "" : `<button data-action="add-site" data-site="reddit">Add</button>`}</li>
      <li><b>2FA backup codes</b> (if any), emergency-only. <button data-action="add-site" data-site="other">Add</button></li>
    </ol>
    <p class="muted small">Then back up the vault (Settings → Export) and keep a copy somewhere safe, like your main email or cloud drive. The file is safe to store anywhere because it holds only time-locked ciphertext.</p>
  </section>`;
}

function nativeSpeedBlock(): string {
  const st = vault.settings;
  return `<h3>Emergency solver speed</h3>
    <p class="small">Puzzles are sized to the fastest solver you have, so a ${st.emergencyHours}h puzzle really takes about ${st.emergencyHours}h. On the PC:</p>
    <ol class="small">
      <li>Install Python, then run <code>pip install gmpy2</code></li>
      <li>Download <a href="${import.meta.env.BASE_URL}emergency.py" download>emergency.py</a> and run <code>python emergency.py calibrate</code></li>
      <li>Enter the number it prints:</li>
    </ol>
    <form id="native-form" class="row">
      <input name="rate" type="number" min="1000" step="1" placeholder="e.g. 670000" value="${st.nativeRate ?? ""}" required>
      <button type="submit">Save native speed</button>
    </form>
    <p class="muted small">Native: <b>${st.nativeRate ? `${st.nativeRate.toLocaleString()}/s` : "not set"}</b> ·
      In-browser (${esc(st.maxRateDevice ?? "none yet")}): <b>${st.maxRate ? `${st.maxRate.toLocaleString()}/s` : "not measured"}</b>.
      Lowering the native number later only affects new locks, and it can't go below what's already set.</p>`;
}

let addSite = "x";
function viewAdd(): string {
  const defaults: Record<string, string> = { x: "X", reddit: "Reddit", email: "Recovery email", other: "2FA backup codes" };
  return `<section class="card"><h2>Add account</h2>
    <form id="add-form" autocomplete="off">
      <label>Type
        <select name="site">
          ${["x", "reddit", "email", "other"].map((s) => `<option value="${s}" ${s === addSite ? "selected" : ""}>${{ x: "X (daily window)", reddit: "Reddit (daily window)", email: "Recovery email (emergency only)", other: "Backup codes / other secret (emergency only)" }[s]}</option>`).join("")}
        </select></label>
      <label>Name <input name="label" value="${esc(defaults[addSite])}" required></label>
      <label>Username / email address <input name="username" placeholder="@handle or address" autocomplete="off"></label>
      ${addSite === "other" ? `<label>Secret to lock (paste backup codes). Leave blank to generate a password.<textarea name="secret" rows="4" autocomplete="off" spellcheck="false"></textarea></label>` : ""}
      <button class="primary" type="submit">Generate &amp; continue</button>
    </form></section>`;
}

function viewLock(e: Entry): string {
  const p = e.pending!;
  const list = e.site === "email" ? RECOVERY_EMAIL : e.site === "other" ? [] : stepsFor(e.site);
  const otherNote =
    e.site === "other"
      ? `<p>Make sure no other copy of this secret exists: delete downloaded files, screenshots and notes. Once it's locked, it's emergency-only.</p>`
      : "";
  return `<section class="card">
    <h2>Lock ${esc(e.label)}</h2>
    <p class="muted">This password is never shown. Copy it, paste it where the steps say, and don't save it anywhere.</p>
    ${secretRow("New password", "copy-pending", e.id, p.secret.length)}
    ${otherNote}
    ${list.length ? checklist(list, "lock") : ""}
    <div class="lock-bar">
      <button class="danger wide" data-action="do-lock" data-id="${e.id}" ${allChecked(list, "lock") && !busy ? "" : "disabled"}>
        ${busy ? esc(busy) : e.kind === "scheduled" ? `Lock until next ${esc(eatTime())} EAT window` : "Lock (emergency-only)"}</button>
      <p class="muted small">Tick every step first. After locking, the only ways in are ${e.kind === "scheduled" ? "the daily window or " : ""}the ${vault.settings.emergencyHours}h emergency path.</p>
      <button class="ghost small" data-action="discard" data-id="${e.id}">Cancel and delete this entry</button>
    </div>
  </section>`;
}

function rotatePanel(e: Entry): string {
  const cur = revealed.get(e.id);
  if (cur === undefined) return `<section class="card"><p>Decrypting…</p></section>`;
  const p = e.pending!;
  let timer = "";
  if (e.tlock && status(e) === "open") {
    const end = windowEnd(e.tlock.unlockAt, vault.settings.window);
    timer =
      Date.now() < end
        ? `<div class="banner ok">Window ends in <b data-countdown="${end}"></b>. Finish the re-lock before then.</div>`
        : `<div class="banner err">Window is over. Re-lock now.</div>`;
  }
  return `<section class="card">
    <h2>${esc(e.label)}: unlocked</h2>
    ${timer}
    ${secretRow("Current password", "copy-current", e.id, cur.length, cur)}
    ${secretRow("Next password (not shown)", "copy-pending", e.id, p.secret.length)}
    <p class="muted small">This password is now permanently decryptable, so it has to be replaced. Do what you came to do, then rotate it.</p>
    ${checklist(RELOCK_STEPS, "relock")}
    <div class="lock-bar">
      <button class="danger wide" data-action="do-lock" data-id="${e.id}" ${allChecked(RELOCK_STEPS, "relock") && !busy ? "" : "disabled"}>
        ${busy ? esc(busy) : "I changed it, lock the new password"}</button>
    </div>
  </section>`;
}

function viewEmergency(e: Entry): string {
  const st = status(e);
  if (st === "emergency-done") return rotatePanel(e);
  const pz = e.puzzle!;
  const s = solving.get(e.id);
  const cp = s?.cp ?? loadCp(pz);
  if (cp || s) {
    return `<section class="card"><h2>Emergency unlock: ${esc(e.label)}</h2>
      <div class="progress"><div class="bar" id="pbar" style="width:${pct(cp, pz)}"></div></div>
      <p id="pstat">${progressText(e.id)}</p>
      ${s ? `<button data-action="pause" data-id="${e.id}">Pause</button>` : `<button class="primary" data-action="resume" data-id="${e.id}">Resume</button>`}
      <p class="muted small">Keep this tab open and the PC awake (Settings → System → Power → Sleep: Never). Progress is saved, so you can pause and resume. Pausing doesn't reset it. Every ${vault.settings.emergencyHours}h puzzle is used once: re-locking replaces it.</p>
      <button class="ghost small" data-action="abandon" data-id="${e.id}">Abandon emergency (deletes progress)</button>
    </section>`;
  }
  return `<section class="card"><h2>Emergency unlock: ${esc(e.label)}</h2>
    <p>This starts a computation that takes about <b>${pz.targetHours} hours</b> of nonstop work on your fastest device. It can't be sped up much. Use it for real emergencies only, like a hacked account or a work deadline, not because you're bored.</p>
    ${e.kind === "scheduled" && e.tlock ? `<p class="muted">The normal window opens in <b data-countdown="${e.tlock.unlockAt}"></b>, which is probably sooner.</p>` : ""}
    <h3>On the PC (fast path)</h3>
    <ol class="small">
      <li>Export the vault (Settings → Export) to the PC.</li>
      <li>Run <code>python emergency.py solve locker-vault.json</code> and pick <b>${esc(e.label)}</b>. It takes about ${pz.targetHours}h. Ctrl+C pauses it, and running the same command again resumes.</li>
      <li>Paste the result line it prints here:</li>
    </ol>
    <form id="result-form" data-id="${e.id}">
      <textarea name="result" rows="3" placeholder='{"locker":"emergency-result",...}' autocomplete="off" spellcheck="false"></textarea>
      <button type="submit">Use result</button>
    </form>
    <h3>In this browser (slow fallback)</h3>
    <p class="muted small">About ${fmtDuration((pz.t / Math.max(vault.settings.maxRate, 1)) * 1000)} here, because the browser solver is much slower than native. A phone suspends it whenever the screen locks.</p>
    <label>Type <code>${EMERGENCY_PHRASE}</code> to start
      <input id="phrase" autocomplete="off" autocapitalize="off" spellcheck="false"></label>
    <button class="danger" data-action="start-emergency" data-id="${e.id}">Start in-browser solve</button>
  </section>`;
}

function progressText(id: string): string {
  const e = entry(id);
  const s = solving.get(id);
  const cp = s?.cp ?? loadCp(e.puzzle!);
  const done = cp?.done ?? 0;
  const left = e.puzzle!.t - done;
  const rate = s?.rate || vault.settings.maxRate;
  return `${pct(cp, e.puzzle!)} · ${s ? `about ${fmtDuration((left / rate) * 1000)} left at ${Math.round(rate).toLocaleString()}/s` : "paused"}`;
}

function updateProgress(id: string) {
  if (route.name !== "emergency" || route.id !== id) {
    if (route.name === "home") render();
    return;
  }
  const e = entry(id);
  const bar = document.getElementById("pbar");
  const stat = document.getElementById("pstat");
  if (bar) bar.style.width = pct(solving.get(id)?.cp ?? null, e.puzzle!);
  if (stat) stat.textContent = progressText(id);
}

function viewSettings(): string {
  const w = vault.settings.window;
  return `<section class="card"><h2>Daily window</h2>
    <form id="window-form">
      <div class="row">
        <label>Opens at (EAT) <input name="time" type="time" value="${eatTime()}" required></label>
        <label>Length (min) <input name="dur" type="number" min="5" max="240" value="${w.durationMin}" required></label>
      </div>
      <p class="muted small">Changes apply from the next lock. Locked passwords keep their current unlock time. Whatever you set, there are always at least 20h between locking and the next window.</p>
      <button type="submit">Save window</button>
    </form></section>
  <section class="card"><h2>Emergency path</h2>
    <form id="emerg-form">
      <label>Emergency delay (hours, minimum ${MIN_EMERGENCY_HOURS}) <input name="hours" type="number" min="${MIN_EMERGENCY_HOURS}" max="720" value="${vault.settings.emergencyHours}"></label>
      <button type="submit">Save</button>
    </form>
    ${nativeSpeedBlock()}
  </section>
  <section class="card"><h2>Backup &amp; sync</h2>
    <p class="muted small">The export holds only time-locked ciphertext, so it's safe to email to yourself or keep in iCloud Drive. Each re-lock changes the vault, so export after re-locking and import on your other device.</p>
    <button data-action="export">Export vault</button>
    <label class="file-btn">Import vault<input type="file" id="import" accept=".json,application/json"></label>
    <p class="muted small">Last backup: ${vault.exportedAt ? fmtTime(vault.exportedAt) : "never"}</p>
  </section>
  <section class="card"><h2>Setup guide</h2><button data-action="setup">Open setup checklist</button></section>`;
}

function render() {
  let body = "";
  if (route.name === "home") body = viewHome();
  else if (route.name === "setup") body = viewSetup();
  else if (route.name === "add") body = viewAdd();
  else if (route.name === "settings") body = viewSettings();
  else {
    const e = vault.entries.find((x) => x.id === (route as { id: string }).id);
    if (!e) {
      route = { name: "home" };
      return render();
    }
    if (route.name === "lock") body = e.pending ? viewLock(e) : viewHome();
    else if (route.name === "open") body = e.pending && revealed.has(e.id) ? rotatePanel(e) : `<section class="card"><p>Decrypting…</p></section>`;
    else body = viewEmergency(e);
  }
  app.innerHTML = header() + `<main>${body}</main>`;
  tickCountdowns();
}

function tickCountdowns() {
  document.querySelectorAll<HTMLElement>("[data-countdown]").forEach((el) => {
    el.textContent = fmtDuration(Number(el.dataset.countdown) - Date.now());
  });
}

// ---------- events ----------
app.addEventListener("click", (ev) => {
  const t = (ev.target as HTMLElement).closest<HTMLElement>("[data-action]");
  if (!t) return;
  const id = t.dataset.id!;
  const a = t.dataset.action!;
  switch (a) {
    case "home":
      return go({ name: "home" });
    case "setup":
      return go({ name: "setup" });
    case "settings":
      return go({ name: "settings" });
    case "add":
      return go({ name: "add" });
    case "add-site":
      addSite = t.dataset.site!;
      return go({ name: "add" });
    case "lock":
      return go({ name: "lock", id });
    case "open": {
      go({ name: "open", id });
      ensureRevealed(entry(id));
      return;
    }
    case "emergency": {
      go({ name: "emergency", id });
      if (status(entry(id)) === "emergency-done") ensureRevealed(entry(id));
      return;
    }
    case "copy-pending":
      copySecret(entry(id).pending!.secret).then((ok) => toast(ok ? "New password copied" : "Copy failed"));
      return;
    case "copy-current":
      copySecret(revealed.get(id)!).then((ok) => toast(ok ? "Current password copied" : "Copy failed"));
      return;
    case "toggle-reveal": {
      const el = document.querySelector<HTMLElement>(`[data-secret="${id}"]`)!;
      const showing = el.dataset.shown === "1";
      el.textContent = showing ? "•".repeat(Math.min(revealed.get(id)!.length, 28)) : revealed.get(id)!;
      el.dataset.shown = showing ? "0" : "1";
      t.textContent = showing ? "Show" : "Hide";
      return;
    }
    case "do-lock":
      clearClipboard(); // still inside the user gesture
      lockPending(entry(id));
      return;
    case "discard":
      if (confirm("Delete this entry? Only do this if you have NOT set this password anywhere yet.")) {
        vault.entries = vault.entries.filter((e) => e.id !== id);
        persist();
        go({ name: "home" });
      }
      return;
    case "start-emergency": {
      const phrase = (document.getElementById("phrase") as HTMLInputElement).value.trim().toLowerCase();
      if (phrase !== EMERGENCY_PHRASE) return toast("Type the phrase exactly");
      const e = entry(id);
      log(e, "emergency unlock started");
      persist();
      startSolving(e);
      render();
      return;
    }
    case "pause":
      stopSolving(id);
      return render();
    case "resume":
      startSolving(entry(id));
      return render();
    case "abandon":
      if (confirm("Delete all emergency progress for this entry?")) {
        stopSolving(id);
        localStorage.removeItem(cpKey(entry(id).puzzle!));
        log(entry(id), "emergency abandoned");
        persist();
        go({ name: "home" });
      }
      return;
    case "calibrate":
      t.textContent = "Measuring…";
      (t as HTMLButtonElement).disabled = true;
      measureRate().then(
        (r) => {
          toast(`${r.toLocaleString()} squarings/s`);
          render();
        },
        (err) => alert(err.message),
      );
      return;
    case "export":
      download(`password-locker-${new Date().toISOString().slice(0, 10)}.json`, exportJson(vault));
      return;
    case "email-finish":
      localStorage.setItem("pl.emailFinish", "1");
      return render();
  }
});

app.addEventListener("change", (ev) => {
  const el = ev.target as HTMLInputElement;
  if (el.dataset.check) {
    el.checked ? checked.add(el.dataset.check) : checked.delete(el.dataset.check);
    render();
  } else if (el.name === "site" && el.form?.id === "add-form") {
    addSite = el.value;
    render();
  } else if (el.id === "import" && el.files?.[0]) {
    el.files[0].text().then((text) => {
      try {
        const v = parseImport(text);
        const pendingHere = vault.entries.some((e) => e.pending);
        const older = v.updatedAt < vault.updatedAt;
        const warn = [
          pendingHere ? "This device has an unfinished lock/re-lock. Importing will DISCARD its new password." : "",
          older ? "The imported file is OLDER than this device's vault." : "",
        ].filter(Boolean).join("\n");
        if (!confirm(`Replace this device's vault with the imported one (${v.entries.length} entries)?\n${warn}`)) return;
        vault = v;
        vault.exportedAt = Date.now() + 1500;
        persist();
        go({ name: "home" });
        toast("Vault imported");
      } catch (err) {
        alert(err instanceof Error ? err.message : String(err));
      }
    });
  }
});

app.addEventListener("submit", (ev) => {
  ev.preventDefault();
  const f = ev.target as HTMLFormElement;
  const d = new FormData(f);
  if (f.id === "add-form") {
    const site = d.get("site") as Entry["site"];
    const typed = String(d.get("secret") ?? "").trim();
    const e: Entry = {
      id: newId(),
      label: String(d.get("label")).trim() || site,
      site,
      kind: site === "x" || site === "reddit" ? "scheduled" : "emergency-only",
      username: String(d.get("username") ?? "").trim(),
      pending: { secret: typed || generatePassword(), createdAt: Date.now(), reason: "initial" },
      history: [],
    };
    log(e, "created");
    vault.entries.push(e);
    persist();
    go({ name: "lock", id: e.id });
  } else if (f.id === "window-form") {
    const [hh, mm] = String(d.get("time")).split(":").map(Number);
    const cfg = { hourUTC: (hh - 3 + 24) % 24, minuteUTC: mm, durationMin: Number(d.get("dur")) };
    const err = validateConfig(cfg);
    if (err) return alert(err);
    vault.settings.window = cfg;
    persist();
    toast("Window saved");
    render();
  } else if (f.id === "result-form") {
    const e = entry(f.dataset.id!);
    try {
      const r = JSON.parse(String(d.get("result")).trim());
      if (r?.locker !== "emergency-result" || r.pid !== puzzleId(e.puzzle!)) throw new Error("That result belongs to a different puzzle (was the entry re-locked since you exported?)");
      if (r.done !== e.puzzle!.t) throw new Error("Result is incomplete");
      const cp: Checkpoint = { done: r.done, y: String(r.y) };
      openPuzzle(e.puzzle!, cp).then(
        (secret) => {
          localStorage.setItem(cpKey(e.puzzle!), JSON.stringify(cp));
          revealed.set(e.id, secret);
          log(e, "emergency unlock completed (native solver)");
          if (!e.pending) e.pending = { secret: generatePassword(), createdAt: Date.now(), reason: "relock" };
          persist();
          render();
        },
        () => alert("Result didn't decrypt this entry. Check you pasted the whole line."),
      );
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  } else if (f.id === "native-form") {
    const r = Math.round(Number(d.get("rate")));
    if (!(r >= 1000)) return alert("Enter the number emergency.py printed");
    // One-way ratchet: you can't shrink future puzzles by entering a lower number.
    if (vault.settings.nativeRate && r < vault.settings.nativeRate) return alert(`Can't lower it (currently ${vault.settings.nativeRate.toLocaleString()}/s).`);
    vault.settings.nativeRate = r;
    persist();
    toast("Saved. Re-lock entries (at their next window) to resize their puzzles");
    render();
  } else if (f.id === "emerg-form") {
    const h = Number(d.get("hours"));
    if (!(h >= MIN_EMERGENCY_HOURS && h <= 720)) return alert(`Must be ${MIN_EMERGENCY_HOURS}–720 hours`);
    vault.settings.emergencyHours = h;
    persist();
    toast("Saved: applies to future locks");
    render();
  }
});

// ---------- boot ----------
setInterval(tickCountdowns, 1000);
setInterval(async () => {
  const before = latest;
  await refreshNet();
  // Re-render home when a window opens (status may change).
  if (route.name === "home" && before !== latest) render();
}, 30_000);

window.addEventListener("storage", () => {
  vault = load();
  render();
});

// Resume any emergency that was running when the app last closed.
for (const e of vault.entries) {
  if (e.puzzle) {
    const cp = loadCp(e.puzzle);
    if (cp && cp.done < e.puzzle.t && localStorage.getItem(runKey(e.puzzle))) startSolving(e);
  }
}

render();
requestPersistence();
refreshNet().then(render);

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`);
}
