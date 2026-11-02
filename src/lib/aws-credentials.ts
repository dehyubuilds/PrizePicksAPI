import { config } from "@/lib/config";

/** Explicit keys when set; otherwise AWS SDK uses default chain (~/.aws/credentials). */
export function optionalAwsCredentials():
  | { accessKeyId: string; secretAccessKey: string }
  | undefined {
  const { accessKeyId, secretAccessKey } = config.aws;
  if (accessKeyId && secretAccessKey) {
    return { accessKeyId, secretAccessKey };
  }
  return undefined;
}

export function awsClientConfig(): { region: string; credentials?: { accessKeyId: string; secretAccessKey: string } } {
  const credentials = optionalAwsCredentials();
  return credentials ? { region: config.aws.region, credentials } : { region: config.aws.region };
}
