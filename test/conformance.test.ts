/**
 * TypeScript conformance runner for `contract/conformance.yaml`.
 *
 * Mirrors `backend/tests/test_conformance_contract.py` case-for-case
 * against a *running* backend (raw `fetch`, not `LicensrClient` — a few
 * cases exercise things the client intentionally doesn't expose, like a
 * missing Authorization header or a deprecated path). See `README.md` for
 * how to start the backend and produce the fixtures file this reads.
 *
 * Skipped by default: requires `CONFORMANCE_BASE_URL` (the running
 * backend) and `CONFORMANCE_FIXTURES_PATH` (JSON from
 * `backend/scripts/seed_conformance_fixtures.py`), matching the backend
 * suite's own `RUN_INTEGRATION_TESTS=1` opt-in.
 */
import {readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, expect, it} from 'vitest';
import {parse} from 'yaml';

interface ConformanceCase {
  id: string;
  description: string;
  setup?: Record<string, unknown>;
  request: {
    method: 'GET' | 'POST';
    path: string;
    auth: 'valid_api_key' | 'missing' | 'invalid' | 'revoked' | 'none';
    origin?: 'allowed' | 'disallowed' | 'omit';
    body?: unknown;
    repeat?: number;
  };
  expect: {
    status: number;
    json?: Record<string, unknown>;
  };
}

type FixtureValues = Record<string, string>;

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFORMANCE_YAML_PATH = resolve(__dirname, '../../../contract/conformance.yaml');
const baseUrl = process.env.CONFORMANCE_BASE_URL;
const fixturesPath = process.env.CONFORMANCE_FIXTURES_PATH;

function loadCases(): ConformanceCase[] {
  const document = parse(readFileSync(CONFORMANCE_YAML_PATH, 'utf-8')) as {cases: ConformanceCase[]};
  return document.cases;
}

function loadFixtures(path: string): Record<string, FixtureValues> {
  return JSON.parse(readFileSync(path, 'utf-8')) as Record<string, FixtureValues>;
}

/** Recursively substitute `${name}` placeholders — mirrors `_resolve` in the Python runner. */
function resolvePlaceholders(value: unknown, values: FixtureValues): unknown {
  if (typeof value === 'string') {
    return Object.entries(values).reduce((acc, [key, replacement]) => acc.split(`\${${key}}`).join(replacement), value);
  }
  if (Array.isArray(value)) return value.map((item) => resolvePlaceholders(item, values));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolvePlaceholders(v, values)]));
  }
  return value;
}

/** Read a dotted path like `detail.error` or `keys.0.kty` out of a parsed JSON body. */
function getPath(obj: unknown, dotted: string): unknown {
  return dotted.split('.').reduce<unknown>((current, part) => {
    if (Array.isArray(current)) return current[Number(part)];
    if (current && typeof current === 'object') return (current as Record<string, unknown>)[part];
    throw new Error(`Cannot descend into ${part} of ${JSON.stringify(current)} (from path ${dotted})`);
  }, obj);
}

function authHeader(auth: ConformanceCase['request']['auth'], values: FixtureValues): Record<string, string> {
  switch (auth) {
    case 'missing':
    case 'none':
      return {};
    case 'invalid':
      return {Authorization: 'Bearer pk_live_00000000000000000000000000'};
    case 'valid_api_key':
    case 'revoked':
      return {Authorization: `Bearer ${values.api_key}`};
  }
}

function originHeader(origin: ConformanceCase['request']['origin'], values: FixtureValues): Record<string, string> {
  switch (origin) {
    case undefined:
    case 'omit':
      return {};
    case 'allowed':
      return {Origin: values._allowed_origin as string};
    case 'disallowed':
      return {Origin: 'https://evil.example'};
  }
}

async function send(base: string, request: ConformanceCase['request'], values: FixtureValues): Promise<Response> {
  const path = resolvePlaceholders(request.path, values) as string;
  const headers = {...authHeader(request.auth, values), ...originHeader(request.origin, values)};

  if (request.method === 'GET') {
    return fetch(new URL(path, base), {headers});
  }
  const body = resolvePlaceholders(request.body ?? {}, values);
  return fetch(new URL(path, base), {
    method: 'POST',
    headers: {...headers, 'Content-Type': 'application/json'},
    body: JSON.stringify(body),
  });
}

describe.skipIf(!baseUrl || !fixturesPath)('conformance suite (contract/conformance.yaml)', () => {
  const cases = loadCases();
  const fixtures = fixturesPath ? loadFixtures(fixturesPath) : {};

  for (const testCase of cases) {
    it(testCase.id, async () => {
      const values = fixtures[testCase.id];
      if (!values) {
        throw new Error(`no seeded fixtures for case ${testCase.id} — re-run seed_conformance_fixtures.py`);
      }

      const repeat = testCase.request.repeat ?? 1;
      let response: Response | undefined;
      for (let i = 0; i < repeat; i += 1) {
        response = await send(baseUrl as string, testCase.request, values);
      }

      expect(response?.status).toBe(testCase.expect.status);
      const body: unknown = await response?.json();
      for (const [dottedPath, expected] of Object.entries(testCase.expect.json ?? {})) {
        expect(getPath(body, dottedPath)).toEqual(expected);
      }
    });
  }
});
