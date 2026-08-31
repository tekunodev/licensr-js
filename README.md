# @licensr/sdk

Official JavaScript/TypeScript SDK for the [Licensr](https://licensr.app) license API: validation, seat/domain activation, offline EdDSA token verification, and hosted checkout. Ships as dual ESM/CJS with bundled types, zero runtime dependencies beyond [`jose`](https://github.com/panva/jose) (for offline token verification).

See the [plugin integration guide](https://docs.licensr.app/plugin-integration) for the underlying API's concepts (activation modes, entitlement/fallback, rate limits, the embedded-key doctrine) — this README covers the JS-specific surface.

## Install

```bash
npm install @licensr/sdk
```

## Quickstart

```ts
import {LicensrClient} from '@licensr/sdk';

const client = new LicensrClient({
  apiKey: 'pk_live_...', // safe to embed in a distributed binary/webview — see §6.1 of plugin-integration.md
  pluginSlug: 'my-plugin',
});

const result = await client.validate({licenseKey: userEnteredKey});
if (result.valid) {
  unlockFullFeatures();
} else if (result.entitlement === 'limited') {
  unlockDegradedMode(); // perpetual-fallback: expired, but the plan grants a limited tier
}
```

## API

Every method returns a camelCase-mapped response and throws on failure — see [Errors](#errors).

| Method                                                              | Wraps                         | Notes                                                                                                                    |
| ------------------------------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `client.validate({licenseKey})`                                     | `POST /v1/license/validate`   | Always read `valid`/`entitlement`; never branch on HTTP status — an unknown key returns `200 {valid: false}`, not `404`. |
| `client.token({licenseKey})`                                        | `POST /v1/license/token`      | Same check as `validate`, plus a short-lived signed offline token. See [Offline verification](#offline-verification).    |
| `client.activate({licenseKey, activationType, identifier, label?})` | `POST /v1/license/activate`   | `activationType` is `'seat'` (per-machine) or `'domain'`, fixed by the plugin's configured mode.                         |
| `client.deactivate({licenseKey, activationId})`                     | `POST /v1/license/deactivate` | Frees a seat/domain slot.                                                                                                |
| `client.activations({licenseKey})`                                  | `GET /v1/license/activations` | Lists every current activation.                                                                                          |
| `client.checkout({planId, customerEmail, successUrl?, cancelUrl?})` | `POST /v1/billing/checkout`   | Returns `checkoutUrl` — redirect the user there. Requires a key with the `checkout` scope.                               |

### Client options

```ts
new LicensrClient({
  apiKey: 'pk_live_...',
  pluginSlug: 'my-plugin',
  baseUrl: 'https://api.licensr.app', // default; override for self-hosted/staging
  deviceId: stableHwid, // buckets rate limits per installation instead of per key — reuse your activate() identifier
  origin: 'app://my-plugin', // non-browser runtimes only; native SDKs should set the plugin's client_kind to "native" instead
  timeoutMs: 10_000,
  retry: {maxRetries: 2, baseDelayMs: 300, maxDelayMs: 5000}, // network errors / 429 / 5xx, exponential backoff + jitter, honors Retry-After
});
```

### Events

```ts
client.events.on('validated', (result) => console.log('validated', result));
client.events.on('retry', ({method, attempt, delayMs}) =>
  console.log(`retrying ${method}, attempt ${attempt} in ${delayMs}ms`)
);
client.events.on('error', ({method, error}) => reportToCrashlytics(method, error));
```

Available events: `validated`, `activated`, `deactivated`, `tokenIssued`, `retry`, `error`.

### Offline verification

`client.token()` mints an EdDSA-signed JWT whose claims mirror `validate()`'s response. Verify it fully offline (no network beyond the first JWKS fetch, which is cached for the process lifetime):

```ts
import {verifyOfflineToken} from '@licensr/sdk';

const {token, jwksUrl} = await client.token({licenseKey});
const claims = await verifyOfflineToken(token, jwksUrl);
// claims.valid, claims.entitlement, claims.exp, ...
```

Offline tokens carry no revocation signal — they prove the token was genuinely issued and hasn't expired, not that the license is still active _right now_. Re-validate online before `expiresAt`.

To boot fully offline (no network at all, e.g. on first launch before any successful `/token` call), persist the last-known-good token yourself using the `OfflineTokenStore` interface (a `InMemoryOfflineTokenStore` is included, but doesn't survive a restart — back it with `localStorage`, a config file, or your platform's keychain):

```ts
import {InMemoryOfflineTokenStore, verifyOfflineToken} from '@licensr/sdk';

const store = new InMemoryOfflineTokenStore(); // swap for your own persistent implementation

const cached = store.get(licenseKey);
if (cached) {
  try {
    await verifyOfflineToken(cached.token, jwksUrl); // still valid — usable while offline
  } catch {
    /* expired or tampered — fall through to an online check */
  }
}
```

### Errors

| Class                           | When                                                                                                                                                                        |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `LicensrApiError`               | Non-2xx response. Has `status`, `code` (see `LicensrErrorCode` — matches `contract/conformance.yaml`), `message`, and `retryAfterSeconds`. Branch on `code`, not `message`. |
| `LicensrNetworkError`           | The request never got a response (network failure, timeout, retries exhausted).                                                                                             |
| `LicensrTokenVerificationError` | `verifyOfflineToken` rejected a bad signature, wrong algorithm, or expired token.                                                                                           |

## Development

```bash
pnpm install
pnpm build        # tsup → dist/ (ESM + CJS + .d.ts)
pnpm test         # vitest
pnpm test:coverage
pnpm typecheck
pnpm lint
pnpm format
```

### Conformance suite

`test/conformance.test.ts` runs every case in [`contract/conformance.yaml`](../../contract/README.md) against a real, running backend — the same contract `backend/tests/test_conformance_contract.py` enforces on the Python side. It's skipped by default (no live backend in a normal `pnpm test` run); to run it locally:

```bash
# 1. Start Postgres + migrate (from repo root)
docker compose up -d postgres
cd backend && APP_ENV=dev poetry run alembic upgrade head

# 2. Start the backend (BILLING_PROVIDER=mock avoids needing real Stripe creds)
APP_ENV=dev BILLING_PROVIDER=mock poetry run uvicorn main:app --port 8080

# 3. Seed fixtures for every case (in another shell)
poetry run python scripts/seed_conformance_fixtures.py --out /tmp/conformance_fixtures.json

# 4. Run the conformance suite (from sdks/js)
cd ../sdks/js
CONFORMANCE_BASE_URL=http://localhost:8080 \
CONFORMANCE_FIXTURES_PATH=/tmp/conformance_fixtures.json \
pnpm exec vitest run test/conformance.test.ts
```

CI wires up the same four steps as one job — see `.github/workflows/test-sdk-js.yaml`.

## Releasing

Bump `"version"` in `package.json`, commit to `main`, then tag `js/vX.Y.Z` and push the tag (triggers npm publish + mirror). Step-by-step: [`docs/SDK_PROGRAM.md` §2](../../docs/SDK_PROGRAM.md#2-releasing-an-sdk-update) or [`sdks/RELEASING.md`](../RELEASING.md).
