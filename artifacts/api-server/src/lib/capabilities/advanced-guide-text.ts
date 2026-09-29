export type GuideText = {
  title: string;
  deliverable: string;
  inputs: string[];
  steps: string[];
  checks: string[];
};

/** Compact authoring format: title; output; inputs; steps; acceptance checks. */
export function guide(text: string): GuideText {
  const fields = text.split(";").map((field) => field.trim());
  if (fields.length !== 5) throw new Error("Invalid guide translation");
  const [title, deliverable, inputs, steps, checks] = fields;
  const list = (value: string) => value.split("|").map((line) => line.trim());
  const result = {
    title,
    deliverable,
    inputs: list(inputs),
    steps: list(steps),
    checks: list(checks),
  };
  if (
    result.inputs.length < 2 ||
    result.steps.length < 4 ||
    result.checks.length < 2 ||
    fields.some((field) => !field) ||
    [...result.inputs, ...result.steps, ...result.checks].some((line) => !line)
  )
    throw new Error("Incomplete guide translation");
  return result;
}
