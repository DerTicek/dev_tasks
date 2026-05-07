#!/usr/bin/env bash
# Fire sample leads at the local n8n webhook.
# Usage:
#   ./send-test.sh high
#   ./send-test.sh medium
#   ./send-test.sh low
#   ./send-test.sh invalid
#   ./send-test.sh all

set -euo pipefail

URL="${WEBHOOK_URL:-http://localhost:5678/webhook/lead-intake}"

send() {
  local label="$1" payload="$2"
  echo "── $label ──────────────────────────────"
  echo "$payload" | jq -C .
  echo
  curl -sS -X POST "$URL" \
    -H "Content-Type: application/json" \
    -d "$payload" | jq -C . || echo "(non-JSON response)"
  echo
}

high='{"name":"Sara Patel","email":"sara@stripe.com","company":"Stripe"}'
med='{"name":"Priya Shah","email":"priya@midmarket.io","company":"MidMarket"}'
low='{"name":"Tom Berger","email":"tom@localbakery.com","company":"Local Bakery"}'
bad='{"name":"","email":"not-an-email","company":"Broken Inc"}'

case "${1:-all}" in
  high)    send "HIGH"    "$high" ;;
  medium)  send "MEDIUM"  "$med" ;;
  low)     send "LOW"     "$low" ;;
  invalid) send "INVALID" "$bad" ;;
  all)
    send "HIGH"    "$high"
    send "MEDIUM"  "$med"
    send "LOW"     "$low"
    send "INVALID" "$bad"
    ;;
  *)
    echo "Usage: $0 {high|medium|low|invalid|all}" >&2
    exit 1
    ;;
esac
