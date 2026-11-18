OXYON LAB  (/future/lab/)

Developer-only hosting diagnostics for winlew.co. Not linked prominently from
the public /future/ landing page and marked noindex.

  index.html     Lab index (links to the tests below)
  probe.php      Read-only server capability probe (plain text). No secrets,
                 no paths, no environment variables, no shell commands run.
                 Outbound HTTPS is tested against EXTERNAL hosts (XL1 RPC,
                 XL1 data lake) -- the old probe only tested winlew.co itself,
                 which can fail because of hairpin routing.
  node-test.js   A Node http server snippet. If the browser shows its source
                 as text, the host does NOT execute Node (expected on shared
                 hosting).
  js-test.js     Confirms browser JavaScript runs.

probe.php reveals capability info (PHP version, enabled functions). It is
harmless but not public-facing; delete or rename it when you are done testing.
Nothing in /future/ touches WinLEW auth, wallets, games, faucets or producers.
