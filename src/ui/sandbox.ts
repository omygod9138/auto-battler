// Dev sandbox (open with ?sandbox): pick any skills and levels, fight a dummy or a
// round's mob, slow time down, and read a log of skill hits and combos.
import { Battle, type BattleEvent } from "../core/battle";
import { mobForRound } from "../core/mobs";
import { COMBOS, MAX_LEVEL, SKILLS, heroStats, type SkillId, type SkillLevels } from "../core/skills";
import { CLASSES, stats, type ClassId } from "../core/stats";
import { playBattle } from "./battleView";

interface Setup {
  cls: ClassId;
  levels: SkillLevels;
  /** 0 = training dummy, otherwise the mob for that round. */
  round: number;
  speed: number;
  seed: number;
}

const PRESETS: { name: string; cls: ClassId; levels: SkillLevels }[] = [
  { name: "Warrior: full combo", cls: "warrior", levels: { charge: 1, spartanKick: 1, shieldBash: 1, heavyStrike: 1 } },
  { name: "Warrior: Kick → Charge", cls: "warrior", levels: { charge: 1, spartanKick: 1 } },
  { name: "Warrior: Charge → Bash → Heavy", cls: "warrior", levels: { charge: 1, shieldBash: 1, heavyStrike: 1 } },
];

/** Never hits back and barely dies, so combos can be watched over and over. */
const DUMMY = stats({ maxHp: 5000, dmg: 0, interval: 99, range: 1.2, speed: 1 });

const STORE = "fjord-sandbox";

function load(): Setup {
  const fallback: Setup = { cls: "warrior", levels: { ...PRESETS[0].levels }, round: 0, speed: 0.5, seed: 1 };
  try {
    return { ...fallback, ...JSON.parse(localStorage.getItem(STORE) ?? "{}") };
  } catch {
    return fallback;
  }
}

function save(s: Setup): void {
  try {
    localStorage.setItem(STORE, JSON.stringify(s));
  } catch {
    // Remembering the setup is only a convenience.
  }
}

function describe(e: BattleEvent): string | null {
  if (e.type === "status") return `<b class="combo">${e.label}</b>`;
  if (e.type === "damage" && e.skill) return `${SKILLS[e.skill].icon} ${SKILLS[e.skill].name} → ${Math.round(e.amount)}${e.crit ? " crit" : ""}`;
  if (e.type === "dodge" && e.target === "mob") return "mob dodged";
  return null;
}

export function startSandbox(app: HTMLElement): void {
  let setup = load();
  let stop: (() => void) | null = null;

  const skillRows = () =>
    (Object.keys(SKILLS) as SkillId[])
      .filter((id) => SKILLS[id].cls === setup.cls || SKILLS[id].cls === "any")
      .map((id) => {
        const k = SKILLS[id];
        const lv = setup.levels[id] ?? 0;
        const opts = Array.from({ length: MAX_LEVEL + 1 }, (_, i) => `<option ${i === lv ? "selected" : ""}>${i}</option>`).join("");
        return `<label class="sb-skill ${lv ? "on" : ""}" title="${k.desc(Math.max(1, lv))}">
          <select data-skill="${id}">${opts}</select> ${k.icon} ${k.name}${k.cat ? ` <small class="muted">${k.cat}</small>` : ""}</label>`;
      })
      .join("");

  const render = () => {
    stop?.();
    stop = null;
    const combos = COMBOS.map((c) => `${c.seq.map((id) => SKILLS[id].name).join(" → ")}: ${c.label.replace("Combo! ", "")}`).join("<br>");
    app.innerHTML = `
      <div class="sandbox">
        <h2>🧪 Sandbox <a class="muted" href="./">back to game</a></h2>
        <div class="sb-controls panel">
          <label>Class <select id="sb-cls">${(Object.keys(CLASSES) as ClassId[]).map((c) => `<option value="${c}" ${c === setup.cls ? "selected" : ""}>${CLASSES[c].name}</option>`).join("")}</select></label>
          <label>Opponent <select id="sb-round">
            <option value="0">Training dummy (never hits back)</option>
            ${Array.from({ length: 15 }, (_, i) => i + 1).map((r) => `<option value="${r}" ${r === setup.round ? "selected" : ""}>Round ${r}: ${mobForRound(r).def.name}</option>`).join("")}
          </select></label>
          <label>Speed <select id="sb-speed">${[0.25, 0.5, 1, 2].map((v) => `<option ${v === setup.speed ? "selected" : ""}>${v}</option>`).join("")}</select></label>
          <label>Seed <input id="sb-seed" type="number" value="${setup.seed}" style="width:5em"></label>
          <select id="sb-preset"><option value="">Preset…</option>${PRESETS.map((p, i) => `<option value="${i}">${p.name}</option>`).join("")}</select>
          <button class="primary" id="sb-fight">▶ Fight</button>
          <button id="sb-clear">Clear skills</button>
        </div>
        <div class="sb-skills panel">${skillRows()}</div>
        <canvas class="arena" width="880" height="320"></canvas>
        <div class="battle-bar"><div class="cds" id="cds"></div><div id="sb-status" class="muted"></div></div>
        <div class="sb-bottom">
          <div class="panel"><h3>Log</h3><ol id="sb-log" class="sb-log"></ol></div>
          <div class="panel"><h3>Combos</h3><p class="muted">Each step within 4s of the last.</p>${combos}</div>
        </div>
      </div>`;
    fight();
  };

  const fight = () => {
    stop?.();
    save(setup);
    const levels = Object.fromEntries(Object.entries(setup.levels).filter(([, lv]) => lv)) as SkillLevels;
    const mob = setup.round ? mobForRound(setup.round) : null;
    const battle = new Battle(heroStats(CLASSES[setup.cls].base, levels), levels, mob?.stats ?? DUMMY, setup.seed, mob?.def.enrage ?? false);
    const canvas = app.querySelector<HTMLCanvasElement>("canvas.arena")!;
    const log = app.querySelector<HTMLOListElement>("#sb-log")!;
    const status = app.querySelector<HTMLElement>("#sb-status")!;
    log.innerHTML = "";
    let seen = 0;
    const timer = setInterval(() => {
      for (; seen < battle.events.length; seen++) {
        const e = battle.events[seen];
        const text = describe(e);
        if (text) log.insertAdjacentHTML("afterbegin", `<li><span class="muted">${e.t.toFixed(1)}s</span> ${text}</li>`);
      }
      status.textContent = `Mob HP ${Math.round(battle.mob.hp)} · stun ${battle.mob.stun.toFixed(1)}s · distance ${battle.distance.toFixed(1)}m${battle.dashing ? " · charging!" : ""}`;
    }, 100);
    const stopBattle = playBattle(
      canvas,
      app.querySelector("#cds")!,
      battle,
      { hero: setup.cls, mob: mob?.def.id ?? "orc", mobBoss: mob?.def.boss ?? false },
      () => setup.speed,
      () => status.insertAdjacentText("beforeend", ` · ${battle.outcome === "win" ? "won" : "lost"}, press Fight to replay`),
    );
    stop = () => {
      clearInterval(timer);
      stopBattle();
    };
  };

  app.addEventListener("change", (e) => {
    const el = e.target as HTMLInputElement;
    if (el.dataset.skill) {
      setup.levels[el.dataset.skill as SkillId] = Number(el.value);
      el.closest("label")?.classList.toggle("on", Number(el.value) > 0);
      return fight();
    }
    if (el.id === "sb-cls") {
      setup = { ...setup, cls: el.value as ClassId, levels: {} };
      return render();
    }
    if (el.id === "sb-preset" && el.value) {
      const p = PRESETS[Number(el.value)];
      setup = { ...setup, cls: p.cls, levels: { ...p.levels } };
      return render();
    }
    if (el.id === "sb-round") setup.round = Number(el.value);
    if (el.id === "sb-seed") setup.seed = Number(el.value) || 1;
    if (el.id === "sb-speed") {
      // Speed applies live; no restart needed.
      setup.speed = Number(el.value);
      return save(setup);
    }
    fight();
  });
  app.addEventListener("click", (e) => {
    const id = (e.target as HTMLElement).id;
    if (id === "sb-fight") fight();
    if (id === "sb-clear") {
      setup.levels = {};
      render();
    }
  });

  render();
}
