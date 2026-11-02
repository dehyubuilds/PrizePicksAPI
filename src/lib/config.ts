import { readPublicAppUrl, readDropflowSecrets, twilioFeatureEnabled } from "./dropflow-env";

const secrets = readDropflowSecrets();

export const config = {
  aws: {
    ...secrets.aws,
  },
  app: {
    name: "Dropflow",
    baseUrl: readPublicAppUrl(),
  },
  cognito: {
    ...secrets.cognito,
    useReal: true,
  },
  twilio: {
    ...secrets.twilio,
    useReal: twilioFeatureEnabled(),
  },
  /** Dropflow uses email/Cognito sign-in only; no SMS gate. */
  phoneVerificationRequired: false,
  dynamo: {
    region: secrets.aws.region,
    tables: {
      users: "statics_users",
      apps: "statics_apps",
      subscriptions: "statics_subscriptions",
      subscriptionStop: "statics_subscription_stop",
      verify: "statics_verify",
      dropflow_users: "dropflow_users",
      dropflow_beats: "dropflow_beats",
      dropflow_episodes: "dropflow_episodes",
      dropflow_orders: "dropflow_orders",
      dropflow_events: "dropflow_events",
      dropflow_user_saved_beats: "dropflow_user_saved_beats",
      dropflow_user_dismissed_orders: "dropflow_user_dismissed_orders",
      dropflow_user_favorites: "dropflow_user_favorites",
      dropflow_youtube_importer_allowlist: "dropflow_youtube_importer_allowlist",
      dropflow_buyer_waitlist: "dropflow_buyer_waitlist",
      dropflow_referrals: "dropflow_referrals",
      dropflow_comments: "dropflow_comments",
      dropflow_playlists: "dropflow_playlists",
      dropflow_series: "dropflow_series",
      dropflow_youtube_beat_index: "statics_dropflow_youtube_beat_index",
      dropflow_instagram_beat_index: "statics_dropflow_instagram_beat_index",
      youtube_import_daily: "statics_youtube_import_daily",
      youtube_import_job_meta: "statics_youtube_import_job_meta",
      instagram_import_job_meta: "statics_instagram_import_job_meta",
    },
    useReal: true,
  },
  dropflow: {
    platformFeePercent: 0.05,
    minPriceCents: 100,
    previewDurationSeconds: 15,
    episodePreviewDurationSeconds: 60,
    bucket: secrets.s3.tracksBucket,
    baseUrl: secrets.s3.cdnBaseUrl,
    previewLambdaName: "dropflow-generate-preview",
    episodeProcessLambdaName: "dropflow-generate-preview",
    mediaconvertSubmitLambdaName:
      process.env.DROPFLOW_MEDIACONVERT_SUBMIT_LAMBDA?.trim() || "dropflow-mediaconvert-submit",
    mediaconvertJobsTable:
      process.env.DROPFLOW_MEDIACONVERT_JOBS_TABLE?.trim() || "dropflow_mediaconvert_jobs",
    ordersBuyerByDateGsi: "buyer-by-date",
  },
  youtubeImport: {
    lambdaName: "",
    workerApiBaseUrl: "",
    workerApiSharedSecret: "",
    localWebSocketMode: true,
    /** Dropflow-only stack `dropflow-youtube-import-ws` (not shared with AoTQ). */
    localWsJobsTable: "dropflow-youtube-import-jobs",
    localWebSocketUrl: "wss://ncnv21aq13.execute-api.us-east-1.amazonaws.com/prod",
  },
  youtubeDataApiKey: secrets.youtubeDataApiKey,
  stripe: {
    secretKey: secrets.stripe.secretKey,
    webhookSecret: secrets.stripe.webhookSecret,
    dropflowPremiumPriceId:
      process.env.STRIPE_DROPFLOW_PREMIUM_PRICE_ID?.trim() || "",
    useReal: true,
  },
  dropflowPremium: {
    monthlyDownloadQuota: 50,
    /** Used when STRIPE_DROPFLOW_PREMIUM_PRICE_ID is unset (Stripe Checkout price_data). */
    monthlyPriceCents: Math.max(
      199,
      Math.round(Number(process.env.DROPFLOW_PREMIUM_MONTHLY_PRICE_CENTS ?? "999")) || 999
    ),
    checkoutEnabled: Boolean(secrets.stripe.secretKey),
  },
  resend: {
    apiKey: secrets.resend.apiKey,
    from: secrets.resend.from,
  },
  avatar: {
    bucket: secrets.s3.avatarBucket,
    baseUrl: secrets.s3.avatarBaseUrl,
    useReal: true,
  },
  admin: {
    adminEmail: secrets.adminEmail || "dehyu.sinyan@gmail.com",
  },
} as const;
