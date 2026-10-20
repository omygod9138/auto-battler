import { BUILDINGS, CLANS, RULES, TERRAIN_INFO, UNITS, type ClanId, type UnitKind } from "./core/data";
import { cloneBoard, income, place, placementError, tileYield } from "./core/board";
import {
  buy,
  cancelPending,
  endBuild,
  fateCard,
  fight,
  lossDamage,
  newRun,
  placePending,
  playerWarband,
  reroll,
  resolveBattle,
  takeFate,
  type RunState,
} from "./core/game";
import type { Battle } from "./core/combat";
import { playBattle } from "./ui/battleView";
import { findGhost, saveGhost } from "./ui/ghosts";

const app = document.getElementById("app")!;

let run: RunState | null = null;
let hoverTile: number | null = null;
let toast = "";
let battle: Battle | null = null;
let stopBattle: (() => void) | null = null;
let battleSpeed = 1;

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`);

function render(): void {
  if (!run) return renderClanSelect();
  if (run.phase === "battle" && battle) return renderBattleOverlay();
  app.innerHTML = `
    ${header(run)}
    <main class="layout">
      <section class="board-wrap">${board(run)}${tileInfo(run)}</section>
      <aside class="panel">${panel(run)}</aside>
    </main>
    ${toast ? `<div class="toast">${esc(toast)}</div>` : ""}
  `;
}

function renderClanSelect(): void {
  app.innerHTML = `
    <div class="title-screen">
      <h1>⚔️ Fjord Battlegrounds</h1>
      <p class="sub">Build a Viking settlement. Every round your warband fights another clan. Survive ${RULES.finalRound} rounds.</p>
      <h2>Choose your clan</h2>
      <div class="cards">
        ${(Object.keys(CLANS) as ClanId[])
          .map((id) => {
            const c = CLANS[id];
            return `<button class="card clan" data-action="clan" data-id="${id}">
              <div class="big">${c.icon}</div><b>${c.name}</b><span>${c.desc}</span></button>`;
          })
          .join("")}
      </div>
      <details class="howto"><summary>How to play</summary>
        <ol>
          <li><b>Build:</b> buy buildings with 🪵 wood and place them next to your settlement. Adjacent terrain and buildings boost them.</li>
          <li><b>Feed:</b> 🍖 food is your army supply. Units beyond it stay home.</li>
          <li><b>Fate:</b> spend 📜 lore on a blessing from Odin, Thor or Baldr. Blessings last the whole run.</li>
          <li><b>Battle:</b> your warband auto-fights draugr raiders, then rival clans. Losing costs ❤️, more for later rounds and for each enemy left standing.</li>
        </ol>
      </details>
    </div>`;
}

function header(s: RunState): string {
  const inc = income(s.board, s.mods);
  const wb = playerWarband(s);
  return `
    <header class="hud">
      <span>${CLANS[s.clan].icon} ${CLANS[s.clan].name}</span>
      <span>Round <b>${s.round}</b>/${RULES.finalRound}</span>
      <span title="Health">❤️ <b>${s.hp}</b></span>
      <span title="Wood (income next round)">🪵 <b>${s.wood}</b> <small>${signed(inc.wood)}/rd</small></span>
      <span title="Food supply used / available">🍖 <b>${wb.supplyUsed}</b>/${wb.supplyCap}</span>
      <span title="Lore (income next round)">📜 <b>${s.lore}</b> <small>${signed(inc.lore)}/rd</small></span>
    </header>`;
}

function board(s: RunState): string {
  const cells = s.board.tiles
    .map((t, i) => {
      const classes = ["tile", t.terrain];
      let preview = "";
      if (s.pending) {
        const err = placementError(s.board, i, s.pending);
        classes.push(err ? "invalid" : "valid");
        if (!err && hoverTile === i) {
          const trial = cloneBoard(s.board);
          place(trial, i, s.pending);
          const a = income(s.board, s.mods);
          const b = income(trial, s.mods);
          const parts = [
            b.wood - a.wood && `🪵${signed(b.wood - a.wood)}`,
            b.food - a.food && `🍖${signed(b.food - a.food)}`,
            b.lore - a.lore && `📜${signed(b.lore - a.lore)}`,
          ].filter(Boolean);
          preview = `<span class="preview">${parts.join(" ") || BUILDINGS[s.pending].icon}</span>`;
        }
      }
      if (hoverTile === i) classes.push("hover");
      const icon = t.building ? BUILDINGS[t.building].icon : TERRAIN_INFO[t.terrain].icon;
      return `<div class="${classes.join(" ")}" data-tile="${i}">
        <span class="${t.building ? "bld" : "ter"}">${icon}</span>${preview}</div>`;
    })
    .join("");
  return `<div class="board" style="--n:${s.board.size}">${cells}</div>`;
}

function tileInfo(s: RunState): string {
  if (hoverTile === null) return `<div class="tile-info muted">Hover a tile for details.</div>`;
  const t = s.board.tiles[hoverTile];
  const terr = TERRAIN_INFO[t.terrain].name;
  if (!t.building) {
    const err = s.pending ? placementError(s.board, hoverTile, s.pending) : null;
    return `<div class="tile-info"><b>${terr}</b>${err ? ` <span class="bad">· ${esc(err)}</span>` : ""}</div>`;
  }
  const def = BUILDINGS[t.building];
  const y = tileYield(s.board, hoverTile, s.mods);
  const out = [y.wood && `🪵${y.wood}`, y.food && `🍖${y.food}`, y.lore && `📜${y.lore}`].filter(Boolean).join(" ");
  return `<div class="tile-info"><b>${def.icon} ${def.name}</b> on ${terr}${out ? ` · makes ${out}` : ""}<br><span class="muted">${def.desc}</span></div>`;
}

function panel(s: RunState): string {
  switch (s.phase) {
    case "build":
      return buildPanel(s);
    case "fate":
      return fatePanel(s);
    case "battle":
      return battlePanel(s);
    case "won":
    case "lost":
      return endPanel(s);
  }
}

function warbandSummary(s: RunState): string {
  const wb = playerWarband(s);
  const counts = new Map<UnitKind, number>();
  wb.units.forEach((u) => counts.set(u.kind, (counts.get(u.kind) ?? 0) + 1));
  const list = [...counts].map(([k, n]) => `${UNITS[k].icon}×${n}`).join(" ") || "<span class='muted'>no units yet</span>";
  return `<div class="warband"><h3>Warband</h3>${list}${wb.unfed ? `<div class="bad">${wb.unfed} unit(s) unfed: build farms</div>` : ""}</div>`;
}

function buildPanel(s: RunState): string {
  const shop = s.shop
    .map((id, slot) => {
      const b = BUILDINGS[id];
      const afford = s.wood >= b.cost && !s.pending;
      return `<button class="card shop" data-action="buy" data-slot="${slot}" ${afford ? "" : "disabled"}>
        <div class="big">${b.icon}</div><b>${b.name}</b><span class="cost">🪵 ${b.cost}</span><span>${b.desc}</span></button>`;
    })
    .join("");
  const pending = s.pending
    ? `<div class="pending">Placing <b>${BUILDINGS[s.pending].icon} ${BUILDINGS[s.pending].name}</b>: click a green tile.
        <button data-action="cancel">Cancel</button></div>`
    : "";
  return `
    <h2>Build phase</h2>
    ${pending}
    <div class="cards">${shop || "<span class='muted'>Shop empty.</span>"}</div>
    <button data-action="reroll" ${s.wood >= RULES.rerollCost && !s.pending ? "" : "disabled"}>🎲 Reroll (🪵${RULES.rerollCost})</button>
    ${warbandSummary(s)}
    <button class="primary" data-action="end-build">Done building ➜</button>
    ${history(s)}`;
}

function fatePanel(s: RunState): string {
  const cards = s.fateOffers
    .map((id) => {
      const c = fateCard(id);
      const afford = s.lore >= c.cost;
      return `<button class="card fate ${c.patron.toLowerCase()}" data-action="fate" data-id="${id}" ${afford ? "" : "disabled"}>
        <small>${c.patron}</small><b>${c.name}</b><span class="cost">📜 ${c.cost}</span><span>${c.desc}</span></button>`;
    })
    .join("");
  const taken = s.fateTaken.map((id) => fateCard(id).name).join(", ");
  return `
    <h2>Fate cards</h2>
    <p class="muted">Spend lore on a permanent blessing, or save it.</p>
    <div class="cards">${cards}</div>
    <button class="primary" data-action="fate-skip">Skip ➜ to battle</button>
    ${taken ? `<p class="muted">Blessings: ${esc(taken)}</p>` : ""}`;
}

function battlePanel(s: RunState): string {
  const o = s.opponent!;
  return `
    <h2>Battle</h2>
    <p>Next rival: <b>${o.ghost ? "👻 " : ""}${esc(o.name)}</b> ${o.clan ? `(${CLANS[o.clan].name})` : ""} · ${o.units.length} units</p>
    ${warbandSummary(s)}
    <button class="primary" data-action="fight">⚔️ Fight!</button>`;
}

function endPanel(s: RunState): string {
  const won = s.phase === "won";
  return `
    <h2>${won ? "🏆 Valhalla awaits!" : "💀 Your clan has fallen"}</h2>
    <p>${won ? `You survived all ${RULES.finalRound} rounds with ${s.hp} HP.` : `Defeated in round ${s.round}.`}</p>
    <button class="primary" data-action="restart">New run</button>
    ${history(s)}`;
}

function history(s: RunState): string {
  if (s.history.length === 0) return "";
  const rows = [...s.history]
    .reverse()
    .map((h) => `<li class="${h.outcome}">R${h.round} ${h.outcome.toUpperCase()} vs ${esc(h.opponent)}${h.damageTaken ? ` (−${h.damageTaken}❤️)` : ""}</li>`)
    .join("");
  return `<ul class="history">${rows}</ul>`;
}

function renderBattleOverlay(): void {
  if (app.querySelector("canvas.arena")) return;
  const s = run!;
  const o = s.opponent!;
  app.innerHTML = `
    ${header(s)}
    <div class="battle-screen">
      <div class="vs"><span class="you">${CLANS[s.clan].icon} You</span> vs <span class="foe">${o.ghost ? "👻 " : ""}${esc(o.name)} ${o.clan ? CLANS[o.clan].icon : "💀"}</span></div>
      <canvas class="arena"></canvas>
      <div class="battle-controls">
        <button data-action="speed">⏩ Speed ×<span id="spd">${battleSpeed}</span></button>
        <button data-action="skip-battle">Skip to result</button>
      </div>
      <div id="result"></div>
    </div>`;
  const canvas = app.querySelector<HTMLCanvasElement>("canvas.arena")!;
  stopBattle = playBattle(canvas, battle!, () => battleSpeed, showResult);
}

function showResult(): void {
  const s = run!;
  const b = battle!;
  const outcome = b.outcome!;
  const dmg = lossDamage(s.round, b.survivingThreat("enemy"));
  const text = outcome === "win" ? "Victory!" : outcome === "loss" ? `Defeat. You lose ${dmg} ❤️.` : "Draw. No damage.";
  const el = document.getElementById("result");
  if (el) el.innerHTML = `<h2 class="${outcome}">${text}</h2><button class="primary" data-action="after-battle">Continue ➜</button>`;
}

function startFight(): void {
  const s = run!;
  saveGhost({ seed: s.seed, round: s.round, clan: s.clan, units: playerWarband(s).units });
  battle = fight(s);
  render();
}

function afterBattle(): void {
  const s = run!;
  const b = battle!;
  stopBattle?.();
  stopBattle = null;
  resolveBattle(s, b.outcome!, b.survivingThreat("enemy"));
  battle = null;
  hoverTile = null;
  render();
}

function flash(msg: string): void {
  toast = msg;
  render();
  setTimeout(() => {
    if (toast === msg) {
      toast = "";
      render();
    }
  }, 1800);
}

app.addEventListener("click", (e) => {
  const target = e.target as HTMLElement;
  const tileEl = target.closest<HTMLElement>("[data-tile]");
  if (tileEl && run?.pending) {
    const err = placePending(run, Number(tileEl.dataset.tile));
    if (err) flash(`Can't build there: ${err}`);
    else render();
    return;
  }
  const btn = target.closest<HTMLButtonElement>("[data-action]");
  if (!btn || btn.disabled) return;
  const s = run;
  switch (btn.dataset.action) {
    case "clan":
      run = newRun(Math.floor(Math.random() * 2 ** 31), btn.dataset.id as ClanId);
      break;
    case "buy":
      buy(s!, Number(btn.dataset.slot));
      break;
    case "cancel":
      cancelPending(s!);
      break;
    case "reroll":
      reroll(s!);
      break;
    case "end-build":
      endBuild(s!);
      break;
    case "fate":
      takeFate(s!, btn.dataset.id!);
      break;
    case "fate-skip":
      takeFate(s!, null);
      break;
    case "fight":
      return startFight();
    case "speed": {
      battleSpeed = battleSpeed >= 4 ? 1 : battleSpeed * 2;
      const spd = document.getElementById("spd");
      if (spd) spd.textContent = String(battleSpeed);
      return;
    }
    case "skip-battle":
      battle?.runToEnd();
      return;
    case "after-battle":
      return afterBattle();
    case "restart":
      run = null;
      break;
  }
  // A ghost from an earlier run replaces the bot rival about half the time.
  if (s && s.phase === "battle" && s.opponent?.clan && !s.opponent.ghost && btn.dataset.action?.startsWith("fate")) {
    const ghost = Math.random() < 0.5 ? findGhost(s.round, s.seed, Math.random()) : null;
    if (ghost) s.opponent = ghost;
  }
  render();
});

app.addEventListener("mouseover", (e) => {
  const tileEl = (e.target as HTMLElement).closest<HTMLElement>("[data-tile]");
  const next = tileEl ? Number(tileEl.dataset.tile) : null;
  if (next !== hoverTile && run && run.phase !== "battle" && run.phase !== "won" && run.phase !== "lost") {
    hoverTile = next;
    // Only the board reacts to hover; re-rendering the panel would swap buttons under the cursor.
    const wrap = app.querySelector(".board-wrap");
    if (wrap) wrap.innerHTML = board(run) + tileInfo(run);
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && run?.pending) {
    cancelPending(run);
    render();
  }
});

render();
