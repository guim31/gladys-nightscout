# Nightscout for Gladys Assistant

> **NOT A MEDICAL DEVICE.** This integration copies into Gladys what a
> Nightscout site shows. Never use it for a treatment decision: its values and
> alerts may be late, wrong or missing. Keep the alarms of your sensor, pump or
> follow app.

An external integration for [Gladys Assistant](https://gladysassistant.com)
that reads a [Nightscout](https://nightscout.github.io/) site, the open-source,
self-hosted home of continuous glucose monitoring data (Dexcom, FreeStyle
Libre, Medtronic… through xDrip+, AndroidAPS, Loop and others). Read only.

- **One device per site**: glucose (mg/dL or mmol/L), change over 5 minutes,
  trend (number and arrow), age of the last value, out of target range, and
  the uploader battery when the site reports it. Health data: no history by
  default.
- **Scene triggers**: glucose low, very low, high (the thresholds of
  Nightscout, or fixed ones), back in range, rising fast, falling fast,
  measurement too old. Once per crossing, kept across restarts.
- **Scene action**: read the glucose, with a ready sentence for a message
  ("Glucose 142 mg/dL → +3, 4 min ago").
- **Dashboard widget**: glucose colored by the range of the site, trend, age
  and the curve of the last three hours.
- Access token (recommended), API_SECRET or public site; self-hosted at home
  or hosted (local or cloud badge).
- Texts in English, French, German and Spanish.

Neighbours: [gladys-dexcom](https://github.com/LM1LC3N7/gladys-dexcom) and
[gladys-librelinkup](https://github.com/LM1LC3N7/gladys-librelinkup) read the
clouds of the sensor makers; this one reads your own Nightscout, whatever the
sensor. The feature names, the trend numbers and the trigger keys follow
theirs, so scenes look the same.

Tested against a real Nightscout in Docker (15.0.8 with MongoDB), fed with
simulated values (fast fall, highs, lows, missing data), with a read-only
token, with the API_SECRET and on a public site.
**Developed without the hardware: feedback welcome** on
[the issues](https://github.com/guim31/gladys-nightscout/issues).

## Requirements

- Gladys Assistant 5.1.0 or later.
- A Nightscout site (14 or 15) reachable from Gladys.
- An access token with the `readable` role (Nightscout → Admin tools → Add
  new Subject), the API_SECRET, or nothing for a public site.

## Installation

In Gladys, **Integrations → Install from GitHub**, address
`https://github.com/guim31/gladys-nightscout`. Then enter the address of the
site and the token in the configuration, **Test the connection**, and add the
device from the **Discover** tab. The full guide: [docs/en.md](docs/en.md)
([fr](docs/fr.md), [de](docs/de.md), [es](docs/es.md)).

## How it works

The container reads `GET /api/v1/status.json` (unit, thresholds), the values
of the last three hours (`/api/v1/entries/sgv.json`) and the uploader battery
(`/api/v1/devicestatus.json`) every 1, 2 or 5 minutes, on its own timer:
Gladys never polls the device, and the triggers work whether it is added or
not. Only the changed values are published. The state of the triggers is kept
in `/data`, without any glucose value. A value older than the chosen delay (15
minutes by default) is never published as current and fires no glucose
trigger.

## Limits

- **Not a medical device**: no guarantee of delay or delivery.
- One Nightscout site per integration.
- Read every minute at best: a trigger may come after the alarm of
  Nightscout.
- Not read: insulin and carbs on board, pump and loop details, treatments.
- Unofficial integration, not affiliated with the Nightscout project.

## Development

```bash
npm ci
npm run format:check && npm run lint && npm test
npx -y github:GladysAssistant/integration-store --skip-image-check .
```

See [CLAUDE.md](CLAUDE.md) for the project rules and the notes on the
Nightscout API.

## Credits

- [Nightscout cgm-remote-monitor](https://github.com/nightscout/cgm-remote-monitor)
  by the Nightscout contributors (AGPL-3.0): the answers in
  `test/fixtures/nightscout` come from its Docker image. The cover uses the
  Nightscout logo from its repository.
- The trend numbers and arrows of
  [pydexcom](https://github.com/gagebenne/pydexcom), through
  [gladys-dexcom](https://github.com/LM1LC3N7/gladys-dexcom); the Home
  Assistant `nightscout` integration and
  [py-nightscout](https://github.com/marciogranzotto/py-nightscout) as
  reference.
- Built from the official
  [Gladys integration template](https://github.com/GladysAssistant/integration-template-js)
  and on the architecture of
  [gladys-scrutiny](https://github.com/guim31/gladys-scrutiny).

Not affiliated with the Nightscout project, Dexcom or Abbott.

## License

Apache-2.0, see [LICENSE](LICENSE).
