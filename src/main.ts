import type { Battle } from "./core/battle";
import { ASCEND, ASCEND_ROUND, PATHS, pathsOf, skillLook } from "./core/ascension";
import { FallbackLeaderboard, LocalLeaderboard, SupabaseLeaderboard, TOP_N, cleanName, type Leaderboard, type ScoreEntry } from "./core/leaderboard";
import { MAX_LEVEL, SKILLS, type SkillCat, type SkillId, type SkillKind } from "./core/skills";
import { CLASSES, type ClassId, type PathId, type Stats } from "./core/stats";
import {
  ascend,
  chooseSkill,
  currentMob,
  currentStats,
  finishBattle,
  newRun,
  reroll,
  startBattle,
  type RunState,
} from "./core/run";
import { playBattle } from "./ui/battleView";
import { portrait } from "./ui/characters";
import { startSandbox } from "./ui/sandbox";
import { loadSprites } from "./ui/sprites";
import { playTitle } from "./ui/titleArt";

const app = document.getElementById("app")!;

let run: RunState | null = null;
let battle: Battle | null = null;
let stopBattle: (() => void) | null = null;
let battleSpeed = 1;
// Online board when the build has Supabase settings, else (or when offline) this device's.
const localBoard = new LocalLeaderboard(localStorage);
const { VITE_SUPABASE_URL: sbUrl, VITE_SUPABASE_ANON_KEY: sbKey } = import.meta.env;
const leaderboard: Leaderboard = sbUrl && sbKey ? new FallbackLeaderboard(new SupabaseLeaderboard(sbUrl, sbKey), localBoard) : localBoard;
/** Before a run: the title menu, or the class picker its Start leads to. */
let screen: "title" | "classes" = "title";
/** Leaderboard window over the title: null = closed, "all" = all-time across classes, else that class's board. */
let boardTab: ClassId | "all" | null = null;
let stopTitle: (() => void) | null = null;
/** The run that just ended, for highlighting it on the game-over board. */
let lastScore: { entry: ScoreEntry; rank: number | null; board: ScoreEntry[] } | null = null;
const NAME_KEY = "fjord-player-name";

function playerName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? "";
  } catch {
    return "";
  }
}

function setPlayerName(name: string): void {
  try {
    localStorage.setItem(NAME_KEY, cleanName(name));
  } catch {
    // ignore
  }
}

function esc(t: string): string {
  return t.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

const BEST_KEY = "fjord-best-v2";

function loadBest(): Partial<Record<ClassId, number>> {
  try {
    return JSON.parse(localStorage.getItem(BEST_KEY) ?? "{}");
  } catch {
    return {};
  }
}

function saveBest(cls: ClassId, wins: number): void {
  try {
    const best = loadBest();
    if (wins > (best[cls] ?? 0)) localStorage.setItem(BEST_KEY, JSON.stringify({ ...best, [cls]: wins }));
  } catch {
    // Records are a nicety; ignore storage failures.
  }
}

const KIND_LABEL: Record<SkillKind, string> = { passive: "Passive", proc: "On hit", active: "Active" };
const CAT_LABEL: Record<SkillCat, string> = { attack: "⚔️ Attack", defense: "🛡️ Defense", passive: "✨ Passive" };

function render(): void {
  if (run || screen !== "title") {
    stopTitle?.();
    stopTitle = null;
  }
  if (!run) return screen === "title" ? renderTitle() : renderClasses();
  if (run.phase === "choose") return renderChoose(run);
  if (run.phase === "battle") return renderBattle(run);
  if (run.phase === "ascend") return renderAscend(run);
  return renderOver(run);
}

/** RPG-style title: the cover scene animating behind a Start / Leaderboard menu. */
function renderTitle(): void {
  if (!app.querySelector(".title-menu")) {
    app.innerHTML = `
      <div class="title-menu">
        <canvas class="title-art" aria-hidden="true"></canvas>
        <h1 class="sr-only">Fjord Battlegrounds</h1>
        <nav class="menu">
          <button class="menu-btn" data-action="start">Start</button>
          <button class="menu-btn" data-action="board" data-id="all">Leaderboard</button>
        </nav>
        <div id="board-modal"></div>
      </div>`;
    const root = app.querySelector<HTMLElement>(".title-menu")!;
    // The menu sits in the band between the logo and the ground.
    stopTitle = playTitle(root.querySelector("canvas")!, (logoEnd, ground) => {
      root.style.setProperty("--logo-end", `${logoEnd * 100}%`);
      root.style.setProperty("--ground", `${ground * 100}%`);
    });
    app.querySelector<HTMLButtonElement>(".menu-btn")?.focus();
  }
  void renderBoard();
}

function renderClasses(): void {
  const best = loadBest();
  app.innerHTML = `
    <div class="title-screen">
      <h1>Choose your hero</h1>
      <p class="sub">Pick a skill. Beat the mob. Each win brings a stronger one. One loss and it's over.</p>
      ${import.meta.env.DEV ? `<p><a href="?sandbox">🧪 Sandbox</a> <span class="muted">(dev only)</span></p>` : ""}
      <div class="row name-row">
        <label>Name <input id="player-name" maxlength="16" placeholder="Hero" value="${esc(playerName())}"></label>
        <button data-action="home">⬅ Back</button>
      </div>
      <div class="cards three">
        ${(Object.keys(CLASSES) as ClassId[])
          .map((id) => {
            const c = CLASSES[id];
            return `<button class="card clan" data-action="class" data-id="${id}">
              <img class="portrait" src="${portrait(id)}" alt="" width="96" height="96">
              <b>${c.name}</b><small class="tag">${c.role}</small>
              <span>${c.desc}</span>
              <span class="muted">${statLine(c.base)}</span>
              ${best[id] ? `<span class="best">Best: round ${best[id]! + 1}</span>` : ""}
            </button>`;
          })
          .join("")}
      </div>
    </div>`;
}

function boardTable(list: ScoreEntry[], highlight?: ScoreEntry, showClass = true): string {
  // Always TOP_N rows; open slots read as unclaimed so the board never looks broken.
  const cols = showClass ? 7 : 6;
  const rank = (i: number) => `<td class="rank">${["🥇", "🥈", "🥉"][i] ?? i + 1}</td>`;
  const empty = (i: number) =>
    `<tr class="unclaimed">${rank(i)}<td>— Unclaimed —</td>${"<td>—</td>".repeat(cols - 4)}<td class="opt">—</td><td class="opt">—</td></tr>`;
  const rows = list
    .slice(0, TOP_N)
    .map((e, i) => {
      const skills = e.skills
        .map(([id, lv]) => (SKILLS[id] ? `<span title="${SKILLS[id].name} ${lv}">${SKILLS[id].icon}<sub>${lv}</sub></span>` : ""))
        .join("");
      const me = highlight && e.at === highlight.at && e.name === highlight.name ? "me" : "";
      return `<tr class="${me}">
        ${rank(i)}
        <td class="name">${esc(e.name)}</td>
        ${showClass ? `<td title="${CLASSES[e.cls]?.name ?? e.cls}">${CLASSES[e.cls]?.icon ?? ""}<span class="cls-name"> ${CLASSES[e.cls]?.name ?? e.cls}</span></td>` : ""}
        <td class="num"><b>${e.wins}</b></td>
        <td class="skills">${skills}</td>
        <td class="muted opt">${esc(e.killedBy)}</td>
        <td class="muted opt">${new Date(e.at).toLocaleDateString()}</td>
      </tr>`;
    })
    .concat(Array.from({ length: Math.max(0, TOP_N - list.length) }, (_, k) => empty(list.length + k)))
    .join("");
  return `<div class="board-wrap"><table class="board">
    <thead><tr><th>#</th><th>Name</th>${showClass ? "<th>Class</th>" : ""}<th>Wins</th><th>Build</th><th class="opt">Fell to</th><th class="opt">Date</th></tr></thead>
    <tbody>${rows}</tbody>
  </table></div>`;
}

/** The leaderboard as a wooden notice board over the title, with the sheet for `boardTab` pinned on it. */
async function renderBoard(): Promise<void> {
  const host = document.getElementById("board-modal");
  if (!host) return;
  const tab = boardTab;
  if (!tab) {
    host.innerHTML = "";
    return;
  }
  const tabs = (["all", ...Object.keys(CLASSES)] as (ClassId | "all")[])
    .map(
      (id) =>
        `<button class="tab ${id === tab ? "on" : ""}" data-action="board" data-id="${id}">${id === "all" ? "🏆 All-time" : `${CLASSES[id].icon} ${CLASSES[id].name}`}</button>`,
    )
    .join("");
  const sheet = (body: string) => `
    <div class="modal-bg" data-action="close-board">
      <section class="notice" role="dialog" aria-modal="true" aria-labelledby="notice-title">
        <h2 class="notice-sign" id="notice-title">Leaderboard</h2>
        <div class="notice-tabs">${tabs}</div>
        <div class="parchment">${body}</div>
        <button class="menu-btn notice-close" data-action="close-board">Close</button>
      </section>
    </div>`;
  // Keep the open sheet while the next tab loads, so the window doesn't flicker shut.
  if (!host.querySelector(".notice")) host.innerHTML = sheet(`<p class="loading">Loading…</p>`);
  const list = await leaderboard.top(tab === "all" ? undefined : tab);
  if (boardTab !== tab || run || screen !== "title") return;
  host.innerHTML = sheet(`
    <p class="sub">Top ${TOP_N} ${tab === "all" ? "" : `${CLASSES[tab].name} `}runs ${leaderboard.scope === "global" ? "worldwide" : "on this device"}, by wins.</p>
    ${boardTable(list, undefined, tab === "all")}`);
  host.querySelector<HTMLButtonElement>(".notice-close")?.focus({ preventScroll: true });
}

function statLine(s: Stats): string {
  return `❤️ ${Math.round(s.maxHp)} · ⚔️ ${s.dmg.toFixed(0)} · ${(1 / s.interval).toFixed(2)}/s · 📏 ${s.range}`;
}

/** The hero's title: the class, or its ascended path. */
function heroName(s: RunState): { icon: string; name: string } {
  return s.path ? PATHS[s.path] : CLASSES[s.cls];
}

function header(s: RunState): string {
  const c = heroName(s);
  return `<header class="hud ${s.path ? "ascended" : ""}">
    <span>${c.icon} <b>${c.name}</b></span>
    <span>Round <b>${s.round}</b></span>
    <span>Wins <b>${s.round - 1}</b></span>
    ${loadBest()[s.cls] !== undefined ? `<span class="muted">Best: round ${loadBest()[s.cls]! + 1}</span>` : ""}
  </header>`;
}

function heroPanel(s: RunState): string {
  const st = currentStats(s);
  const rows: [string, string][] = [
    ["❤️ HP", `${Math.round(st.maxHp)}`],
    ["⚔️ Damage", st.dmg.toFixed(1)],
    ["⏱️ Attacks/s", (1 / st.interval).toFixed(2)],
    ["📏 Range", st.range.toFixed(1)],
    ["🎯 Crit", `${Math.round(st.crit * 100)}% ×${st.critMult.toFixed(2)}`],
    ["🛡️ Armor", `${st.armor}${st.dmgTaken < 1 ? ` · −${Math.round((1 - st.dmgTaken) * 100)}% dmg` : ""}`],
  ];
  if (st.dodge) rows.push(["🍃 Dodge", `${Math.round(st.dodge * 100)}%`]);
  if (st.lifesteal) rows.push(["🧛 Lifesteal", `${Math.round(st.lifesteal * 100)}%`]);
  if (st.regen) rows.push(["🌿 Regen", `${(st.regen * 100).toFixed(1)}%/s`]);
  if (st.spellPower !== 1) rows.push(["✨ Spell power", `×${st.spellPower.toFixed(2)}`]);
  const chip = ([id, lv]: [SkillId, number]) => {
    const k = skillLook(id, s.path);
    return `<span class="chip" title="${k.desc(lv)}">${k.icon} ${k.name} <b>${lv}</b></span>`;
  };
  const learned = Object.entries(s.levels) as [SkillId, number][];
  // Class skills grouped by category, shared skills last.
  const groups: [string, [SkillId, number][]][] = [
    ...(Object.keys(CAT_LABEL) as SkillCat[]).map((c): [string, [SkillId, number][]] => [CAT_LABEL[c], learned.filter(([id]) => SKILLS[id].cat === c)]),
    ["Shared", learned.filter(([id]) => !SKILLS[id].cat)],
  ];
  const owned = groups
    .filter(([, list]) => list.length)
    .map(([name, list]) => `<div class="skill-group"><small class="tag">${name}</small><div class="chips">${list.map(chip).join("")}</div></div>`)
    .join("");
  return `<section class="panel hero">
    <div class="hero-head"><img class="portrait small" src="${portrait(s.cls)}" alt="" width="56" height="56"><h3>Your ${heroName(s).name}</h3></div>
    <dl class="stats">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl>
    <h3>Skills</h3>
    ${owned || "<span class='muted'>None yet.</span>"}
  </section>`;
}

function mobPanel(s: RunState): string {
  const { def, stats } = currentMob(s);
  return `<section class="panel mob ${def.boss ? "boss" : ""}">
    <h3>Next: round ${s.round}${def.boss ? " · BOSS" : ""}</h3>
    <div class="mob-row"><img class="portrait mob-portrait" src="${portrait(def.id)}" alt="" width="84" height="84">
      <div><b>${def.name}</b><br><span class="muted">${def.trait}</span><br>
      ❤️ ${stats.maxHp} · ⚔️ ${stats.dmg.toFixed(0)} · 📏 ${stats.range}${stats.armor ? ` · 🛡️ ${stats.armor}` : ""}${stats.dodge ? ` · 🍃 Dodge ${Math.round(stats.dodge * 100)}%` : ""}</div>
    </div>
  </section>`;
}

function renderChoose(s: RunState): void {
  const cards = s.offers
    .map((id) => {
      const k = SKILLS[id];
      const look = skillLook(id, s.path);
      const lv = s.levels[id] ?? 0;
      const owner = k.path ? PATHS[k.path].name : CLASSES[k.cls as ClassId]?.name;
      return `<button class="card skill ${k.cls === "any" ? "shared" : ""} ${k.path ? "path" : ""}" data-action="pick" data-id="${id}">
        <div class="big">${look.icon}</div>
        <b>${look.name}</b>
        <small class="tag ${k.kind}">${k.cat ? `<span class="cat">${CAT_LABEL[k.cat]}</span> · ${KIND_LABEL[k.kind]} · <span class="cls">${owner}</span>` : `${KIND_LABEL[k.kind]} · Shared`}</small>
        <span class="lv">${lv ? `Lv ${lv} → ${lv + 1}` : "New"}${lv + 1 === MAX_LEVEL ? " (max)" : ""}</span>
        <span>${look.desc(lv + 1)}</span>
      </button>`;
    })
    .join("");
  app.innerHTML = `${header(s)}
    <main class="layout">
      <div class="col">${heroPanel(s)}</div>
      <div class="col">
        ${mobPanel(s)}
        <section class="panel">
          <h2>Choose a skill</h2>
          <div class="cards three">${cards}</div>
          <button data-action="reroll" ${s.rerollsLeft ? "" : "disabled"}>🎲 Reroll (${s.rerollsLeft} left)</button>
        </section>
      </div>
    </main>`;
}

/** Paths still to come, shown locked beside the playable ones. */
const COMING_SOON: Partial<Record<ClassId, { name: string; icon: string; role: string }[]>> = {
  warrior: [{ name: "Paladin", icon: "🛡️", role: "Defence" }],
};

/** Round 20's boss is down: a pillar of light and the choice of path, for the rest of the run. */
function renderAscend(s: RunState): void {
  const cards = pathsOf(s.cls)
    .map((p) => `<button class="card clan path-card ${p.id}" data-action="ascend" data-id="${p.id}">
        <img class="portrait" src="${portrait(s.cls)}" alt="" width="96" height="96">
        <b>${p.icon} ${p.name}</b><small class="tag">${p.role}</small>
        <span>${p.desc}</span>
        <span class="muted">New skills join your picks; ${CLASSES[s.cls].name} skills you haven't learned leave them.</span>
      </button>`)
    .concat((COMING_SOON[s.cls] ?? []).map((p) => `<div class="card clan path-card locked" aria-disabled="true">
        <img class="portrait" src="${portrait(s.cls)}" alt="" width="96" height="96">
        <b>${p.icon} ${p.name}</b><small class="tag">${p.role}</small>
        <span class="muted">Coming soon.</span>
      </div>`))
    .join("");
  app.innerHTML = `${header(s)}
    <div class="ascend-screen">
      <div class="pillar" aria-hidden="true"></div>
      <h1>✨ Ascension</h1>
      <p class="sub">You beat round ${ASCEND_ROUND}. Your ${CLASSES[s.cls].name} ascends: ×${ASCEND.dmg} damage, ×${ASCEND.hp} HP, and your hits stop mobs regenerating. Choose a path for the rest of this run.</p>
      <div class="cards three">${cards}</div>
    </div>`;
}

function renderBattle(s: RunState): void {
  if (app.querySelector("canvas.arena")) return;
  const { def } = currentMob(s);
  battle = startBattle(s);
  app.innerHTML = `${header(s)}
    <div class="battle-screen">
      <div class="vs"><span class="you">${heroName(s).icon} You</span> vs <span class="foe">${def.name} ${def.icon}</span></div>
      <canvas class="arena" width="880" height="320"></canvas>
      <div class="battle-bar">
        <div class="cds" id="cds"></div>
        <div class="controls">
          <button data-action="speed">⏩ ×<span id="spd">${battleSpeed}</span></button>
          <button data-action="skip">Skip ⏭</button>
        </div>
      </div>
      <div id="result"></div>
    </div>`;
  const canvas = app.querySelector<HTMLCanvasElement>("canvas.arena")!;
  stopBattle = playBattle(
    canvas,
    document.getElementById("cds")!,
    battle,
    { hero: s.cls, mob: def.id, mobBoss: def.boss },
    () => battleSpeed,
    showResult,
  );
}

function showResult(): void {
  const b = battle!;
  const won = b.outcome === "win";
  const el = document.getElementById("result");
  if (!el) return;
  el.innerHTML = won
    ? `<h2 class="win">Victory! ${Math.round(b.hero.hp)} HP left in ${b.time.toFixed(1)}s</h2>
       <button class="primary" data-action="next">Choose next skill ➜</button>`
    : `<h2 class="loss">${b.time >= 60 ? "Out of time." : "Defeated."}</h2>
       <button class="primary" data-action="next">See results ➜</button>`;
}

function afterBattle(): void {
  const s = run!;
  stopBattle?.();
  stopBattle = null;
  finishBattle(s, battle!.outcome === "win");
  battle = null;
  if (s.phase !== "over") return render();
  saveBest(s.cls, s.round - 1);
  // Uploading the score takes a moment online; say so instead of looking frozen.
  const btn = document.querySelector<HTMLButtonElement>('#result [data-action="next"]');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner"></span> Saving score…`;
  }
  void recordScore(s).finally(render);
}

async function recordScore(s: RunState): Promise<void> {
  const entry: ScoreEntry = {
    name: playerName() || "Hero",
    cls: s.cls,
    wins: s.round - 1,
    killedBy: currentMob(s).def.name,
    skills: Object.entries(s.levels) as [SkillId, number][],
    at: Date.now(),
  };
  try {
    const { saved, rank } = await leaderboard.submit(entry, s.cls);
    lastScore = { entry: saved, rank, board: await leaderboard.top(s.cls) };
  } catch {
    lastScore = null;
  }
}

function renderOver(s: RunState): void {
  const { def } = currentMob(s);
  const wins = s.round - 1;
  app.innerHTML = `${header(s)}
    <div class="over panel">
      <h1>💀 Game over</h1>
      <p>${heroName(s).name} fell to the <b>${def.icon} ${def.name}</b> in round ${s.round} after <b>${wins}</b> win${wins === 1 ? "" : "s"}.</p>
      ${
        lastScore
          ? `<h3>${lastScore.rank ? `🏆 #${lastScore.rank} on the ${leaderboard.scope === "global" ? "global " : ""}${CLASSES[s.cls].name} leaderboard!` : `${CLASSES[s.cls].name} leaderboard`}</h3>
             ${boardTable(lastScore.board, lastScore.entry, false)}`
          : ""
      }
      ${heroPanel(s)}
      <div class="row">
        <button class="primary" data-action="again">Try again as ${CLASSES[s.cls].name}</button>
        <button data-action="title">Change class</button>
      </div>
    </div>`;
}

app.addEventListener("click", (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-action]");
  if (!btn || btn.disabled) return;
  const seed = () => Math.floor(Math.random() * 2 ** 31);
  switch (btn.dataset.action) {
    case "board":
      boardTab = btn.dataset.id as ClassId | "all";
      break;
    case "close-board":
      // Clicks inside the sheet bubble up to the backdrop; only the backdrop itself closes it.
      if (btn.classList.contains("modal-bg") && e.target !== btn) return;
      boardTab = null;
      break;
    case "start":
      screen = "classes";
      break;
    case "home":
      screen = "title";
      break;
    case "class":
      run = newRun(seed(), btn.dataset.id as ClassId);
      break;
    case "ascend":
      ascend(run!, btn.dataset.id as PathId);
      break;
    case "pick":
      chooseSkill(run!, btn.dataset.id as SkillId);
      break;
    case "reroll":
      reroll(run!);
      break;
    case "speed": {
      battleSpeed = battleSpeed >= 4 ? 1 : battleSpeed * 2;
      const spd = document.getElementById("spd");
      if (spd) spd.textContent = String(battleSpeed);
      return;
    }
    case "skip":
      battle?.runToEnd();
      return;
    case "next":
      return afterBattle();
    case "again":
      run = newRun(seed(), run!.cls);
      break;
    case "title":
      run = null;
      screen = "classes";
      break;
  }
  render();
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && boardTab && !run && screen === "title") {
    boardTab = null;
    render();
  }
});

app.addEventListener("change", (e) => {
  const input = e.target as HTMLInputElement;
  if (input.id === "player-name") setPlayerName(input.value);
});

// Build stamp in the corner, outside #app so every screen keeps it.
const stamp = document.createElement("div");
stamp.className = "build-stamp";
stamp.textContent = `${__BUILD_COMMIT__} · ${__BUILD_TIME__.slice(0, 16).replace("T", " ")} UTC${import.meta.env.DEV ? " · dev" : ""}`;
stamp.title = "Build: commit and build time";
document.body.append(stamp);

// Missing art just means the procedural characters are used.
const params = new URLSearchParams(location.search);
// Dev shortcut (?ascend): a Warrior run that has just beaten round 20, at the path choice.
if (import.meta.env.DEV && params.has("ascend")) {
  run = newRun(Math.floor(Math.random() * 2 ** 31), "warrior");
  run.levels = { charge: 2, shieldBash: 2, heavyStrike: 1, spartanKick: 1, ironSkin: 2, might: 2, vitality: 2, fortify: 2, bloodlust: 2, thorns: 1 };
  run.round = ASCEND_ROUND;
  run.phase = "battle";
  finishBattle(run, true);
}
if (params.has("sandbox")) loadSprites().finally(() => startSandbox(app));
else loadSprites().finally(render);
