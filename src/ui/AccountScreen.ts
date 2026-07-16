import { AccountManager, validateUsername, type AccountRecord } from "@/core/AccountManager";

/**
 * First-launch / login screen. Lets the player create a new operator (username)
 * or pick an existing one; resolves to the logged-in account record. Duplicate
 * usernames are rejected by the AccountManager and surfaced inline.
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

  /** Show the screen and resolve once the player has created or selected an operator. */
  resolve(accounts: AccountManager): Promise<AccountRecord> {
    return new Promise(async (resolvePromise) => {
      const existing = await accounts.listUsernames();

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

      // Existing operators — quick login buttons.
      if (existing.length) {
        const label = document.createElement("div");
        label.textContent = "RESUME AS";
        label.style.cssText = "font-size:12px; letter-spacing:2px; color:#9fc78a; margin-bottom:8px;";
        panel.appendChild(label);
        for (const name of existing) {
          const b = document.createElement("button");
          b.textContent = name;
          b.style.cssText = this.btn("#20351d");
          b.onclick = async () => {
            const rec = await accounts.get(name.toLowerCase());
            if (rec) {
              this.hide();
              resolvePromise(rec);
            }
          };
          panel.appendChild(b);
        }
        const div = document.createElement("div");
        div.textContent = "— or create a new operator —";
        div.style.cssText = "text-align:center; color:#6f8566; font-size:12px; margin:18px 0 12px;";
        panel.appendChild(div);
      } else {
        const welcome = document.createElement("div");
        welcome.textContent = "Choose a callsign to begin. Your progress, stats and settings save automatically.";
        welcome.style.cssText = "font-size:13px; color:#9db392; line-height:1.5; margin-bottom:16px;";
        panel.appendChild(welcome);
      }

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

      const create = document.createElement("button");
      create.textContent = "CREATE OPERATOR";
      create.style.cssText = this.btn("#3c6b32", true);
      const submit = async () => {
        const name = input.value.trim();
        const invalid = validateUsername(name);
        if (invalid) {
          error.textContent = invalid;
          return;
        }
        try {
          const rec = await accounts.create(name);
          this.hide();
          resolvePromise(rec);
        } catch (e) {
          error.textContent = (e as Error).message;
        }
      };
      create.onclick = submit;
      input.onkeydown = (e) => {
        if (e.key === "Enter") submit();
        error.textContent = "";
      };
      panel.appendChild(create);

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
