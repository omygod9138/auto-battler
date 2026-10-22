import type { Battle } from "./core/battle";
import { MAX_LEVEL, SKILLS, type SkillCat, type SkillId, type SkillKind } from "./core/skills";
import { CLASSES, type ClassId, type Stats } from "./core/stats";
import {
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

const app = document.getElementById("app")!;

let run: RunState | null = null;
let battle: Battle | null = null;
let stopBattle: (() => void) | null = null;
let battleSpeed = 1;

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
  if (!run) return renderTitle();
  if (run.phase === "choose") return renderChoose(run);
  if (run.phase === "battle") return renderBattle(run);
  return renderOver(run);
}

function renderTitle(): void {
  const best = loadBest();
  app.innerHTML = `
    <div class="title-screen">
      <h1>⚔️ Fjord Battlegrounds</h1>
      <p class="sub">Pick a skill. Beat the mob. Each win brings a stronger one. One loss and it's over.</p>
      ${import.meta.env.DEV ? `<p><a href="?sandbox">🧪 Sandbox</a> <span class="muted">(dev only)</span></p>` : ""}
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

function statLine(s: Stats): string {
  return `❤️ ${Math.round(s.maxHp)} · ⚔️ ${s.dmg.toFixed(0)} · ${(1 / s.interval).toFixed(2)}/s · 📏 ${s.range}`;
}

function header(s: RunState): string {
  const c = CLASSES[s.cls];
  return `<header class="hud">
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
  const chip = ([id, lv]: [SkillId, number]) =>
    `<span class="chip" title="${SKILLS[id].desc(lv)}">${SKILLS[id].icon} ${SKILLS[id].name} <b>${lv}</b></span>`;
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
    <div class="hero-head"><img class="portrait small" src="${portrait(s.cls)}" alt="" width="56" height="56"><h3>Your ${CLASSES[s.cls].name}</h3></div>
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
      ❤️ ${stats.maxHp} · ⚔️ ${stats.dmg.toFixed(0)} · 📏 ${stats.range}${stats.armor ? ` · 🛡️ ${stats.armor}` : ""}</div>
    </div>
  </section>`;
}

function renderChoose(s: RunState): void {
  const cards = s.offers
    .map((id) => {
      const k = SKILLS[id];
      const lv = s.levels[id] ?? 0;
      return `<button class="card skill ${k.cls === "any" ? "shared" : ""}" data-action="pick" data-id="${id}">
        <div class="big">${k.icon}</div>
        <b>${k.name}</b>
        <small class="tag ${k.kind}">${k.cat ? `<span class="cat">${CAT_LABEL[k.cat]}</span> · ${KIND_LABEL[k.kind]} · <span class="cls">${CLASSES[k.cls as ClassId].name}</span>` : `${KIND_LABEL[k.kind]} · Shared`}</small>
        <span class="lv">${lv ? `Lv ${lv} → ${lv + 1}` : "New"}${lv + 1 === MAX_LEVEL ? " (max)" : ""}</span>
        <span>${k.desc(lv + 1)}</span>
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

function renderBattle(s: RunState): void {
  if (app.querySelector("canvas.arena")) return;
  const { def } = currentMob(s);
  battle = startBattle(s);
  app.innerHTML = `${header(s)}
    <div class="battle-screen">
      <div class="vs"><span class="you">${CLASSES[s.cls].icon} You</span> vs <span class="foe">${def.name} ${def.icon}</span></div>
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
  if (s.phase === "over") saveBest(s.cls, s.round - 1);
  render();
}

function renderOver(s: RunState): void {
  const { def } = currentMob(s);
  const wins = s.round - 1;
  app.innerHTML = `${header(s)}
    <div class="over panel">
      <h1>💀 Game over</h1>
      <p>${CLASSES[s.cls].name} fell to the <b>${def.icon} ${def.name}</b> in round ${s.round} after <b>${wins}</b> win${wins === 1 ? "" : "s"}.</p>
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
    case "class":
      run = newRun(seed(), btn.dataset.id as ClassId);
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
      break;
  }
  render();
});

// Missing art just means the procedural characters are used.
if (new URLSearchParams(location.search).has("sandbox")) loadSprites().finally(() => startSandbox(app));
else loadSprites().finally(render);
