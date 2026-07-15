import type { AmbienceAudio } from "./AmbienceAudio";

/**
 * The DEPLOY loading transition: the whole page glitches out, a secure SAF
 * terminal takes over and types the authentication/briefing sequence, then a
 * blinking CLICK TO COMMENCE prompt hands control to the game. That final
 * click is deliberate — it gives the browser a fresh user gesture, so the
 * game's Pointer Lock and audio start reliably rather than being blocked as
 * stale-gesture requests after several seconds of typing.
 *
 * Any key/click while the terminal is typing fast-forwards the sequence.
 */

interface BootLine {
  text: string;
  cls?: string;
  pauseMs: number;
}

const BOOT_LINES: BootLine[] = [
  { text: "SAF SECURE NET — TERMINAL 03 // MINDEF-NET v9.4", cls: "lp-boot-warn", pauseMs: 300 },
  { text: "AUTHENTICATING…", pauseMs: 650 },
  { text: "IDENTITY CONFIRMED — SVC NO. [REDACTED] — RANK: PTE", cls: "lp-boot-ok", pauseMs: 320 },
  { text: "CLEARANCE LEVEL 2 GRANTED", cls: "lp-boot-ok", pauseMs: 380 },
  { text: "LOADING OPERATIONAL BRIEF…", pauseMs: 520 },
  { text: "RECEIVING SATELLITE FEED… ▓▓▓▓▓▓▓▓▓▓ 100%", pauseMs: 420 },
  { text: "SYNCHRONISING SQUAD COMMS… NET 1 SECURE", pauseMs: 380 },
  { text: "WEAPON DRAW AUTHORISED — SAR 21 / P30", pauseMs: 420 },
  { text: "", pauseMs: 150 },
  { text: "MISSION STATUS: READY", cls: "lp-boot-ok", pauseMs: 200 },
];

export class TerminalBoot {
  /**
   * Runs glitch → terminal typing → commence prompt. Resolves on the final
   * user click/keypress (inside a fresh gesture handler). The overlay stays
   * on screen; call `fadeOut()` once the game behind it is ready.
   */
  run(container: HTMLElement, pageRoot: HTMLElement, audio: AmbienceAudio): Promise<void> {
    return new Promise((resolve) => {
      // --- Phase 1: glitch the existing page for ~650ms.
      pageRoot.classList.add("lp-glitching");
      const slices: HTMLDivElement[] = [];
      for (let i = 0; i < 6; i++) {
        const slice = document.createElement("div");
        slice.className = "lp-glitch-slice";
        slice.style.top = `${Math.random() * 92}%`;
        slice.style.height = `${2 + Math.random() * 9}%`;
        slice.style.animationDelay = `${Math.random() * 0.1}s`;
        container.appendChild(slice);
        slices.push(slice);
      }
      audio.staticBurst(0.5);

      window.setTimeout(() => {
        pageRoot.classList.remove("lp-glitching");
        for (const s of slices) s.remove();
        this.showTerminal(container, audio, resolve);
      }, 650);
    });
  }

  private overlay: HTMLDivElement | null = null;

  private showTerminal(container: HTMLElement, audio: AmbienceAudio, resolve: () => void): void {
    const overlay = document.createElement("div");
    overlay.className = "lp-boot";
    overlay.setAttribute("role", "status");
    overlay.setAttribute("aria-live", "polite");
    this.overlay = overlay;

    const term = document.createElement("div");
    term.className = "lp-boot-term";
    const textEl = document.createElement("div");
    const commence = document.createElement("div");
    commence.className = "lp-boot-commence";
    commence.textContent = "▮ CLICK TO COMMENCE OPERATION";
    term.append(textEl, commence);
    overlay.appendChild(term);
    container.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add("lp-boot-on"));

    let lineIdx = 0;
    let charIdx = 0;
    let done = "";
    let finished = false;
    let skipRequested = false;
    let timer = 0;

    const render = (partial: string) => {
      textEl.innerHTML = done + partial + `<span class="lp-cursor"></span>`;
    };

    const finish = () => {
      if (finished) return;
      finished = true;
      window.clearTimeout(timer);
      done = BOOT_LINES.map((l) =>
        l.text === "" ? "\n" : `<span class="${l.cls ?? ""}">&gt; ${l.text}</span>\n`
      ).join("");
      render("");
      commence.classList.add("lp-on");
      audio.lineDone();
    };

    const step = () => {
      if (finished) return;
      if (skipRequested) { finish(); return; }
      const line = BOOT_LINES[lineIdx];
      if (!line) { finish(); return; }
      if (charIdx === 0 && line.text === "") {
        done += "\n";
        lineIdx++;
        timer = window.setTimeout(step, line.pauseMs);
        return;
      }
      charIdx = Math.min(line.text.length, charIdx + 1);
      render(`<span class="${line.cls ?? ""}">&gt; ${line.text.slice(0, charIdx)}</span>`);
      if (charIdx % 2 === 0) audio.typeTick();
      if (charIdx >= line.text.length) {
        done += `<span class="${line.cls ?? ""}">&gt; ${line.text}</span>\n`;
        audio.lineDone();
        lineIdx++;
        charIdx = 0;
        timer = window.setTimeout(step, line.pauseMs);
      } else {
        timer = window.setTimeout(step, 14 + Math.random() * 14);
      }
    };

    const onInput = (e: Event) => {
      if (!finished) {
        // First interaction fast-forwards the typing.
        skipRequested = true;
        if (e.type === "keydown" || e.type === "pointerdown") finish();
        return;
      }
      overlay.removeEventListener("pointerdown", onInput);
      window.removeEventListener("keydown", onInput);
      audio.uiClick();
      resolve();
    };
    overlay.addEventListener("pointerdown", onInput);
    window.addEventListener("keydown", onInput);

    timer = window.setTimeout(step, 350);
  }

  /** Fade the terminal away once the game underneath is live. */
  fadeOut(): void {
    const overlay = this.overlay;
    if (!overlay) return;
    overlay.classList.remove("lp-boot-on");
    window.setTimeout(() => overlay.remove(), 450);
    this.overlay = null;
  }
}
