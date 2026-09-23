# Security

Music Coach runs a small server on the user's Mac, listening only on
`127.0.0.1`. It stores an optional API key for the coach model in a local file
readable only by the user's account.

## Reporting a vulnerability

Please report security problems privately: open the
[Security tab](https://github.com/stylusnexus/music-coach/security) and choose
**Report a vulnerability**. Don't open a public issue.

Especially welcome: anything that lets another website or another user on the
Mac read the API key, read files outside the chosen sample folders, or send
requests to the local server.
