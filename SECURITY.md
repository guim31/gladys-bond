# Security policy

## Reporting a vulnerability

Please do **not** report a security problem in a public issue, pull request or
forum post.

Report it privately through GitHub instead: open the **Security** tab of this
repository, then **Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only
asks the maintainers for a private contact, without any detail of the problem,
and send the report there.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- the log lines that help (remove tokens, passwords and addresses first).

The fix ships as a new version of the integration, and the advisory is
published once users can update.

## Supported versions

Only the latest release receives security fixes: update the integration from
Gladys before reporting a problem.

## Scope

In scope: the code of this repository and the Docker image it publishes.

What the integration handles:

- **Secrets**: the local tokens of the Bond bridges are `secret` fields of the
  Gladys configuration. The integration reads them from Gladys at startup,
  keeps them in memory, sends them only to the bridge they belong to (the
  `BOND-Token` header, over plain HTTP on the local network, as the Bond local
  API requires), and never writes them to `/data` nor to the logs. "Get the
  local token" reads the token from the bridge (`GET /v2/token`, answered only
  during the 10 minutes after the bridge starts) and saves it in the Gladys
  configuration.
- **Stored in `/data`**: nothing.
- **Network**: HTTP requests go only to the bridge addresses of the
  configuration, on the local network; UDP datagrams (BPUP keep-alives) go to
  port 30007 of the same addresses, and only their answers are read. "Find the
  bridges" asks the Gladys core for an mDNS browse of `_bond._tcp` (declared
  in the manifest). The integration opens no listening port and calls no cloud
  service.
- **Safety**: fireplaces are never controllable from Gladys, and garage doors
  are not published, so that a scene, a voice assistant or a mistake on the
  dashboard cannot light a flame or open a door.

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)),
the Bond bridges and their firmware, and the other devices and services of
your network.
