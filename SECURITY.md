# Security

Music Coach runs a small server on the user's Mac, listening only on
`127.0.0.1`, port **8765** (http://localhost:8765). Other computers can't reach
it. It answers only its own page: requests whose Host isn't localhost or
127.0.0.1 on that port, or that come from another website, are refused. It
stores an optional API key for the coach model in a local file readable only
by the user's account.

The port is fixed for now. When running from the code, `COACH_PORT=9000
./music-coach` uses another one. Choosing it in the app is tracked in the
issues.

When the app opens and finds a Music Coach server from another copy of the
code already on that port (for example the version before an update), it asks
that server to stop and starts its own. It only does this when the page on the
port is Music Coach.

## Reporting a vulnerability

Please report security problems privately: open the
[Security tab](https://github.com/stylusnexus/music-coach/security) and choose
**Report a vulnerability**, or email [admin@stylusnexus.com](mailto:admin@stylusnexus.com).
Don't open a public issue.

Especially welcome: anything that lets another website or another user on the
Mac read the API key, read files outside the chosen sample folders, or send
requests to the local server.
