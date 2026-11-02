# Sports Daily collector

The collector creates an immutable, point-in-time evidence bundle for AoTQ. It does not place wagers or publish picks.

```bash
npm run sports-daily:collect -- --estimate
npm run sports-daily:collect -- --dry-run --sports NBA --max-credits 20
npm run sports-daily:collect -- --upload --sports NBA --max-credits 20
```

`--estimate` makes no sportsbook request. `--dry-run` retrieves live data and writes only a local bundle. `--upload` writes the bundle once under:

```text
aotq/sports-daily/evidence-bundles/YYYY/MM/DD/<bundleId>.json
```

The write uses `If-None-Match: *`, private bucket access, no-store caching, and SSE-S3 by default. Set `AOTQ_SPORTS_DAILY_KMS_KEY_ID` to use a customer-managed KMS key.

## Collector role

Use a dedicated role or IAM user. Replace the placeholders and do not grant access to the public `picks/` prefix.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "WriteEvidenceBundles",
      "Effect": "Allow",
      "Action": ["s3:PutObject"],
      "Resource": "arn:aws:s3:::YOUR_BUCKET/aotq/sports-daily/evidence-bundles/*"
    },
    {
      "Sid": "WriteQuantSnapshots",
      "Effect": "Allow",
      "Action": ["s3:PutObject"],
      "Resource": "arn:aws:s3:::YOUR_BUCKET/quant/prizepicks/snapshots/*"
    }
  ]
}
```

If KMS is enabled, add `kms:Encrypt` only for the configured key and constrain it with the S3 encryption-context condition. CloudTrail data events should be enabled for the evidence prefix. Never put API keys, cookies, OAuth tokens, private keys, or AWS credentials in a bundle.

## Operational behavior

- Sportsbook requests have a per-run credit cap.
- X/xAI research is off unless `--with-x` is passed and its existing spend guard is configured.
- Kalshi data is marked contextual; it is not treated as a player-prop probability.
- Missing source data becomes an explicit limitation. The collector does not invent observations.
- Uploading starts draft generation only after the AoTQ intake stack is deployed.
