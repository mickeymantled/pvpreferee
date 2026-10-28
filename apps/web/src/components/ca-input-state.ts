export const MIN_CA_INPUTS = 2;
export const MAX_CA_INPUTS = 10;
export const MAX_CA_LENGTH = 44;

interface CaField {
  id: number;
  value: string;
  error: string | null;
}

export interface CaInputState {
  fields: CaField[];
  nextId: number;
  focusId: number | null;
  announcement: string;
}

export type CaInputAction =
  | { type: "add" }
  | { type: "remove"; id: number }
  | { type: "change"; id: number; value: string }
  | { type: "paste"; id: number; text: string; start: number; end: number };

export function initialCaInputs(): CaInputState {
  return {
    fields: Array.from({ length: MIN_CA_INPUTS }, (_, index) => ({
      id: index + 1,
      value: "",
      error: null,
    })),
    nextId: MIN_CA_INPUTS + 1,
    focusId: null,
    announcement: "",
  };
}

/** Input editing only. The server remains responsible for address validation. */
export function caInputReducer(state: CaInputState, action: CaInputAction): CaInputState {
  if (action.type === "add") {
    if (state.fields.length >= MAX_CA_INPUTS) return state;
    const fields = [...state.fields, { id: state.nextId, value: "", error: null }];
    return {
      fields,
      nextId: state.nextId + 1,
      focusId: state.nextId,
      announcement: `Contract address ${fields.length} added. ${fields.length} of ${MAX_CA_INPUTS} tokens.`,
    };
  }

  const index = state.fields.findIndex(field => field.id === action.id);
  const field = state.fields[index];
  if (!field) return state;

  if (action.type === "remove") {
    if (state.fields.length <= MIN_CA_INPUTS) return state;
    const fields = state.fields.filter(item => item.id !== action.id);
    return {
      ...state,
      fields,
      focusId: (fields[index] ?? fields[fields.length - 1])!.id,
      announcement: `Contract address ${index + 1} removed. ${fields.length} of ${MAX_CA_INPUTS} tokens.`,
    };
  }

  let value: string;
  let error: string | null = null;
  if (action.type === "paste") {
    const text = action.text.trim();
    // Inspect the clipboard before the browser strips newlines or truncates at maxlength.
    value = field.value.slice(0, action.start) + text + field.value.slice(action.end);
    if (!/^[1-9A-HJ-NP-Za-km-z]+$/.test(text)) {
      error = "Paste one Solana contract address per box. Use Add token for another address.";
    }
  } else {
    value = action.value;
  }
  if (!error && value.length > MAX_CA_LENGTH) {
    error = `Use one contract address of at most ${MAX_CA_LENGTH} characters. Nothing was truncated.`;
  }
  return {
    ...state,
    fields: state.fields.map(item => item.id === action.id
      ? { ...item, value: error ? item.value : value, error }
      : item),
    focusId: null,
  };
}
