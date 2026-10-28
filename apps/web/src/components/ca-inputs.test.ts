import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { caInputReducer, initialCaInputs } from "./ca-input-state";
import { CaInputs } from "./ca-inputs";

// Synthetic syntax-only addresses, never source evidence or live token facts.
const ADDRESS = "1".repeat(32);
const LONG_ADDRESS = "2".repeat(44);

describe("contract address editing before submission", () => {
  it("starts with two empty fields and refuses to remove either", () => {
    const state = initialCaInputs();
    expect(state.fields.map(field => field.value)).toEqual(["", ""]);
    expect(state.focusId).toBeNull();
    for (const field of state.fields) {
      expect(caInputReducer(state, { type: "remove", id: field.id })).toBe(state);
    }
  });

  it("adds up to ten fields, then ignores further additions", () => {
    let state = initialCaInputs();
    for (let count = 3; count <= 10; count++) {
      state = caInputReducer(state, { type: "add" });
      expect(state.fields).toHaveLength(count);
      expect(state.focusId).toBe(state.fields[count - 1]!.id);
      expect(state.fields[count - 1]!.value).toBe("");
      expect(state.announcement).toContain(`${count} of 10 tokens`);
    }
    expect(new Set(state.fields.map(field => field.id)).size).toBe(10);
    expect(caInputReducer(state, { type: "add" })).toBe(state);
  });

  it("keeps surviving values and IDs when removing a middle field, then adds a fresh ID", () => {
    let state = caInputReducer(initialCaInputs(), { type: "add" });
    state = caInputReducer(state, { type: "change", id: 1, value: ADDRESS });
    state = caInputReducer(state, { type: "change", id: 3, value: LONG_ADDRESS });
    const removed = caInputReducer(state, { type: "remove", id: 2 });
    expect(removed.fields).toEqual([state.fields[0], state.fields[2]]);
    expect(removed.focusId).toBe(3);
    expect(removed.announcement).toContain("Contract address 2 removed");
    const added = caInputReducer(removed, { type: "add" });
    expect(added.fields.map(field => field.id)).toEqual([1, 3, 4]);
    expect(added.fields.map(field => field.value)).toEqual([ADDRESS, LONG_ADDRESS, ""]);
    expect(added.focusId).toBe(4);
  });

  it("focuses the previous address when removing the last field", () => {
    const state = caInputReducer(initialCaInputs(), { type: "add" });
    expect(caInputReducer(state, { type: "remove", id: 3 }).focusId).toBe(2);
  });

  it("ignores removal of a field that no longer exists", () => {
    const state = caInputReducer(initialCaInputs(), { type: "add" });
    expect(caInputReducer(state, { type: "remove", id: 99 })).toBe(state);
  });

  it.each([ADDRESS, LONG_ADDRESS])("pastes a single address with surrounding clipboard whitespace: %s", value => {
    const state = caInputReducer(initialCaInputs(), {
      type: "paste", id: 1, text: ` \n${value}\r\n `, start: 0, end: 0,
    });
    expect(state.fields[0]).toMatchObject({ value, error: null });
    expect(state.fields[1]!.value).toBe("");
    expect(state.fields).toHaveLength(2);
  });

  it.each(["\n", "\r\n", " ", "\t", ",", ";", ""])("rejects multiple pasted addresses separated by %j without truncating or replacing an existing value", separator => {
    const original = caInputReducer(initialCaInputs(), { type: "change", id: 1, value: LONG_ADDRESS });
    const state = caInputReducer(original, {
      type: "paste", id: 1, text: `${ADDRESS}${separator}${LONG_ADDRESS}`, start: 0, end: 44,
    });
    expect(state.fields[0]!.value).toBe(LONG_ADDRESS);
    expect(state.fields[0]!.error).toBeTruthy();
    expect(state.fields[1]!.value).toBe("");
    expect(state.fields).toHaveLength(2);
  });

  it("replaces the selected text and clears a previous paste error", () => {
    let state = caInputReducer(initialCaInputs(), { type: "change", id: 1, value: ADDRESS });
    state = caInputReducer(state, { type: "paste", id: 1, text: `${ADDRESS}\n${ADDRESS}`, start: 0, end: 32 });
    state = caInputReducer(state, { type: "paste", id: 1, text: LONG_ADDRESS, start: 0, end: 32 });
    expect(state.fields[0]).toMatchObject({ value: LONG_ADDRESS, error: null });
  });

  it("supports pasting into a selection within a single address", () => {
    const original = caInputReducer(initialCaInputs(), { type: "change", id: 1, value: ADDRESS });
    const state = caInputReducer(original, { type: "paste", id: 1, text: "222", start: 4, end: 7 });
    expect(state.fields[0]).toMatchObject({ value: "1111222" + "1".repeat(25), error: null });
  });

  it("rejects an overlong edit and allows correction without stealing focus", () => {
    let state = caInputReducer(initialCaInputs(), { type: "change", id: 1, value: "1".repeat(45) });
    expect(state.fields[0]!.value).toBe("");
    expect(state.fields[0]!.error).toContain("at most 44");
    state = caInputReducer(state, { type: "change", id: 1, value: ADDRESS });
    expect(state.fields[0]).toMatchObject({ value: ADDRESS, error: null });
    expect(state.focusId).toBeNull();
  });
});

describe("contract address markup", () => {
  it("labels exactly two required single-address inputs with matching help and native length limits", () => {
    const html = renderToStaticMarkup(React.createElement(CaInputs));
    const inputs = html.match(/<input\b[^>]*>/g) ?? [];
    expect(inputs).toHaveLength(2);
    inputs.forEach((input, index) => {
      const id = /id="([^"]+)"/.exec(input)![1];
      const help = /aria-describedby="([^"]+)"/.exec(input)![1];
      expect(html).toContain(`<label for="${id}">Contract address ${index + 1}</label>`);
      expect(html).toContain(`id="${help}"`);
      expect(input).toContain('name="ca"');
      expect(input).toContain('type="text"');
      expect(input).toContain('value=""');
      expect(input).toContain('required=""');
      expect(input).toMatch(/minlength="32"/i);
      expect(input).toMatch(/maxlength="44"/i);
      const pattern = new RegExp(`^(?:${/pattern="([^"]+)"/.exec(input)![1]})$`);
      expect(pattern.test(ADDRESS)).toBe(true);
      expect(pattern.test(LONG_ADDRESS)).toBe(true);
      expect(pattern.test("1".repeat(31))).toBe(false);
      expect(pattern.test("1".repeat(45))).toBe(false);
      expect(pattern.test(`${ADDRESS},${ADDRESS}`)).toBe(false);
    });
    expect(html).toContain("Paste one contract address per box");
    expect(html).not.toContain("<textarea");
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
  });

  it("uses non-submit buttons with explicit removal labels and enforces the initial minimum", () => {
    const html = renderToStaticMarkup(React.createElement(CaInputs));
    const buttons = html.match(/<button\b[^>]*>/g) ?? [];
    expect(buttons).toHaveLength(3);
    buttons.forEach(button => expect(button).toContain('type="button"'));
    for (let index = 0; index < 2; index++) {
      expect(buttons[index]).toContain(`aria-label="Remove contract address ${index + 1}"`);
      expect(buttons[index]).toContain('disabled=""');
    }
    expect(buttons[2]).not.toContain('disabled=""');
    expect(html).toContain("Add token");
    expect(html).toContain("2 of 10 tokens");
  });

  it("disables the full address group while the form is pending", () => {
    const html = renderToStaticMarkup(React.createElement(CaInputs, { disabled: true }));
    expect(html).toMatch(/<fieldset\b[^>]*disabled=""/);
  });
});
