import { beforeEach, describe, expect, it, vi } from "vitest";
import { INPUT, form, resolution, ruling } from "../test/fixtures";
import { reviewFingerprint } from "../lib/workflow";

const mocks = vi.hoisted(() => ({
  resolve: vi.fn(),
  run: vi.fn(),
  redirect: vi.fn(),
  protect: vi.fn(),
}));
vi.mock('../server/security', () => ({ protectRequest: mocks.protect }));
vi.mock("../server/services", () => ({
  webServices: { resolve: mocks.resolve, run: mocks.run },
}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
import { beginReview, issueRuling } from "./actions";

beforeEach(() => {
  Object.values(mocks).forEach((mock) => mock.mockReset());
  mocks.resolve.mockResolvedValue(resolution());
  mocks.run.mockResolvedValue(ruling());
  mocks.redirect.mockImplementation((url: string) => {
    throw new Error("NEXT_REDIRECT:" + url);
  });
});
describe("server action orchestration", () => {
  it("validates input before redirecting to source review, without ingesting", async () => {
    await expect(beginReview({ status: "idle" }, form())).rejects.toThrow(
      "NEXT_REDIRECT:/resolve?",
    );
    expect(mocks.run).not.toHaveBeenCalled();
    expect(mocks.resolve).not.toHaveBeenCalled();
  });
  it("returns an actionable input error instead of redirecting an invalid form", async () => {
    expect(
      await beginReview({ status: "idle" }, form({ cas: "bad" })),
    ).toMatchObject({ status: "error" });
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
  it("redirects only after a persisted ruling and does not catch the Next redirect", async () => {
    await expect(
      issueRuling(
        { status: "idle" },
        form({ review_hash: reviewFingerprint(INPUT, resolution()) }),
      ),
    ).rejects.toThrow("NEXT_REDIRECT:/ruling/synthetic-ruling");
    expect(mocks.run).toHaveBeenCalledOnce();
  });
  it("does not redirect on a forged source override", async () => {
    expect(
      await issueRuling({ status: "idle" }, form({ meme: "{}" })),
    ).toMatchObject({
      status: "error",
      message: expect.stringContaining("locked"),
    });
    expect(mocks.run).not.toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
  it('blocks expensive work when request protection fails', async () => {
    mocks.protect.mockRejectedValue(new Error('backend failed'));
    expect(await issueRuling({ status: 'idle' }, form())).toMatchObject({ status: 'error' });
    expect(mocks.resolve).not.toHaveBeenCalled();
    expect(mocks.run).not.toHaveBeenCalled();
  });
});
