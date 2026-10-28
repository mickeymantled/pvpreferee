"use client";

import React, { useEffect, useId, useReducer, useRef } from "react";
import { caInputReducer, initialCaInputs, MAX_CA_INPUTS, MAX_CA_LENGTH, MIN_CA_INPUTS } from "./ca-input-state";

export function CaInputs({ disabled = false }: { disabled?: boolean }) {
  const [state, dispatch] = useReducer(caInputReducer, undefined, initialCaInputs);
  const prefix = useId();
  const inputRefs = useRef(new Map<number, HTMLInputElement>());
  const helpId = `${prefix}-ca-help`;

  useEffect(() => {
    for (const field of state.fields) {
      inputRefs.current.get(field.id)?.setCustomValidity(field.error ?? "");
    }
    if (state.focusId !== null) inputRefs.current.get(state.focusId)?.focus();
  }, [state.fields, state.focusId]);

  return (
    <fieldset className="ca-fields" disabled={disabled} aria-describedby={helpId}>
      <legend>Contract addresses</legend>
      <p id={helpId} className="field-help">
        Add 2–10 Solana tokens. Paste one contract address per box. Use different addresses for each token.
      </p>
      <div className="ca-input-list">
        {state.fields.map((field, index) => {
          const inputId = `${prefix}-ca-${field.id}`;
          const errorId = `${inputId}-error`;
          return (
            <div className="ca-input-row" key={field.id}>
              <div className="ca-input-heading">
                <label htmlFor={inputId}>Contract address {index + 1}</label>
                <button
                  type="button"
                  className="ca-remove"
                  aria-label={`Remove contract address ${index + 1}`}
                  disabled={state.fields.length <= MIN_CA_INPUTS}
                  onClick={() => dispatch({ type: "remove", id: field.id })}
                >
                  Remove
                </button>
              </div>
              <input
                ref={input => {
                  if (input) inputRefs.current.set(field.id, input);
                  else inputRefs.current.delete(field.id);
                }}
                id={inputId}
                name="ca"
                type="text"
                value={field.value}
                onChange={event => dispatch({ type: "change", id: field.id, value: event.target.value })}
                onPaste={event => {
                  event.preventDefault();
                  dispatch({
                    type: "paste",
                    id: field.id,
                    text: event.clipboardData.getData("text"),
                    start: event.currentTarget.selectionStart ?? field.value.length,
                    end: event.currentTarget.selectionEnd ?? field.value.length,
                  });
                }}
                required
                minLength={32}
                maxLength={MAX_CA_LENGTH}
                pattern="[1-9A-HJ-NP-Za-km-z]{32,44}"
                title="Enter one Solana contract address (32–44 base58 characters)."
                placeholder="Paste a Solana contract address"
                spellCheck={false}
                autoComplete="off"
                autoCapitalize="none"
                autoCorrect="off"
                aria-invalid={field.error ? true : undefined}
                aria-describedby={field.error ? `${helpId} ${errorId}` : helpId}
              />
              {field.error && <p id={errorId} className="field-help ca-input-error" role="alert">{field.error}</p>}
            </div>
          );
        })}
      </div>
      <div className="ca-add-row">
        <button
          type="button"
          className="button secondary"
          disabled={state.fields.length >= MAX_CA_INPUTS}
          onClick={() => dispatch({ type: "add" })}
        >
          Add token
        </button>
        <p className="field-help">{state.fields.length} of {MAX_CA_INPUTS} tokens{state.fields.length === MAX_CA_INPUTS ? " · Maximum reached" : ""}</p>
      </div>
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">{state.announcement}</p>
    </fieldset>
  );
}
