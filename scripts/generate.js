#!/usr/bin/env node
/**
 * compliwa-node — scripts/generate.js
 *
 * Writes the generated half of the SDK from the Compliwa API's OpenAPI contract:
 *
 *   src/generated/operations.js   every API-key operation: its SDK name, HTTP method, path, and
 *                                 what it takes (path ids, a body, query filters, pages, idempotency)
 *   src/generated/meta.js         the API version the SDK was generated from
 *   types/generated.d.ts          TypeScript types: every request and answer, and every method
 *
 * The names come from the contract itself (`x-sdk`, written by the API — compliwaAPI
 * src/openapi/sdkNames.js), so the SDK, the Python SDK and the API reference can never disagree.
 * Nothing here is edited by hand: change the API, then run
 *
 *   npm run generate                                   # ../compliwaAPI/openapi/dist/openapi.json
 *   npm run generate -- --spec http://localhost:5010/v1/openapi.json
 *   npm run generate -- --check                        # CI: fail if the files are out of date
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name) => {
  const at = args.indexOf(name);
  return at === -1 ? undefined : args[at + 1];
};
const CHECK = args.includes('--check');
const SPEC =
  flag('--spec') ??
  process.env.COMPLIWA_OPENAPI ??
  [resolve(root, '../compliwaAPI/openapi/dist/openapi.json'), resolve(root, 'openapi.json')].find((p) =>
    existsSync(p),
  );

if (!SPEC) {
  console.error(
    'No contract found. Build it in the API folder (npm run openapi:build), or pass --spec <file or URL>.',
  );
  process.exit(1);
}

async function loadSpec(source) {
  if (/^https?:\/\//.test(source)) {
    const res = await fetch(source);
    if (!res.ok) throw new Error(`${source} answered ${res.status}`);
    return res.json();
  }
  return JSON.parse(await readFile(source, 'utf8'));
}

const doc = await loadSpec(SPEC);
const SCHEMAS = doc.components?.schemas ?? {};
const VERBS = ['get', 'post', 'put', 'patch', 'delete'];

const camel = (text) => text.replace(/[-_]([a-z0-9])/g, (_, c) => c.toUpperCase());
const pascal = (text) => camel(text).replace(/^[a-z]/, (c) => c.toUpperCase());
const refName = (ref) => ref.split('/').at(-1);
const deref = (p) => (p?.$ref ? doc.components.parameters[refName(p.$ref)] : p);

/* ------------------------------------------------------------ the operations */

const operations = [];
for (const [path, item] of Object.entries(doc.paths)) {
  for (const verb of VERBS) {
    const op = item[verb];
    const sdk = op?.['x-sdk'];
    if (!sdk) continue;
    const parameters = [...(item.parameters ?? []), ...(op.parameters ?? [])].map(deref);
    const ok = Object.entries(op.responses ?? {}).filter(([status]) => /^2/.test(status));
    operations.push({
      name: [...sdk.resource, sdk.method].join('.'),
      resource: sdk.resource,
      method: sdk.method,
      http: verb.toUpperCase(),
      path,
      pathParams: sdk.path_params,
      body: sdk.body,
      bodyRequired: Boolean(op.requestBody?.required),
      query: sdk.query,
      paginated: Boolean(sdk.paginated),
      idempotent: Boolean(sdk.idempotent),
      operationId: op.operationId,
      summary: op.summary ?? '',
      description: op.description ?? '',
      deprecated: Boolean(op.deprecated),
      parameters,
      requestSchema: op.requestBody?.content?.['application/json']?.schema ?? null,
      responseSchemas: ok.map(([, r]) => r.content?.['application/json']?.schema).filter(Boolean),
    });
  }
}
operations.sort((a, b) => a.name.localeCompare(b.name));
if (operations.length === 0) {
  console.error('The contract has no x-sdk names — is the API at step 12.4 or later?');
  process.exit(1);
}

/* ------------------------------------------------------------ JSON Schema → TypeScript */

const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const key = (k) => (IDENT.test(k) ? k : JSON.stringify(k));
const used = new Map(); // component name → 'input' | 'output' | 'both'

function useComponent(name, mode) {
  const before = used.get(name);
  if (before === mode || before === 'both') return;
  used.set(name, before ? 'both' : mode);
  collect(SCHEMAS[name], mode);
}

function collect(schema, mode) {
  if (!schema || typeof schema !== 'object') return;
  if (Array.isArray(schema)) return schema.forEach((s) => collect(s, mode));
  if (schema.$ref) return useComponent(refName(schema.$ref), mode);
  for (const [k, v] of Object.entries(schema)) {
    if (k === 'example' || k === 'examples' || k === 'default' || k === 'const' || k === 'enum') continue;
    collect(v, mode);
  }
}

function comment(text, pad) {
  const lines = String(text ?? '')
    .trim()
    .replace(/\*\//g, '*\\/')
    .split('\n');
  if (!lines[0]) return '';
  if (lines.length === 1) return `${pad}/** ${lines[0]} */\n`;
  return `${pad}/**\n${lines.map((l) => `${pad} *${l ? ` ${l}` : ''}`).join('\n')}\n${pad} */\n`;
}

const paren = (t) => (/[|&]/.test(t) && !/^\{[\s\S]*\}$/.test(t) ? `(${t})` : t);
const union = (types) => [...new Set(types)].join(' | ') || 'never';

function ts(schema, mode, pad = '') {
  if (schema === true || schema === undefined || schema === null) return 'unknown';
  if (schema === false) return 'never';
  if (schema.$ref) return refName(schema.$ref);
  if ('const' in schema) return JSON.stringify(schema.const);
  if (Array.isArray(schema.enum)) return union(schema.enum.map((v) => JSON.stringify(v)));
  if (schema.anyOf || schema.oneOf) return union((schema.anyOf ?? schema.oneOf).map((s) => ts(s, mode, pad)));
  if (schema.allOf) return schema.allOf.map((s) => paren(ts(s, mode, pad))).join(' & ');
  if (Array.isArray(schema.type)) {
    return union(schema.type.map((type) => ts({ ...schema, type }, mode, pad)));
  }
  switch (schema.type) {
    case 'string':
      return 'string';
    case 'integer':
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'null':
      return 'null';
    case 'array':
      return `Array<${ts(schema.items, mode, pad)}>`;
    case 'object':
    case undefined: {
      if (!schema.properties && schema.type === undefined) return 'unknown';
      return objectType(schema, mode, pad);
    }
    default:
      return 'unknown';
  }
}

function objectType(schema, mode, pad) {
  const required = new Set(schema.required ?? []);
  const inner = `${pad}  `;
  const lines = Object.entries(schema.properties ?? {}).map(([name, prop]) => {
    const optional = !required.has(name) || (mode === 'input' && prop && 'default' in prop);
    const note = [
      prop?.description,
      prop && 'default' in prop ? `Default: ${JSON.stringify(prop.default)}` : '',
    ]
      .filter(Boolean)
      .join('\n\n');
    return `${comment(note, inner)}${inner}${key(name)}${optional ? '?' : ''}: ${ts(prop, mode, inner)};`;
  });
  const extra = schema.additionalProperties;
  if (extra && extra !== false) {
    lines.push(`${inner}[key: string]: ${extra === true ? 'unknown' : ts(extra, mode, inner)};`);
  } else if (!schema.properties && extra === undefined) {
    return 'Record<string, unknown>';
  }
  if (lines.length === 0) return 'Record<string, never>';
  return `{\n${lines.join('\n')}\n${pad}}`;
}

/* ------------------------------------------------------------ per-operation types */

const opTypes = [];
const sigOf = new Map();

for (const op of operations) {
  if (op.requestSchema) collect(op.requestSchema, 'input');
  op.responseSchemas.forEach((s) => collect(s, 'output'));
  const queryParams = op.parameters.filter((p) => p.in === 'query');
  queryParams.forEach((p) => collect(p.schema, 'input'));

  const base = pascal(op.operationId ?? op.name.replace(/\./g, '_'));
  let paramsType = null;
  let paramsRequired = false;
  if (op.body) {
    paramsType = op.requestSchema?.$ref ? refName(op.requestSchema.$ref) : `${base}Params`;
    if (!op.requestSchema?.$ref) {
      opTypes.push(`${comment(op.summary, '')}export type ${base}Params = ${ts(op.requestSchema, 'input')};`);
    }
    paramsRequired = op.bodyRequired;
  } else if (op.query) {
    paramsType = `${base}Params`;
    const props = Object.fromEntries(
      queryParams.map((p) => [p.name, { ...p.schema, description: p.description }]),
    );
    const required = queryParams.filter((p) => p.required).map((p) => p.name);
    paramsRequired = required.length > 0;
    opTypes.push(
      `${comment(`Filters for ${op.name}()`, '')}export interface ${paramsType} ${objectType({ type: 'object', properties: props, required }, 'input', '')}`,
    );
  }

  const answer = union(op.responseSchemas.map((s) => ts(s, 'output')));
  let returns = `Promise<WithResponse<${answer}>>`;
  if (op.paginated) {
    const page = op.responseSchemas[0];
    const pageSchema = page?.$ref ? SCHEMAS[refName(page.$ref)] : page;
    const item = ts(pageSchema?.properties?.data?.items, 'output');
    returns = `PagePromise<${item}, ${answer}>`;
  }

  const ids = op.pathParams.map((p) => `${camel(p)}: string`);
  const params = paramsType ? [`params${paramsRequired ? '' : '?'}: ${paramsType}`] : [];
  const scope = /Needs `([a-z.]+)`/.exec(op.description)?.[1];
  const doc = [
    op.summary,
    '',
    op.description.split('\n\n')[0].trim(),
    '',
    `${op.http} ${op.path}${scope ? ` · scope ${scope}` : ''}${op.idempotent ? ' · idempotent (retried safely)' : ''}`,
    op.deprecated ? '\n@deprecated' : '',
  ]
    .join('\n')
    .replace(/\n{3,}/g, '\n\n');
  sigOf.set(op.name, {
    doc,
    signature: `${op.method}(${[...ids, ...params, 'options?: RequestOptions'].join(', ')}): ${returns};`,
  });
}

/* ------------------------------------------------------------ the resource tree */

const tree = {};
for (const op of operations) {
  let node = tree;
  for (const part of op.resource) {
    if (node[part]?.__method) throw new Error(`${op.name}: ${part} is both a method and a resource`);
    node = node[part] ??= {};
  }
  if (node[op.method]) throw new Error(`${op.name}: the name is used twice`);
  node[op.method] = { __method: op.name };
}

function treeType(node, pad) {
  const inner = `${pad}  `;
  return `{\n${Object.entries(node)
    .map(([name, value]) => {
      if (value.__method) {
        const { doc: text, signature } = sigOf.get(value.__method);
        return `${comment(text, inner)}${inner}${signature}`;
      }
      return `${inner}readonly ${key(name)}: ${treeType(value, inner)};`;
    })
    .join('\n')}\n${pad}}`;
}

/* ------------------------------------------------------------ write */

const header = (what) =>
  `// GENERATED by scripts/generate.js from the Compliwa API contract ${doc.info.version} — do not edit.\n// ${what}\n`;

const table = operations.map((op) => {
  const row = {
    name: op.name,
    http: op.http,
    path: op.path,
    pathParams: op.pathParams,
  };
  if (op.body) row.body = true;
  if (op.query) row.query = true;
  if (op.paginated) row.paginated = true;
  if (op.idempotent) row.idempotent = true;
  return `  ${JSON.stringify(row)},`;
});

const files = {
  'src/generated/operations.js': `${header('Every operation an API key can call, by its SDK name.')}
/** @type {ReadonlyArray<{ name: string, http: string, path: string, pathParams: string[], body?: true, query?: true, paginated?: true, idempotent?: true }>} */
export const OPERATIONS = Object.freeze([
${table.join('\n')}
]);
`,
  'src/generated/meta.js': `${header('Which contract this SDK was generated from.')}
export const API_VERSION = ${JSON.stringify(doc.info.version)};
export const OPERATION_COUNT = ${operations.length};
`,
};

const components = [...used.keys()].sort().map((name) => {
  const mode = used.get(name) === 'input' ? 'input' : 'output';
  const schema = SCHEMAS[name];
  return `${comment(schema?.description, '')}export type ${name} = ${ts(schema, mode)};`;
});

files['types/generated.d.ts'] = `${header('Types for every request and answer, and the methods.')}
import type { PagePromise, RequestOptions, WithResponse } from './index.js';

${components.join('\n\n')}

${opTypes.join('\n\n')}

/** Every resource and method of the Compliwa API (API ${doc.info.version}). */
export interface CompliwaResources ${treeType(tree, '')}
`;

let stale = false;
for (const [file, content] of Object.entries(files)) {
  const target = resolve(root, file);
  const before = existsSync(target) ? await readFile(target, 'utf8') : null;
  if (before === content) continue;
  if (CHECK) {
    console.error(`✖ ${file} is out of date — run npm run generate`);
    stale = true;
    continue;
  }
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, content);
  console.log(`  wrote ${file}`);
}
if (stale) process.exit(1);

const digest = createHash('sha256').update(Object.values(files).join('')).digest('hex').slice(0, 12);
console.log(
  `✔ API ${doc.info.version} · ${operations.length} operations · ${used.size} types · ${digest}${CHECK ? ' · up to date' : ''}`,
);
