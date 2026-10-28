import { InvalidInputError, parseCas, validateSourceUrl } from "@pvp/pipeline";
import { listRulebooks } from "@pvp/config";

export interface ComparisonInput {
  cas: string[];
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
  const cas = parseCas(textField(form, "cas", 1024));
  const source_url = validateSourceUrl(textField(form, "source_url", 2048));
  const version = textField(form, "version", 24) || "v1";
  if (!listRulebooks().includes(version))
    throw new InvalidInputError("Choose a published rulebook version.");
  return { cas, source_url, version };
}

export function reviewUrl(input: ComparisonInput): string {
  return (
    "/resolve?" +
    new URLSearchParams({
      cas: input.cas.join("\n"),
      source_url: input.source_url,
      version: input.version,
    })
  );
}

export function queryForm(
  params: Record<string, string | string[] | undefined>,
): FormData {
  const form = new FormData();
  for (const key of ["cas", "source_url", "version"]) {
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
