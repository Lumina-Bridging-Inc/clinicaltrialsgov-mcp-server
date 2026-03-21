# Zitadel Authentication Setup

This guide covers how to configure the ClinicalTrials.gov MCP server to authenticate requests using [Zitadel](https://zitadel.com) as the OAuth 2.0 / OIDC identity provider.

## Overview

The MCP server validates incoming Bearer tokens against Zitadel's JWKS endpoint. When a client sends a request to the `/mcp` endpoint, the server:

1. Extracts the `Authorization: Bearer <token>` header
2. Verifies the JWT signature against Zitadel's public keys
3. Extracts identity claims (`client_id`, `tenant_id`, `scopes`, `subject`)
4. Enforces scope-based access control on each tool/resource

```
Client ──Bearer token──▶ MCP Server ──JWKS verify──▶ Zitadel
                              │
                              ▼
                     Extract claims (azp, sub,
                     org ID) → authorize scopes
```

## Prerequisites

- A running Zitadel instance (cloud or self-hosted)
- A Zitadel project created for the MCP server
- The MCP server deployed with `MCP_TRANSPORT_TYPE=http`

## Step 1: Create a Zitadel Project

1. Log in to the Zitadel console
2. Navigate to **Projects** and create a new project (e.g., `clinicaltrials-mcp`)
3. Note the **Project ID** — this will be your `OAUTH_AUDIENCE` value

## Step 2: Create a Service User (Machine-to-Machine)

For server-to-server authentication (e.g., Claude API MCP connector, other backend services):

1. Go to **Users > Service Users > New**
2. Enter a username (e.g., `mcp-client`) and display name
3. Click **Create**
4. **Important:** In the service user's general settings, change **Access Token Type** from `opaque` to `JWT`
   - Zitadel issues opaque tokens by default; the MCP server requires JWT tokens for local signature verification

### Option A: Client Credentials (simpler)

1. Open the service user's **Actions** menu (top right) > **Generate Client Secret**
2. Copy the **Client ID** and **Client Secret** immediately (the secret is only shown once)
3. To obtain a token:

```bash
curl -X POST https://YOUR_INSTANCE.zitadel.cloud/oauth/v2/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -u "$CLIENT_ID:$CLIENT_SECRET" \
  -d "grant_type=client_credentials" \
  -d "scope=openid urn:zitadel:iam:org:project:id:PROJECT_ID:aud urn:zitadel:iam:user:resourceowner"
```

### Option B: Private Key JWT (more secure)

1. In the service user settings, go to **Keys** and generate a new key pair
2. Download the JSON key file
3. Sign a JWT assertion with the private key and exchange it at the token endpoint using `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer`

## Step 3: Configure Scopes

The MCP server enforces scope-based authorization on every tool and resource:

| Scope | Grants Access To |
|---|---|
| `tool:clinicaltrials:read` | All clinical trials tools (search, get study, compare, analyze trends, find eligible, get results, get field values) |
| `resource:echo:read` | Echo resource (for testing) |

### Zitadel Scopes to Request

When requesting a token, include these scopes:

| Scope | Purpose |
|---|---|
| `openid` | Required for OIDC |
| `urn:zitadel:iam:org:project:id:PROJECT_ID:aud` | Adds your project ID to the token's `aud` claim so the MCP server can validate it |
| `urn:zitadel:iam:user:resourceowner` | Includes the Zitadel organization ID in the token (used as `tenantId` for multi-tenant storage isolation) |

### Adding Custom Scopes via Zitadel Actions (Recommended)

By default, Zitadel does **not** include a `scope` claim in JWT access tokens. The MCP server will still authenticate the token but scope-based authorization checks require scopes to be present.

To inject custom scopes into tokens, create a **Zitadel Action** using the complement token flow:

1. Go to **Actions** in the Zitadel console
2. Create a new action with a **Complement Token** trigger
3. Add a script that sets the `scope` claim:

```javascript
function setCustomScopes(ctx, api) {
  // Grant MCP tool access to all service users in this project
  api.v1.claims.setClaim('scope', 'tool:clinicaltrials:read resource:echo:read');
}
```

4. Attach the action to the appropriate flow

Alternatively, if you do not configure scopes, the MCP server will log a warning but still authenticate the request. Scope enforcement is skipped when no scopes are present in the token (auth context exists but scopes are empty), which means tools remain accessible without fine-grained control.

## Step 4: Configure the MCP Server

Set the following environment variables on your MCP server deployment:

```env
# Enable OAuth authentication
MCP_AUTH_MODE=oauth

# Your Zitadel instance URL (the OIDC issuer)
OAUTH_ISSUER_URL=https://your-instance.zitadel.cloud

# Your Zitadel project ID (validated against the token's aud claim)
OAUTH_AUDIENCE=YOUR_PROJECT_ID

# Zitadel's JWKS endpoint (must be set explicitly — Zitadel uses
# /oauth/v2/keys, not the /.well-known/jwks.json default)
OAUTH_JWKS_URI=https://your-instance.zitadel.cloud/oauth/v2/keys
```

### Optional Configuration

```env
# JWKS cache cooldown in ms (default: 300000 = 5 minutes)
OAUTH_JWKS_COOLDOWN_MS=300000

# JWKS fetch timeout in ms (default: 5000)
OAUTH_JWKS_TIMEOUT_MS=5000
```

### Do NOT Set

- `MCP_SERVER_RESOURCE_IDENTIFIER` — Zitadel does not support RFC 8707 resource indicators. Setting this will cause token validation to fail.

### Railway Deployment

If deploying on Railway, set these variables in the Railway dashboard for the `clinicaltrialsgov-mcp-server` service in your target environment.

## Step 5: Verify the Setup

### Test the health endpoint (no auth required)

```bash
curl https://your-mcp-server.example.com/healthz
# Expected: {"status":"ok"}
```

### Get an access token from Zitadel

```bash
TOKEN=$(curl -s -X POST https://YOUR_INSTANCE.zitadel.cloud/oauth/v2/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -u "$CLIENT_ID:$CLIENT_SECRET" \
  -d "grant_type=client_credentials" \
  -d "scope=openid urn:zitadel:iam:org:project:id:PROJECT_ID:aud urn:zitadel:iam:user:resourceowner" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

echo $TOKEN
```

### Call the MCP endpoint

```bash
curl -X POST https://your-mcp-server.example.com/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/list"
  }'
```

### Check the OAuth discovery endpoint

```bash
curl https://your-mcp-server.example.com/.well-known/oauth-protected-resource
# Expected: JSON with resource identifier and authorization_servers array
```

### Without a valid token (expect 401)

```bash
curl -X POST https://your-mcp-server.example.com/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
# Expected: 401 Unauthorized with WWW-Authenticate header
```

## Using with Claude's MCP Connector

The MCP server is compatible with Claude's [MCP connector](https://platform.claude.com/docs/en/agents-and-tools/mcp-connector), which connects to remote MCP servers from the Messages API.

1. Obtain a Zitadel access token (see Step 5 above)
2. Pass it as `authorization_token` in the MCP connector config:

```json
{
  "model": "claude-sonnet-4-20250514",
  "max_tokens": 1000,
  "messages": [{"role": "user", "content": "Search for diabetes trials"}],
  "mcp_servers": [
    {
      "type": "url",
      "url": "https://your-mcp-server.example.com/mcp",
      "name": "clinicaltrials",
      "authorization_token": "YOUR_ZITADEL_ACCESS_TOKEN"
    }
  ],
  "tools": [
    {
      "type": "mcp_toolset",
      "mcp_server_name": "clinicaltrials"
    }
  ]
}
```

**Note:** The Claude API requires the beta header `"anthropic-beta": "mcp-client-2025-11-20"` for MCP connector support.

## Claim Mapping Reference

The MCP server automatically maps Zitadel's JWT claims to its internal auth model:

| MCP Server Field | Zitadel Claim | Fallback Claims | Notes |
|---|---|---|---|
| `clientId` | `azp` | `client_id`, `cid` | Identifies the calling application |
| `subject` | `sub` | — | The Zitadel user ID |
| `tenantId` | `urn:zitadel:iam:user:resourceowner:id` | `tid` | The Zitadel organization ID; used for multi-tenant storage isolation |
| `scopes` | `scope` (space-separated string) | `scp` (array) | Requires Zitadel Actions to inject; empty by default |

## Troubleshooting

### Token rejected with "issuer mismatch"

Ensure `OAUTH_ISSUER_URL` exactly matches the `iss` claim in Zitadel tokens. For Zitadel Cloud, this is `https://your-instance.zitadel.cloud`. No trailing slash.

### Token rejected with "audience mismatch"

Ensure:
- `OAUTH_AUDIENCE` is set to your Zitadel **project ID**
- The token request includes the scope `urn:zitadel:iam:org:project:id:PROJECT_ID:aud`

### JWKS fetch fails or times out

- Verify `OAUTH_JWKS_URI` is set to `https://your-instance.zitadel.cloud/oauth/v2/keys`
- If omitted, the server defaults to `${OAUTH_ISSUER_URL}/.well-known/jwks.json` which is **not** the correct Zitadel path
- Increase `OAUTH_JWKS_TIMEOUT_MS` if the Zitadel instance has high latency

### "Insufficient permissions. Missing required scopes: tool:clinicaltrials:read"

Zitadel does not include scopes in JWT tokens by default. Either:
- Add a Zitadel Action to inject the `scope` claim (see Step 3)
- Or, if scope enforcement is not needed, this error means the token was authenticated successfully but lacks the required scope

### Token type is opaque, not JWT

Go to the Zitadel service user's settings and change **Access Token Type** to `JWT`. Opaque tokens cannot be verified via JWKS — they require introspection, which this server does not support.

### Multi-tenancy and storage isolation

If using a persistent storage provider (filesystem, Supabase), ensure tokens include a tenant ID. Request the `urn:zitadel:iam:user:resourceowner` scope so Zitadel includes the organization ID. Without a tenant ID, storage operations will fail with a "missing tenantId" error.
