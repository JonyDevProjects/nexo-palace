/**
 * Utilidades de interfaz interactiva para la terminal (TUI) y barra de progreso.
 * Sin dependencias externas: usa secuencias de escape ANSI nativas de Node.js.
 */
import * as readline from "node:readline";

export interface MenuItem<T> {
  value: T;
  label: string;
  description?: string;
  badge?: string;
}

/**
 * Muestra un menú de selección única con flechas arriba/abajo (o j/k) y Enter / Espacio.
 * Si stdin no es una TTY (ej. en un pipe o CI), usa un fallback no interactivo.
 */
export async function selectMenu<T>(options: {
  title: string;
  subtitle?: string;
  items: MenuItem<T>[];
  initialIndex?: number;
}): Promise<T> {
  const { title, subtitle, items, initialIndex = 0 } = options;

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    // Modo no-interactivo (fallback)
    process.stdout.write(`\n${title}\n`);
    items.forEach((it, idx) => {
      process.stdout.write(`  [${idx + 1}] ${it.label} ${it.badge ?? ""}\n`);
    });
    return items[Math.max(0, Math.min(initialIndex, items.length - 1))].value;
  }

  let selected = Math.max(0, Math.min(initialIndex, items.length - 1));
  let linesRendered = 0;

  function render(): void {
    // Si ya renderizamos antes, limpiamos esas líneas
    if (linesRendered > 0) {
      readline.cursorTo(process.stdout, 0);
      readline.moveCursor(process.stdout, 0, -linesRendered);
      readline.clearScreenDown(process.stdout);
    }

    const output: string[] = [];
    output.push(`\x1b[1m\x1b[36m${title}\x1b[0m`);
    if (subtitle) {
      output.push(`\x1b[90m${subtitle}\x1b[0m`);
    }
    output.push("");

    items.forEach((item, idx) => {
      const isSelected = idx === selected;
      const pointer = isSelected ? "\x1b[32m▸ \x1b[1m" : "  ";
      const badge = item.badge ? ` \x1b[32m[${item.badge}]\x1b[0m` : "";
      const reset = "\x1b[0m";

      output.push(`${pointer}${item.label}${badge}${reset}`);
      if (item.description) {
        const indent = "    ";
        output.push(`${indent}\x1b[90m${item.description}\x1b[0m`);
      }
    });

    output.push("");
    output.push("\x1b[90m(Usa ↑/↓ o j/k para navegar, Espacio o Enter para confirmar)\x1b[0m");

    const text = output.join("\n") + "\n";
    process.stdout.write(text);
    linesRendered = output.length;
  }

  readline.emitKeypressEvents(process.stdin);
  const wasRaw = process.stdin.isRaw;
  process.stdin.setRawMode(true);
  process.stdin.resume();

  // Ocultar cursor
  process.stdout.write("\x1b[?25l");
  render();

  return new Promise<T>((resolve) => {
    function cleanup(): void {
      process.stdin.removeListener("keypress", onKeypress);
      if (process.stdin.setRawMode) {
        process.stdin.setRawMode(wasRaw ?? false);
      }
      process.stdin.pause();
      // Restaurar cursor
      process.stdout.write("\x1b[?25h");
    }

    function onKeypress(_str: string, key: readline.Key): void {
      if (!key) return;

      if (key.ctrl && key.name === "c") {
        cleanup();
        process.exit(130);
      }

      if (key.name === "up" || key.name === "k") {
        selected = (selected - 1 + items.length) % items.length;
        render();
      } else if (key.name === "down" || key.name === "j") {
        selected = (selected + 1) % items.length;
        render();
      } else if (key.name === "return" || key.name === "space") {
        cleanup();
        process.stdout.write("\n");
        resolve(items[selected].value);
      }
    }

    process.stdin.on("keypress", onKeypress);
  });
}

/**
 * Pregunta interactiva sí/no (confirmación con flechas o 'y'/'n').
 */
export async function confirmPrompt(question: string, defaultValue = true): Promise<boolean> {
  return selectMenu<boolean>({
    title: question,
    items: [
      { value: true, label: "Sí", description: "Proceder ahora" },
      { value: false, label: "No", description: "Omitir por ahora" },
    ],
    initialIndex: defaultValue ? 0 : 1,
  });
}

/**
 * Barra de progreso y estado en tiempo real para terminal.
 */
export class ProgressBar {
  private total: number;
  private current: number = 0;
  private message: string = "";
  private width: number = 26;
  private isTTY: boolean;
  private lastRenderTime: number = 0;

  constructor(total: number, message: string = "") {
    this.total = Math.max(1, total);
    this.message = message;
    this.isTTY = Boolean(process.stdout.isTTY);
  }

  update(current: number, message?: string): void {
    this.current = Math.min(this.total, Math.max(0, current));
    if (message !== undefined) this.message = message;
    this.render();
  }

  increment(message?: string): void {
    this.update(this.current + 1, message);
  }

  private render(): void {
    const now = Date.now();
    // Throttle rendering si se llama muy rápido (excepto fin)
    if (this.current < this.total && now - this.lastRenderTime < 40) return;
    this.lastRenderTime = now;

    const ratio = this.current / this.total;
    const percent = Math.floor(ratio * 100);
    const filled = Math.round(this.width * ratio);
    const empty = Math.max(0, this.width - filled);

    const bar = `\x1b[36m${"━".repeat(filled)}\x1b[90m${"━".repeat(empty)}\x1b[0m`;
    const label = `${percent.toString().padStart(3)}% (${this.current}/${this.total})`;
    const statusMsg = this.message ? ` \x1b[90m— ${this.message.slice(0, 40)}\x1b[0m` : "";

    if (this.isTTY) {
      readline.cursorTo(process.stdout, 0);
      readline.clearLine(process.stdout, 0);
      process.stdout.write(`  [${bar}] ${label}${statusMsg}`);
    }
  }

  finish(finalMessage?: string): void {
    this.current = this.total;
    this.render();
    if (this.isTTY) {
      process.stdout.write("\n");
    }
    if (finalMessage) {
      process.stdout.write(`  \x1b[32m✔\x1b[0m ${finalMessage}\n`);
    }
  }
}
