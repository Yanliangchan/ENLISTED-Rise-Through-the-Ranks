import { Backend, validateUsername } from "@/core/Backend";

/**
 * First-launch / login screen. Username-only — the server finds-or-creates
 * the account (see server/routes/auth.ts), so one field covers both "I'm
 * new" and "I'm returning but this browser lost its remembered session".
 * Returning players with a valid stored token never see this screen at all
 * (see Backend.tryResume in main.ts).
 */
export class AccountScreen {
  private root: HTMLDivElement;

  constructor(private readonly container: HTMLElement) {
    this.root = document.createElement("div");
    this.root.style.cssText = `
      position: fixed; inset: 0; z-index: 60; display: none;
      align-items: center; justify-content: center;
      background: radial-gradient(circle at 50% 30%, #12211a, #060a08 70%);
      font-family: Consolas, "Courier New", monospace; color: #d7e8d0;
    `;
  }

  /** Show the screen and resolve once the player has logged in (new or existing operator). */
  resolve(): Promise<Backend> {
    return new Promise((resolvePromise) => {
      const panel = document.createElement("div");
      panel.style.cssText = `
        width: min(440px, 92vw); background: rgba(10,18,12,0.95);
        border: 1px solid #35502f; padding: 30px; box-shadow: 0 0 60px rgba(0,0,0,0.7);
      `;

      const title = document.createElement("div");
      title.textContent = "ENLISTED";
      title.style.cssText = "font-size:34px; font-weight:800; letter-spacing:8px; text-align:center; color:#bfe0ab;";
      const sub = document.createElement("div");
      sub.textContent = "OPERATOR LOGIN";
      sub.style.cssText = "font-size:13px; letter-spacing:4px; text-align:center; color:#7f9a72; margin:6px 0 24px;";
      panel.appendChild(title);
      panel.appendChild(sub);

      const welcome = document.createElement("div");
      welcome.textContent =
        "Enter your callsign. New names create an operator automatically; existing ones resume where you left off.";
      welcome.style.cssText = "font-size:13px; color:#9db392; line-height:1.5; margin-bottom:16px;";
      panel.appendChild(welcome);

      const input = document.createElement("input");
      input.type = "text";
      input.placeholder = "Callsign (3–16 chars)";
      input.maxLength = 16;
      input.style.cssText = `
        width:100%; box-sizing:border-box; background:#0a120a; color:#eaf4e4;
        border:1px solid #3c5834; padding:12px; font-family:inherit; font-size:16px;
        letter-spacing:1px; margin-bottom:6px;
      `;
      panel.appendChild(input);

      const error = document.createElement("div");
      error.style.cssText = "color:#e08a6a; font-size:12px; min-height:16px; margin-bottom:12px;";
      panel.appendChild(error);

      const submitBtn = document.createElement("button");
      submitBtn.textContent = "DEPLOY";
      submitBtn.style.cssText = this.btn("#3c6b32", true);
      let submitting = false;
      const submit = async () => {
        if (submitting) return;
        const name = input.value.trim();
        const invalid = validateUsername(name);
        if (invalid) {
          error.textContent = invalid;
          return;
        }
        submitting = true;
        submitBtn.textContent = "CONNECTING…";
        try {
          const backend = await Backend.login(name);
          this.hide();
          resolvePromise(backend);
        } catch (e) {
          error.textContent = (e as Error).message || "Could not reach the server. Try again.";
          submitting = false;
          submitBtn.textContent = "DEPLOY";
        }
      };
      submitBtn.onclick = submit;
      input.onkeydown = (e) => {
        if (e.key === "Enter") void submit();
        error.textContent = "";
      };
      panel.appendChild(submitBtn);

      this.root.appendChild(panel);
      this.container.appendChild(this.root);
      this.root.style.display = "flex";
      setTimeout(() => input.focus(), 50);
    });
  }

  private btn(bg: string, primary = false): string {
    return `
      display:block; width:100%; box-sizing:border-box; margin-top:8px;
      background:${bg}; color:#eaf4e4; border:1px solid rgba(255,255,255,0.15);
      padding:${primary ? "13px" : "10px"}; font-family:inherit;
      font-size:${primary ? "15px" : "14px"}; font-weight:${primary ? "700" : "400"};
      letter-spacing:1px; cursor:pointer;
    `;
  }

  private hide(): void {
    this.root.style.display = "none";
    this.root.remove();
  }
}
