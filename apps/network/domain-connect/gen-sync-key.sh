#!/usr/bin/env bash
#
# Generate the RSA keypair Domain Connect uses to sign synchronous-flow requests, and
# print the public-key TXT record to publish under `syncPubKeyDomain`
# (`_dconf.trustmcp.app` in our template). Providers fetch this key to verify that an
# `/apply` request really came from us before they write records.
#
# Usage:   ./gen-sync-key.sh [key-id]
#   key-id  Label prefixed to syncPubKeyDomain (default: _dc1). Lets you rotate keys
#           by publishing a new id alongside the old one.
#
# Output:  domain-connect-sync.key  (PRIVATE — load into the network service, never commit)
#          domain-connect-sync.pub  (public key, for reference)
#          ...and the exact TXT record to publish, printed to stdout.
#
# See the Domain Connect spec, "Signing the query string", for the signature scheme.
set -euo pipefail

KEY_ID="${1:-_dc1}"
SYNC_PUB_KEY_DOMAIN="_dconf.trustmcp.app"   # keep in sync with templates/*.json

if ! command -v openssl >/dev/null 2>&1; then
  echo "error: openssl is required" >&2
  exit 1
fi

openssl genrsa -out domain-connect-sync.key 2048 >/dev/null 2>&1
openssl rsa -in domain-connect-sync.key -pubout -out domain-connect-sync.pub >/dev/null 2>&1

# Domain Connect publishes the public key as base64-encoded DER in a `p=` tag.
PUB_DER_B64="$(openssl rsa -in domain-connect-sync.key -pubout -outform DER 2>/dev/null | base64 | tr -d '\n')"

cat <<EOF

Generated:
  domain-connect-sync.key   PRIVATE key — load into the network service (do NOT commit)
  domain-connect-sync.pub   public key (reference)

Publish this TXT record at your DNS:
  name:   ${KEY_ID}.${SYNC_PUB_KEY_DOMAIN}
  type:   TXT
  value:  p=${PUB_DER_B64}, a=RS256, t=x509

Then point the network service at the private key (env), and reference the key id
(${KEY_ID}) when signing /apply requests. Validate the whole setup in the Domain
Connect Online Editor before opening the templates-repo PR.
EOF
