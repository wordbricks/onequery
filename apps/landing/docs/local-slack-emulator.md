# Local Slack Emulator

The landing app sends lead-capture notifications through
`LANDING_SLACK_WEBHOOK_URL`. `bun run dev` starts the Slack emulator when that
environment variable is unset, then injects the emulator webhook URL into Astro.

Start local development with:

```bash
rtk bun run dev
```

Submit the product updates form or the contact form in the local landing page,
then inspect the stored Slack messages at:

```text
http://localhost:4003/
```

The default emulator webhook posts to the emulator's `general` channel:

```text
http://localhost:4003/services/T000000001/B000000001/X000000001
```

If `LANDING_SLACK_WEBHOOK_URL` is already configured, `bun run dev` uses that
value and does not start the emulator. To keep the old null-sink behavior, run:

```bash
rtk env LANDING_SLACK_EMULATOR=0 bun run dev
```

You can still run only the emulator with:

```bash
rtk bun run slack:emulate
```
