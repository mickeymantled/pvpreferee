import { describe, expect, it, vi } from "vitest";
import { NeedsResolutionError } from "@pvp/pipeline";
import { parseComparison, queryForm, reviewUrl } from "./input";
import {
  OVERRIDE_MESSAGE,
  SERVICE_MESSAGE,
  reviewComparison,
  reviewFingerprint,
  submitComparison,
  type WebServices,
} from "./workflow";
import { CAS, INPUT, form, resolution, ruling } from "../test/fixtures";

function services(): WebServices {
  return {
    resolve: vi.fn(async () => resolution()),
    run: vi.fn(async () => ruling()),
  };
}
function confirmedForm() {
  return form({ review_hash: reviewFingerprint(INPUT, resolution()) });
}

describe("comparison inputs", () => {
  it("accepts comma/space/newline-separated keys and deduplicates", () => {
    expect(
      parseComparison(form({ cas: `${CAS[0]}, ${CAS[1]};\n${CAS[0]}` })).cas,
    ).toEqual(CAS);
  });
  it.each([
    "",
    CAS[0]!,
    "fake-address,other-fake",
    "11111111111111111111111111111111111," + CAS[1],
  ])("rejects insufficient or invalid keys: %s", (cas) => {
    expect(() => parseComparison(form({ cas }))).toThrow();
  });
  it("rejects more than ten distinct addresses", () => {
    expect(() =>
      parseComparison(
        form({
          cas: Array.from({ length: 11 }, (_, i) => "synthetic-" + i).join(" "),
        }),
      ),
    ).toThrow("2 to 10");
  });
  it.each([
    "javascript:alert(1)",
    "data:text/plain,a",
    "file:///etc/passwd",
    "https://user:password@example.com",
    "/relative",
  ])("rejects unsafe source %s", (source_url) => {
    expect(() => parseComparison(form({ source_url }))).toThrow();
  });
  it("rejects unpublished config, repeated fields, files and oversized values", () => {
    expect(() => parseComparison(form({ version: "v999" }))).toThrow(
      "published",
    );
    const repeated = form();
    repeated.append("cas", CAS[0]!);
    expect(() => parseComparison(repeated)).toThrow("one text");
    const blob = form();
    blob.set("cas", new Blob(["not text"]));
    expect(() => parseComparison(blob)).toThrow("one text");
    expect(() =>
      parseComparison(form({ source_url: "x".repeat(2049) })),
    ).toThrow("too long");
  });
  it("keeps only URL-encoded input fields in the review link and preserves duplicate-query validation", () => {
    const url = new URL(reviewUrl(INPUT), "https://app.example");
    expect(url.pathname).toBe("/resolve");
    expect([...url.searchParams.keys()]).toEqual([
      "cas",
      "source_url",
      "version",
    ]);
    expect(() =>
      parseComparison(
        queryForm({
          cas: CAS.join(","),
          source_url: [INPUT.source_url, INPUT.source_url],
        }),
      ),
    ).toThrow();
  });
});

describe("source review trust boundary", () => {
  it("reviews without invoking ingestion or persistence", async () => {
    const deps = services();
    const review = await reviewComparison(INPUT, deps);
    expect(review.ready).toBe(true);
    expect(deps.run).not.toHaveBeenCalled();
  });
  it("re-resolves on submit, preserving only independently verified endorsements", async () => {
    const deps = services();
    expect(await submitComparison(confirmedForm(), deps)).toEqual({
      status: "success",
      slug: "synthetic-ruling",
    });
    expect(deps.resolve).toHaveBeenCalledWith(INPUT);
    expect(deps.run).toHaveBeenCalledWith(
      INPUT,
      resolution().meme,
      resolution().endorsements,
    );
  });
  it.each([
    "meme",
    "canonical_name",
    "resolved",
    "endorsements",
    "actor",
    "authenticated",
    "patch",
    "beneficiary_wallet",
  ])("rejects forged %s before any provider is used", async (key) => {
    const deps = services();
    const data = confirmedForm();
    data.set(key, '{"authenticated":true}');
    expect(await submitComparison(data, deps)).toEqual({
      status: "error",
      message: OVERRIDE_MESSAGE,
    });
    expect(deps.resolve).not.toHaveBeenCalled();
    expect(deps.run).not.toHaveBeenCalled();
  });
  it("allows framework action metadata without treating it as trusted source data", async () => {
    const deps = services();
    const data = confirmedForm();
    data.set("$ACTION_ID_synthetic", "");
    expect((await submitComparison(data, deps)).status).toBe("success");
  });
  it("requires an explicit review before running", async () => {
    const deps = services();
    expect((await submitComparison(form(), deps)).status).toBe("review");
    expect(deps.run).not.toHaveBeenCalled();
  });
  it("requires another review if facts or audited overrides change", async () => {
    const deps = services();
    const changed = resolution();
    changed.meme!.canonical_ticker = "DIFFERENT";
    vi.mocked(deps.resolve).mockResolvedValue(changed);
    expect(await submitComparison(confirmedForm(), deps)).toMatchObject({
      status: "review",
      message: expect.stringContaining("changed"),
    });
    expect(deps.run).not.toHaveBeenCalled();
  });
  it.each(["missing", "needs_review", "unconfirmed"])(
    "blocks ingestion for %s source",
    async (state) => {
      const deps = services();
      const unready = resolution();
      if (state === "missing") unready.meme = null;
      if (state === "needs_review") unready.needs_review = true;
      if (state === "unconfirmed") unready.meme!.resolved = false;
      vi.mocked(deps.resolve).mockResolvedValue(unready);
      expect((await submitComparison(confirmedForm(), deps)).status).toBe(
        "review",
      );
      expect(deps.run).not.toHaveBeenCalled();
    },
  );
  it("does not expose backend credentials or stack traces on failure", async () => {
    const deps = services();
    vi.mocked(deps.run).mockRejectedValue(
      new Error("postgres://user:SECRET@host"),
    );
    expect(await submitComparison(confirmedForm(), deps)).toEqual({
      status: "error",
      message: SERVICE_MESSAGE,
    });
  });
  it("handles NeedsResolutionError without inventing a winner", async () => {
    const deps = services();
    vi.mocked(deps.run).mockRejectedValue(
      new NeedsResolutionError(resolution()),
    );
    expect(await submitComparison(confirmedForm(), deps)).toMatchObject({
      status: "error",
      message: expect.stringContaining("could not be confirmed"),
    });
  });
  it("only reports success after the pipeline has persisted", async () => {
    const deps = services();
    vi.mocked(deps.run).mockRejectedValue(new Error("immutable save failed"));
    expect((await submitComparison(confirmedForm(), deps)).status).toBe(
      "error",
    );
  });
});
