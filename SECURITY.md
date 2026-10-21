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

What the integration keeps and sends:

- Its configuration (the Nightscout address, the access token or the
  API_SECRET) is stored by Gladys and handed to the container; the API_SECRET
  is only sent to Nightscout hashed (SHA-1), as Nightscout expects, and the
  token in the query string. Neither is ever written to the logs, nor the
  glucose values.
- `/data/nightscout-state.json` holds the state of the scene triggers: a
  digest of the site address, the time of the last value and which thresholds
  were crossed. No glucose value.
- Network: only GET requests to the configured Nightscout site. Redirects are
  not followed, so the secret never goes elsewhere.

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)),
Nightscout and the sensors and apps that feed it.
