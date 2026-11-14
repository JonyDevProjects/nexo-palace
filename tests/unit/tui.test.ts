import { describe, it, expect, vi } from "vitest";
import { ProgressBar } from "../../src/tui.ts";

describe("TUI ProgressBar", () => {
  it("incrementa y finaliza sin arrojar errores", () => {
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    const bar = new ProgressBar(10, "Procesando");
    bar.update(3, "archivo1.ts");
    bar.increment("archivo2.ts");
    bar.finish("Completado");

    expect(writeSpy).toHaveBeenCalled();
    writeSpy.mockRestore();
  });
});
