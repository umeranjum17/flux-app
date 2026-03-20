# Remote Control Notes

Flux Desktop now exposes a local-network WebSocket JSON-RPC server on port `19275`
and advertises `_flux-ctrl._tcp` over mDNS for Flux Mobile discovery.

## Desktop behavior

- The desktop settings panel can generate short-lived pairing codes.
- Pairing codes are accepted over `auth:pair`, and the desktop returns a durable issued token for future handshakes.
- Once a client is paired, the desktop tracks it as a revocable remote client.
- The desktop publishes workspace, task, approval, and diff events over the
  same JSON-RPC channel used for request/response calls.
- The remote API also supports answering question prompts plus retrieving
  workspace chat sessions and session message history so mobile clients can
  recover state after reconnecting.

## Mobile contract

1. Mobile submits the pairing code to the desktop.
2. Desktop responds with a durable issued token.
3. Mobile stores the issued token in Expo Secure Store and uses that token for
   future `auth:pair` handshakes.
