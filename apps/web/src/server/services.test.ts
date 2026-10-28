import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { INPUT, MEME, resolution, ruling } from "../test/fixtures";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  resolve: vi.fn(),
  findMeme: vi.fn(),
  find: vi.fn(),
  closeRepo: vi.fn(),
  createRepo: vi.fn(),
  createSource: vi.fn(),
  createRuntime: vi.fn(),
  run: vi.fn(),
  closeRuntime: vi.fn(),
  overrideService: vi.fn(),
}));
vi.mock("@pvp/source", () => ({
  createSourceFromEnv: mocks.createSource,
  createManualOverrideServiceFromEnv: mocks.overrideService,
}));
vi.mock("@pvp/ingest", () => ({ createRulingRepository: mocks.createRepo }));
vi.mock("@pvp/pipeline/runtime", () => ({
  createRuntime: mocks.createRuntime,
}));
import { findStoredRuling, webServices } from "./services";
import { applyReviewedOverride, requireAdminForOverride } from "./overrides";

beforeEach(() => {
  Object.values(mocks).forEach((mock) => mock.mockReset());
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("HELIUS_API_KEY", "");
  mocks.resolve.mockResolvedValue(resolution());
  mocks.findMeme.mockResolvedValue(null);
  mocks.find.mockResolvedValue(ruling());
  mocks.createSource.mockReturnValue({ resolve: mocks.resolve });
  mocks.createRepo.mockReturnValue({
    findMemeBySourceUrl: mocks.findMeme,
    findBySlug: mocks.find,
    close: mocks.closeRepo,
  });
  mocks.createRuntime.mockReturnValue({
    pipeline: { runResolved: mocks.run },
    close: mocks.closeRuntime,
  });
  mocks.run.mockResolvedValue(ruling());
});
afterEach(() => vi.unstubAllEnvs());

describe("lazy service adapters", () => {
  it("reviews sources with neither database nor Helius configured", async () => {
    expect(await webServices.resolve(INPUT)).toEqual(resolution());
    expect(mocks.createRuntime).not.toHaveBeenCalled();
    expect(mocks.createRepo).not.toHaveBeenCalled();
  });
  it("loads existing audited overrides while retaining independently verified endorsements", async () => {
    vi.stubEnv("DATABASE_URL", "synthetic-db");
    const reviewed = {
      ...MEME,
      canonical_name: "Reviewed name",
      overrides: [
        {
          field: "canonical_name",
          previous: "Old",
          value: "Reviewed name",
          actor: "synthetic-admin",
          at: "2026-10-01T00:00:00Z",
          reason: "Synthetic cited proof",
        },
      ],
    };
    mocks.findMeme.mockResolvedValue(reviewed);
    expect(await webServices.resolve(INPUT)).toEqual({
      meme: reviewed,
      endorsements: resolution().endorsements,
      needs_review: false,
      reasons: [],
    });
    expect(mocks.findMeme).toHaveBeenCalledWith(INPUT.source_url);
    expect(mocks.closeRepo).toHaveBeenCalledOnce();
    expect(mocks.createRuntime).not.toHaveBeenCalled();
  });
  it("does not treat a merely persisted automatic record as an override", async () => {
    vi.stubEnv("DATABASE_URL", "synthetic-db");
    mocks.findMeme.mockResolvedValue({
      ...MEME,
      canonical_name: "Old unreviewed name",
    });
    expect(await webServices.resolve(INPUT)).toEqual(resolution());
  });
  it("fails closed if a configured database cannot supply its audited review", async () => {
    vi.stubEnv("DATABASE_URL", "synthetic-db");
    mocks.findMeme.mockRejectedValue(new Error("unavailable"));
    await expect(webServices.resolve(INPUT)).rejects.toThrow("unavailable");
    expect(mocks.closeRepo).toHaveBeenCalledOnce();
  });
  it("reads stored rulings without constructing ingest or the source provider", async () => {
    vi.stubEnv("DATABASE_URL", "synthetic-db");
    expect(await findStoredRuling("synthetic-ruling")).toEqual(ruling());
    expect(mocks.createRuntime).not.toHaveBeenCalled();
    expect(mocks.createSource).not.toHaveBeenCalled();
    expect(mocks.closeRepo).toHaveBeenCalledOnce();
  });
  it("rejects unsafe slugs before database access", async () => {
    expect(await findStoredRuling("../bad")).toBeNull();
    expect(mocks.createRepo).not.toHaveBeenCalled();
  });
  it("closes pipeline resources on success and failure", async () => {
    await webServices.run(INPUT, MEME, resolution().endorsements);
    expect(mocks.run).toHaveBeenCalledWith({
      cas: INPUT.cas,
      meme: MEME,
      version: "v1",
      endorsements: resolution().endorsements,
    });
    expect(mocks.closeRuntime).toHaveBeenCalledOnce();
    mocks.run.mockRejectedValue(new Error("save failed"));
    await expect(webServices.run(INPUT, MEME, [])).rejects.toThrow(
      "save failed",
    );
    expect(mocks.closeRuntime).toHaveBeenCalledTimes(2);
  });
  it("keeps the Wave3 override gate closed even when an actor is configured", async () => {
    vi.stubEnv("SOURCE_ADMIN_ACTOR", "synthetic-admin");
    await expect(requireAdminForOverride()).rejects.toThrow("locked");
    await expect(
      applyReviewedOverride(null, {
        patch: { canonical_name: "forged" },
        reason: "forged",
      }),
    ).rejects.toThrow("locked");
    expect(mocks.overrideService).not.toHaveBeenCalled();
    expect(mocks.createRepo).not.toHaveBeenCalled();
  });
});
