import { describe, expect, it, vi } from "vitest";
import { cardResponse } from "./card";
import { ruling } from "../test/fixtures";

describe("card endpoint with an injected renderer (never the CARD scaffold)", () => {
  it("renders the stored immutable payload and returns a PNG", async () => {
    const saved = ruling();
    const find = vi.fn(async () => saved),
      render = vi.fn(async () => Buffer.from([137, 80, 78, 71]));
    const response = await cardResponse(saved.share_slug, { find, render });
    expect(response.status).toBe(200);
    expect(render).toHaveBeenCalledWith(saved);
    expect(response.headers.get("Content-Type")).toBe("image/png");
    expect(response.headers.get("Cache-Control")).toContain("immutable");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(
      new Uint8Array([137, 80, 78, 71]),
    );
  });
  it("returns 404 without rendering when no ruling exists", async () => {
    const render = vi.fn();
    const response = await cardResponse("absent", {
      find: async () => null,
      render,
    });
    expect(response.status).toBe(404);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(render).not.toHaveBeenCalled();
  });
  it("rejects header/path injection before lookup", async () => {
    const find = vi.fn(),
      render = vi.fn();
    const response = await cardResponse("x\r\nInjected: yes", { find, render });
    expect(response.status).toBe(404);
    expect(find).not.toHaveBeenCalled();
  });
  it.each(["find", "render"])(
    "returns a sanitized retryable failure when %s fails",
    async (field) => {
      const find = vi.fn(async () => ruling()),
        render = vi.fn(async () => Buffer.from("synthetic"));
      if (field === "find")
        find.mockRejectedValue(new Error("SECRET database error"));
      else render.mockRejectedValue(new Error("SECRET renderer error"));
      const response = await cardResponse("synthetic-ruling", { find, render });
      expect(response.status).toBe(503);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(await response.text()).not.toContain("SECRET");
    },
  );
});
