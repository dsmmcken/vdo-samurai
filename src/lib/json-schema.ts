// A small JSON Schema validator: the subset animation declarations use (draft
// 2020-12 keywords: type, enum, const, not, oneOf, required, properties,
// additionalProperties, propertyNames, items, minLength, maxLength, minimum,
// maximum, exclusiveMinimum, pattern). `x-hint` on a schema replaces its
// errors with one message meant for a person.

export type Schema = {
  type?: 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array';
  enum?: unknown[];
  const?: unknown;
  not?: Schema;
  oneOf?: Schema[];
  required?: string[];
  properties?: Record<string, Schema>;
  additionalProperties?: boolean | Schema;
  propertyNames?: Schema;
  items?: Schema;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  pattern?: string;
  description?: string;
  title?: string;
  $schema?: string;
  'x-hint'?: string;
};

export interface SchemaError {
  /** Where, as JavaScript would write it: end.tile, audio[0].gain. */
  path: string;
  message: string;
}

const typeOf = (v: unknown) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);
const show = (v: unknown) => (typeof v === 'string' ? `'${v}'` : JSON.stringify(v));
const join = (path: string, key: string | number) => (typeof key === 'number' ? `${path}[${key}]` : /^[A-Za-z_$][\w$]*$/.test(key) ? (path ? `${path}.${key}` : key) : `${path}[${JSON.stringify(key)}]`);

export function validate(schema: Schema, value: unknown, path = ''): SchemaError[] {
  const errs = check(schema, value, path);
  return errs.length && schema['x-hint'] ? [{ path, message: schema['x-hint'] }] : errs;
}

function check(s: Schema, v: unknown, path: string): SchemaError[] {
  const err = (message: string): SchemaError[] => [{ path, message }];
  const t = typeOf(v);
  if (s.type) {
    const ok = s.type === 'integer' ? t === 'number' && Number.isInteger(v) : s.type === 'number' ? t === 'number' && Number.isFinite(v) : t === s.type;
    if (!ok) return err(`must be ${s.type === 'integer' ? 'a whole number' : s.type === 'object' ? 'an object' : s.type === 'array' ? 'a list' : `a ${s.type}`}, not ${t === 'number' && !Number.isFinite(v as number) ? String(v) : t}`);
  }
  if (s.enum && !s.enum.includes(v)) return err(`must be ${s.enum.map(show).join(', ').replace(/, ([^,]*)$/, ' or $1')}`);
  if ('const' in s && v !== s.const) return err(`must be ${show(s.const)}`);
  if (s.not && !check(s.not, v, path).length) return err(`can't be ${'const' in s.not ? show(s.not.const) : 'that'}`);
  if (s.oneOf) {
    const passing = s.oneOf.filter((o) => !validate(o, v, path).length).length;
    if (passing !== 1) return err(passing ? 'matches more than one form' : 'is not one of the allowed forms');
  }
  if (typeof v === 'string') {
    if (s.minLength !== undefined && v.length < s.minLength) return err(s.minLength === 1 ? "can't be empty" : `must be at least ${s.minLength} characters`);
    if (s.maxLength !== undefined && v.length > s.maxLength) return err(`must be at most ${s.maxLength} characters`);
    if (s.pattern && !new RegExp(s.pattern).test(v)) return err('is not in the right format');
  }
  if (typeof v === 'number') {
    if (s.minimum !== undefined && v < s.minimum) return err(`must be at least ${s.minimum}`);
    if (s.exclusiveMinimum !== undefined && v <= s.exclusiveMinimum) return err(`must be more than ${s.exclusiveMinimum}`);
    if (s.maximum !== undefined && v > s.maximum) return err(`must be at most ${s.maximum}`);
  }
  const out: SchemaError[] = [];
  if (t === 'object') {
    const o = v as Record<string, unknown>;
    for (const k of s.required ?? []) if (!(k in o) || o[k] === undefined) out.push({ path: join(path, k), message: 'is required' });
    for (const [k, val] of Object.entries(o)) {
      if (val === undefined) continue;
      if (s.propertyNames) for (const e of validate(s.propertyNames, k, join(path, k))) out.push({ ...e, message: `isn't a usable name (${e.message})` });
      const ps = s.properties?.[k];
      if (ps) out.push(...validate(ps, val, join(path, k)));
      else if (s.additionalProperties === false) out.push({ path: join(path, k), message: `isn't a known option${s.properties ? ` (the options are ${Object.keys(s.properties).join(', ')})` : ''}` });
      else if (s.additionalProperties && typeof s.additionalProperties === 'object') out.push(...validate(s.additionalProperties, val, join(path, k)));
    }
  }
  if (t === 'array' && s.items) (v as unknown[]).forEach((x, i) => out.push(...validate(s.items!, x, join(path, i))));
  return out;
}
