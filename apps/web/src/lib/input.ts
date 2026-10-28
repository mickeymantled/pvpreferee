import { InvalidInputError, parseCas, validateSourceUrl } from "@pvp/pipeline";
import { listRulebooks } from "@pvp/config";

export interface ComparisonInput {
  cas: string[];
  /** Empty means discover the origin from the contract addresses on the server. */
  source_url: string;
  version: string;
}
export type FormValues = Pick<FormData, "getAll" | "keys">;

export function textField(form: FormValues, key: string, max: number): string {
  const values = form.getAll(key);
  if (
    values.length > 1 ||
    (values[0] !== undefined && typeof values[0] !== "string")
  ) {
    throw new InvalidInputError("Each field must have one text value.");
  }
  const value = (values[0] as string | undefined)?.trim() ?? "";
  if (value.length > max)
    throw new InvalidInputError("The submitted form is too long.");
  return value;
}

export function parseComparison(form: FormValues): ComparisonInput {
  const rows = form.getAll("ca");
  if (rows.length && form.getAll("cas").length)
    throw new InvalidInputError("Use either individual address fields or a saved comparison, not both.");
  if (rows.length > 10)
    throw new InvalidInputError("Enter 2 to 10 distinct Solana contract addresses.");
  const values = rows.map((value, index) => {
    if (typeof value !== "string")
      throw new InvalidInputError("Each contract address must be text.");
    const address = value.trim();
    if (!address || address.length > 44 || /[\s,;]/.test(address))
      throw new InvalidInputError(`Enter one contract address in box ${index + 1}.`);
    return address;
  });
  // Keep existing bot/review permalinks working. New home submissions use one 'ca' per box.
  const cas = parseCas(rows.length ? values.join("\n") : textField(form, "cas", 1024));
  const source = textField(form, "source_url", 2048);
  const source_url = source ? validateSourceUrl(source) : "";
  const version = textField(form, "version", 24) || "v1";
  if (!listRulebooks().includes(version))
    throw new InvalidInputError("Choose a published rulebook version.");
  return { cas, source_url, version };
}

export function reviewUrl(input: ComparisonInput): string {
  const params = new URLSearchParams({ cas: input.cas.join("\n") });
  if (input.source_url) params.set("source_url", input.source_url);
  params.set("version", input.version);
  return "/resolve?" + params;
}

export function queryForm(
  params: Record<string, string | string[] | undefined>,
): FormData {
  const form = new FormData();
  for (const key of ["ca", "cas", "source_url", "version"]) {
    const values = params[key];
    for (const value of Array.isArray(values)
      ? values
      : values === undefined
        ? []
        : [values])
      form.append(key, value);
  }
  return form;
}

export function isShareSlug(slug: string): boolean {
  return /^[a-zA-Z0-9_-]{1,100}$/.test(slug);
}
